// Register / unregister the "jira" MCP server into each MCP client the user has,
// at USER scope — so it works in every window without opening any project.
//
// There is no shared OS-wide MCP registry: each client keeps its own config.
// We detect the ones present and write into each. Everything here is idempotent:
// registering twice updates in place; unregistering a missing entry is a no-op.

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { isWin, isMac, installedServer } from "./paths.js";

const HOME = homedir();
const APPDATA = process.env.APPDATA || join(HOME, "AppData", "Roaming");
const SERVER_NAME = "jira";

const exists = (p) => stat(p).then(() => true, () => false);

// Claude Desktop and VS Code user-config file locations, per OS.
const claudeDesktopCfg = isWin
  ? join(APPDATA, "Claude", "claude_desktop_config.json")
  : isMac
    ? join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json")
    : join(process.env.XDG_CONFIG_HOME || join(HOME, ".config"), "Claude", "claude_desktop_config.json");

const vscodeUserMcp = isWin
  ? join(APPDATA, "Code", "User", "mcp.json")
  : isMac
    ? join(HOME, "Library", "Application Support", "Code", "User", "mcp.json")
    : join(process.env.XDG_CONFIG_HOME || join(HOME, ".config"), "Code", "User", "mcp.json");

const cursorMcp = join(HOME, ".cursor", "mcp.json");

// The command every client uses. Absolute node path so clients launched from a
// GUI (with a minimal PATH) still find it.
const nodePath = process.execPath;
const stdioEntry = () => ({ command: nodePath, args: [installedServer] });
const vscodeEntry = () => ({ type: "stdio", command: nodePath, args: [installedServer] });

async function readJson(p) {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; }
}

// Merge/remove a server under `key` in a JSON config file. Returns a status.
async function patchJson(file, key, entry, { create }) {
  const dir = dirname(file);
  const dirThere = await exists(dir);
  const fileThere = await exists(file);
  if (!fileThere && !(create && dirThere)) return "absent"; // client not installed
  const cfg = (await readJson(file)) || {};
  cfg[key] = cfg[key] || {};
  if (entry) cfg[key][SERVER_NAME] = entry; else delete cfg[key][SERVER_NAME];
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  return entry ? "registered" : "removed";
}

// Run the `claude` CLI (a .cmd shim on Windows, hence shell:true). We pass a
// single quoted command line rather than an args array so paths containing
// spaces (e.g. "C:\Program Files\nodejs\node.exe") survive the shell intact.
function claudeCli(cmdline) {
  return spawnSync(cmdline, { shell: true, encoding: "utf8" }).status === 0;
}
const q = (s) => `"${s}"`;
const haveClaudeCli = () => claudeCli("claude --version");

// ---- public API ------------------------------------------------------------

// Register into every present client. Returns [{ client, status }].
export async function registerAll() {
  const out = [];

  out.push({ client: "Claude Desktop", status: await patchJson(claudeDesktopCfg, "mcpServers", stdioEntry(), { create: true }) });
  out.push({ client: "Cursor",         status: await patchJson(cursorMcp,        "mcpServers", stdioEntry(), { create: true }) });
  out.push({ client: "VS Code",        status: await patchJson(vscodeUserMcp,    "servers",    vscodeEntry(), { create: true }) });

  // Claude Code — via its own CLI (handles ~/.claude.json for us). Remove-then-add
  // keeps it idempotent regardless of whether an entry already exists.
  if (haveClaudeCli()) {
    claudeCli(`claude mcp remove ${SERVER_NAME} -s user`);
    const ok = claudeCli(`claude mcp add ${SERVER_NAME} -s user -- ${q(nodePath)} ${q(installedServer)}`);
    out.push({ client: "Claude Code", status: ok ? "registered" : "error" });
  } else {
    out.push({ client: "Claude Code", status: "absent" });
  }

  return out;
}

// Remove from every client. Returns [{ client, status }].
export async function unregisterAll() {
  const out = [];
  out.push({ client: "Claude Desktop", status: await patchJson(claudeDesktopCfg, "mcpServers", null, { create: false }) });
  out.push({ client: "Cursor",         status: await patchJson(cursorMcp,        "mcpServers", null, { create: false }) });
  out.push({ client: "VS Code",        status: await patchJson(vscodeUserMcp,    "servers",    null, { create: false }) });
  if (haveClaudeCli()) {
    const ok = claudeCli(`claude mcp remove ${SERVER_NAME} -s user`);
    out.push({ client: "Claude Code", status: ok ? "removed" : "absent" });
  } else {
    out.push({ client: "Claude Code", status: "absent" });
  }
  return out;
}
