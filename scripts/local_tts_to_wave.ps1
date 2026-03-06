param(
  [Parameter(Mandatory = $true)]
  [string]$TextPath,

  [Parameter(Mandatory = $true)]
  [string]$OutPath,

  [string]$Voice = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Speech

$text = [System.IO.File]::ReadAllText($TextPath, [System.Text.Encoding]::UTF8)

if ([string]::IsNullOrWhiteSpace($text)) {
  throw "TextPath did not contain any speech input."
}

$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()

try {
  if (-not [string]::IsNullOrWhiteSpace($Voice)) {
    $synth.SelectVoice($Voice)
  }

  $synth.SetOutputToWaveFile($OutPath)
  $synth.Speak($text)
} finally {
  $synth.Dispose()
}
