#!/bin/bash
# Double-click to remove the Jira MCP server from this machine (macOS).
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found; cannot run the uninstaller."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

node "$(dirname "$0")/app/cli.js" uninstall
echo
read -n 1 -s -r -p "Press any key to close..."
