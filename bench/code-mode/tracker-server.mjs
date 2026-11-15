// A fake "tracker" MCP server (stdio) for the code-mode bench: 13 tools with realistic descriptions
// and schemas over deterministic data (data.mjs), built so each bench task has a trap — paging,
// a join that needs one lookup per customer, bot authors flagged only in a nested field, a result
// over code mode's 24k-char cap — plus decoys. Writes change this run's state only: they go to the
// run's write log (state.mjs), which a later process of the same run replays, so no run can alter
// another run's data. update_issue fails once, transiently, for the T10_FLAKY issues.
//
//   node tracker-server.mjs
//
// The SDK comes from sdk.mjs.
import { loadSdk } from "./sdk.mjs";
import { customers, exportRows, issues as seed, messages, orders, T10_FLAKY, users } from "./data.mjs";
import { applyUpdates, log, readLog } from "./state.mjs";

// This run's issues: the seed plus the writes earlier processes of the same run logged.
const state = applyUpdates(seed, readLog());
const issues = [...state.values()];

const cursorOf = (n) => (n == null ? null : Buffer.from(`o:${n}`).toString("base64url"));
const offsetOf = (c) => {
  if (!c) return 0;
  const m = /^o:(\d+)$/.exec(Buffer.from(String(c), "base64url").toString());
  if (!m) throw new Error(`invalid cursor ${JSON.stringify(c)}; pass next_cursor from the previous page unchanged`);
  return Number(m[1]);
};
function page(rows, cursor, size) {
  const at = offsetOf(cursor);
  const slice = rows.slice(at, at + size);
  return { items: slice, next_cursor: at + size < rows.length ? cursorOf(at + size) : null, total_count: rows.length };
}

const PAGE_ISSUES = 50;
const PAGE_MESSAGES = 100;
const PAGE_ORDERS = 100;
const cursorProp = { type: "string", description: "Opaque cursor from the previous page's next_cursor. Omit for the first page." };

const tools = [
  {
    name: "list_issues",
    description:
      "List issues in the tracker, newest first, 50 per page. Each item is a summary (id, key, title, status, priority, project, assignee_id, labels, updated_at); use get_issue for the full record. Results are paginated: when next_cursor is not null, call again with cursor=next_cursor to get the next page. Filters narrow the list server-side.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", enum: ["CORE", "PAY", "MOB"], description: "Only issues of this project." },
        assignee_id: { type: "string", description: "Only issues assigned to this user id (e.g. U104)." },
        updated_since: { type: "string", description: "ISO date (YYYY-MM-DD); only issues updated on or after it." },
        cursor: cursorProp,
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_issue",
    description: "Get one issue by numeric id: title, status, priority, project, assignee {id, name, email}, reporter_id, labels, dates, description and comment count.",
    inputSchema: { type: "object", properties: { id: { type: "integer", description: "Numeric issue id, e.g. 42 for TRK-42." } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "search_issues",
    description: "Full-text search over issue titles. Returns at most 10 matches (id, key, title), best first. Does not search status, labels or descriptions.",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "Words to look for in titles." } }, required: ["text"], additionalProperties: false },
  },
  {
    name: "create_issue",
    description: "Create an issue. Returns the new issue's id and key.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", enum: ["CORE", "PAY", "MOB"] },
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["p0", "p1", "p2", "p3"] },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["project", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "update_issue",
    description: "Change an issue's status, priority, assignee or labels. Returns the updated fields.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        status: { type: "string", enum: ["open", "in_progress", "blocked", "in_review", "done", "closed"] },
        priority: { type: "string", enum: ["p0", "p1", "p2", "p3"] },
        assignee_id: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to an issue. Markdown is supported.",
    inputSchema: { type: "object", properties: { id: { type: "integer" }, body: { type: "string" } }, required: ["id", "body"], additionalProperties: false },
  },
  {
    name: "list_projects",
    description: "List the tracker's projects with their keys, leads and issue counts.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_messages",
    description:
      "List chat messages across the team's channels, oldest first, 100 per page. Each message has id, channel, ts, author {id, display_name, kind} and text. Paginated with cursor/next_cursor.",
    inputSchema: {
      type: "object",
      properties: { channel: { type: "string", description: "Only this channel, e.g. #eng." }, cursor: cursorProp },
      additionalProperties: false,
    },
  },
  {
    name: "get_user",
    description: "Get a user or bot account by id: name, email, kind (human | bot) and team.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "User id, e.g. U104 or B901." } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "list_customers",
    description: "List customer accounts (id, name, tier). For the address, region and account manager use get_customer.",
    inputSchema: { type: "object", properties: { tier: { type: "string", enum: ["standard", "gold", "platinum"] } }, additionalProperties: false },
  },
  {
    name: "get_customer",
    description: "Get one customer by id: name, tier, account_manager_id and address {region (EMEA | AMER | APAC), country, city}.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Customer id, e.g. C305." } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "list_orders",
    description:
      "List orders, 100 per page: id, customer_id, placed_at, status, total {amount, currency} and line items. Filter by status or customer_id. Paginated with cursor/next_cursor.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["paid", "shipped", "refunded", "pending"] },
        customer_id: { type: "string" },
        cursor: cursorProp,
      },
      additionalProperties: false,
    },
  },
  {
    name: "export_rows",
    description: "Export the bookings report as rows (row_id, region, sku, qty, value, booked_on, note). Returns every row of the report in one response, unsorted.",
    inputSchema: { type: "object", properties: { report: { type: "string", enum: ["bookings"], description: "Which report; only bookings exists." } }, additionalProperties: false },
  },
];

const summary = (i) => ({ id: i.id, key: i.key, title: i.title, status: i.status, priority: i.priority, project: i.project, assignee_id: i.assignee.id, labels: i.labels, updated_at: i.updated_at });
const issuesNewestFirst = () => [...issues].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id);

function handle(name, a) {
  switch (name) {
    case "list_issues": {
      const rows = issuesNewestFirst().filter((i) => (!a.project || i.project === a.project) && (!a.assignee_id || i.assignee.id === a.assignee_id) && (!a.updated_since || i.updated_at >= a.updated_since));
      const p = page(rows, a.cursor, PAGE_ISSUES);
      return { issues: p.items.map(summary), next_cursor: p.next_cursor, total_count: p.total_count };
    }
    case "get_issue": {
      const i = state.get(Number(a.id));
      if (!i) throw new Error(`issue ${a.id} not found`);
      return i;
    }
    case "search_issues": {
      const words = String(a.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const scored = issues.map((i) => ({ i, s: words.filter((w) => i.title.toLowerCase().includes(w)).length })).filter((x) => x.s > 0);
      scored.sort((x, y) => y.s - x.s || x.i.id - y.i.id);
      return { matches: scored.slice(0, 10).map(({ i }) => ({ id: i.id, key: i.key, title: i.title })) };
    }
    case "create_issue":
      log({ server: "tracker", tool: name, args: a, ok: true });
      return { id: 251, key: "TRK-251" };
    case "update_issue": {
      const i = state.get(Number(a.id));
      if (!i) throw new Error(`issue ${a.id} not found`);
      if (T10_FLAKY.includes(i.id) && !readLog().some((e) => e.tool === name && e.transient && Number(e.args.id) === i.id)) {
        log({ server: "tracker", tool: name, args: a, ok: false, transient: true });
        throw new Error("503 Service Unavailable: the tracker timed out and the change was not applied; retry the request");
      }
      if (a.status) i.status = a.status;
      if (a.priority) i.priority = a.priority;
      if (a.labels) i.labels = [...a.labels];
      if (a.assignee_id) i.assignee = { id: a.assignee_id };
      log({ server: "tracker", tool: name, args: a, ok: true });
      return { id: i.id, key: i.key, status: i.status, priority: i.priority, assignee_id: i.assignee.id, labels: i.labels };
    }
    case "add_comment":
      if (!state.has(Number(a.id))) throw new Error(`issue ${a.id} not found`);
      log({ server: "tracker", tool: name, args: a, ok: true });
      return { ok: true, id: Number(a.id), comment_id: 9001 };
    case "list_projects":
      return {
        projects: ["CORE", "PAY", "MOB"].map((k) => ({ key: k, name: { CORE: "Core platform", PAY: "Payments", MOB: "Mobile apps" }[k], lead_id: users[k.length].id, issue_count: issues.filter((i) => i.project === k).length })),
      };
    case "list_messages": {
      const rows = messages.filter((m) => !a.channel || m.channel === a.channel);
      const p = page(rows, a.cursor, PAGE_MESSAGES);
      return { messages: p.items, next_cursor: p.next_cursor };
    }
    case "get_user": {
      const u = users.find((x) => x.id === a.id);
      if (!u) throw new Error(`user ${a.id} not found`);
      return u;
    }
    case "list_customers":
      return { customers: customers.filter((c) => !a.tier || c.tier === a.tier).map((c) => ({ id: c.id, name: c.name, tier: c.tier })) };
    case "get_customer": {
      const c = customers.find((x) => x.id === a.id);
      if (!c) throw new Error(`customer ${a.id} not found`);
      return c;
    }
    case "list_orders": {
      const rows = orders.filter((o) => (!a.status || o.status === a.status) && (!a.customer_id || o.customer_id === a.customer_id));
      const p = page(rows, a.cursor, PAGE_ORDERS);
      return { orders: p.items, next_cursor: p.next_cursor };
    }
    case "export_rows":
      return { report: "bookings", row_count: exportRows.length, rows: exportRows };
  }
  throw new Error(`unknown tool ${name}`);
}

const sdk = loadSdk();
const server = new sdk.Server({ name: "tracker", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(sdk.types.ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(sdk.types.CallToolRequestSchema, async (req) => {
  try {
    const value = handle(req.params.name, req.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(value) }] };
  } catch (e) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
  }
});
await server.connect(new sdk.StdioServerTransport());
