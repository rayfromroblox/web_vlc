@echo off
setlocal
title web_vlc
cd /d "%~dp0"

if "%WEBVLC_PORT%"=="" set "WEBVLC_PORT=4000"

echo.
echo   web_vlc - local media, beautifully played
echo   Getting things ready…
echo.

set "WEBVLC_OPEN_BROWSER=1"
npm start
if errorlevel 1 (
  echo.
  echo web_vlc could not start. Install Node.js 20, 22, or 24, then run this file again.
  pause
)
