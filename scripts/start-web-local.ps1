param([int]$WebPort = 8085)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$backendPort = '3000'
$envPath = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $envPath) {
    foreach ($line in Get-Content -LiteralPath $envPath) {
        if ($line -match '^\s*PORT\s*=\s*["'']?(\d+)["'']?\s*(?:#.*)?$') {
            $backendPort = $Matches[1]
        }
    }
}
if ([int]$backendPort -lt 1 -or [int]$backendPort -gt 65535 -or $WebPort -lt 1 -or $WebPort -gt 65535) {
    throw 'Puerto fuera del rango 1..65535.'
}
$baseUrl = "http://127.0.0.1:$backendPort"
# Fail early if this port belongs to another application or the backend is down.
$status = Invoke-RestMethod "$baseUrl/market-data/status" -TimeoutSec 10
if (-not $status.connection.provider) { throw 'El puerto no corresponde al backend de RiTech.' }
Write-Host "RiTech web: http://127.0.0.1:$WebPort -> $baseUrl"
Push-Location (Join-Path $projectRoot 'frontend_mobile')
try {
    & flutter run -d web-server --web-hostname 127.0.0.1 --web-port $WebPort "--dart-define=API_BASE_URL=$baseUrl" "--dart-define=WS_BASE_URL=$baseUrl/telemetry"
    if ($LASTEXITCODE -ne 0) { throw "Flutter terminó con código $LASTEXITCODE" }
} finally {
    Pop-Location
}
