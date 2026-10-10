# Builds the controller firmware with PlatformIO and refreshes the binary used
# by the browser installer (game/flash/firmware.bin).
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
$pio = Get-Command pio -ErrorAction SilentlyContinue
if (-not $pio) {
  $candidate = Join-Path $HOME '.platformio\penv\Scripts\pio.exe'
  if (Test-Path $candidate) { $pio = $candidate } else { throw 'PlatformIO not found. Install the PlatformIO IDE extension in VS Code or run: pip install platformio' }
} else { $pio = $pio.Source }
Push-Location (Join-Path $repo 'firmware')
try {
  & $pio run -e nodemcuv2
  if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
  Copy-Item '.pio\build\nodemcuv2\firmware.bin' (Join-Path $repo 'game\flash\firmware.bin') -Force
  Write-Host 'Updated game/flash/firmware.bin' -ForegroundColor Green
} finally { Pop-Location }
