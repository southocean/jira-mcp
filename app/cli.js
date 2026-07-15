#!/usr/bin/env node
// jira-mcp — standalone Jira MCP server CLI.
//
//   install     copy program to a stable location, set up credentials (or keep
//               existing ones), and register into every MCP client. This is what
//               the double-click installer runs, and re-running it UPGRADES in
//               place: old files replaced, saved token kept, clients re-wired.
//   uninstall   remove the program, the stored credentials, and every client entry.
//   setup       (re)enter credentials only.
//   register    (re)register into clients / unregister removes.
//   serve       run the MCP server (what clients spawn; usually server.js directly).
//   version     print the installed version.

import { cp, rm, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { appDir, configDir, installedServer, envPath } from "./lib/paths.js";
import { runSetup, credentialsValid } from "./lib/setup.js";
import { registerAll, unregisterAll } from "./lib/clients.js";

const srcDir = dirname(fileURLToPath(import.meta.url));
const exists = (p) => stat(p).then(() => true, () => false);

async function version() {
  try { return JSON.parse(await readFile(join(srcDir, "package.json"), "utf8")).version; }
  catch { return "0.0.0"; }
}

const SYMBOL = { registered: "✓", removed: "✓", skipped: "·", absent: "·", error: "✗" };
const NOTE = {
  registered: "registered", removed: "removed", absent: "not installed — skipped", error: "FAILED",
};
function report(rows) {
  for (const { client, status } of rows) {
    console.log(`    ${SYMBOL[status] || "·"} ${client.padEnd(16)} ${NOTE[status] || status}`);
  }
}

function ask(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim()); }));
}

async function install() {
  const v = await version();
  console.log(`\n┌─ Jira MCP · installer (v${v}) ──────────────────────────────┐\n`);

  // 1) Copy program files to the stable install dir (unless we're already there).
  const sameLocation = resolve(srcDir) === resolve(appDir);
  if (!sameLocation) {
    const updating = await exists(appDir);
    console.log(`  ${updating ? "Updating" : "Installing"} program files → ${appDir}`);
    await rm(appDir, { recursive: true, force: true }); // clean old version, if any
    await cp(srcDir, appDir, { recursive: true });
  } else {
    console.log(`  Program files already at ${appDir}`);
  }

  // 2) Credentials — keep existing valid ones (no re-auth on update), else set up.
  const current = await credentialsValid();
  if (current) {
    console.log(`  ✓ Using saved credentials — signed in as ${current.displayName}`);
    console.log(`    (run "jira-mcp setup" to change the token or default project)`);
  } else {
    console.log("  Let's connect your Jira account:\n");
    await runSetup();
  }

  // 3) Register into every client, pointing at the installed server.
  console.log("\n  Registering with your MCP clients:");
  report(await registerAll());

  console.log(`\n  ✓ Done. Restart any open Claude / VS Code / Cursor windows and the`);
  console.log(`    "jira" tools will be available — no project needed.\n`);
  console.log(`└─────────────────────────────────────────────────────────────┘\n`);
}

async function uninstall() {
  console.log(`\n┌─ Jira MCP · uninstall ──────────────────────────────────────┐\n`);
  console.log("  Unregistering from your MCP clients:");
  report(await unregisterAll());

  const ans = (await ask("\n  Also delete your saved token and settings? (Y/n): ")).toLowerCase();
  const dropCreds = ans !== "n" && ans !== "no";

  await rm(appDir, { recursive: true, force: true });
  console.log(`  ✓ Removed program files (${appDir})`);
  if (dropCreds) {
    await rm(configDir, { recursive: true, force: true });
    console.log(`  ✓ Removed credentials (${configDir})`);
  } else {
    console.log(`  · Kept credentials at ${configDir}`);
  }
  console.log(`\n  Done. Restart any open clients to drop the now-removed server.\n`);
  console.log(`└─────────────────────────────────────────────────────────────┘\n`);
}

async function main() {
  const cmd = process.argv[2] || "install";
  switch (cmd) {
    case "install": await install(); break;
    case "uninstall": await uninstall(); break;
    case "setup": await runSetup(); break;
    case "register": console.log("Registering:"); report(await registerAll()); break;
    case "unregister": console.log("Unregistering:"); report(await unregisterAll()); break;
    case "serve": await import("./server.js"); break;
    case "version": case "--version": case "-v": console.log(await version()); break;
    default:
      console.log(`Unknown command "${cmd}". Use: install | uninstall | setup | register | unregister | serve | version`);
      process.exit(1);
  }
}

main().catch((e) => { console.error("\nError:", e.message); process.exit(1); });
