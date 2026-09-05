param(
  [string]$NodeVersion,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\release")
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if (-not $NodeVersion) {
  $NodeVersion = (& node --version).Trim()
}

if (-not $NodeVersion.StartsWith("v")) {
  $NodeVersion = "v$NodeVersion"
}

$releaseName = "web_vlc-windows-x64"
$stagingDirectory = Join-Path $env:TEMP "$releaseName-$([guid]::NewGuid().ToString('N'))"
$runtimeArchive = Join-Path $env:TEMP "node-$NodeVersion-win-x64.zip"
$runtimeUrl = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
$releaseDirectory = Join-Path $OutputDirectory $releaseName
$releaseZip = Join-Path $OutputDirectory "$releaseName.zip"

try {
  New-Item -ItemType Directory -Force -Path $stagingDirectory, $OutputDirectory | Out-Null
  $releaseEntries = @(
    'config.js',
    'db.js',
    'server.js',
    'start.js',
    'package.json',
    'package-lock.json',
    'README.md',
    'public',
    'Open web_vlc.bat',
    'Open web_vlc.vbs',
    'start.bat'
  )
  foreach ($releaseEntry in $releaseEntries) {
    Copy-Item -Path (Join-Path $projectRoot $releaseEntry) -Destination $stagingDirectory -Recurse -Force
  }

  Invoke-WebRequest -Uri $runtimeUrl -OutFile $runtimeArchive
  Expand-Archive -Path $runtimeArchive -DestinationPath $env:TEMP -Force
  $extractedRuntime = Join-Path $env:TEMP "node-$NodeVersion-win-x64"
  New-Item -ItemType Directory -Force -Path (Join-Path $stagingDirectory 'runtime') | Out-Null
  Get-ChildItem -Force $extractedRuntime | Copy-Item -Destination (Join-Path $stagingDirectory 'runtime') -Recurse -Force

  Push-Location $stagingDirectory
  try {
    & (Join-Path $stagingDirectory 'runtime\npm.cmd') ci --omit=dev --no-audit --no-fund
    & (Join-Path $stagingDirectory 'runtime\npm.cmd') rebuild better-sqlite3 --no-audit --no-fund
  } finally {
    Pop-Location
  }

  Remove-Item -Recurse -Force $releaseDirectory -ErrorAction SilentlyContinue
  Move-Item $stagingDirectory $releaseDirectory
  Remove-Item -Force $releaseZip -ErrorAction SilentlyContinue
  Compress-Archive -Path $releaseDirectory -DestinationPath $releaseZip -Force
  Write-Host "Portable release created: $releaseZip"
} finally {
  Remove-Item -Recurse -Force $stagingDirectory -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force (Join-Path $env:TEMP "node-$NodeVersion-win-x64") -ErrorAction SilentlyContinue
  Remove-Item -Force $runtimeArchive -ErrorAction SilentlyContinue
}
