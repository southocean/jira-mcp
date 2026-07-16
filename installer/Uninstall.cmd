@echo off
REM Double-click to remove the Jira MCP server from this machine.
setlocal
cd /d "%~dp0"

REM Locate app\cli.js — beside this script (unzipped release) or one level up (git clone).
set "APPDIR=%~dp0app"
if not exist "%APPDIR%\cli.js" set "APPDIR=%~dp0..\app"
if not exist "%APPDIR%\cli.js" (
  echo.
  echo Could not find the Jira MCP program files ^("app\cli.js"^) next to this script.
  echo Run this from the unzipped jira-mcp folder ^(or the clone's "installer" folder^).
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found; cannot run the uninstaller.
  pause
  exit /b 1
)

node "%APPDIR%\cli.js" uninstall
echo.
pause
