$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$username = Read-Host 'Nombre de usuario'
$email = Read-Host 'Correo electronico'
$secure = Read-Host 'Contrasena (minimo 12 caracteres)' -AsSecureString
$confirmation = Read-Host 'Repite la contrasena' -AsSecureString
try {
  $password = [System.Net.NetworkCredential]::new('', $secure).Password
  if ($password -cne [System.Net.NetworkCredential]::new('', $confirmation).Password) {
    throw 'Las contrasenas no coinciden.'
  }
  @{ username = $username; email = $email; password = $password } | ConvertTo-Json -Compress |
    node --env-file=.env --import tsx server/src/bootstrap-admin.ts
  exit $LASTEXITCODE
} finally {
  Remove-Variable password -ErrorAction SilentlyContinue
  $secure.Dispose()
  $confirmation.Dispose()
}
