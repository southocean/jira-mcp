import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import dotenv from "dotenv";
import { envPath } from "./lib/paths.js";

// Credentials live in the user config dir (written by `jira-mcp setup`), so the
// server works no matter where it was launched from or which repo is open. As a
// convenience for a source checkout, a .env next to this script is loaded first,
// then overridden by the user-config one when present.
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), ".env"), quiet: true });
dotenv.config({ path: envPath, override: true, quiet: true });

const CLOUD_ID = process.env.JIRA_CLOUD_ID;
const TOKEN = process.env.JIRA_API_TOKEN;
const EMAIL = process.env.JIRA_EMAIL;
// The default project is per-user and OPTIONAL. When unset, tools that need a
// project require it explicitly (create_ticket) or fall back to a cross-project
// search — nothing is hardcoded to any one team's project.
const PROJECT = (process.env.JIRA_PROJECT || "").trim().toUpperCase() || null;
// The "me" assignee shortcut resolves to this account. JIRA_ME_ACCOUNT_ID is the
// current name; JIRA_ASSIGNEE_ACCOUNT_ID is still read as a back-compat fallback.
const ME_ACCOUNT_ID = process.env.JIRA_ME_ACCOUNT_ID || process.env.JIRA_ASSIGNEE_ACCOUNT_ID || null;

const BASE = `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3`;
const AGILE = `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/agile/1.0`;

const auth = Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");

async function jira(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira ${method} ${path} → ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const TRANSITIONS = {
  todo: "11",
  "in-progress": "21",
  qa: "31",
  vqa: "41",
  done: "51",
};

const ISSUE_TYPES = {
  task: "Task",
  bug: "Bug",
  feature: "Feature",
  subtask: "Subtask",
};

// Normalize a ticket key: "371" -> "ABC-371", "ABC-371" unchanged. Expanding a
// bare number needs a default project; without one we ask for a full key.
const normKey = (k) => {
  if (k.includes("-")) return k;
  if (!PROJECT) {
    throw new Error(`No default project is set, so "${k}" can't be expanded to a full key. Pass a full ticket key (e.g. "ABC-${k}"), or set a default project by re-running the jira-mcp setup.`);
  }
  return `${PROJECT}-${k}`;
};

// Resolve the effective project for an operation: an explicit arg wins, then the
// configured default. Throws a clear error when neither is available so the
// agent knows to ask the user which project to use.
const effectiveProject = (arg) => {
  const p = ((arg ?? "").trim() || PROJECT || "").toUpperCase();
  if (!p) {
    throw new Error("No project specified and no default project is configured. Pass project=<KEY> (e.g. 'ABC'), or set a default by re-running the jira-mcp setup.");
  }
  return p;
};

// GET against the Jira Agile API (separate base path from the core REST API).
async function jiraAgile(path) {
  const res = await fetch(`${AGILE}${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Jira agile GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// Resolve a project's currently-active sprint id at runtime, cached per project
// for this process. The active sprint changes only at rollover, so caching is
// safe and a fresh process picks up the new sprint automatically — this replaces
// the old hardcoded JIRA_SPRINT_ID that silently went stale. Returns null for
// Kanban projects, projects with no active sprint, or on any lookup failure, in
// which case the ticket is simply created without a sprint.
const _sprintCache = new Map();
async function getActiveSprintId(projectKey) {
  if (_sprintCache.has(projectKey)) return _sprintCache.get(projectKey);
  let sprintId = null;
  try {
    const boards = await jiraAgile(`/board?projectKeyOrId=${encodeURIComponent(projectKey)}`);
    const board = (boards.values ?? [])[0];
    if (board) {
      const sprints = await jiraAgile(`/board/${board.id}/sprint?state=active`);
      sprintId = (sprints.values ?? [])[0]?.id ?? null;
    }
  } catch {
    sprintId = null;
  }
  _sprintCache.set(projectKey, sprintId);
  return sprintId;
}

// Resolve an assignee string to a Jira `assignee` field value.
//   "unassigned"         -> null   (clears the assignee)
//   "me" (or "nam")      -> the configured account id (fast path, no API call)
//   any other name/email -> looked up via the project's assignable-user search
// Throws a clear error on no-match or ambiguous-match so the caller sees why.
async function resolveAssignee(nameOrEmail, projectArg) {
  const v = (nameOrEmail ?? "").trim();
  if (!v) return undefined;
  if (v.toLowerCase() === "unassigned") return null;
  // "nam" kept as an alias for back-compat with existing configs.
  if ((v.toLowerCase() === "me" || v.toLowerCase() === "nam") && ME_ACCOUNT_ID) {
    return { accountId: ME_ACCOUNT_ID };
  }

  const project = effectiveProject(projectArg);
  const users = await jira(
    "GET",
    `/user/assignable/search?project=${project}&query=${encodeURIComponent(v)}`,
  );
  if (!users || users.length === 0) {
    throw new Error(`No assignable Jira user matches "${v}" in project ${project}. Try a fuller name or an email address.`);
  }
  const lower = v.toLowerCase();
  const exact = users.find(
    (u) => u.displayName?.toLowerCase() === lower || u.emailAddress?.toLowerCase() === lower,
  );
  if (exact) return { accountId: exact.accountId };
  if (users.length === 1) return { accountId: users[0].accountId };

  const names = users
    .slice(0, 8)
    .map((u) => u.displayName + (u.emailAddress ? ` <${u.emailAddress}>` : ""))
    .join(", ");
  throw new Error(`Ambiguous assignee "${v}" — ${users.length} matches: ${names}. Use a fuller name or an email address.`);
}

// Flatten an Atlassian Document Format (ADF) node tree — the structure Jira
// uses for comment/description bodies — into plain text. Handles the node
// types that actually show up in ticket comments; unrecognized leaf types
// are skipped rather than dumped as raw JSON.
function flattenAdf(node) {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") return `@${node.attrs?.text ?? node.attrs?.id ?? "user"}`;
  if (node.type === "emoji") return node.attrs?.text ?? node.attrs?.shortName ?? "";
  if (node.type === "inlineCard" || node.type === "blockCard") return node.attrs?.url ?? "";
  if (node.type === "link" && node.attrs?.href) return node.attrs.href;

  const inner = (node.content ?? []).map(flattenAdf).join("");
  switch (node.type) {
    case "paragraph":
    case "heading":
      return `${inner}\n\n`;
    case "listItem":
      return `- ${inner}\n`;
    case "codeBlock":
      return `\`\`\`\n${inner}\n\`\`\`\n\n`;
    case "blockquote":
      return `> ${inner}\n\n`;
    default:
      return inner;
  }
}

const server = new McpServer({
  name: "jira",
  version: "1.0.0",
});

server.tool(
  "create_ticket",
  "Create a Jira ticket. Uses your configured default project unless `project` is given. If no default is set and `project` is omitted, this errors asking which project to use. Returns the ticket key (e.g. ABC-341).",
  {
    summary: z.string().describe("Short title of the ticket"),
    description: z.string().optional().describe("Detailed description"),
    type: z.enum(["task", "bug", "feature", "subtask"]).default("task"),
    project: z.string().optional().describe("Project key to create in, e.g. 'ABC'. Omit to use the configured default project. Required (ask the user) when no default is configured."),
    estimate: z.string().optional().describe("Time estimate e.g. '2h', '1d'"),
    assignee: z.string().optional().describe("Who to assign — a full name, email, or 'me'/'unassigned'. Omit to leave unassigned. Resolved to a Jira account via the project's assignable-user search."),
    parent: z.string().optional().describe("Parent ticket key (e.g. 'ABC-370'). Required for type 'subtask' (parent must be a standard issue: Task/Story/Feature/Bug). For a Task/Story/Feature/Bug the parent must be an Epic — same-level parenting (e.g. Task under Feature) is rejected by Jira."),
    move_to_in_progress: z.boolean().optional().describe("Immediately move to In Progress after creation"),
  },
  async ({ summary, description, type, project, estimate, assignee, parent, move_to_in_progress }) => {
    if (type === "subtask" && !parent) {
      throw new Error("A subtask requires a parent — pass parent (e.g. 'ABC-370').");
    }
    const projectKey = effectiveProject(project);
    const fields = {
      project: { key: projectKey },
      summary,
      issuetype: { name: ISSUE_TYPES[type] },
    };
    // Subtasks inherit the sprint from their parent; setting it explicitly errors.
    // For everything else, drop the ticket into the project's active sprint if it
    // has one (resolved at runtime, so it never goes stale).
    if (type !== "subtask") {
      const sprintId = await getActiveSprintId(projectKey);
      if (sprintId) fields.customfield_10020 = sprintId;
    }
    if (parent) fields.parent = { key: normKey(parent) };

    if (description) {
      fields.description = {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: description }] }],
      };
    }

    if (estimate) {
      fields.timetracking = { originalEstimate: estimate };
    }

    if (assignee) {
      const resolved = await resolveAssignee(assignee, projectKey);
      if (resolved !== undefined) fields.assignee = resolved;
    }

    const issue = await jira("POST", "/issue", { fields });
    const key = issue.key;

    if (move_to_in_progress) {
      await jira("POST", `/issue/${key}/transitions`, { transition: { id: TRANSITIONS["in-progress"] } });
    }

    return { content: [{ type: "text", text: `Created ${key}: ${summary}` }] };
  }
);

server.tool(
  "get_ticket",
  "Get details of a Jira ticket by key or number. E.g. 'ABC-341' or just '341'.",
  {
    key: z.string().describe("Ticket key like ABC-341 or just the number 341"),
  },
  async ({ key }) => {
    const issueKey = normKey(key);
    const issue = await jira("GET", `/issue/${issueKey}?fields=summary,status,assignee,timetracking,description,issuetype,labels`);
    const f = issue.fields;
    const result = {
      key: issue.key,
      summary: f.summary,
      // Description is fetched above; flatten the ADF body to plain text (same
      // as get_comments) so callers actually receive the ticket's spec.
      description: f.description ? flattenAdf(f.description) : "",
      type: f.issuetype?.name ?? "Unknown",
      status: f.status.name,
      assignee: f.assignee?.displayName ?? "Unassigned",
      estimate: f.timetracking?.originalEstimate ?? "None",
      labels: f.labels ?? [],
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "move_ticket",
  "Move a Jira ticket to a new status.",
  {
    key: z.string().describe("Ticket key like ABC-341 or just 341"),
    status: z.enum(["todo", "in-progress", "qa", "vqa", "done"]),
  },
  async ({ key, status }) => {
    const issueKey = normKey(key);
    await jira("POST", `/issue/${issueKey}/transitions`, { transition: { id: TRANSITIONS[status] } });
    return { content: [{ type: "text", text: `Moved ${issueKey} to ${status}` }] };
  }
);

server.tool(
  "move_ticket_to_project",
  "Move one or more Jira tickets to a DIFFERENT project (re-keys them, e.g. BUG-99 -> ABC-358). " +
    "This is the cross-project 'Move' operation, not a status change — use move_ticket for status. " +
    "Requires Move Issues permission on the source project. Statuses/fields the target workflow " +
    "doesn't share are remapped to target defaults. Notifications are always sent (disabling them " +
    "requires elevated permissions). Returns the old->new key mapping.",
  {
    keys: z.string().describe("One or more ticket keys, comma- or space-separated. E.g. 'BUG-98, BUG-99'"),
    target_project: z.string().optional().describe("Target project key, e.g. 'ABC'. Defaults to your configured default project if one is set; required otherwise."),
  },
  async ({ keys, target_project }) => {
    const target = effectiveProject(target_project);
    const keyList = keys.split(/[\s,]+/).map((k) => k.trim()).filter(Boolean).map(normKey);
    if (!keyList.length) throw new Error("No ticket keys provided");

    // Resolve target project id + its issue types (to map by issue-type name).
    const proj = await jira("GET", `/project/${target}`);
    const typeByName = {};
    for (const it of proj.issueTypes ?? []) if (!it.subtask) typeByName[it.name.toLowerCase()] = it.id;
    const fallbackTypeId = typeByName["task"] ?? Object.values(typeByName)[0];

    // Group source issues by the target issue-type id that matches their current type name.
    const mapping = {};
    for (const key of keyList) {
      const issue = await jira("GET", `/issue/${key}?fields=issuetype`);
      const typeName = issue.fields.issuetype?.name?.toLowerCase();
      const targetTypeId = typeByName[typeName] ?? fallbackTypeId;
      const mapKey = `${proj.id},${targetTypeId}`;
      (mapping[mapKey] ??= {
        inferClassificationDefaults: true,
        inferFieldDefaults: true,
        inferStatusDefaults: true,
        inferSubtaskTypeDefault: true,
        issueIdsOrKeys: [],
      }).issueIdsOrKeys.push(key);
    }

    // Submit the async bulk move and poll the task to completion.
    const { taskId } = await jira("POST", "/bulk/issues/move", {
      sendBulkNotification: true,
      targetToSourcesMapping: mapping,
    });

    let task;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      task = await jira("GET", `/task/${taskId}`);
      if (["COMPLETE", "FAILED", "CANCELLED", "DEAD"].includes(task.status)) break;
    }

    if (task?.status !== "COMPLETE") {
      throw new Error(`Bulk move ${taskId} ended as ${task?.status}: ${JSON.stringify(task?.result ?? {})}`);
    }

    // Resolve the new keys (old keys redirect to their new home).
    const lines = [];
    for (const key of keyList) {
      const moved = await jira("GET", `/issue/${key}?fields=status`);
      lines.push(`${key} -> ${moved.key} [${moved.fields.status.name}]`);
    }
    const failed = Object.keys(task.result?.failedIssues ?? {});
    return {
      content: [
        {
          type: "text",
          text: `Moved ${keyList.length - failed.length}/${keyList.length} to ${target}:\n${lines.join("\n")}` +
            (failed.length ? `\nFAILED: ${failed.join(", ")}` : ""),
        },
      ],
    };
  }
);

server.tool(
  "convert_to_subtask",
  "Convert one or more EXISTING standard issues (Task/Story/Bug) into Sub-tasks nested under a parent, in the same project. This is the only way to nest an existing ticket — Jira's edit API refuses an issue-type change to subtask, so this uses the bulk-move API (the same operation as the UI 'Move'). Notifications are always sent (disabling them needs elevated permissions). Returns the per-issue result.",
  {
    keys: z.string().describe("One or more ticket keys to convert, comma- or space-separated. E.g. 'ABC-371, ABC-373'"),
    parent: z.string().describe("Parent ticket key the subtasks nest under (e.g. 'ABC-370'). Must be a standard-level issue (Task/Story/Feature/Bug) — not an Epic and not itself a subtask."),
  },
  async ({ keys, parent }) => {
    const keyList = keys.split(/[\s,]+/).map((k) => k.trim()).filter(Boolean).map(normKey);
    if (!keyList.length) throw new Error("No ticket keys provided");
    const parentKey = normKey(parent);

    // Subtasks live in their parent's project — resolve the project (and its
    // subtask issue-type id) from the parent rather than any default project.
    const parentIssue = await jira("GET", `/issue/${parentKey}?fields=project`);
    const projKey = parentIssue.fields.project.key;
    const proj = await jira("GET", `/project/${projKey}`);
    const subtaskType = (proj.issueTypes ?? []).find((it) => it.subtask);
    if (!subtaskType) throw new Error(`No subtask issue type found in project ${projKey}`);

    // The target key for a subtask move is THREE-part: "projectId,issueTypeId,parentKey".
    const { taskId } = await jira("POST", "/bulk/issues/move", {
      sendBulkNotification: true,
      targetToSourcesMapping: {
        [`${proj.id},${subtaskType.id},${parentKey}`]: {
          inferClassificationDefaults: true,
          inferFieldDefaults: true,
          inferStatusDefaults: true,
          inferSubtaskTypeDefault: true,
          issueIdsOrKeys: keyList,
        },
      },
    });

    let task;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      task = await jira("GET", `/task/${taskId}`);
      if (["COMPLETE", "FAILED", "CANCELLED", "DEAD"].includes(task.status)) break;
    }
    if (task?.status !== "COMPLETE") {
      throw new Error(`Convert-to-subtask ${taskId} ended as ${task?.status}: ${JSON.stringify(task?.result ?? {})}`);
    }

    const lines = [];
    for (const key of keyList) {
      const i = await jira("GET", `/issue/${key}?fields=issuetype,parent`);
      lines.push(`${key} -> ${i.fields.issuetype?.name} under ${i.fields.parent?.key ?? "?"}`);
    }
    const failed = Object.keys(task.result?.failedIssues ?? {});
    return {
      content: [{
        type: "text",
        text: `Converted ${keyList.length - failed.length}/${keyList.length} to subtasks under ${parentKey}:\n${lines.join("\n")}` +
          (failed.length ? `\nFAILED: ${failed.join(", ")}` : ""),
      }],
    };
  }
);

server.tool(
  "update_ticket",
  "Update fields on an existing Jira ticket.",
  {
    key: z.string().describe("Ticket key like ABC-341 or just 341"),
    summary: z.string().optional(),
    description: z.string().optional(),
    estimate: z.string().optional().describe("e.g. '2h', '1d'"),
    assignee: z.string().optional().describe("A full name, email, 'me', or 'unassigned'. Resolved to a Jira account via the project's assignable-user search."),
    parent: z.string().optional().describe("Parent ticket key (e.g. 'ABC-370'). Jira hierarchy applies: only an Epic can parent a Task/Story/Feature, and only a standard issue can parent a Subtask — same-level parenting is rejected."),
    sprint: z.number().optional().describe("Sprint id (integer) to place the ticket in, e.g. the current active sprint. Find it via JQL 'sprint in openSprints()'. Required after a cross-project move for the ticket to appear on the board."),
  },
  async ({ key, summary, description, estimate, assignee, parent, sprint }) => {
    const issueKey = normKey(key);
    const fields = {};

    if (parent) fields.parent = { key: normKey(parent) };

    if (summary) fields.summary = summary;

    if (description) {
      fields.description = {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: description }] }],
      };
    }

    if (estimate) fields.timetracking = { originalEstimate: estimate };

    if (sprint !== undefined) fields.customfield_10020 = sprint;

    if (assignee !== undefined) fields.assignee = await resolveAssignee(assignee);

    await jira("PUT", `/issue/${issueKey}`, { fields });
    return { content: [{ type: "text", text: `Updated ${issueKey}` }] };
  }
);

server.tool(
  "add_comment",
  "Add a comment to a Jira ticket.",
  {
    key: z.string().describe("Ticket key like ABC-341 or just 341"),
    comment: z.string(),
  },
  async ({ key, comment }) => {
    const issueKey = normKey(key);
    await jira("POST", `/issue/${issueKey}/comment`, {
      body: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: comment }] }],
      },
    });
    return { content: [{ type: "text", text: `Comment added to ${issueKey}` }] };
  }
);

server.tool(
  "get_comments",
  "Get comments on a Jira ticket: author, timestamp, and body flattened from ADF to plain text.",
  {
    key: z.string().describe("Ticket key like ABC-341 or just 341"),
    max: z.number().optional().default(50).describe("Max comments to return"),
  },
  async ({ key, max }) => {
    const issueKey = normKey(key);
    const data = await jira("GET", `/issue/${issueKey}/comment?maxResults=${max}`);
    const comments = (data.comments ?? []).map((c) => ({
      author: c.author?.displayName ?? "Unknown",
      created: c.created,
      body: flattenAdf(c.body).trim(),
    }));
    return { content: [{ type: "text", text: JSON.stringify(comments, null, 2) }] };
  }
);

server.tool(
  "add_label",
  "Add a label to a Jira ticket.",
  {
    key: z.string().describe("Ticket key like ABC-341 or just 341"),
    label: z.string().describe("Label to add, e.g. 'ai-inprogress'"),
  },
  async ({ key, label }) => {
    const issueKey = normKey(key);
    await jira("PUT", `/issue/${issueKey}`, { update: { labels: [{ add: label }] } });
    return { content: [{ type: "text", text: `Added label "${label}" to ${issueKey}` }] };
  }
);

server.tool(
  "remove_label",
  "Remove a label from a Jira ticket.",
  {
    key: z.string().describe("Ticket key like ABC-341 or just 341"),
    label: z.string().describe("Label to remove, e.g. 'ai-inprogress'"),
  },
  async ({ key, label }) => {
    const issueKey = normKey(key);
    await jira("PUT", `/issue/${issueKey}`, { update: { labels: [{ remove: label }] } });
    return { content: [{ type: "text", text: `Removed label "${label}" from ${issueKey}` }] };
  }
);

server.tool(
  "list_attachments",
  "List attachments on a Jira ticket: id, filename, mimeType, size, created, author.",
  {
    key: z.string().describe("Ticket key like ABC-341 or just 341"),
  },
  async ({ key }) => {
    const issueKey = normKey(key);
    const issue = await jira("GET", `/issue/${issueKey}?fields=attachment`);
    const attachments = (issue.fields.attachment ?? []).map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      created: a.created,
      author: a.author?.displayName ?? "Unknown",
    }));
    return { content: [{ type: "text", text: JSON.stringify(attachments, null, 2) }] };
  }
);

server.tool(
  "download_attachment",
  "Download a Jira attachment by id to a local directory (created if missing). Returns the saved absolute path.",
  {
    id: z.string().describe("Attachment id, e.g. '19014' — from list_attachments"),
    outDir: z.string().describe("Directory to save into; created (recursively) if it doesn't exist"),
    filename: z.string().optional().describe("Override filename; defaults to the attachment's original filename"),
  },
  async ({ id, outDir, filename }) => {
    // Metadata call gives us the original filename/mimeType up front.
    const meta = await jira("GET", `/attachment/${id}`);

    // The content endpoint 303-redirects to a pre-signed media URL; fetch()
    // follows it automatically. The cross-origin hop correctly drops our
    // Jira Authorization header — the signed URL doesn't need (or want) it.
    const res = await fetch(`${BASE}/attachment/content/${id}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GET attachment/content/${id} → ${res.status}: ${text}`);
    }

    const name = filename ?? meta.filename ?? id;
    await mkdir(outDir, { recursive: true });
    const outPath = join(outDir, name);
    await writeFile(outPath, Buffer.from(await res.arrayBuffer()));

    return { content: [{ type: "text", text: outPath }] };
  }
);

server.tool(
  "search_tickets",
  "Search Jira tickets using a plain-English query or JQL.",
  {
    query: z.string().describe("Plain text like 'my open bugs' or JQL like 'project=ABC AND status=QA'"),
    max: z.number().optional().default(10),
  },
  async ({ query, max }) => {
    const looksLikeJql = query.toLowerCase().includes("project=") || query.toLowerCase().includes(" and ");
    const jql = looksLikeJql
      ? query
      : PROJECT
        ? `project = ${PROJECT} AND text ~ "${query}" ORDER BY updated DESC`
        : `text ~ "${query}" ORDER BY updated DESC`;

    const data = await jira("GET", `/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${max}&fields=summary,status,assignee`);
    const issues = data.issues.map((i) => ({
      key: i.key,
      summary: i.fields.summary,
      status: i.fields.status.name,
      assignee: i.fields.assignee?.displayName ?? "Unassigned",
    }));
    return { content: [{ type: "text", text: JSON.stringify(issues, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
