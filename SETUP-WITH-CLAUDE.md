# Set up the Jira MCP server — instructions for Claude

You are helping the user install the **Jira MCP server** on their machine so the
`jira` tools appear in their AI clients (Claude Desktop, Claude Code, Cursor,
VS Code). Act as a friendly, adaptive installer: explain what you're doing, ask
for what you need, and solve problems as they come up (missing Node, blocked
downloads, etc.) instead of giving up. Do everything for them — don't just print
steps for them to run, actually run them with your tools.

**If you don't have terminal/file tools** (e.g. you're the Claude desktop chat app
with no tools configured), say so honestly and instead guide the user through the
steps below one at a time.

## Guardrails
- The API token is sensitive. Never print it back, never write it anywhere except
  the credentials file below, never put it in a URL. Tell the user it stays only
  on their machine.
- Prefer no-admin steps. Don't require elevation unless there's truly no alternative.
- Confirm success at the end and tell them to restart their clients.

## Steps

### 1. Greet and set expectations
Tell the user you'll connect their Jira to their AI tools; it takes ~2 minutes and
you'll need their Atlassian email and an API token in a moment.

### 2. Preflight: Node.js
Run `node --version`. If Node is missing (unlikely if you're Claude Code, which
needs Node itself):
- **Windows:** download the latest LTS from `https://nodejs.org/dist/index.json`
  (pick the newest entry with `lts` set), grab `node-<ver>-win-x64.zip`, extract to
  `%LOCALAPPDATA%\Programs\nodejs`, and add that folder to the user PATH. No admin.
- **macOS:** `brew install node` if Homebrew exists, else point them to the
  nodejs.org `.pkg` and wait for them to install it.

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

### 8. Verify and finish
Optionally boot the server to confirm it works: run
`node <installed>/server.js`, send an MCP `initialize` + `tools/list`, and check it
returns the 13 tools. Then tell the user:
- ✅ Done — restart any open Claude / VS Code / Cursor windows.
- The `jira` tools are now available in all of them, no project needed.
- To change their token later, re-run this, or run `jira-mcp setup`.
- To remove everything, run the `Uninstall` script from the zip.
