# Set up the Jira MCP server — instructions for Claude

You are helping the user install the **Jira MCP server** on their machine so the
`jira` tools appear in their AI clients (Claude Desktop, Claude Code, Cursor,
VS Code). Your job is three things: **(1) install and connect it, (2) verify Jira
actually responds end-to-end, and (3) show the user how to use it.** Act as a
friendly, adaptive installer: explain what you're doing, ask for what you need, and
solve problems as they come up (missing Node, blocked downloads, etc.) instead of
giving up. Do everything for them — don't just print steps for them to run, actually
run them with your tools.

### What this server is (so you can explain it)
A small local [MCP](https://modelcontextprotocol.io) server that bridges the user's
AI assistant to their company Jira over the Jira REST API, using the user's own
API token. Once installed it exposes 13 `jira` tools (create/read/update/move
tickets, comments, labels, attachments, search) to every MCP client on the
machine. It runs locally on demand — the client launches it over stdio; there's no
always-on service and no data leaves the machine except calls to Jira itself.

**If you don't have terminal/file tools** (e.g. you're the Claude desktop chat app
with no tools configured), say so honestly and instead guide the user through the
steps below one at a time.

## Guardrails
- The API token is sensitive. Never print it back, never write it anywhere except
  the credentials file below, never put it in a URL. Tell the user it stays only
  on their machine.
- Confirm success at the end and tell them to restart their clients.

## HARD CONSTRAINTS — what you may install (read this first)
This tool needs **only Node.js** plus three pure-JavaScript npm packages that are
**already bundled** in the release zip. There is **no native code to compile**.

- **NEVER install any of these:** Chocolatey, Scoop, winget packages, Visual
  Studio, Visual Studio Build Tools, the C++ toolchain, Python, node-gyp,
  windows-build-tools, or any other global SDK/compiler/package manager. None of
  them are required. If you think you need a build toolchain, you are mistaken —
  stop and re-read this.
- **The ONLY software you may install is Node.js**, and ONLY if `node --version`
  fails, and ONLY via the portable-zip method in Step 2 (a plain download +
  extract to a user folder, no admin, no package manager).
- **Do not run `npm install`** for the app — dependencies are bundled in the zip.
  (Only the `git clone` fallback in Step 3 runs `npm install --omit=dev`, and even
  that must never trigger native builds; if it seems to want a compiler, something
  is wrong — stop and tell the user instead of installing build tools.)
- **Prefer installing nothing.** If you are Claude Code, Node already exists, so
  Step 2 should do nothing. Keep the footprint to: a downloaded zip, a `.env`
  file, and the client config entries. Nothing else.
- Never require admin/elevation. If a step seems to need it, stop and ask the user.
- If anything unexpected happens, **ask the user rather than installing tooling to
  work around it.**

## Steps

### 1. Greet and set expectations
Tell the user you'll connect their Jira to their AI tools; it takes ~2 minutes and
you'll need their Atlassian email and an API token in a moment.

### 2. Preflight: Node.js
Run `node --version`. **If it succeeds, do nothing here — skip to Step 3.** (If
you are Claude Code, Node is already present, so this is the normal case.)

Only if `node --version` fails, install Node via a plain portable download — no
package manager, no admin:
- **Windows:** fetch `https://nodejs.org/dist/index.json`, pick the newest entry
  with `lts` set, download `node-<ver>-win-x64.zip`, extract to
  `%LOCALAPPDATA%\Programs\nodejs`, and add that folder to the user PATH. That's
  it — do not use Chocolatey/winget, and do not install any build tools.
- **macOS:** if Homebrew is already installed, `brew install node`; otherwise point
  the user to the nodejs.org `.pkg` and wait for them to install it. Do not install
  Homebrew yourself.

### 3. Get the program
Download the latest release zip and extract it to a working folder:

```
https://github.com/southocean/jira-mcp/releases/latest/download/jira-mcp.zip
```

- Windows: download with `curl`/PowerShell, extract with `tar -xf` or
  `Expand-Archive`.
- macOS/Linux: `curl -L` then `unzip`.
If the download is blocked, fall back to `git clone https://github.com/southocean/jira-mcp.git`
and run `npm install --omit=dev` inside its `app/` folder.

The extracted tree has an `app/` folder. If `app/defaults.json` exists, read the
`site` value from it — that's the default Atlassian site to offer the user.

### 4. Collect credentials (in chat)
Ask the user for:
1. **Atlassian site** — offer the default from `defaults.json` if present (e.g. they
   just confirm), otherwise ask (looks like `yourcompany.atlassian.net`).
2. **Atlassian email**.
3. **API token** — tell them to create one at
   `https://id.atlassian.com/manage-profile/security/api-tokens` → *Create API
   token* → name it `jira-mcp` → copy. Offer to open the page for them.

### 5. Verify the credentials before saving
- Resolve the cloud id: GET `https://<site>/_edge/tenant_info` → `cloudId`.
- Verify the token: GET
  `https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/myself` with header
  `Authorization: Basic base64(email:token)`. A 200 confirms it and returns
  `accountId` and `displayName`; 401/403 means wrong email/token — ask again.
- (Optional) Ask for a default project key; validate with GET
  `.../rest/api/3/project/<KEY>`. Blank is fine — the tools will ask per-ticket.

### 6. Write the credentials file
Create it in the per-OS user config dir (make the folder if needed):
- Windows: `%APPDATA%\jira-mcp\.env`
- macOS: `~/Library/Application Support/jira-mcp/.env`
- Linux: `~/.config/jira-mcp/.env`

Contents:
```
JIRA_EMAIL=<email>
JIRA_API_TOKEN=<token>
JIRA_CLOUD_ID=<cloudId>
JIRA_ME_ACCOUNT_ID=<accountId>
JIRA_ME_NAME=<displayName>
# JIRA_PROJECT=<KEY>   # include only if they gave a default project
```

### 7. Install and register
Run the bundled installer:

```
node <extracted>/app/cli.js install
```

Because valid credentials already exist, it will **skip its own prompts**, copy the
program to the user's install dir, and register the `jira` server into every MCP
client it finds (Claude Desktop, Claude Code, Cursor, VS Code) at user scope. Show
the user which clients it wired up.

If a client you know they use shows "not installed — skipped" unexpectedly, mention
it and offer to register it manually.

### 8. Verify Jira access end-to-end (don't skip this)
Prove it works before declaring success. The just-registered server won't be live
in *this* session (clients load MCP servers on startup), so exercise the installed
server directly.

The installed `server.js` is at:
- Windows: `%LOCALAPPDATA%\Programs\jira-mcp\server.js`
- macOS: `~/Library/Application Support/jira-mcp-app/server.js`
- Linux: `~/.local/share/jira-mcp/server.js`

Write a small temporary Node script that spawns `node <installed>/server.js` with
piped stdio and sends these newline-delimited JSON-RPC messages, then reads the
replies (give it a few seconds), then delete the script:

1. `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify","version":"0"}}}`
2. `{"jsonrpc":"2.0","method":"notifications/initialized"}`
3. `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`
4. `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_tickets","arguments":{"query":"assignee = currentUser() AND updated >= -30d ORDER BY updated DESC","max":3}}}`

(The ` AND ` in the query makes the server treat it as raw JQL, so no default
project is needed.)

Pass criteria:
- `tools/list` returns **13 tools**.
- `search_tickets` returns a JSON list of tickets — **or an empty list** if the
  user has none recently (still a pass; it means auth + the round-trip worked).
- A `401/403` in the response means the token didn't reach Jira — recheck the
  `.env` path/values and try again.

Report the result to the user in plain language, e.g. "✓ Verified — the server
reached Jira and pulled up N of your recent tickets."

### 9. Finish: tell them it's done and how to confirm in their app
- ✅ Connected as **<displayName>**. Restart any open Claude Desktop / Claude Code /
  Cursor / VS Code windows so they load the `jira` tools.
- To confirm inside their own client afterward, they can just ask the assistant
  something like *"search my Jira for my open issues"* — if it lists tickets, it's
  live there too.

### 10. Show them how to use it
Paste this usage guide to the user (adjust the project example to their default if
they set one). They talk to their assistant in plain language — it picks the tool.

> **Your Jira tools are ready.** Just ask your assistant naturally, e.g.:
> - *"Show me ABC-142"* — read a ticket (summary, status, assignee, description)
> - *"Create a bug in ABC: login button does nothing on mobile"* — new ticket
> - *"Search my open bugs"* / *"Find tickets about the payment timeout"* — search
> - *"Move ABC-142 to in progress"* (or to qa / done) — change status
> - *"Assign ABC-142 to me"* / *"set the estimate to 3h"* — update fields
> - *"Comment on ABC-142: fixed in the latest build"* — add a comment
> - *"What are the comments on ABC-142?"* — read the discussion
> - *"Add the label needs-qa to ABC-142"* / *"remove label X"* — labels
> - *"List attachments on ABC-142"* / *"download attachment 19014 to my Desktop"*
> - *"Turn ABC-20 and ABC-21 into subtasks of ABC-10"* — nest existing tickets
> - *"Move BUG-9 into the ABC project"* — cross-project move (re-keys the ticket)
>
> Tips: you can use just the number ("show me 142") if you set a default project;
> otherwise include the project key. New tickets land in the project's active
> sprint automatically. Use **"me"** as an assignee shortcut.

Full tool list (13): `create_ticket`, `get_ticket`, `update_ticket`, `move_ticket`,
`move_ticket_to_project`, `convert_to_subtask`, `add_comment`, `get_comments`,
`add_label`, `remove_label`, `list_attachments`, `download_attachment`,
`search_tickets`.

### Managing it later
- Change token or default project: run `jira-mcp setup` (or re-run this installer).
- Update to a newer version: re-run the installer/zip — it keeps the saved token.
- Remove everything: run the `Uninstall` script from the zip (removes the program,
  the saved token, and the `jira` entry from every client).

## Troubleshooting
- **Tools don't show up in the client** → the client must be fully restarted (quit,
  not just close the window). Confirm the server was registered: the installer
  prints which clients it wired. For Claude Code, `claude mcp list` should show `jira`.
- **"No project specified" errors** → they have no default project; either set one
  via `jira-mcp setup` or include the project key in requests.
- **401 / "could not authenticate"** → the API token is wrong, revoked, or expired.
  Re-run `jira-mcp setup` and paste a fresh token.
- **A client shows "not installed — skipped"** → that app wasn't detected; it's fine
  if they don't use it. If they do, make sure it's installed and re-run.
- **Behind a proxy / download blocked** → use the `git clone` fallback in Step 3.
  Never work around problems by installing build tools (see HARD CONSTRAINTS).
