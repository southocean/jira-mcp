@echo off
REM Double-click to remove the Jira MCP server from this machine.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found; cannot run the uninstaller.
  pause
  exit /b 1
)

node "%~dp0app\cli.js" uninstall
echo.
pause
