$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')

$port = 5174
if (-not (Test-Path -LiteralPath '.env')) { throw 'Falta configurar .env.' }
$setting = Get-Content -LiteralPath '.env' | Where-Object { $_ -match '^APP_PORT=' } | Select-Object -First 1
if ($setting) { $port = [int]($setting -replace '^APP_PORT=', '') }

docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  docker desktop start --timeout 75
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
docker compose up -d --wait db
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "El puerto $port ya está en uso. No se inició una segunda instancia."
  exit 0
}

npm.cmd run db:migrate
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (Test-Path -LiteralPath 'server/dist/index.js') -or -not (Test-Path -LiteralPath 'client/dist/index.html')) {
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
npm.cmd start
exit $LASTEXITCODE
