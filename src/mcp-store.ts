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
import { hasUserStoreBackend, loadBlob, saveBlob, ownerKey, OPERATOR_OWNER } from "./user-store.js";
import type { Config } from "./config.js";
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";
import { maskSecret } from "./redact.js";

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

/**
 * A stdio server whose command or args reference paths that only exist on the OPERATOR'S machine
 * (a Mac homebrew tree, a home directory, a Windows drive) can never run inside a Linux box —
 * spawning it just burns memory and stamps a "failed to connect" warning into every transcript.
 * Users routinely import their whole local MCP config into the dashboard, so this is common.
 */
const HOST_BOUND_PATH_RE = /^(\/opt\/homebrew\/|\/Users\/|\/home\/|~\/|[A-Za-z]:[\\/])/;

/**
 * A private/LAN or loopback target is unreachable from a cloud microVM — and worse than useless:
 * the TCP connect black-holes, and omp's print mode BLOCKS session start on MCP readiness for up
 * to 30s (measured live as a 31s "Starting up" on every task). Matches bare hosts and hosts inside
 * URLs in env/args values.
 */
const LAN_TARGET_RE =
  /(^|[=@/])(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)([:/]|$)/i;

export function isBoxRunnableServer(s: Pick<McpServer, "type" | "command" | "args" | "env" | "url">): boolean {
  if (s.type !== "stdio") {
    // Remote servers: reachable from anywhere — unless they point INTO the operator's LAN.
    return !LAN_TARGET_RE.test(s.url ?? "");
  }
  if (HOST_BOUND_PATH_RE.test(s.command ?? "")) return false;
  if ((s.args ?? []).some((a) => HOST_BOUND_PATH_RE.test(a) || LAN_TARGET_RE.test(a))) return false;
  return !Object.values(s.env ?? {}).some((v) => LAN_TARGET_RE.test(v));
}

/** What the in-box `claude --mcp-config` reads: enabled, box-runnable servers, in Claude Code's shape. */
export function toClaudeMcpConfig(store: McpStore): { mcpServers: Record<string, unknown> } | null {
  const mcpServers: Record<string, unknown> = {};
  for (const s of Object.values(store.servers)) {
    if (!s.enabled || !isBoxRunnableServer(s)) continue;
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
const SECRET_KEY_RE = /(token|secret|passw|pwd|keys?(?:$|[_-])|apikey|^auth$|authorization|cookie|credential|private|bearer|session|signing)/i;
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

/** 2/3 head/tail, min 6 — FIXED: mergeSecrets compares a submitted value against the mask of the
 *  stored value to mean "unchanged", so a saved form from before any change to these numbers must still match. */
export const MCP_MASK = { head: 2, tail: 3, min: 6 } as const;

function maskMap(m: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!m) return undefined;
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, isSecretKey(k) ? maskSecret(v, MCP_MASK) : v]));
}

/** What the dashboard sees: secret VALUES masked, everything else as stored — plus, when a header
 *  carries a JWT, its expiry, so a dead token is visible in the LIST instead of only after a run
 *  silently misses its tools. */
export function viewServers(store: McpStore) {
  return Object.values(store.servers)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => {
      let tokenExpiresAt: string | undefined;
      let tokenExpired: boolean | undefined;
      for (const v of Object.values(s.headers ?? {})) {
        const j = jwtExpiry(v);
        if (j) {
          tokenExpiresAt = j.exp.toISOString();
          tokenExpired = j.expired;
          break;
        }
      }
      return { ...s, env: maskMap(s.env), headers: maskMap(s.headers), ...(tokenExpiresAt ? { tokenExpiresAt, tokenExpired } : {}) };
    });
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
    out[k] = stored !== undefined && (v === "" || v === maskSecret(stored, MCP_MASK)) ? stored : v;
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

/* ───────────────────────── health check ───────────────────────── */

export interface McpProbeResult {
  ok: boolean;
  status?: number;
  /** Human-readable diagnosis — shown verbatim on the dashboard. */
  detail: string;
  /** Tool names the server advertised on `tools/list` after a successful handshake (http/sse only). */
  tools?: string[];
}

/**
 * A JSON-RPC result out of an MCP response body. Streamable HTTP servers may answer a POST with
 * plain JSON or with an SSE stream whose `data:` lines carry the same message; both are handled.
 * Pure — testable without a network.
 */
export function parseJsonRpcResult(body: string): unknown {
  const tryParse = (s: string): unknown => {
    try {
      const v: unknown = JSON.parse(s);
      return v && typeof v === "object" && "result" in v ? v.result : undefined;
    } catch {
      return undefined;
    }
  };
  const direct = tryParse(body);
  if (direct !== undefined) return direct;
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const r = tryParse(line.slice(5).trim());
    if (r !== undefined) return r;
  }
  return undefined;
}

/** Tool names out of a `tools/list` result; `undefined` when the shape is not one. */
export function toolNamesOf(result: unknown): string[] | undefined {
  if (!result || typeof result !== "object" || !("tools" in result) || !Array.isArray(result.tools)) return undefined;
  const names: string[] = [];
  for (const t of result.tools as unknown[]) {
    if (t && typeof t === "object" && "name" in t && typeof t.name === "string") names.push(t.name);
  }
  return names;
}

/**
 * If a header value carries a JWT whose `exp` is in the past, say so specifically — an expired
 * static token is by far the most common way an http MCP server silently dies (the in-box claude
 * drops servers that fail to connect, so the agent just "doesn't have" the tools).
 */
export function jwtExpiry(headerValue: string): { exp: Date; expired: boolean } | null {
  const m = /(?:^|\s)([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/.exec(headerValue);
  if (!m) return null;
  try {
    const payload = JSON.parse(Buffer.from(m[1].split(".")[1], "base64url").toString()) as { exp?: number };
    if (typeof payload.exp !== "number") return null;
    const exp = new Date(payload.exp * 1000);
    return { exp, expired: exp.getTime() < Date.now() };
  } catch {
    return null;
  }
}

/** Shape a probe outcome into the message the dashboard shows. Pure — testable without a network. */
export function describeProbe(s: McpServer, r: { status?: number; body?: string; error?: string }): McpProbeResult {
  const tokenNote = (() => {
    for (const v of Object.values(s.headers ?? {})) {
      const j = jwtExpiry(v);
      if (j?.expired) return ` The stored token EXPIRED ${j.exp.toISOString()} — paste a fresh one.`;
    }
    return "";
  })();
  if (r.error) return { ok: false, detail: `Could not reach ${s.url}: ${r.error}${tokenNote}` };
  const status = r.status ?? 0;
  if (status === 401 || status === 403)
    return { ok: false, status, detail: `${status} unauthorized${r.body ? ` — ${r.body.slice(0, 200)}` : ""}.${tokenNote || " Check the Authorization header."}` };
  if (status >= 400) return { ok: false, status, detail: `HTTP ${status}${r.body ? ` — ${r.body.slice(0, 200)}` : ""}` };
  return { ok: true, status, detail: "Connected — the server answered the MCP initialize handshake." };
}

/**
 * Test one server the way the in-box claude would: for http/sse, POST an `initialize` and read the
 * verdict; for stdio there is nothing to call from here, so only the definition is sanity-checked.
 * Runs on the CONTROLLER (the dashboard's CSP has connect-src 'self', and the box may not exist yet).
 */
/**
 * The probe runs ON the controller with a tenant-supplied URL — classic SSRF shape. Refuse anything
 * that isn't a public https host: loopback, link-local, RFC1918 literals and bare hostnames would
 * let a tenant poke the controller's own API or the host network from inside the container.
 */
export function isProbeableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".")) return false; // localhost, bare container names
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  if (h === "host.docker.internal" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (h.startsWith("[") || h.includes(":")) return false; // IPv6 literals: not needed, hard to vet
  return true;
}

/** The lexical check can be dodged by DNS (evil.nip.io → 169.254.169.254): vet the RESOLVED address too. */
async function resolvesToPublicAddress(hostname: string): Promise<boolean> {
  try {
    const { lookup } = await import("node:dns/promises");
    const addrs = await lookup(hostname, { all: true });
    return addrs.every((a) => {
      if (a.family === 6) return false; // not needed, hard to vet
      const [x, y] = a.address.split(".").map(Number);
      return !(x === 127 || x === 10 || x === 0 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127));
    });
  } catch {
    return false;
  }
}

export async function probeMcpServer(s: McpServer, timeoutMs = 8000): Promise<McpProbeResult> {
  if (s.type === "stdio") return { ok: true, detail: "stdio server — starts inside each sandbox; nothing to test from here." };
  if (!s.url || !isProbeableUrl(s.url)) return { ok: false, detail: "Only public https URLs can be tested from here (the sandbox itself may still reach it)." };
  if (!(await resolvesToPublicAddress(new URL(s.url).hostname)))
    return { ok: false, detail: "Only public https URLs can be tested from here (the sandbox itself may still reach it)." };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const baseHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(s.headers ?? {}) };
  try {
    // fetchPinned resolves once, vets the addresses, and pins the connection to the vetted IP —
    // without the pin a rebinding DNS server passes the lookup check above and re-resolves to
    // 169.254.169.254 for the actual connect. It also never follows redirects (a public host
    // 302ing to link-local/metadata must not be chased from here).
    const { fetchPinned } = await import("./net-guard.js");
    const rpc = (body: unknown, extra: Record<string, string> = {}) =>
      fetchPinned(s.url!, { method: "POST", headers: { ...baseHeaders, ...extra }, body: JSON.stringify(body), signal: ac.signal });
    const res = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "agent-sandbox-health", version: "1" } },
    });
    if (res.status >= 300 && res.status < 400)
      return { ok: false, status: res.status, detail: `HTTP ${res.status} redirect — probes do not follow redirects; use the server's final URL.` };
    const body = await res.text().catch(() => "");
    const verdict = describeProbe(s, { status: res.status, body });
    if (!verdict.ok) return verdict;
    // Handshake done: ask what the agent would actually get. Best effort — a server that only
    // speaks initialize still counts as connected, just without a tool count.
    try {
      const session = res.headers.get("mcp-session-id");
      const sess: Record<string, string> = session ? { "mcp-session-id": session } : {};
      await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, sess);
      const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sess);
      const tools = toolNamesOf(parseJsonRpcResult(await list.text().catch(() => "")));
      if (tools) return { ...verdict, detail: `Connected — ${tools.length} tool${tools.length === 1 ? "" : "s"} advertised.`, tools };
    } catch {
      /* connected, tools unknown */
    }
    return verdict;
  } catch (e) {
    return describeProbe(s, { error: ac.signal.aborted ? `timed out after ${Math.round(timeoutMs / 1000)}s` : (e as Error).message });
  } finally {
    clearTimeout(t);
  }
}

/* ───────────────────────────── IO ───────────────────────────── */

const STORE_PATH = '"$HOME/.agent-sandbox/mcp.json"';

// The file lives on the VPS behind an SSH hop (~100–300 ms). The dashboard reads it on every visit,
// so keep a short-lived copy in memory; writes go through here too, so the copy is never stale.
const CACHE_TTL_MS = 60_000;
let cached: { store: McpStore; at: number } | null = null;

const BLOB_KIND = "mcp";
const perOwner = new Map<string, { store: McpStore; at: number }>();

/** The calling principal's MCP servers (database row per owner; legacy file for the stdio entry / first operator load). */
export async function loadMcpStore(cfg: Config): Promise<McpStore> {
  if (hasUserStoreBackend()) {
    const owner = ownerKey();
    const c = perOwner.get(owner);
    if (c && Date.now() - c.at < CACHE_TTL_MS) return structuredClone(c.store);
    let raw = loadBlob(BLOB_KIND, owner);
    if (raw === null && owner === OPERATOR_OWNER) {
      const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `cat ${STORE_PATH} 2>/dev/null || true`], { check: false });
      raw = r.stdout ?? "";
      if (raw.trim()) saveBlob(BLOB_KIND, raw, owner);
    }
    const store = parseMcpStore(raw ?? "");
    perOwner.set(owner, { store: structuredClone(store), at: Date.now() });
    return store;
  }
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return structuredClone(cached.store);
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `cat ${STORE_PATH} 2>/dev/null || true`], { check: false });
  const store = parseMcpStore(r.stdout ?? "");
  cached = { store: structuredClone(store), at: Date.now() };
  return store;
}

export async function saveMcpStore(cfg: Config, store: McpStore): Promise<void> {
  const json = serializeMcpStore(store);
  if (hasUserStoreBackend()) {
    const owner = ownerKey();
    saveBlob(BLOB_KIND, json, owner);
    perOwner.set(owner, { store: structuredClone(store), at: Date.now() });
    return;
  }
  const remote =
    `mkdir -p "$HOME/.agent-sandbox" && chmod 700 "$HOME/.agent-sandbox" && ` +
    `printf '%s' ${shellQuote(json)} > ${STORE_PATH}.tmp && chmod 600 ${STORE_PATH}.tmp && mv ${STORE_PATH}.tmp ${STORE_PATH}`;
  await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, remote]);
  cached = { store: { servers: { ...store.servers } }, at: Date.now() };
}
