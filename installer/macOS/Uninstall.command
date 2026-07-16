#!/bin/bash
# Double-click to remove the Jira MCP server from this machine (macOS).
cd "$(dirname "$0")" || exit 1
HERE="$(dirname "$0")"

# Locate app/cli.js. This script lives in the macOS/ subfolder, so app/ is one
# level up in the unzipped release and two levels up when run from a git clone.
APPDIR=""
for cand in "$HERE/app" "$HERE/../app" "$HERE/../../app"; do
  if [ -f "$cand/cli.js" ]; then APPDIR="$cand"; break; fi
done
if [ -z "$APPDIR" ]; then
  echo "Could not find the Jira MCP program files (app/cli.js)."
  echo "Keep this macOS folder inside the unzipped jira-mcp folder and run it from there."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found; cannot run the uninstaller."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

node "$APPDIR/cli.js" uninstall
echo
read -n 1 -s -r -p "Press any key to close..."
