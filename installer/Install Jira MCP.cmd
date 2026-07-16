@echo off
REM Double-click to install (or update) the Jira MCP server on Windows.
setlocal
cd /d "%~dp0"

REM Locate app\cli.js — beside this script (unzipped release) or one level up
REM (running from a git clone, where launchers live in installer\).
set "APPDIR=%~dp0app"
if not exist "%APPDIR%\cli.js" set "APPDIR=%~dp0..\app"
if not exist "%APPDIR%\cli.js" (
  echo.
  echo Could not find the Jira MCP program files ^("app\cli.js"^).
  echo.
  echo This installer needs to sit next to the "app" folder. Run it from the
  echo unzipped jira-mcp folder ^(don't move this file out on its own^), or if you
  echo cloned the repo, run it from the "installer" folder inside the clone.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found. Installing a local copy just for you ^(no admin needed^)...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%APPDIR%\ensure-node.ps1"
  if errorlevel 1 (
    echo.
    echo Automatic Node.js install failed. Please install it from https://nodejs.org/
    echo then run this installer again.
    echo.
    echo IMPORTANT: during the Node.js setup, do NOT tick "Tools for Native Modules"
    echo ^(it installs Chocolatey, Python and Visual Studio Build Tools — none of which
    echo this tool needs^). Just click Next through that screen.
    echo.
    pause
    exit /b 1
  )
  REM Make the freshly installed Node available to this window.
  set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
)

REM The released zip bundles the server's dependencies; a git clone doesn't.
REM If they're missing, install them here (pure-JS deps — no native build).
if exist "%APPDIR%\node_modules" goto depsok
echo.
echo Installing the server's dependencies ^(first run from a source copy^)...
echo.
pushd "%APPDIR%"
call npm install --omit=dev
set "DEPRC=%errorlevel%"
popd
if not "%DEPRC%"=="0" (
  echo.
  echo Could not install the dependencies automatically. Open a terminal in
  echo    "%APPDIR%"
  echo and run:  npm install --omit=dev
  echo then run this installer again.
  echo.
  pause
  exit /b 1
)
:depsok

node "%APPDIR%\cli.js" install
echo.
pause
