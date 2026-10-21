$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$testRoot = Join-Path $env:RUNNER_TEMP "webvlc-browser-$([guid]::NewGuid().ToString('N'))"
$mediaDirectory = Join-Path $testRoot 'media'
$dataDirectory = Join-Path $testRoot 'data'
$outputFile = Join-Path $testRoot 'page.html'
$port = 4176

New-Item -ItemType Directory -Force -Path $mediaDirectory, $dataDirectory | Out-Null
1..1000 | ForEach-Object {
  $name = 'Track {0:D4}.mp3' -f $_
  [IO.File]::WriteAllBytes((Join-Path $mediaDirectory $name), [byte[]]@())
}

$env:WEBVLC_DATA_DIR = $dataDirectory
$env:WEBVLC_MEDIA_DIR = $mediaDirectory
$env:WEBVLC_PORT = "$port"
$env:WEBVLC_OPEN_BROWSER = '0'
$server = Start-Process -FilePath (Get-Command node).Source -ArgumentList (Join-Path $projectRoot 'start.js'), '--no-open' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru

try {
  $ready = $false
  1..40 | ForEach-Object {
    if ($ready) { return }
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 1
      $ready = $health.app -eq 'web_vlc'
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $ready) { throw 'web_vlc did not become ready.' }

  $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  if (-not (Test-Path $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }
  & $edge --headless=new --disable-gpu --virtual-time-budget=20000 --dump-dom "http://127.0.0.1:$port/" > $outputFile
  if ($LASTEXITCODE -ne 0) { throw "Edge exited with code $LASTEXITCODE." }

  $html = Get-Content -Raw $outputFile
  $renderedCards = ([regex]::Matches($html, 'class="media-card')).Count
  if ($renderedCards -ne 72) {
    throw "Expected the first batch of 72 media cards, found $renderedCards."
  }
  if ($html -notmatch 'resultCount[^>]*>1000 items<') {
    throw 'The result count did not report 1000 items.'
  }
  Write-Host "Rendered $renderedCards cards from a 1,000-item library."
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force $testRoot -ErrorAction SilentlyContinue
}
