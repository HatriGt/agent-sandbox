// A fake "ops" MCP server (stdio) for the code-mode bench: 38 tools, so a session has a large catalog
// next to the tracker's 13. Three carry the tasks: pager_route_resolve (T8; the obvious names —
// oncall_teams_list, escalation_policy_get, rotation_list — do not answer "who is paged"),
// billing_invoice_query (T9; customers keyed by a numeric customer_no where the tracker says "C305",
// paged by offset with {truncated, nextOffset} instead of the tracker's next_cursor). The rest are
// plausible fillers with small deterministic answers. Writes are logged to the run's write log.
//
//   node ops-server.mjs
import { loadSdk } from "./sdk.mjs";
import { invoices, onCall, rota, SERVICES } from "./data.mjs";
import { log } from "./state.mjs";

const svc = { type: "string", enum: SERVICES, description: "Service name, e.g. payments-api." };
const str = (description) => ({ type: "string", description });
const int = (description) => ({ type: "integer", description });
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });

const BILLING_MAX = 25;

/** [name, description, inputSchema, handler(args) | "write"] */
const SPECS = [
  ["pager_route_resolve", "Resolve where a service's paging route lands at a given instant: the responder {user_id, name, handle} the page reaches and the rotation it came from.", obj({ service: svc, at: str("ISO date or date-time, UTC. Default: now.") }, ["service"]), (a) => {
    const date = String(a.at ?? "2026-11-15").slice(0, 10);
    const r = onCall(a.service, date);
    if (!r) throw new Error(`no route for ${a.service}`);
    return { service: a.service, at: date, rotation: `${a.service}-primary`, responder: r };
  }],
  ["oncall_teams_list", "List the on-call teams and the services each team owns.", obj({}), () => ({ teams: [{ team: "payments", services: ["payments-api", "billing-worker"] }, { team: "web", services: ["checkout-web", "auth-gateway"] }, { team: "platform", services: ["search-indexer", "notifications", "reporting", "mobile-sync"] }] })],
  ["escalation_policy_get", "Get a service's escalation policy: its levels, each with a delay and the rotation or team it notifies.", obj({ service: svc }, ["service"]), (a) => ({ service: a.service, levels: [{ level: 1, after_min: 0, target: `${a.service}-primary` }, { level: 2, after_min: 15, target: `${a.service}-secondary` }, { level: 3, after_min: 45, target: "eng-managers" }] })],
  ["rotation_list", "List paging rotations with their length and hand-off time.", obj({}), () => ({ rotations: rota.map((r) => ({ name: `${r.service}-primary`, members: r.responders.length, handoff: "00:00 UTC daily" })) })],
  ["billing_invoice_query", `Query invoices: invoice_no, customer_no, issued, status (open | paid | void), amount_due, currency. At most ${BILLING_MAX} rows per call; when truncated is true, call again with offset=nextOffset.`, obj({ status: { type: "string", enum: ["open", "paid", "void"] }, customer_no: int("Numeric customer number."), offset: int("Rows to skip. Default 0."), limit: int(`Rows per call, at most ${BILLING_MAX}.`) }), (a) => {
    const rows = invoices.filter((v) => (!a.status || v.status === a.status) && (a.customer_no == null || v.customer_no === Number(a.customer_no)));
    const at = Math.max(0, Number(a.offset ?? 0));
    const n = Math.min(BILLING_MAX, Math.max(1, Number(a.limit ?? BILLING_MAX)));
    const page = rows.slice(at, at + n);
    return at + n < rows.length ? { rows: page, truncated: true, nextOffset: at + n } : { rows: page, truncated: false };
  }],
  ["billing_summary", "Billing totals per month (issued, collected) across all customers.", obj({ month: str("YYYY-MM") }), (a) => ({ month: a.month ?? "2026-11", issued: 812340.5, collected: 640112.25, currency: "EUR" })],
  ["deploys_list", "List recent deploys of a service (id, version, at, by, status).", obj({ service: svc, limit: int("Default 10.") }), (a) => ({ deploys: [1, 2, 3].map((n) => ({ id: `D-${a.service ?? "all"}-${n}`, version: `v2.${40 - n}.0`, at: `2026-11-1${n}T09:00:00Z`, by: "ci", status: "succeeded" })) })],
  ["deploy_get", "Get one deploy by id with its changelog.", obj({ id: str("Deploy id.") }, ["id"]), (a) => ({ id: a.id, status: "succeeded", changes: ["bump deps", "fix retry backoff"] })],
  ["deploy_rollback", "Roll a service back to an earlier deploy.", obj({ service: svc, to: str("Deploy id.") }, ["service", "to"]), "write"],
  ["incidents_list", "List incidents (id, title, severity, status, opened_at).", obj({ status: { type: "string", enum: ["open", "resolved"] } }), () => ({ incidents: [{ id: "INC-311", title: "checkout latency", severity: "sev2", status: "resolved", opened_at: "2026-11-09T14:02:00Z" }] })],
  ["incident_get", "Get one incident with its timeline.", obj({ id: str("Incident id.") }, ["id"]), (a) => ({ id: a.id, timeline: [{ at: "2026-11-09T14:02:00Z", note: "opened" }, { at: "2026-11-09T15:10:00Z", note: "resolved" }] })],
  ["incident_create", "Open an incident.", obj({ title: str("Title."), severity: { type: "string", enum: ["sev1", "sev2", "sev3"] } }, ["title"]), "write"],
  ["incident_ack", "Acknowledge an incident.", obj({ id: str("Incident id.") }, ["id"]), "write"],
  ["incident_resolve", "Resolve an incident.", obj({ id: str("Incident id."), note: str("Resolution note.") }, ["id"]), "write"],
  ["alerts_list", "List firing alerts (name, service, since).", obj({ service: svc }), () => ({ alerts: [] })],
  ["alert_silence", "Silence an alert for a while.", obj({ name: str("Alert name."), minutes: int("Duration.") }, ["name"]), "write"],
  ["metrics_query", "Run a metrics query (PromQL) over a range; returns points.", obj({ query: str("PromQL."), range: str("e.g. 1h") }, ["query"]), () => ({ points: [[1763200000, 0.42], [1763200060, 0.44]] })],
  ["slo_status", "SLO attainment of a service over 28 days.", obj({ service: svc }, ["service"]), (a) => ({ service: a.service, slo: 99.9, attained: 99.93 })],
  ["flags_list", "List feature flags and their state.", obj({}), () => ({ flags: [{ key: "new-checkout", on: true }, { key: "dark-mode", on: false }] })],
  ["flag_set", "Turn a feature flag on or off.", obj({ key: str("Flag key."), on: { type: "boolean" } }, ["key", "on"]), "write"],
  ["runbooks_search", "Search runbooks by words.", obj({ text: str("Words.") }, ["text"]), () => ({ runbooks: [{ id: "RB-12", title: "Queue backlog" }] })],
  ["runbook_get", "Get a runbook's steps.", obj({ id: str("Runbook id.") }, ["id"]), (a) => ({ id: a.id, steps: ["check queue depth", "scale workers"] })],
  ["hosts_list", "List hosts of a service.", obj({ service: svc }), () => ({ hosts: ["ip-10-0-1-12", "ip-10-0-1-13"] })],
  ["host_get", "Get one host's facts.", obj({ name: str("Host name.") }, ["name"]), (a) => ({ name: a.name, cpu: 4, mem_gb: 16, zone: "eu-central-1a" })],
  ["certs_expiring", "TLS certificates expiring within N days.", obj({ days: int("Default 30.") }), () => ({ certs: [{ host: "api.acme.example", expires: "2026-12-02" }] })],
  ["dns_records_list", "List DNS records of a zone.", obj({ zone: str("Zone.") }, ["zone"]), (a) => ({ zone: a.zone, records: [{ name: "api", type: "CNAME", value: "lb.acme.example" }] })],
  ["queue_depth", "Current depth of a work queue.", obj({ queue: str("Queue name.") }, ["queue"]), (a) => ({ queue: a.queue, depth: 17 })],
  ["cron_jobs_list", "List scheduled jobs.", obj({}), () => ({ jobs: [{ name: "nightly-report", schedule: "0 2 * * *" }] })],
  ["cron_job_trigger", "Run a scheduled job now.", obj({ name: str("Job name.") }, ["name"]), "write"],
  ["backups_list", "List database backups.", obj({ db: str("Database.") }), () => ({ backups: [{ id: "BK-77", at: "2026-11-15T02:00:00Z", size_gb: 41 }] })],
  ["backup_restore", "Restore a backup into a database.", obj({ id: str("Backup id."), db: str("Target database.") }, ["id", "db"]), "write"],
  ["status_page_get", "The public status page's components and their state.", obj({}), () => ({ components: [{ name: "API", state: "operational" }] })],
  ["status_page_update", "Set a status page component's state.", obj({ name: str("Component."), state: { type: "string", enum: ["operational", "degraded", "outage"] } }, ["name", "state"]), "write"],
  ["changelog_list", "Product changelog entries.", obj({ since: str("YYYY-MM-DD") }), () => ({ entries: [{ at: "2026-11-10", text: "Faster exports" }] })],
  ["maintenance_windows_list", "Planned maintenance windows.", obj({}), () => ({ windows: [] })],
  ["maintenance_window_create", "Plan a maintenance window.", obj({ start: str("ISO."), minutes: int("Length.") }, ["start", "minutes"]), "write"],
  ["cost_report", "Cloud cost per service for a month.", obj({ month: str("YYYY-MM") }), () => ({ services: SERVICES.map((s, i) => ({ service: s, eur: 1200 + i * 310 })) })],
  ["audit_events_list", "Audit events (who changed what).", obj({ since: str("YYYY-MM-DD") }), () => ({ events: [{ at: "2026-11-14T08:00:00Z", actor: "U101", action: "flag_set new-checkout" }] })],
];

const tools = SPECS.map(([name, description, inputSchema]) => ({ name, description, inputSchema }));
const handlers = new Map(SPECS.map(([name, , , h]) => [name, h]));

const sdk = loadSdk();
const server = new sdk.Server(
  { name: "ops", version: "1.0.0" },
  { capabilities: { tools: {} }, instructions: "Times are UTC; paging rotations hand off at 00:00 UTC." },
);
server.setRequestHandler(sdk.types.ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(sdk.types.CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const a = req.params.arguments ?? {};
  try {
    const h = handlers.get(name);
    if (!h) throw new Error(`unknown tool ${name}`);
    if (h === "write") {
      log({ server: "ops", tool: name, args: a, ok: true });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(h(a)) }] };
  } catch (e) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
  }
});
await server.connect(new sdk.StdioServerTransport());
