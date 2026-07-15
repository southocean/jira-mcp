Jira MCP — install
==================

This connects Jira to your AI coding tools (Claude Desktop, Claude Code,
Cursor, VS Code). Once installed, the "jira" tools appear in all of them —
no project to open, no repo to clone.

REQUIREMENT: Node.js must be installed (https://nodejs.org/). If you write
code here you almost certainly already have it.

TO INSTALL
----------
  Windows : double-click  "Install Jira MCP.cmd"
  macOS   : double-click  "Install Jira MCP.command"
            (first time you may need, in Terminal:
             chmod +x "Install Jira MCP.command")

It will:
  1. Copy the program to your user folder.
  2. Ask for your Atlassian email + an API token (it opens the page for you).
  3. Turn on the "jira" tools in every AI client you have.

Then restart any open Claude / VS Code / Cursor windows.

TO UPDATE
---------
Got a newer zip? Just run the installer again. It replaces the old version,
KEEPS your saved login (no need to re-enter your token), and re-connects your
clients. No need to uninstall first.

TO REMOVE
---------
  Windows : double-click  "Uninstall.cmd"
  macOS   : double-click  "Uninstall.command"
Removes the program, your saved token, and the "jira" entry from every client.
(Keep this folder if you want to uninstall later, or just re-download it.)

Your API token is stored only on your machine and is personal to you — never
share it; anyone with it can act as you in Jira.
