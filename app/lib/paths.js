// OS-appropriate locations for the standalone Jira MCP install.
//
//   configDir  — where the user's credentials live (.env). Survives updates.
//   appDir     — where the program files are copied to by the installer.
//
// Kept in one place so the server, the setup wizard, the installer, and the
// uninstaller all agree on where things are.

import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const APPDATA = process.env.APPDATA || join(HOME, "AppData", "Roaming");
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, "AppData", "Local");

export const isWin = process.platform === "win32";
export const isMac = process.platform === "darwin";

// Credentials / config (persist across updates).
export const configDir = isWin
  ? join(APPDATA, "jira-mcp")
  : isMac
    ? join(HOME, "Library", "Application Support", "jira-mcp")
    : join(process.env.XDG_CONFIG_HOME || join(HOME, ".config"), "jira-mcp");

export const envPath = join(configDir, ".env");

// Installed program files (replaced on update).
export const appDir = isWin
  ? join(LOCALAPPDATA, "Programs", "jira-mcp")
  : isMac
    ? join(HOME, "Library", "Application Support", "jira-mcp-app")
    : join(process.env.XDG_DATA_HOME || join(HOME, ".local", "share"), "jira-mcp");

// The server entry point once installed.
export const installedServer = join(appDir, "server.js");
