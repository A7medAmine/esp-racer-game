# Tiny static web server for the game (no installs needed on Windows).
# Serves the game/ folder on http://localhost:8080 and opens the browser.
# Web Serial (USB) only works on http://localhost or https, which is why the
# game must be served instead of opened as a file.
param([int]$Port = 8080, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\game')).Path

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.mjs' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.bin' = 'application/octet-stream'
  '.wasm' = 'application/wasm'; '.txt' = 'text/plain; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'
}

$listener = $null
for ($p = $Port; $p -lt $Port + 20; $p++) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l
    $Port = $p
    break
  } catch { }
}
if (-not $listener) { Write-Host "Could not open a port between $Port and $($Port + 19)." -ForegroundColor Red; exit 1 }

$url = "http://localhost:$Port/"
Write-Host ""
Write-Host "  ESP Racer is running at $url" -ForegroundColor Green
Write-Host "  Use Chrome or Edge (needed for USB). Close this window to stop the game server."
Write-Host ""
if (-not $NoBrowser) { Start-Process $url }

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '' -or $rel.EndsWith('/')) { $rel += 'index.html' }
    $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if (-not $path.StartsWith($root) -or -not (Test-Path $path -PathType Leaf)) {
      $res.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes('Not found')
    } else {
      $ext = [IO.Path]::GetExtension($path).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $bytes = [IO.File]::ReadAllBytes($path)
    }
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    # Browser closed the connection early; ignore.
  } finally {
    try { $res.Close() } catch { }
  }
}
