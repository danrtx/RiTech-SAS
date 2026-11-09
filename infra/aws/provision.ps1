$ErrorActionPreference = 'Stop'
$region='us-east-2'
$account='816352409922'
$name='ritech-demo'
$repo=Resolve-Path "$PSScriptRoot/../.."
$out=Join-Path (Split-Path $repo) 'reportes/aws-deploy'
New-Item -ItemType Directory -Force $out | Out-Null
function JsonFile($name,$value) { $path=Join-Path $out $name; [IO.File]::WriteAllText($path,($value | ConvertTo-Json -Depth 30),(New-Object Text.UTF8Encoding $false)); return "file://$path" }
function AwsJson([string[]]$arguments) { $raw=& aws @arguments --region $region --output json --no-cli-pager; if($LASTEXITCODE -ne 0){throw "AWS operation failed: $($arguments[0..1] -join ' ')"}; if($raw){return ($raw -join "`n" | ConvertFrom-Json)} }
if((AwsJson @('sts','get-caller-identity')).Account -ne $account){throw 'Unexpected AWS account'}
if(Test-Path "$out/state.json"){throw 'Deployment state exists; inspect before provisioning again'}
$bucket="$name-$account-ohio-artifacts"
& aws s3api head-bucket --bucket $bucket --region $region 2>$null
if($LASTEXITCODE -ne 0){ AwsJson @('s3api','create-bucket','--bucket',$bucket,'--create-bucket-configuration','LocationConstraint=us-east-2') | Out-Null }
AwsJson @('s3api','put-public-access-block','--bucket',$bucket,'--public-access-block-configuration','BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true') | Out-Null
$enc=JsonFile 'bucket-encryption.json' @{Rules=@(@{ApplyServerSideEncryptionByDefault=@{SSEAlgorithm='AES256'}})}
AwsJson @('s3api','put-bucket-encryption','--bucket',$bucket,'--server-side-encryption-configuration',$enc) | Out-Null
AwsJson @('s3api','put-bucket-versioning','--bucket',$bucket,'--versioning-configuration','Status=Enabled') | Out-Null
$bp=JsonFile 'bucket-policy.json' @{Version='2012-10-17';Statement=@(@{Effect='Deny';Principal='*';Action='s3:*';Resource=@("arn:aws:s3:::$bucket","arn:aws:s3:::$bucket/*");Condition=@{Bool=@{'aws:SecureTransport'='false'}}})}
AwsJson @('s3api','put-bucket-policy','--bucket',$bucket,'--policy',$bp) | Out-Null
$secret=AwsJson @('secretsmanager','create-secret','--name',"$name/runtime",'--description','RiTech isolated demo runtime configuration')
$trust=JsonFile 'instance-trust.json' @{Version='2012-10-17';Statement=@(@{Effect='Allow';Principal=@{Service='ec2.amazonaws.com'};Action='sts:AssumeRole'})}
AwsJson @('iam','create-role','--role-name',"$name-host",'--assume-role-policy-document',$trust) | Out-Null
AwsJson @('iam','attach-role-policy','--role-name',"$name-host",'--policy-arn','arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore') | Out-Null
$permissions=JsonFile 'instance-permissions.json' @{Version='2012-10-17';Statement=@(@{Effect='Allow';Action=@('s3:GetObject');Resource="arn:aws:s3:::$bucket/release/*"},@{Effect='Allow';Action='secretsmanager:GetSecretValue';Resource=$secret.ARN})}
AwsJson @('iam','put-role-policy','--role-name',"$name-host",'--policy-name','ReleaseAndRuntime','--policy-document',$permissions) | Out-Null
AwsJson @('iam','create-instance-profile','--instance-profile-name',"$name-host") | Out-Null
AwsJson @('iam','add-role-to-instance-profile','--instance-profile-name',"$name-host",'--role-name',"$name-host") | Out-Null
$sg=AwsJson @('ec2','create-security-group','--group-name',"$name-web",'--description','RiTech HTTPS demo and ACME only; no DB or SSH ingress','--vpc-id','vpc-0f4e31fbd4b31e168')
$ingress=JsonFile 'web-ingress.json' @(@{IpProtocol='tcp';FromPort=80;ToPort=80;IpRanges=@(@{CidrIp='0.0.0.0/0';Description='ACME validation and HTTPS redirect only'})},@{IpProtocol='tcp';FromPort=443;ToPort=443;IpRanges=@(@{CidrIp='0.0.0.0/0';Description='Password protected HTTPS demo'})})
AwsJson @('ec2','authorize-security-group-ingress','--group-id',$sg.GroupId,'--ip-permissions',$ingress) | Out-Null
$boot=@'
#!/bin/bash
set -euo pipefail
dnf install -y docker openssl
systemctl enable --now docker amazon-ssm-agent
mkdir -p /opt/ritech
chmod 700 /opt/ritech
'@
$ami=(AwsJson @('ssm','get-parameter','--name','/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64')).Parameter.Value
$lt=JsonFile 'launch-template.json' @{ImageId=$ami;InstanceType='t3.small';IamInstanceProfile=@{Name="$name-host"};SecurityGroupIds=@($sg.GroupId);UserData=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($boot.Replace("`r",'')));MetadataOptions=@{HttpTokens='required';HttpEndpoint='enabled';HttpPutResponseHopLimit=1};CreditSpecification=@{CpuCredits='standard'};InstanceInitiatedShutdownBehavior='stop';BlockDeviceMappings=@(@{DeviceName='/dev/xvda';Ebs=@{Encrypted=$true;VolumeSize=30;VolumeType='gp3';DeleteOnTermination=$false}});TagSpecifications=@(@{ResourceType='instance';Tags=@(@{Key='Name';Value=$name},@{Key='Project';Value='RiTech-SAS'})},@{ResourceType='volume';Tags=@(@{Key='Project';Value='RiTech-SAS'})})}
$template=AwsJson @('ec2','create-launch-template','--launch-template-name',$name,'--launch-template-data',$lt)
Start-Sleep -Seconds 15
$instance=AwsJson @('ec2','run-instances','--launch-template',"LaunchTemplateId=$($template.LaunchTemplate.LaunchTemplateId),Version=1",'--subnet-id','subnet-0e5a1c4be386689ce','--count','1')
$instanceId=$instance.Instances[0].InstanceId
$eip=AwsJson @('ec2','allocate-address','--domain','vpc')
@{Region=$region;Account=$account;Bucket=$bucket;SecretArn=$secret.ARN;InstanceId=$instanceId;SecurityGroupId=$sg.GroupId;AllocationId=$eip.AllocationId;PublicIp=$eip.PublicIp;LaunchTemplateId=$template.LaunchTemplate.LaunchTemplateId} | ConvertTo-Json | Set-Content "$out/state.json"
& aws ec2 wait instance-running --instance-ids $instanceId --region $region
if($LASTEXITCODE -ne 0){throw 'Instance did not reach running'}
AwsJson @('ec2','associate-address','--instance-id',$instanceId,'--allocation-id',$eip.AllocationId) | Out-Null
Get-Content "$out/state.json"

