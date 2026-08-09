@echo off
setlocal
title web_vlc
cd /d "%~dp0"

if "%WEBVLC_PORT%"=="" set "WEBVLC_PORT=4000"

echo.
echo   web_vlc - local media, beautifully played
echo   Starting at http://127.0.0.1:%WEBVLC_PORT%
if "%WEBVLC_MEDIA_DIR%"=="" (
  echo   Tip: set WEBVLC_MEDIA_DIR to choose a different media folder.
)
echo.

start "" "http://127.0.0.1:%WEBVLC_PORT%"
node server.js
if errorlevel 1 (
  echo.
  echo web_vlc could not start. Confirm that Node.js 20 or newer is installed.
  pause
)
