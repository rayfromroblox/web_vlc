@echo off
title Edits Viewer
cd /d "%~dp0"
echo Starting Edits Viewer...
start http://localhost:4000
node server.js
if errorlevel 1 (
  echo.
  echo Failed to start server. Make sure Node.js is installed.
  echo Press any key to exit...
  pause >nul
)
