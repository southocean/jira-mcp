#!/bin/bash
# Double-click to install (or update) the Jira MCP server on macOS.
# First time, you may need: chmod +x "Install Jira MCP.command"
cd "$(dirname "$0")" || exit 1
HERE="$(dirname "$0")"

# Locate app/cli.js. This script lives in the macOS/ subfolder, so app/ is one
# level up in the unzipped release and two levels up when run from a git clone.
APPDIR=""
for cand in "$HERE/app" "$HERE/../app" "$HERE/../../app"; do
  if [ -f "$cand/cli.js" ]; then APPDIR="$cand"; break; fi
done
if [ -z "$APPDIR" ]; then
  echo
  echo "Could not find the Jira MCP program files (app/cli.js)."
  echo "Keep this macOS folder inside the unzipped jira-mcp folder and run it from there."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

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

# The released zip bundles the server's dependencies; a git clone doesn't.
# If they're missing, install them here (pure-JS deps — no native build).
if [ ! -d "$APPDIR/node_modules" ]; then
  echo
  echo "Installing the server's dependencies (first run from a source copy)..."
  echo
  if ! ( cd "$APPDIR" && npm install --omit=dev ); then
    echo
    echo "Could not install the dependencies automatically. In Terminal run:"
    echo "    cd \"$APPDIR\" && npm install --omit=dev"
    echo "then run this installer again."
    read -n 1 -s -r -p "Press any key to close..."
    exit 1
  fi
fi

node "$APPDIR/cli.js" install
echo
read -n 1 -s -r -p "Press any key to close..."
