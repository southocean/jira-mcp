// Interactive credential setup for the standalone Jira MCP install.
//
// Asks for the minimum (email + API token, optional default project), derives
// the rest from the Jira API, verifies before writing, and stores a personal
// .env in the user config dir (see paths.js). Safe to re-run any time.

import { createInterface } from "node:readline";
import { writeFile, readFile, chmod, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { configDir, envPath, isWin } from "./paths.js";

// Optional per-distribution defaults (e.g. your company's Atlassian site) live in
// app/defaults.json, which is NOT committed — so this public source stays generic
// while a built zip can still pre-fill the site. See defaults.example.json.
function loadDefaults() {
  try { return JSON.parse(readFileSync(new URL("../defaults.json", import.meta.url), "utf8")); }
  catch { return {}; }
}
const DEFAULTS = loadDefaults();
const DEFAULT_SITE = DEFAULTS.site || "";
// Company email domain (e.g. "wasabiproductions.com"). When set, typing "@" in the
// email prompt auto-fills "@<domain>" for a one-keystroke address.
const DEFAULT_EMAIL_DOMAIN = (DEFAULTS.emailDomain || "").replace(/^@/, "");
const TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

const ask = (q, fallback = "") =>
  new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); res(a.trim() || fallback); });
  });

// Remove terminal escape sequences before they reach a value: arrow/navigation
// keys (ESC[C …) and the bracketed-paste markers (ESC[200~ … ESC[201~) that some
// terminals wrap pasted text in. Without this, a paste can smuggle stray bytes
// like "[201~" into a token and make it fail authentication for no visible reason.
const stripEscapes = (s) => s.replace(/\x1b\[[0-9;]*[~A-Za-z]/g, "").replace(/\x1b/g, "");

// Like ask(), but when the user types a lone "@" and no "@" is present yet, it
// auto-fills "@<domain>" so a company address is one keystroke. The fill is just
// normal editable text — backspace to remove it and type a different domain. A
// pasted address (multi-char chunk) is taken literally so it can't be doubled.
// Falls back to a plain readline when there's no domain or stdin isn't a TTY.
function askEmail(q, domain = "") {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    if (!domain || !stdin.isTTY) {
      const rl = createInterface({ input: stdin, output: stdout });
      rl.question(q, (a) => { rl.close(); resolve(a.trim()); });
      return;
    }
    stdout.write(q);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const cleanup = () => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); };
    const onData = (raw) => {
      const chunk = stripEscapes(raw);
      // A lone "@" keystroke fills the domain; a pasted address is left as-is.
      if (chunk === "@" && !value.includes("@")) {
        const add = "@" + domain;
        value += add;
        stdout.write(add);
        return;
      }
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") { cleanup(); stdout.write("\n"); resolve(value.trim()); return; }
        if (ch === "\u0003") { cleanup(); stdout.write("\n"); process.exit(130); } // Ctrl+C
        if (ch === "\u007f" || ch === "\b") { if (value) { value = value.slice(0, -1); stdout.write("\b \b"); } continue; }
        if (ch < " ") continue; // ignore other control chars
        value += ch;
        stdout.write(ch);
      }
    };
    stdin.on("data", onData);
  });
}

// Read a secret without printing it, but echo one "*" per character so the user
// can SEE that a paste landed (and roughly how long it was) — fully hidden input
// made paste mistakes impossible to notice. Handles backspace, Enter and Ctrl+C,
// and drops escape sequences (arrow keys) so their bytes can't leak into the
// token. Falls back to a plain readline when stdin isn't a TTY (piped input
// can't be masked).
function askHidden(q) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      const rl = createInterface({ input: stdin, output: stdout });
      stdout.write(q);
      rl.question("", (a) => { rl.close(); stdout.write("\n"); resolve(a.trim()); });
      return;
    }
    stdout.write(q);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const cleanup = () => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); };
    const onData = (raw) => {
      const chunk = stripEscapes(raw);
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") { cleanup(); stdout.write("\n"); resolve(value.trim()); return; }
        if (ch === "\u0003") { cleanup(); stdout.write("\n"); process.exit(130); } // Ctrl+C
        if (ch === "\u007f" || ch === "\b") { if (value) { value = value.slice(0, -1); stdout.write("\b \b"); } continue; }
        if (ch < " ") continue; // ignore other control chars
        value += ch;
        stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

function openBrowser(url) {
  try {
    const [cmd, args] =
      isWin ? ["cmd", ["/c", "start", "", url]] :
      process.platform === "darwin" ? ["open", [url]] :
      ["xdg-open", [url]];
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch { /* the URL is printed anyway */ }
}

const basic = (email, token) => "Basic " + Buffer.from(`${email}:${token}`).toString("base64");

export async function resolveCloudId(site) {
  const res = await fetch(`https://${site}/_edge/tenant_info`);
  if (!res.ok) throw new Error(`Couldn't reach https://${site} (${res.status}). Check the site name.`);
  const { cloudId } = await res.json();
  if (!cloudId) throw new Error(`No cloud id returned for ${site}.`);
  return cloudId;
}

// Checks credentials against Jira. Returns a discriminated result:
//   { status: "ok", me: { accountId, displayName } }
//   { status: "auth" }                     — 401: the email/token is wrong
//   { status: "rate-limited", retryAfter } — 429/403 cooldown after repeated failures
//   { status: "forbidden", detail }        — 403 with no rate-limit signal (no site access/scope)
// Throws only on network errors or genuinely unexpected statuses.
export async function verify(site, email, token) {
  // Basic auth with an API token works only against the site's own domain, NOT
  // the api.atlassian.com/ex/jira/{cloudId} gateway (that path is OAuth-only and
  // returns 401 for Basic auth no matter how correct the credentials are).
  const res = await fetch(`https://${site}/rest/api/3/myself`, {
    headers: { Authorization: basic(email, token), Accept: "application/json" },
  });
  if (res.ok) {
    const me = await res.json();
    return { status: "ok", me: { accountId: me.accountId, displayName: me.displayName } };
  }
  if (res.status === 401) return { status: "auth" };
  if (res.status === 429 || res.status === 403) {
    const retryAfter = res.headers.get("retry-after") || res.headers.get("x-ratelimit-reset") || "";
    let body = "";
    try { body = await res.text(); } catch { /* ignore */ }
    if (res.status === 429 || retryAfter || /rate|limit|too many|throttl/i.test(body)) {
      return { status: "rate-limited", retryAfter };
    }
    return { status: "forbidden", detail: body.slice(0, 200) };
  }
  throw new Error(`Jira /myself → ${res.status}: ${await res.text()}`);
}

export async function projectExists(site, email, token, key) {
  const res = await fetch(`https://${site}/rest/api/3/project/${encodeURIComponent(key)}`, {
    headers: { Authorization: basic(email, token), Accept: "application/json" },
  });
  return res.ok;
}

// Parse the stored .env into a plain object (or {} if none).
export async function readEnv() {
  try {
    const text = await readFile(envPath, "utf8");
    return Object.fromEntries(
      text.split(/\r?\n/)
        .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
        .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/\s+#.*$/, "")]; }),
    );
  } catch { return {}; }
}

// True if the stored credentials still authenticate. Used to skip the wizard on
// an update so nobody has to re-enter their token.
export async function credentialsValid() {
  const e = await readEnv();
  if (!e.JIRA_SITE || !e.JIRA_EMAIL || !e.JIRA_API_TOKEN) return null;
  try {
    const r = await verify(e.JIRA_SITE, e.JIRA_EMAIL, e.JIRA_API_TOKEN);
    return r.status === "ok" ? { ...r.me, email: e.JIRA_EMAIL, project: e.JIRA_PROJECT || "" } : null;
  } catch { return null; }
}

async function writeEnv({ email, token, site, cloudId, accountId, displayName, project }) {
  await mkdir(configDir, { recursive: true });
  const lines = [
    "# Generated by `jira-mcp setup`. PERSONAL — do not share.",
    "# Anyone with this token can act as you in Jira.",
    "",
    `JIRA_EMAIL=${email}`,
    `JIRA_API_TOKEN=${token}`,
    `JIRA_SITE=${site}`,
    `JIRA_CLOUD_ID=${cloudId}`,
    `JIRA_ME_ACCOUNT_ID=${accountId}`,
    `JIRA_ME_NAME=${displayName}`,
    project
      ? `JIRA_PROJECT=${project}`
      : "# JIRA_PROJECT=            # no default — the agent asks which project on create",
    "",
  ];
  await writeFile(envPath, lines.join("\n"), "utf8");
  if (!isWin) { try { await chmod(envPath, 0o600); } catch { /* best effort */ } }
}

// Run the interactive wizard. Returns { email, displayName, project }.
export async function runSetup() {
  let cloudId, site;
  // A preconfigured site (defaults.json) is used silently — no prompt. We only
  // fall back to asking if that site can't be resolved (typo/network/off-domain).
  if (DEFAULT_SITE) {
    try {
      cloudId = await resolveCloudId(DEFAULT_SITE);
      site = DEFAULT_SITE;
      console.log(`  Atlassian site: ${site}`);
    } catch (e) {
      console.log(`  ✗ Preconfigured site ${DEFAULT_SITE} didn't resolve (${e.message}).\n`);
    }
  }
  for (let i = 0; !cloudId; i++) {
    site = (await ask("Atlassian site (e.g. yourcompany.atlassian.net): "))
      .replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    try { cloudId = await resolveCloudId(site); }
    catch (e) { console.log("  ✗ " + e.message + "\n"); if (i >= 2) throw new Error("Could not resolve the Atlassian site."); }
  }

  const email = await askEmail("Your Atlassian email: ", DEFAULT_EMAIL_DOMAIN);

  console.log(`\n  Create an API token (opening in your browser):\n    ${TOKEN_URL}\n    → "Create API token" → name it "jira-mcp" → Copy.\n`);
  openBrowser(TOKEN_URL);

  let token, me;
  for (let i = 1; ; i++) {
    token = await askHidden("Paste your Jira API token: ");
    if (!token) {
      console.log("  ✗ Nothing was pasted. Copy the token from the page, then paste and press Enter.\n");
      if (i >= 3) throw new Error("No token was entered.");
      continue;
    }
    let result;
    try {
      result = await verify(site, email, token);
    } catch (e) {
      // Reached neither a yes nor a no — network/DNS/proxy or an unexpected status.
      console.log(`  ✗ Couldn't reach Jira to check the token (${e.message}).\n    Check your connection and try again.\n`);
      if (i >= 3) throw new Error("Gave up after repeated errors contacting Jira.");
      continue;
    }

    if (result.status === "ok") { me = result.me; break; }

    if (result.status === "rate-limited") {
      // A cooldown after too many failed attempts — the token itself may be fine.
      const wait = result.retryAfter ? `about ${result.retryAfter}s` : "a few minutes";
      throw new Error(
        `Atlassian is temporarily rate-limiting sign-ins for this account — almost certainly from the earlier failed pastes, not a bad token.\n` +
        `    Wait ${wait}, then re-run the installer and paste the token once. Don't keep retrying now; that only extends the cooldown.`,
      );
    }

    if (result.status === "forbidden") {
      throw new Error(
        `Jira returned 403 for ${email}. The token is valid but this account may not have access to ${site} (wrong Atlassian org), or the token lacks the needed scope.`,
      );
    }

    // status === "auth" (401): the email or token is genuinely wrong.
    console.log(
      `  ✗ Jira rejected this sign-in (401):\n` +
      `      email:  ${email}\n` +
      `      token:  ${token.length} characters pasted\n` +
      `    • The email must be the one you sign in to Atlassian with.\n` +
      `    • Make sure the whole token copied, and that it isn't expired or revoked.\n` +
      `    • If unsure, create a fresh token on the open page and paste it again.\n`,
    );
    if (i >= 3) throw new Error(`Jira kept rejecting the sign-in for ${email} — check that email and use a fresh token.`);
  }
  console.log(`  ✓ Signed in as ${me.displayName}`);

  console.log(`\n  Which Jira project do you work in most? It becomes your default.\n  Leave blank to be asked each time instead.`);
  let project = "";
  for (let i = 0; ; i++) {
    const p = (await ask("  Default project key (blank to skip): ")).toUpperCase();
    if (!p) break;
    if (await projectExists(site, email, token, p)) { project = p; break; }
    console.log(`  ✗ Project "${p}" not found or not accessible.\n`);
    if (i >= 2) { console.log("  Skipping default project."); break; }
  }

  await writeEnv({ email, token, site, cloudId, accountId: me.accountId, displayName: me.displayName, project });
  console.log(`\n  ✓ Saved credentials to ${envPath}`);
  return { email, displayName: me.displayName, project };
}
