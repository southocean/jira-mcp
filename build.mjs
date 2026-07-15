// Build dist/jira-mcp.zip — the file you hand to colleagues.
//
//   node build.mjs
//
// Stages the installer scripts at the zip root and the program (with bundled
// node_modules) under app/, then zips it. Run `npm install --omit=dev` in app/
// first if node_modules is missing.

import { rm, mkdir, cp, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const stage = join(root, "build", "jira-mcp");
const dist = join(root, "dist");
const zip = join(dist, "jira-mcp.zip");

const exists = (p) => stat(p).then(() => true, () => false);

if (!(await exists(join(root, "app", "node_modules")))) {
  console.error("app/node_modules missing — run:  cd app && npm install --omit=dev");
  process.exit(1);
}

console.log("Staging…");
await rm(join(root, "build"), { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(join(root, "installer"), stage, { recursive: true });
await cp(join(root, "app"), join(stage, "app"), { recursive: true });

await mkdir(dist, { recursive: true });
await rm(zip, { force: true });

console.log("Zipping…");
// Use libarchive's bsdtar to emit a real .zip with forward-slash entries and a
// single top-level jira-mcp/ folder (portable to macOS unzip). On Windows the
// git-bundled GNU tar can't write zip, so call the system bsdtar explicitly.
const tarBin = process.platform === "win32"
  ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
  : "tar";
const r = spawnSync(tarBin, ["-a", "-cf", zip, "-C", dirname(stage), "jira-mcp"], { stdio: "inherit" });

if (r.status !== 0) { console.error("Zip failed."); process.exit(1); }
console.log(`\n✓ Built ${zip}`);
