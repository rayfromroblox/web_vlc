@echo off
setlocal
title web_vlc
cd /d "%~dp0"

set "WEBVLC_OPEN_BROWSER=1"
set "WEBVLC_RUNTIME=%~dp0runtime\node.exe"

if exist "%WEBVLC_RUNTIME%" (
  "%WEBVLC_RUNTIME%" "%~dp0start.js"
) else (
  where node >nul 2>nul
  if errorlevel 1 goto :missing_runtime
  node "%~dp0start.js"
)

set "WEBVLC_EXIT_CODE=%ERRORLEVEL%"
if not "%WEBVLC_EXIT_CODE%"=="0" pause
exit /b %WEBVLC_EXIT_CODE%

:missing_runtime
echo.
echo This source checkout needs Node.js 20 through 26.
echo Download a portable web_vlc release for one-click setup, or install Node.js and try again.
echo.
pause
exit /b 1
