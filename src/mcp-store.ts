/**
 * MCP servers the sandbox agent gets — configured once on the dashboard, injected into every run.
 *
 * Stored on the VPS (`~/.agent-sandbox/mcp.json`, 600) next to the token store; never in the browser
 * beyond what the operator typed. Two ways in: a form (name, transport, command/args or url, env,
 * headers) and pasting the JSON every agentic IDE already speaks (`{"mcpServers": {...}}`). Before
 * the in-box `claude` starts, the enabled servers are written to `/root/.agent-mcp.json` and passed
 * with `--mcp-config`, so the agent has Jira, Slack, a database… without the operator ever being
 * asked mid-run. Pure parsing/shaping here; IO at the bottom.
 */
import type { Config } from "./config.js";
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";

export type McpTransport = "stdio" | "http" | "sse";

export interface McpServer {
  name: string;
  type: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled: boolean;
  addedAt: number;
}

export interface McpStore {
  servers: Record<string, McpServer>;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function parseMcpStore(raw: string): McpStore {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && obj.servers && typeof obj.servers === "object") return { servers: { ...obj.servers } };
  } catch {
    /* fall through */
  }
  return { servers: {} };
}

export function serializeMcpStore(store: McpStore): string {
  return JSON.stringify(store, null, 2);
}

/** Validate + normalise one server definition (form or import). Throws a human message on bad input. */
export function normalizeServer(input: Partial<McpServer> & { name: string }, now = Date.now()): McpServer {
  const name = (input.name ?? "").trim();
  if (!NAME_RE.test(name)) throw new Error(`Server name "${name}" must be 1-64 chars: letters, digits, . _ -`);
  const type: McpTransport = input.type === "http" || input.type === "sse" ? input.type : "stdio";
  const server: McpServer = { name, type, enabled: input.enabled ?? true, addedAt: input.addedAt ?? now };
  if (type === "stdio") {
    const command = (input.command ?? "").trim();
    if (!command) throw new Error(`Server "${name}" needs a command (stdio transport).`);
    server.command = command;
    const args = (input.args ?? []).map((a) => String(a)).filter((a) => a.length > 0);
    if (args.length) server.args = args;
  } else {
    const url = (input.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) throw new Error(`Server "${name}" needs an http(s) url.`);
    server.url = url;
    if (input.headers && Object.keys(input.headers).length) server.headers = cleanMap(input.headers);
  }
  if (input.env && Object.keys(input.env).length) server.env = cleanMap(input.env);
  return server;
}

function cleanMap(m: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    const key = k.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) throw new Error(`Invalid key "${k}".`);
    out[key] = String(v ?? "");
  }
  return out;
}

/**
 * Import the JSON the IDEs use: `{"mcpServers": {name: {...}}}` (Claude Desktop / Claude Code /
 * Cursor / VS Code), or a bare `{name: {...}}` map, or one `{"name": ..., "command": ...}` object.
 */
export function parseMcpImport(json: string, now = Date.now()): McpServer[] {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error("Not valid JSON.");
  }
  if (!obj || typeof obj !== "object") throw new Error("Expected a JSON object.");
  const o = obj as Record<string, unknown>;
  const map = (o.mcpServers && typeof o.mcpServers === "object" ? o.mcpServers : typeof o.name === "string" ? { [o.name]: o } : o) as Record<string, Record<string, unknown>>;
  const out: McpServer[] = [];
  for (const [name, def] of Object.entries(map)) {
    if (!def || typeof def !== "object") continue;
    const type = (def.type as string | undefined) ?? (def.url ? (String(def.url).includes("/sse") ? "sse" : "http") : "stdio");
    out.push(
      normalizeServer(
        {
          name,
          type: type as McpTransport,
          command: def.command as string | undefined,
          args: Array.isArray(def.args) ? (def.args as string[]) : undefined,
          url: def.url as string | undefined,
          env: (def.env as Record<string, string>) ?? undefined,
          headers: (def.headers as Record<string, string>) ?? undefined,
          enabled: def.disabled === true ? false : true,
        },
        now
      )
    );
  }
  if (!out.length) throw new Error("No servers found in that JSON.");
  return out;
}

/** What the in-box `claude --mcp-config` reads: enabled servers only, in Claude Code's shape. */
export function toClaudeMcpConfig(store: McpStore): { mcpServers: Record<string, unknown> } | null {
  const mcpServers: Record<string, unknown> = {};
  for (const s of Object.values(store.servers)) {
    if (!s.enabled) continue;
    mcpServers[s.name] =
      s.type === "stdio"
        ? { type: "stdio", command: s.command, ...(s.args?.length ? { args: s.args } : {}), ...(s.env ? { env: s.env } : {}) }
        : { type: s.type, url: s.url, ...(s.headers ? { headers: s.headers } : {}), ...(s.env ? { env: s.env } : {}) };
  }
  return Object.keys(mcpServers).length ? { mcpServers } : null;
}

/**
 * Which env/header keys hold secrets. Only these are masked on the way to the browser — a host,
 * port, schema or log level is configuration the operator needs to read and edit, not a credential.
 */
const SECRET_KEY_RE = /(token|secret|passw|pwd|api[_-]?key|apikey|^auth$|authorization|cookie|credential|private|bearer|session|access[_-]?key|client[_-]?secret|signing)/i;
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

export function mask(v: string): string {
  return v.length <= 6 ? "••••" : `${v.slice(0, 2)}…${v.slice(-3)}`;
}

function maskMap(m: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!m) return undefined;
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, isSecretKey(k) ? mask(v) : v]));
}

/** What the dashboard sees: secret VALUES masked, everything else as stored. */
export function viewServers(store: McpStore) {
  return Object.values(store.servers)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ ...s, env: maskMap(s.env), headers: maskMap(s.headers) }));
}

/**
 * Values coming back from an editor that only ever saw masked secrets: a value equal to the mask of
 * what is stored (or left blank) means "unchanged" and keeps the stored secret; anything else is new.
 */
export function mergeSecrets(incoming: Record<string, string> | undefined, prev: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!incoming) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(incoming)) {
    const stored = prev?.[k];
    out[k] = stored !== undefined && (v === "" || v === mask(stored)) ? stored : v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The whole store as the JSON the IDEs speak — `{"mcpServers": {name: {...}}}` — with `disabled: true`
 * on servers that are off (Cursor's convention) and secrets masked. This is what the JSON editor shows.
 */
export function toEditableConfig(store: McpStore): { mcpServers: Record<string, unknown> } {
  const mcpServers: Record<string, unknown> = {};
  for (const s of Object.values(store.servers).sort((a, b) => a.name.localeCompare(b.name))) {
    mcpServers[s.name] = {
      type: s.type,
      ...(s.type === "stdio" ? { command: s.command, ...(s.args?.length ? { args: s.args } : {}) } : { url: s.url }),
      ...(s.env ? { env: maskMap(s.env) } : {}),
      ...(s.headers ? { headers: maskMap(s.headers) } : {}),
      ...(s.enabled ? {} : { disabled: true }),
    };
  }
  return { mcpServers };
}

/** Apply an edited full config: servers missing from the JSON are removed, secrets left masked survive. */
export function replaceFromJson(store: McpStore, json: string, now = Date.now()): McpStore {
  const servers: Record<string, McpServer> = {};
  for (const s of parseMcpImport(json, now)) {
    const prev = store.servers[s.name];
    if (prev) {
      s.addedAt = prev.addedAt;
      s.env = mergeSecrets(s.env, prev.env);
      s.headers = mergeSecrets(s.headers, prev.headers);
    }
    servers[s.name] = s;
  }
  return { servers };
}

/* ───────────────────────────── IO ───────────────────────────── */

const STORE_PATH = '"$HOME/.agent-sandbox/mcp.json"';

// The file lives on the VPS behind an SSH hop (~100–300 ms). The dashboard reads it on every visit,
// so keep a short-lived copy in memory; writes go through here too, so the copy is never stale.
const CACHE_TTL_MS = 60_000;
let cached: { store: McpStore; at: number } | null = null;

export async function loadMcpStore(cfg: Config): Promise<McpStore> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return { servers: { ...cached.store.servers } };
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `cat ${STORE_PATH} 2>/dev/null || true`], { check: false });
  const store = parseMcpStore(r.stdout ?? "");
  cached = { store: { servers: { ...store.servers } }, at: Date.now() };
  return store;
}

export async function saveMcpStore(cfg: Config, store: McpStore): Promise<void> {
  const json = serializeMcpStore(store);
  const remote =
    `mkdir -p "$HOME/.agent-sandbox" && chmod 700 "$HOME/.agent-sandbox" && ` +
    `printf '%s' ${shellQuote(json)} > ${STORE_PATH}.tmp && chmod 600 ${STORE_PATH}.tmp && mv ${STORE_PATH}.tmp ${STORE_PATH}`;
  await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, remote]);
  cached = { store: { servers: { ...store.servers } }, at: Date.now() };
}
