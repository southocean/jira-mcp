#!/bin/bash
# Double-click to have Claude Code install the Jira MCP server for you (macOS).
# Keep this file next to SETUP-WITH-CLAUDE.md.
# First time, you may need: chmod +x "Setup with Claude.command"
cd "$(dirname "$0")" || exit 1

if ! command -v claude >/dev/null 2>&1; then
  echo
  echo "Claude Code was not found on this machine."
  echo
  echo "Install it, then double-click this again:"
  echo "    npm install -g @anthropic-ai/claude-code"
  echo "  (see https://claude.com/claude-code)"
  echo
  echo "No Claude Code? Open the Claude desktop app and drag the file"
  echo "\"SETUP-WITH-CLAUDE.md\" into a chat — Claude will guide you through it."
  echo
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

echo "Starting Claude Code to set up the Jira MCP server..."
echo "(Claude will ask you for your Atlassian email and API token.)"
echo
claude "Read the file SETUP-WITH-CLAUDE.md in this folder and follow it exactly to install the Jira MCP server on my machine. Ask me for any information you need."
