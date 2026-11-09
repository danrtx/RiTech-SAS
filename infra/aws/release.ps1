$ErrorActionPreference='Stop'
$repo=Resolve-Path "$PSScriptRoot/../.."
$out=Join-Path (Split-Path $repo) 'reportes/aws-deploy'
$state=Get-Content "$out/state.json" -Raw | ConvertFrom-Json
$region=$state.Region
$envValues=@{}
foreach($line in Get-Content "$repo/.env") { if($line -match '^([A-Z][A-Z0-9_]*)=(.*)$'){$envValues[$matches[1]]=$matches[2].Trim().Trim('"').Trim("'")} }
foreach($key in @('TWELVE_DATA_API_KEY','GEMINI_API_KEY')) {if(!$envValues[$key]){throw "Missing $key"}}
function RandomHex { return [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant() }
if (!(Test-Path "$out/runtime.env")) {
$db=RandomHex; $redis=RandomHex
$lines=@('NODE_ENV=production','PORT=3000','EXECUTION_MODE=disabled','FCM_ENABLED=false','MARKET_DATA_ENABLED=true','MARKET_DATA_PROVIDER=twelvedata','MARKET_DATA_FEED=realtime','MARKET_DATA_MAX_TICK_AGE_MS=2000','GEMINI_TIMEOUT_MS=30000','MARKET_DATA_SYMBOL=QQQ','GEMINI_ENABLED=true','GEMINI_MODEL=gemini-3.1-flash-lite','DB_HOST=postgres','DB_PORT=5432','DB_USER=ritech','DB_NAME=ritech',"DB_PASSWORD=$db",'REDIS_HOST=redis','REDIS_PORT=6379',"REDIS_PASSWORD=$redis",'DB_TLS_ENABLED=true','REDIS_TLS_ENABLED=true','DB_TLS_CA_FILE=/tls/ca.crt','REDIS_TLS_CA_FILE=/tls/ca.crt','SERVER_TLS_ENABLED=true','SERVER_TLS_CERT_FILE=/tls/server.crt','SERVER_TLS_KEY_FILE=/tls/server.key','SERVER_TLS_HEALTH_HOST=backend','SERVER_TLS_HEALTH_CA_FILE=/tls/ca.crt',"TWELVE_DATA_API_KEY=$($envValues['TWELVE_DATA_API_KEY'])", "GEMINI_API_KEY=$($envValues['GEMINI_API_KEY'])")
[IO.File]::WriteAllText("$out/runtime.env",($lines -join "`n"),(New-Object Text.UTF8Encoding $false))
[IO.File]::WriteAllText("$out/acceso-demo.txt","URL: https://$($state.PublicIp)`nAcceso público sin usuario ni contraseña.")
}
& aws secretsmanager put-secret-value --region $region --secret-id $state.SecretArn --secret-string "file://$out/runtime.env" --query VersionId --output text
if($LASTEXITCODE -ne 0){throw 'Secret upload failed'}
Push-Location "$repo/frontend_mobile"
try { & flutter build web --release "--dart-define=API_BASE_URL=https://$($state.PublicIp)" "--dart-define=WS_BASE_URL=https://$($state.PublicIp)/telemetry" '--dart-define=MARKET_SYMBOL=QQQ'; if($LASTEXITCODE -ne 0){throw 'Flutter build failed'} } finally {Pop-Location}
& tar -cf "$out/web.tar" -C "$repo/frontend_mobile/build/web" .
if($LASTEXITCODE -ne 0){throw 'Frontend archive failed'}
& docker build -t ritech-backend:aws-demo "$repo/backend"
if($LASTEXITCODE -ne 0){throw 'Backend image build failed'}
& docker save -o "$out/backend.tar" ritech-backend:aws-demo
if($LASTEXITCODE -ne 0){throw 'Backend archive failed'}
foreach($file in @('backend.tar','web.tar')) { & aws s3 cp "$out/$file" "s3://$($state.Bucket)/release/$file" --region $region --only-show-errors; if($LASTEXITCODE -ne 0){throw 'Artifact upload failed'} }
& aws s3 cp "$PSScriptRoot/bootstrap.sh" "s3://$($state.Bucket)/release/bootstrap.sh" --region $region --only-show-errors
if($LASTEXITCODE -ne 0){throw 'Bootstrap upload failed'}
$commands=@('set -eu', 'cloud-init status --wait', 'mkdir -p /opt/ritech', "aws s3 cp s3://$($state.Bucket)/release/bootstrap.sh /opt/ritech/bootstrap.sh --region $region --only-show-errors", 'sed -i ''s/\r$//'' /opt/ritech/bootstrap.sh', "bash /opt/ritech/bootstrap.sh $($state.Bucket) $($state.SecretArn) $($state.PublicIp)")
$parameters=@{commands=$commands;executionTimeout=@('1800')}
[IO.File]::WriteAllText("$out/ssm-parameters.json",($parameters | ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding $false))
& aws ssm send-command --instance-ids $state.InstanceId --document-name AWS-RunShellScript --parameters "file://$out/ssm-parameters.json" --region $region --query Command.CommandId --output text | Set-Content "$out/bootstrap-command-id.txt"
if($LASTEXITCODE -ne 0){throw 'SSM submission failed'}
Get-Content "$out/bootstrap-command-id.txt"
