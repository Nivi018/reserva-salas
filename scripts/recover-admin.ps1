$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$identifier = Read-Host 'Correo o usuario del administrador'
$secure = Read-Host 'Contrasena nueva (minimo 12 caracteres)' -AsSecureString
$confirmation = Read-Host 'Repite la contrasena nueva' -AsSecureString
try {
  $password = [System.Net.NetworkCredential]::new('', $secure).Password
  if ($password -cne [System.Net.NetworkCredential]::new('', $confirmation).Password) {
    throw 'Las contrasenas no coinciden.'
  }
  @{ identifier = $identifier; password = $password } | ConvertTo-Json -Compress |
    node --env-file=.env --import tsx server/src/recover-admin.ts
  exit $LASTEXITCODE
} finally {
  Remove-Variable password -ErrorAction SilentlyContinue
  $secure.Dispose()
  $confirmation.Dispose()
}
