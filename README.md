# Jira MCP

A one-click Jira integration for your AI coding tools. Install it once and the
**`jira` tools** appear in **Claude Desktop, Claude Code, Cursor, and VS Code** —
create, read, update, move, comment on, and search Jira tickets straight from
your assistant. No repo to clone, no config files to edit.

---

## Install (users)

**1. Get the zip.** Download `jira-mcp.zip` from the
[Releases page](../../releases) (or build it — see [Maintainers](#maintainers)).

**2. Unzip it**, then double-click the installer:

| OS | Double-click |
|----|--------------|
| Windows | `Install Jira MCP.cmd` |
| macOS | `Install Jira MCP.command`  (first time you may need `chmod +x "Install Jira MCP.command"` in Terminal) |

**3. Follow the prompt.** It asks for two things:
- your **Atlassian email**
- a **Jira API token** — it opens the page for you; click *Create API token*, name
  it `jira-mcp`, copy, paste.

That's it. **Restart** any open Claude / VS Code / Cursor windows and the `jira`
tools are there.

> **Node.js** is required, but you probably don't need to think about it: if it's
> missing, the **Windows** installer sets up a local copy automatically (no admin);
> on **macOS** it installs via Homebrew if available, otherwise points you to the
> one-click download.

### Or: let Claude install it for you

If you use **Claude Code**, you can skip the zip entirely: grab
[`Setup with Claude.cmd`](Setup%20with%20Claude.cmd) (macOS:
`Setup with Claude.command`) and [`SETUP-WITH-CLAUDE.md`](SETUP-WITH-CLAUDE.md),
keep them together, and double-click the launcher. Claude Code reads the playbook,
asks you for your email + token, handles anything missing (even Node.js), installs,
and registers everything — an adaptive installer that troubleshoots as it goes.

Only have the **Claude desktop app**? Drag `SETUP-WITH-CLAUDE.md` into a chat and
Claude will walk you through the steps (it can't run commands itself there).

### Update

Got a newer zip? **Just run the installer again.** It replaces the old version,
**keeps your saved login** (no re-entering your token), and re-connects your
clients. No need to uninstall first.

### Uninstall

Double-click **`Uninstall.cmd`** (Windows) or **`Uninstall.command`** (macOS). It
removes the program, your saved token, and the `jira` entry from every client.

### A note on your token

Your API token is stored **only on your machine** (`%APPDATA%\jira-mcp\.env` on
Windows) and is personal to you — never share it; anyone with it can act as you
in Jira.

---

## Maintainers

### Layout

```
app/                     the program
  server.js              the MCP server (the actual Jira tools)
  cli.js                 install / uninstall / setup / register / serve
  lib/paths.js           per-OS locations for creds + install dir
  lib/setup.js           credential wizard (email + token; rest auto-derived)
  lib/clients.js         registers the server into each MCP client, user scope
installer/               double-click launchers + README (sit at the zip root)
build.mjs                packs everything into dist/jira-mcp.zip
```

### Pre-fill your Atlassian site (optional)

To save colleagues from typing your Atlassian site, drop an `app/defaults.json`
(gitignored, so it never enters this public repo — bundled into the zip you build):

```bash
cp app/defaults.example.json app/defaults.json
# edit it: { "site": "yourcompany.atlassian.net" }
```

Without it the wizard simply asks for the site. Tool descriptions use a neutral
`ABC` project as the example placeholder.

### Build the zip

```bash
cd app && npm install --omit=dev && cd ..
node build.mjs                 # -> dist/jira-mcp.zip
```

Dependencies are bundled into the zip, so end users don't run `npm install`.

### Replicate on another machine

```bash
git clone https://github.com/southocean/jira-mcp.git
cd jira-mcp/app && npm install && cd ..
node build.mjs
```

### Cut a release (so users can download the zip)

The repo tracks **source only** (the zip is a build artifact). One-time setup:
install the [`gh` CLI](https://cli.github.com/) and run `gh auth login`. Then a
release is a single command:

```bash
node release.mjs v1.1.0            # or:  npm run release -- v1.1.0
```

It builds `dist/jira-mcp.zip`, creates the tagged GitHub release, and uploads the
zip. The [Install](#install-users) link always serves the newest one:
`https://github.com/southocean/jira-mcp/releases/latest/download/jira-mcp.zip`.

Prefer the browser? Releases → *Draft a new release* → tag → drag in
`dist/jira-mcp.zip` → publish.

### How it works

- **No shared MCP registry exists** — each client keeps its own config. The
  installer writes a user-scope `jira` entry into every client it finds (Claude
  Desktop / Cursor / VS Code config files; Claude Code via its CLI), baking in the
  absolute `node` path so GUI-launched apps resolve it.
- **Credentials** live in the user config dir, never in a repo. The wizard asks
  only for email + token and derives the cloud id, account id, and display name
  from the Jira API.
- **Program files** install to `%LOCALAPPDATA%\Programs\jira-mcp`
  (`~/.local/share/jira-mcp` on Linux, `~/Library/Application Support/jira-mcp-app`
  on macOS).
- **Update** = re-run installer (replace files, keep token, re-register).
  **Uninstall** = remove program, credentials, and every client entry.

### Server capabilities

The active sprint is resolved at runtime (never a stale id), the default project
is optional and per-user, and `me` works as an assignee shortcut. Tools:

`create_ticket` · `get_ticket` · `update_ticket` · `move_ticket` ·
`move_ticket_to_project` · `convert_to_subtask` · `add_comment` · `get_comments` ·
`add_label` · `remove_label` · `list_attachments` · `download_attachment` ·
`search_tickets`
