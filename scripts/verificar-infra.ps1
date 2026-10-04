# Verifica que PostgreSQL y Redis de RiTech esten levantados y aceptando conexiones.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/verificar-infra.ps1

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Se creo .env a partir de .env.example"
}

# Leer variables de .env
$cfg = @{}
Get-Content ".env" | Where-Object { $_ -match '^\s*([^#=\s]+)\s*=\s*(.*)$' } | ForEach-Object {
    $cfg[$Matches[1]] = $Matches[2].Trim()
}

function Assert-Ok($msg) {
    if ($LASTEXITCODE -ne 0) { Write-Host $msg -ForegroundColor Red; exit 1 }
}

Write-Host "`n== Levantando servicios ==" -ForegroundColor Cyan
docker compose up -d --wait
Assert-Ok "Docker Compose fallo. Revisa: docker compose logs"

Write-Host "`n== Estado ==" -ForegroundColor Cyan
docker compose ps

Write-Host "`n== PostgreSQL ==" -ForegroundColor Cyan
docker compose exec -T postgres psql -U $cfg.POSTGRES_USER -d $cfg.POSTGRES_DB -tAc "select version();"
Assert-Ok "PostgreSQL no responde"

Write-Host "`n== Redis ==" -ForegroundColor Cyan
docker compose exec -T redis redis-cli --no-auth-warning -a $cfg.REDIS_PASSWORD ping
Assert-Ok "Redis no responde"
docker compose exec -T redis redis-cli --no-auth-warning -a $cfg.REDIS_PASSWORD set ritech:healthcheck ok EX 60 | Out-Null
docker compose exec -T redis redis-cli --no-auth-warning -a $cfg.REDIS_PASSWORD get ritech:healthcheck
Assert-Ok "Redis no permite escribir/leer"

Write-Host "`nTodo OK: PostgreSQL y Redis estan listos." -ForegroundColor Green
