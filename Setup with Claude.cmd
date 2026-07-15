@echo off
REM Double-click to have Claude Code install the Jira MCP server for you.
REM Keep this file next to SETUP-WITH-CLAUDE.md.
setlocal
cd /d "%~dp0"

where claude >nul 2>nul
if errorlevel 1 (
  echo.
  echo Claude Code was not found on this machine.
  echo.
  echo Install it, then double-click this again:
  echo     npm install -g @anthropic-ai/claude-code
  echo   ^(see https://claude.com/claude-code^)
  echo.
  echo No Claude Code? You can instead open the Claude desktop app and drag the
  echo file "SETUP-WITH-CLAUDE.md" into a chat — Claude will guide you through it.
  echo.
  pause
  exit /b 1
)

echo Starting Claude Code to set up the Jira MCP server...
echo (Claude will ask you for your Atlassian email and API token.)
echo.
claude "Read the file SETUP-WITH-CLAUDE.md in this folder and follow it exactly to install the Jira MCP server on my machine. Ask me for any information you need."
