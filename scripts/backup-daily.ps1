param([string]$NodePath)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
if (-not $NodePath) { $NodePath = (Get-Command node.exe).Source }
$directory = Join-Path $env:LOCALAPPDATA 'ReservaSalas\Copias'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$lockPath = Join-Path $directory 'backup.lock'
try {
  $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
} catch [IO.IOException] {
  Write-Host 'Ya hay otra copia en curso.'
  exit 0
}

$status = Join-Path $directory 'estado.txt'
$day = Get-Date -Format 'yyyy-MM-dd'
$archive = Join-Path $directory "reserva-salas-diaria-$day.dump"
$staging = Join-Path $directory ("pendiente-" + [guid]::NewGuid().ToString('N') + '.dump')
$backupScript = Join-Path $PSScriptRoot 'backup.mjs'

function Invoke-BackupStep([string[]]$Arguments) {
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $result = & $NodePath $backupScript @Arguments 2>&1
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw ($result | Out-String).Trim() }
}

try {
  if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-BackupStep @('create', $staging)
    Invoke-BackupStep @('verify', $staging)
    [IO.File]::Move($staging, $archive)
  }
  $verified = Get-ChildItem -LiteralPath $directory -File |
    Where-Object { $_.Name -cmatch '^reserva-salas-diaria-\d{4}-\d{2}-\d{2}\.dump$' } |
    Sort-Object Name -Descending
  $verified | Select-Object -Skip 14 | Remove-Item -ErrorAction Stop
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') OK: $archive" | Set-Content -LiteralPath $status -Encoding UTF8
  Write-Host "Copia diaria verificada: $archive"
} catch {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ERROR: $($_.Exception.Message)" | Set-Content -LiteralPath $status -Encoding UTF8
  Write-Error $_ -ErrorAction Continue
  exit 1
} finally {
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -ErrorAction SilentlyContinue }
  $lock.Dispose()
}
