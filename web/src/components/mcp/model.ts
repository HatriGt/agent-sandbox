import type { McpProbe, McpServerView, McpTransport } from "@/lib/api";

/**
 * The pure half of the MCP maintenance UI: how a server definition is described to a human, parsed
 * from a pasted command line, validated, and turned into the IDE-style JSON the agent actually reads.
 * No React here so every rule can be unit-tested and reused by the row, the sheet and the preview.
 */

export type Health = McpProbe & { at: number };
export type KV = { k: string; v: string; secret: boolean };
export type Draft = { name: string; type: McpTransport; commandLine: string; url: string; env: KV[]; headers: KV[] };

/** The controller masks stored secrets as `••••` or `ab…xyz`; a value that still looks masked is untouched. */
export const MASKED = /^(••••|.{2}….{3})$/;
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const TRANSPORTS: { value: McpTransport; label: string; short: string; blurb: string }[] = [
  { value: "stdio", label: "Command", short: "stdio", blurb: "A program the sandbox starts and talks to over stdin/stdout. Most npm and Python MCP servers." },
  { value: "http", label: "HTTP", short: "http", blurb: "A remote endpoint over Streamable HTTP — the current MCP transport for hosted servers." },
  { value: "sse", label: "SSE", short: "sse", blurb: "A remote endpoint over Server-Sent Events — the older hosted transport; use it when the docs say /sse." },
];

/* ───────────────────────────── command lines ───────────────────────────── */

/** POSIX-ish split: whitespace separates, single/double quotes group, backslash escapes. */
export function shellSplit(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === "\\" && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

/** Inverse of shellSplit: quote what needs quoting so the line round-trips. */
export function shellJoin(parts: string[]): string {
  return parts
    .map((p) => {
      if (p === "") return '""';
      if (/^[\w@%+=:,./-]+$/.test(p)) return p;
      return `"${p.replace(/(["\\$`])/g, "\\$1")}"`;
    })
    .join(" ");
}

/** The stdio command + args as one line, or the URL. What a row shows as its address. */
export const targetOf = (s: { type: McpTransport; command?: string; args?: string[]; url?: string }) => (s.type === "stdio" ? shellJoin([s.command ?? "", ...(s.args ?? [])].filter(Boolean)) : (s.url ?? ""));

/** The thing being run — the npm/PyPI package or binary — stripped of runner boilerplate. */
export function packageOf(command?: string, args: string[] = []): string | null {
  const cmd = (command ?? "").trim();
  if (!cmd) return null;
  const runner = /^(npx|pnpx|bunx|uvx|uv|pipx|node|python3?|deno|docker)$/i.test(cmd.split(/[\\/]/).pop() ?? "");
  if (!runner) return cmd.split(/[\\/]/).pop() ?? cmd;
  const skipNext = new Set(["-p", "--package", "--from", "--python", "-e", "--env", "-v", "--volume"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "run" || a === "exec" || a === "-m") continue;
    if (skipNext.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    return a.replace(/@(latest|next|\d[\w.-]*)$/, "");
  }
  return null;
}

export function hostOf(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.host + (u.pathname !== "/" ? u.pathname.replace(/\/$/, "") : "");
  } catch {
    return url;
  }
}

/** One line under the name: what this server is, in words. */
export function describe(s: McpServerView): string {
  if (s.type === "stdio") {
    const pkg = packageOf(s.command, s.args);
    return pkg ? `Runs ${pkg} inside the sandbox` : "Runs a command inside the sandbox";
  }
  const host = hostOf(s.url);
  return host ? `${s.type === "sse" ? "SSE" : "HTTP"} · ${host}` : "Remote endpoint";
}

/* ───────────────────────────── status ───────────────────────────── */

export type Status = { kind: "off" | "on" | "connected" | "failed" | "expired" | "checking"; word: string };

export function statusOf(s: McpServerView, h: Health | undefined, testing: boolean): Status {
  if (!s.enabled) return { kind: "off", word: "Off" };
  if (testing) return { kind: "checking", word: "Checking…" };
  if (s.tokenExpired) return { kind: "expired", word: "Token expired" };
  if (h && !h.ok) return { kind: "failed", word: "Failed" };
  if (h && h.ok && s.type !== "stdio") return { kind: "connected", word: h.tools ? `Connected · ${h.tools.length} ${h.tools.length === 1 ? "tool" : "tools"}` : "Connected" };
  return { kind: "on", word: "On" };
}

/** A plain-language next step for a failed probe, keyed off the controller's diagnosis text. */
export function hintFor(detail: string): string | null {
  const d = detail.toLowerCase();
  if (/only public https/.test(d)) return "Private, local or plain-http addresses can't be reached from the controller. The sandbox may still reach it — enable and try a run.";
  if (/401|403|unauthori/.test(d)) return "The server rejected the credentials. Check the Authorization header — a Bearer token is usually expected, and tokens expire.";
  if (/expired/.test(d)) return "Generate a fresh token and paste it into the header.";
  if (/redirect/.test(d)) return "Use the address the server redirects to — usually the same URL with or without a trailing slash, or a /mcp path.";
  if (/404|not found/.test(d)) return "Nothing answers at that path. Most hosted servers listen at /mcp (HTTP) or /sse (SSE) — check the provider's docs.";
  if (/405|406|415|unsupported|not acceptable/.test(d)) return "The endpoint exists but speaks a different transport. Try switching between HTTP and SSE.";
  if (/enotfound|dns|getaddrinfo/.test(d)) return "The hostname doesn't resolve. Check for a typo in the URL.";
  if (/econnrefused|timed? ?out|abort/.test(d)) return "The host didn't answer in time. Confirm the server is up and reachable from the internet.";
  if (/http 5\d\d/.test(d)) return "The server errored on its side. Try again in a minute; if it persists, it's on them.";
  if (/did not look like|not mcp|unexpected/.test(d)) return "Something answered, but not with MCP. Double-check this is the MCP endpoint, not a website or REST API.";
  return null;
}

/* ───────────────────────────── drafts ───────────────────────────── */

export const toKV = (m?: Record<string, string>): KV[] => Object.entries(m ?? {}).map(([k, v]) => ({ k, v, secret: MASKED.test(v) }));
export const fromKV = (rows: KV[]) => Object.fromEntries(rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v]));

export function draftOf(s?: McpServerView): Draft {
  return {
    name: s?.name ?? "",
    type: s?.type ?? "stdio",
    commandLine: s ? shellJoin([s.command ?? "", ...(s.args ?? [])].filter(Boolean)) : "",
    url: s?.url ?? "",
    env: toKV(s?.env),
    headers: toKV(s?.headers),
  };
}

export type DraftErrors = Partial<Record<"name" | "commandLine" | "url", string>>;

export function validate(d: Draft): DraftErrors {
  const e: DraftErrors = {};
  const name = d.name.trim();
  if (!name) e.name = "Give the server a short name — the agent sees tools as name__tool.";
  else if (!NAME_RE.test(name)) e.name = "1–64 characters: letters, digits, . _ -";
  if (d.type === "stdio") {
    if (!shellSplit(d.commandLine).length) e.commandLine = "The command the sandbox runs, e.g. npx -y @modelcontextprotocol/server-postgres";
  } else {
    const u = d.url.trim();
    if (!u) e.url = "The server's endpoint URL.";
    else if (!/^https?:\/\/\S+$/i.test(u)) e.url = "Must start with http:// or https://";
  }
  return e;
}

export function commandOf(d: Draft): { command: string; args: string[] } {
  const [command = "", ...args] = shellSplit(d.commandLine);
  return { command, args };
}

/** The draft as the single-server definition the agent's mcp.json holds under the name. */
export function toDef(d: Draft): Record<string, unknown> {
  const env = fromKV(d.env);
  if (d.type === "stdio") {
    const { command, args } = commandOf(d);
    return { type: "stdio", command, ...(args.length ? { args } : {}), ...(Object.keys(env).length ? { env } : {}) };
  }
  const headers = fromKV(d.headers);
  return { type: d.type, url: d.url.trim(), ...(Object.keys(headers).length ? { headers } : {}), ...(Object.keys(env).length ? { env } : {}) };
}

/** Back from JSON into the structured draft. Throws a human message on a shape we cannot show as fields. */
export function fromDef(text: string, prev: Draft): Draft {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object describing one server.");
  let v = parsed as Record<string, unknown>;
  // Someone pasted a whole { "mcpServers": { name: {…} } } file with one entry — unwrap it.
  if (v.mcpServers && typeof v.mcpServers === "object" && !Array.isArray(v.mcpServers)) {
    const entries = Object.entries(v.mcpServers as Record<string, unknown>);
    if (entries.length !== 1) throw new Error(`That file holds ${entries.length} servers — use Paste config to import several at once.`);
    const [name, def] = entries[0];
    if (!def || typeof def !== "object") throw new Error("Expected a JSON object describing one server.");
    v = { name, ...(def as Record<string, unknown>) };
  }
  const str = (k: string) => {
    const x = v[k];
    return typeof x === "string" ? x : "";
  };
  const map = (k: string): KV[] => {
    const m = v[k];
    if (!m || typeof m !== "object" || Array.isArray(m)) return [];
    return Object.entries(m).map(([kk, vv]) => ({ k: kk, v: String(vv), secret: MASKED.test(String(vv)) }));
  };
  const rawType = str("type");
  const url = str("url");
  const type: McpTransport = rawType === "http" || rawType === "sse" ? rawType : rawType === "stdio" ? "stdio" : url ? (url.includes("/sse") ? "sse" : "http") : "stdio";
  const args = Array.isArray(v.args) ? v.args.map(String) : [];
  return { name: str("name") || prev.name, type, commandLine: shellJoin([str("command"), ...args].filter(Boolean)), url, env: map("env"), headers: map("headers") };
}

/** Masked secrets are not real values; the preview shows them as a placeholder rather than leaking `••••`. */
export function previewJson(name: string, def: Record<string, unknown>): string {
  const scrub = (m: unknown) => (m && typeof m === "object" ? Object.fromEntries(Object.entries(m as Record<string, string>).map(([k, v]) => [k, MASKED.test(v) ? "<stored secret>" : v])) : m);
  const out = { ...def };
  if (out.env) out.env = scrub(out.env);
  if (out.headers) out.headers = scrub(out.headers);
  return JSON.stringify({ mcpServers: { [name || "server"]: out } }, null, 2);
}
