@echo off
REM Double-click to install (or update) the Jira MCP server on Windows.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is required but was not found on your PATH.
  echo Install it from https://nodejs.org/ then run this again.
  echo.
  pause
  exit /b 1
)

node "%~dp0app\cli.js" install
echo.
pause
