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
$server = Start-Process -FilePath (Get-Command node).Source -ArgumentList (Join-Path $projectRoot 'server.js') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru

try {
  $ready = $false
  1..40 | ForEach-Object {
    if ($ready) { return }
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 1
      $ready = $health.ok -eq $true
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $ready) { throw 'web_vlc did not become ready.' }

  $edgeCandidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
  )
  $edge = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $edge) { throw 'Microsoft Edge was not found on the Windows runner.' }

  $timer = [Diagnostics.Stopwatch]::StartNew()
  & $edge --headless --disable-gpu --no-first-run --dump-dom --virtual-time-budget=2500 "http://127.0.0.1:$port/" 2>$null | Set-Content -Path $outputFile -Encoding UTF8
  if ($LASTEXITCODE -ne 0) { throw "Edge exited with code $LASTEXITCODE." }
  $timer.Stop()

  $html = [IO.File]::ReadAllText($outputFile)
  $cardCount = [regex]::Matches($html, '<article class="media-card').Count
  if ($cardCount -ne 72) { throw "Expected 72 rendered cards for 1,000 items; found $cardCount." }
  if ($html -notmatch '>1000 items<') { throw 'The 1,000-item result count was not rendered.' }
  if ($timer.Elapsed.TotalSeconds -gt 15) { throw "Large-library page load took $($timer.Elapsed.TotalSeconds.ToString('0.00')) seconds." }

  Write-Host "Windows Edge smoke test passed: $cardCount cards rendered in $($timer.Elapsed.TotalSeconds.ToString('0.00')) seconds."
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
  Remove-Item -Recurse -Force $testRoot -ErrorAction SilentlyContinue
}
