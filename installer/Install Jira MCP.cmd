@echo off
REM Double-click to install (or update) the Jira MCP server on Windows.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found. Installing a local copy just for you ^(no admin needed^)...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\ensure-node.ps1"
  if errorlevel 1 (
    echo.
    echo Automatic Node.js install failed. Please install it from https://nodejs.org/
    echo then run this installer again.
    echo.
    pause
    exit /b 1
  )
  REM Make the freshly installed Node available to this window.
  set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
)

node "%~dp0app\cli.js" install
echo.
pause
