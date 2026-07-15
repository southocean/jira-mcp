// Cut a release in one command:
//
//   npm run release -- v1.1.0            (uses the version's auto-generated notes)
//   npm run release -- v1.1.0 "Notes…"   (custom notes)
//
// Builds dist/jira-mcp.zip, then creates the GitHub release and uploads the zip
// via the gh CLI. Requires a one-time `gh auth login`.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const zip = join(root, "dist", "jira-mcp.zip");

const tag = process.argv[2];
const notes = process.argv[3];
if (!tag || !/^v\d+\.\d+\.\d+/.test(tag)) {
  console.error('Usage: npm run release -- v1.2.3 ["release notes"]');
  process.exit(1);
}

// Locate gh: on PATH, or the no-admin install under %LOCALAPPDATA%\Programs\gh.
function findGh() {
  const onPath = spawnSync("gh", ["--version"], { shell: true });
  if (onPath.status === 0) return "gh";
  const local = join(process.env.LOCALAPPDATA || "", "Programs", "gh", "bin", "gh.exe");
  if (existsSync(local)) return local;
  return null;
}
const gh = findGh();
if (!gh) {
  console.error("gh CLI not found. Install it, then run `gh auth login`.");
  process.exit(1);
}

// Ensure we're authenticated before building.
if (spawnSync(gh, ["auth", "status"], { shell: true, stdio: "ignore" }).status !== 0) {
  console.error("Not logged in to GitHub. Run:  gh auth login");
  process.exit(1);
}

console.log("Building the zip…");
if (spawnSync(process.execPath, [join(root, "build.mjs")], { stdio: "inherit" }).status !== 0) {
  process.exit(1);
}

console.log(`Creating release ${tag}…`);
const args = ["release", "create", tag, zip, "--title", tag];
if (notes) args.push("--notes", notes); else args.push("--generate-notes");
const r = spawnSync(gh, args, { shell: true, stdio: "inherit" });
if (r.status !== 0) process.exit(r.status || 1);

console.log(`\n✓ Released ${tag}. Download link (always latest):`);
console.log("  https://github.com/southocean/jira-mcp/releases/latest/download/jira-mcp.zip");
