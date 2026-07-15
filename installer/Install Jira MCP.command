#!/bin/bash
# Double-click to install (or update) the Jira MCP server on macOS.
# First time, you may need: chmod +x "Install Jira MCP.command"
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js is required but was not found."
  echo "Install it from https://nodejs.org/ then run this again."
  echo
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

node "$(dirname "$0")/app/cli.js" install
echo
read -n 1 -s -r -p "Press any key to close..."
