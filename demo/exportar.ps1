param([string]$Hyperframes)

$ErrorActionPreference = 'Stop'
if (-not $Hyperframes) { $Hyperframes = (Get-Command hyperframes.cmd).Source }
$project = Join-Path $PSScriptRoot 'hyperframes'
$video = Join-Path $PSScriptRoot 'reserva-salas-demo.mp4'
$shots = Join-Path $PSScriptRoot 'capturas'
$marks = Get-Content -Raw (Join-Path $project 'marcas.json') | ConvertFrom-Json
$timeList = ($marks | ForEach-Object { $_.time }) -join ','

& $Hyperframes lint $project
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $Hyperframes render $project --strict --no-best-effort --fps 25 --quality looks --workers 3 --video-frame-format png --output $video
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

New-Item -ItemType Directory -Force -Path $shots | Out-Null
& $Hyperframes snapshot $project --at $timeList --zoom '80,30,1280,900' --zoom-scale 1 --no-end --keep --output $shots
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
foreach ($mark in $marks) {
  $time = $mark.time.TrimEnd('0').TrimEnd('.')
  $source = Join-Path $shots "at-${time}s.png"
  Move-Item -LiteralPath $source -Destination (Join-Path $shots ($mark.name + '.png')) -Force
}
