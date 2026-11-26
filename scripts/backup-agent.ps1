param([string]$NodePath)

if (-not $NodePath) { $NodePath = (Get-Command node.exe).Source }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$mutex = New-Object System.Threading.Mutex($false, "Local\ReservaSalasBackup-$($identity.User.Value)")
$owns = $false
try {
  try { $owns = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns = $true }
  if (-not $owns) { exit 0 }
  $shell = (Get-Command powershell.exe).Source
  $job = Join-Path $PSScriptRoot 'backup-daily.ps1'
  while ($true) {
    $today = Get-Date -Format 'yyyy-MM-dd'
    $archive = Join-Path $env:LOCALAPPDATA "ReservaSalas\Copias\reserva-salas-diaria-$today.dump"
    if (-not (Test-Path -LiteralPath $archive)) {
      & $shell -NoProfile -NonInteractive -File $job -NodePath $NodePath
    }
    Start-Sleep -Seconds 1800
  }
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
