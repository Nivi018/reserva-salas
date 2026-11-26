$ErrorActionPreference = 'Stop'
$name = 'Reserva Salas - Copia local diaria'
$startup = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$shortcut = Join-Path $startup "$name.lnk"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User.Value
$directory = Join-Path $env:LOCALAPPDATA 'ReservaSalas\Copias'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
icacls.exe $directory /inheritance:r /grant:r "*${sid}:(OI)(CI)(F)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo proteger la carpeta de copias.' }
$node = (Get-Command node.exe).Source
$shell = (Get-Command powershell.exe).Source
$agent = Join-Path $PSScriptRoot 'backup-agent.ps1'
if (Test-Path -LiteralPath $shortcut) {
  throw 'Ya existe un acceso directo de copias. No se reemplazo ninguna configuracion.'
}
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
  throw 'La tarea ya existe. No se reemplazo ninguna configuracion.'
}
$script = Join-Path $PSScriptRoot 'backup-daily.ps1'
$action = New-ScheduledTaskAction -Execute $shell `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$script`" -NodePath `"$node`""
$daily = New-ScheduledTaskTrigger -Daily -At '20:00'
$logon = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$logon.Delay = 'PT2M'
$principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
  -RestartCount 8 -RestartInterval (New-TimeSpan -Minutes 30) -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
try {
  Register-ScheduledTask -TaskName $name -Action $action -Trigger @($daily, $logon) `
    -Principal $principal -Settings $settings -Description 'Copia privada de Reserva Salas con restauracion de prueba y retencion de 14 copias.' | Out-Null
} catch {
  if ($_.CategoryInfo.Category -ne 'PermissionDenied' -and $_.FullyQualifiedErrorId -notlike '*0x80070005*') { throw }
  $argsForAgent = "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$agent`" -NodePath `"$node`""
  $wsh = New-Object -ComObject WScript.Shell
  $link = $wsh.CreateShortcut($shortcut)
  $link.TargetPath = $shell
  $link.Arguments = $argsForAgent
  $link.WorkingDirectory = (Split-Path -Parent $PSScriptRoot)
  $link.Description = 'Copia diaria privada de Reserva Salas'
  $link.Save()
  Start-Process -FilePath $shell -ArgumentList $argsForAgent -WindowStyle Hidden
  Write-Host 'Copias activadas para esta cuenta al iniciar sesion en Windows, con reintento cada 30 minutos.'
  exit 0
}
Start-ScheduledTask -TaskName $name
Write-Host 'Copia programada a las 20:00 y al iniciar sesion en Windows.'
