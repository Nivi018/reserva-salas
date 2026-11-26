$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$assets = Join-Path $PSScriptRoot 'hyperframes\assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null
$script = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'guion.json') | ConvertFrom-Json
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $speech.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female,
    [System.Speech.Synthesis.VoiceAge]::Adult, 0, [System.Globalization.CultureInfo]::GetCultureInfo('es-MX'))
  $speech.Rate = 1
  $speech.Volume = 95
  for ($i = 0; $i -lt $script.Count; $i++) {
    $name = 'voz-{0:00}.wav' -f ($i+1)
    $speech.SetOutputToWaveFile((Join-Path $assets $name))
    $speech.Speak($script[$i].voice)
    $speech.SetOutputToNull()
  }
} finally { $speech.Dispose() }
