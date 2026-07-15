#!/bin/bash
# Double-click to install (or update) the Jira MCP server on macOS.
# First time, you may need: chmod +x "Install Jira MCP.command"
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js was not found."
  if command -v brew >/dev/null 2>&1; then
    echo "Installing it with Homebrew..."
    if ! brew install node; then
      echo "Homebrew install failed. Please install Node.js from https://nodejs.org/ then run this again."
      read -n 1 -s -r -p "Press any key to close..."
      exit 1
    fi
  else
    echo "Please install Node.js from https://nodejs.org/ then run this again."
    echo "(It's a quick installer — download the macOS .pkg and run it.)"
    read -n 1 -s -r -p "Press any key to close..."
    exit 1
  fi
fi

node "$(dirname "$0")/app/cli.js" install
echo
read -n 1 -s -r -p "Press any key to close..."
