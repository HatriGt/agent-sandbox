/**
 * Code mode: an MCP server with two tools, `search` and `run`, in front of the operator's real MCP
 * servers. The model writes one script that calls many upstream tools, filters in the script and
 * returns only what it needs; this server connects to the upstreams, runs the script in a sandboxed
 * child (runner.ts) and answers with the value plus one summary line per call.
 *
 *   node server.js <upstream-config.json>          serve over stdio
 *   node server.js --check <upstream-config.json>  validate, print one line per server, exit 0/1
 *
 * Claude Code's PreToolUse hooks only see the outer `run` call, so every rule about inner calls —
 * which tools exist, the deny list, how many run at once, how long a run may take — lives here.
 * Nothing here waits for a human: a refused call fails at once with the rule that refused it.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  deniedBy,
  MAX_RESULTS,
  renderCatalog,
  fullName,
  literalCalls,
  nearest,
  normalizeCode,
  precheck,
  renderTool,
  searchTools,
  splitName,
  type Detail,
  type ToolDef,
} from "./tools.js";
import { capValue, explainError, fileContents, formatRun, safeFileName, shapeOf, toJson, unwrapResult, UPSTREAM_MAX, type McpResult } from "./result.js";
import { describeSandbox, probeSandbox, runInSandbox, writeChildProgram, type BridgeHooks, type Sandbox } from "./runner.js";

const RUN_TIMEOUT_MS = 120_000;
const CONNECT_TIMEOUT_MS = 30_000;
/** How long `search` waits for upstreams that are still connecting before answering without them. */
const SEARCH_WAIT_MS = 10_000;
const RECALL_KEEP = 50;
const RECALL_MAX_CHARS = 8_000_000;
const SHAPES_MAX = 500;
const SAVE_MAX_CHARS = 50_000_000;
/** CODE_MODE_CATALOG: how long tools/list waits for upstreams so the catalog can list their tools. */
const CATALOG_WAIT_MS = 2_500;
/** CODE_MODE_CATALOG: the most the catalog adds to the `run` description (it rides on every request). */
const CATALOG_MAX = 6_000;
/** An upstream's own MCP instructions, as much as is passed on. */
const NOTES_MAX = 1_500;

// ---------------------------------------------------------------------------------------------
// The SDK

/**
 * The SDK is resolved at run time from next to this file (development and tests) or from the global
 * node_modules root the image bake installs it into (env R, as MCP_DIRECT_BIN_JS uses). The CommonJS
 * build is used through createRequire because an ESM import cannot be pointed at a global root.
 */
function loadSdk() {
  const bases = [import.meta.url, `${(process.env.R || "/usr/local/lib/node_modules").replace(/\/+$/, "")}/`];
  let last: unknown;
  for (const base of bases) {
    try {
      const req = createRequire(base);
      return {
        where: req.resolve("@modelcontextprotocol/sdk/server/index.js"),
        Server: req("@modelcontextprotocol/sdk/server/index.js").Server as typeof import("@modelcontextprotocol/sdk/server/index.js").Server,
        StdioServerTransport: req("@modelcontextprotocol/sdk/server/stdio.js").StdioServerTransport as typeof import("@modelcontextprotocol/sdk/server/stdio.js").StdioServerTransport,
        Client: req("@modelcontextprotocol/sdk/client/index.js").Client as typeof import("@modelcontextprotocol/sdk/client/index.js").Client,
        StdioClientTransport: req("@modelcontextprotocol/sdk/client/stdio.js").StdioClientTransport as typeof import("@modelcontextprotocol/sdk/client/stdio.js").StdioClientTransport,
        StreamableHTTPClientTransport: req("@modelcontextprotocol/sdk/client/streamableHttp.js")
          .StreamableHTTPClientTransport as typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js").StreamableHTTPClientTransport,
        SSEClientTransport: req("@modelcontextprotocol/sdk/client/sse.js").SSEClientTransport as typeof import("@modelcontextprotocol/sdk/client/sse.js").SSEClientTransport,
        types: req("@modelcontextprotocol/sdk/types.js") as typeof import("@modelcontextprotocol/sdk/types.js"),
      };
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`@modelcontextprotocol/sdk is not installed (looked next to the server and under ${bases[1]}): ${(last as Error)?.message}`);
}
type Sdk = ReturnType<typeof loadSdk>;

// ---------------------------------------------------------------------------------------------
// The upstream file

/** One upstream server, in Claude Code's --mcp-config shape (src/mcp-store.ts toClaudeMcpConfig). */
export interface UpstreamSpec {
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface UpstreamConfig {
  servers: Record<string, UpstreamSpec>;
  /** Tools a script may not call, hidden from search too: "mcp__s__t" or with `*` (deniedBy). */
  deny: string[];
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const strMap = (v: unknown) => !v || (typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string"));

/** Read `{mcpServers, codeMode?: {deny}}`; every problem is reported, a bad server is not skipped. */
export function parseConfig(text: string): { config: UpstreamConfig } | { error: string } {
  let raw: { mcpServers?: unknown; codeMode?: { deny?: unknown } };
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: `not JSON: ${(e as Error).message}` };
  }
  const list = raw?.mcpServers;
  if (!list || typeof list !== "object" || Array.isArray(list)) return { error: "no mcpServers object" };
  const servers: Record<string, UpstreamSpec> = {};
  const problems: string[] = [];
  for (const [name, s] of Object.entries(list as Record<string, Record<string, unknown>>)) {
    if (!NAME_RE.test(name)) problems.push(`${name}: the name must be letters, digits, . _ - (1-64)`);
    else if (!s || typeof s !== "object") problems.push(`${name}: not an object`);
    else {
      const type = (s.type ?? (s.command ? "stdio" : undefined)) as string | undefined;
      if (type === "stdio") {
        if (typeof s.command !== "string" || !s.command) problems.push(`${name}: stdio needs a command`);
        else if (s.args !== undefined && !(Array.isArray(s.args) && s.args.every((a) => typeof a === "string"))) problems.push(`${name}: args must be strings`);
        else if (!strMap(s.env)) problems.push(`${name}: env values must be strings`);
        else servers[name] = { type, command: s.command, args: s.args as string[] | undefined, env: s.env as Record<string, string> | undefined };
      } else if (type === "http" || type === "sse") {
        let ok = false;
        try {
          ok = /^https?:$/.test(new URL(String(s.url)).protocol);
        } catch {
          ok = false;
        }
        if (!ok) problems.push(`${name}: ${type} needs an http(s) url`);
        else if (!strMap(s.headers)) problems.push(`${name}: header values must be strings`);
        else servers[name] = { type, url: String(s.url), headers: s.headers as Record<string, string> | undefined };
      } else problems.push(`${name}: unknown type ${JSON.stringify(type)}`);
    }
  }
  const deny = raw.codeMode?.deny ?? [];
  if (!Array.isArray(deny) || !deny.every((d) => typeof d === "string")) problems.push("codeMode.deny must be a list of tool names");
  if (problems.length) return { error: problems.join("; ") };
  if (!Object.keys(servers).length) return { error: "mcpServers is empty" };
  return { config: { servers, deny: deny as string[] } };
}

// ---------------------------------------------------------------------------------------------
// One upstream connection

class Upstream {
  state: "idle" | "connecting" | "ready" | "failed" = "idle";
  tools: ToolDef[] = [];
  error = "";
  /** The server's own MCP `instructions`, which Claude Code would show the model if it were direct. */
  notes = "";
  client?: Client;
  private pending?: Promise<void>;
  private attempts = 0;
  private retryAt = 0;

  constructor(
    readonly name: string,
    private readonly spec: UpstreamSpec,
    private readonly sdk: Sdk
  ) {}

  /**
   * Connected, or the attempt in progress, or a new attempt once the backoff has passed. Resolves
   * either way; the caller reads `state`. A failure also schedules a few background retries, so a
   * server that was slow to come up is there by the time the model searches again.
   */
  ensure(): Promise<void> {
    if (this.state === "ready") return Promise.resolve();
    if (this.pending) return this.pending;
    if (this.state === "failed" && Date.now() < this.retryAt) return Promise.resolve();
    this.state = "connecting";
    this.pending = this.connect()
      .then(() => {
        this.state = "ready";
        this.attempts = 0;
      })
      .catch((e: unknown) => {
        this.state = "failed";
        this.error = briefError(String((e as Error)?.message ?? e));
        this.attempts++;
        const backoff = Math.min(30_000, 1000 * 2 ** this.attempts);
        this.retryAt = Date.now() + backoff;
        if (this.attempts < 4) setTimeout(() => void this.ensure(), backoff).unref();
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async connect(): Promise<void> {
    const { sdk, spec } = this;
    let stderr = "";
    let transport: Transport;
    if (spec.type === "stdio") {
      // The upstream gets the environment Claude Code would have given it (ours plus its own env),
      // so a server behaves exactly as it did when it was configured directly.
      const t = new sdk.StdioClientTransport({
        command: spec.command!,
        args: spec.args ?? [],
        env: { ...(process.env as Record<string, string>), ...(spec.env ?? {}) },
        stderr: "pipe",
      });
      t.stderr?.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-400)));
      transport = t;
    } else {
      const headers = spec.headers ?? {};
      transport =
        spec.type === "http"
          ? new sdk.StreamableHTTPClientTransport(new URL(spec.url!), { requestInit: { headers } })
          : new sdk.SSEClientTransport(new URL(spec.url!), {
              requestInit: { headers },
              eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers as Record<string, string>), ...headers } }) },
            });
    }
    const client = new sdk.Client({ name: "code-mode", version: "1" }, { capabilities: {} });
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer within ${CONNECT_TIMEOUT_MS / 1000} s`)), CONNECT_TIMEOUT_MS))),
      ]);
      const tools: ToolDef[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        for (const t of page.tools) {
          tools.push({ server: this.name, name: t.name, full: fullName(this.name, t.name), description: t.description ?? "", inputSchema: t.inputSchema });
        }
        cursor = page.nextCursor;
      } while (cursor);
      this.tools = tools;
      this.notes = String(client.getInstructions?.() ?? "").trim().slice(0, NOTES_MAX);
      this.client = client;
      // A server that goes away mid-session is reconnected on the next call that needs it.
      client.onclose = () => {
        if (this.client === client) (this.client = undefined), (this.state = "idle");
      };
    } catch (e) {
      await client.close().catch(() => {});
      const tail = stderr.replace(/\r/g, "").split("\n").filter((l) => l.trim()).slice(-3).join(" | ");
      throw new Error(`${(e as Error)?.message ?? e}${tail ? ` (stderr: ${tail})` : ""}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The session

const HOW_TO =
  'Call these from mcp__code-mode__run: `const r = await call("mcp__server__tool", { ...args });`, then filter in the script and return only what the task needs. ' +
  "call() resolves to the tool's structured result when it has one (use its fields directly: r.rows, not r.structuredContent.rows), else to its text parsed as JSON when it is JSON, else the text; a failed call throws, so wrap a call you can do without in try/catch.";

/**
 * An upstream's connect error, short enough to repeat in every search result. Transport errors
 * arrive as a sentence wrapped around a whole JSON body (a Cloudflare 530 page is 600+ chars); keep
 * the status, the title or message, and drop the rest.
 */
export function briefError(message: string): string {
  let m = message.replace(/\s+/g, " ").trim();
  const open = m.indexOf("{");
  const close = m.lastIndexOf("}");
  if (open >= 0 && close > open) {
    try {
      const j = JSON.parse(m.slice(open, close + 1)) as Record<string, unknown>;
      const err = j.error && typeof j.error === "object" ? (j.error as Record<string, unknown>) : undefined;
      const status = j.status ?? err?.code;
      const title = j.title ?? j.message ?? err?.message ?? j.detail;
      if (status !== undefined || title !== undefined) {
        const head = m.slice(0, open).replace(/Streamable HTTP error: Error POSTing to endpoint:?/i, "HTTP:").trim();
        m = `${head} ${[status, title].filter((x) => x !== undefined).join(" ")}`.trim();
      }
    } catch {
      /* not JSON: keep the sentence */
    }
  }
  return m.length > 160 ? m.slice(0, 159) + "…" : m;
}

export interface Paths {
  /** Where remembered result shapes persist across server processes (`claude -c` starts a new one). */
  stateDir: string;
  /** The only directory saveFile writes into. */
  outDir: string;
}

export class CodeMode {
  readonly upstreams: Map<string, Upstream>;
  private shapes = new Map<string, string>();
  private kept = new Map<number, { value: unknown; chars: number }>();
  private keptChars = 0;
  /** Call numbers continue across server processes (`claude -c` starts a new one), so #n never means two results. */
  private n = 0;
  /** Servers whose notes this session has already shown (in a search or the catalog). */
  private told = new Set<string>();
  private sandbox?: Sandbox;
  private program?: string;

  constructor(
    readonly config: UpstreamConfig,
    sdk: Sdk,
    readonly paths: Paths
  ) {
    this.upstreams = new Map(Object.entries(config.servers).map(([name, spec]) => [name, new Upstream(name, spec, sdk)]));
    try {
      for (const [k, v] of Object.entries(JSON.parse(readFileSync(join(paths.stateDir, "shapes.json"), "utf8")))) {
        if (typeof v === "string") this.shapes.set(k, v);
      }
    } catch {
      // No shapes yet: the first session in a box.
    }
    try {
      const n = Number(JSON.parse(readFileSync(join(paths.stateDir, "calls.json"), "utf8")).n);
      if (Number.isSafeInteger(n) && n > 0) this.n = n;
    } catch {
      // First session in this box: numbering starts at #1.
    }
  }

  private visibleTools(): ToolDef[] {
    return [...this.upstreams.values()].flatMap((u) => (u.state === "ready" ? u.tools : [])).filter((t) => !deniedBy(t.full, this.config.deny));
  }

  private async settle(ups: Upstream[], ms: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.all(ups.map((u) => u.ensure())), new Promise((r) => (timer = setTimeout(r, ms)))]);
    clearTimeout(timer);
  }

  async search(query: string, detail: Detail = "signatures"): Promise<string> {
    await this.settle([...this.upstreams.values()], SEARCH_WAIT_MS);
    const q = String(query ?? "").trim();
    const level: Detail = q ? (["names", "signatures", "full"].includes(detail) ? detail : "signatures") : "names";
    const all = searchTools(this.visibleTools(), q, Infinity);
    const hits = q ? all.slice(0, MAX_RESULTS) : all;
    const out = [HOW_TO, ""];
    for (const u of this.upstreams.values()) {
      if (u.state !== "ready" || !u.notes || this.told.has(u.name) || !hits.some((t) => t.server === u.name)) continue;
      this.told.add(u.name);
      out.push(`${u.name} says: ${u.notes}`, "");
    }
    if (hits.length) out.push(...hits.map((t) => renderTool(t, level, this.shapes.get(t.full))).join(level === "names" ? "\n" : "\n\n").split("\n"));
    else out.push(`No tool matched ${JSON.stringify(q)}. Try fewer or other words, or an empty query to list every tool.`);
    if (all.length > hits.length) out.push("", `${hits.length} of ${all.length} matching tools shown; use more specific words for the rest.`);
    const down = [...this.upstreams.values()].filter((u) => u.state !== "ready");
    if (down.length) {
      out.push("", "unavailable:");
      for (const u of down) out.push(u.state === "failed" ? `- ${u.name}: ${u.error}` : `- ${u.name}: still connecting; search again in a few seconds`);
    }
    return out.join("\n");
  }

  /** The text for one `run` and whether it is an error result. */
  async run(code: string): Promise<{ text: string; isError: boolean }> {
    const norm = normalizeCode(String(code ?? ""));
    if ("error" in norm) return { text: `Error: the script did not compile — ${norm.error}`, isError: true };
    const names = literalCalls(norm.code).map((c) => splitName(c.name, [...this.upstreams.keys()])?.server);
    const named = [...new Set(names)].filter((s): s is string => !!s).map((s) => this.upstreams.get(s)!);
    await this.settle(named, CONNECT_TIMEOUT_MS);
    const known = new Map([...this.upstreams.values()].filter((u) => u.state === "ready").map((u) => [u.name, u.tools] as const));
    const refused = precheck(norm.code, { servers: [...this.upstreams.keys()], tools: known, deny: this.config.deny });
    if (refused) return { text: `Error: ${refused}`, isError: true };

    this.sandbox ??= probeSandbox();
    this.program ??= writeChildProgram();
    const r = await runInSandbox(norm.code, { sandbox: this.sandbox, program: this.program, hooks: this.hooks(), timeoutMs: RUN_TIMEOUT_MS });
    this.saveShapes();
    const text = formatRun({ ...r, error: r.error === undefined ? undefined : explainError(r.error) });
    return { text, isError: r.error !== undefined };
  }

  private hooks(): BridgeHooks {
    return {
      nextN: () => ++this.n,
      call: (n, name, argsJson, signal) => this.callUpstream(n, name, argsJson, signal),
      recall: (n) => {
        const k = this.kept.get(n);
        if (k) return toJson(k.value);
        const ns = [...this.kept.keys()];
        throw new Error(`no result #${n} is kept${ns.length ? ` (kept: #${Math.min(...ns)}–#${Math.max(...ns)})` : ""}; results of earlier sessions are not kept, call the tool again`);
      },
      saveFile: (name, dataJson) => {
        const file = safeFileName(name);
        if (!file) throw new Error("saveFile(name, data): name must be a file name like rows.csv");
        const text = fileContents(file, JSON.parse(dataJson));
        if (text.length > SAVE_MAX_CHARS) throw new Error(`saveFile: ${text.length} chars is over the ${SAVE_MAX_CHARS} limit`);
        mkdirSync(this.paths.outDir, { recursive: true });
        const path = join(this.paths.outDir, file);
        writeFileSync(path, text);
        return path;
      },
    };
  }

  private async callUpstream(n: number, name: string, argsJson: string, signal: AbortSignal) {
    const rule = deniedBy(name, this.config.deny);
    if (rule) throw new Error(`refused: ${name} is denied by the rule "${rule}" (codeMode.deny)`);
    const split = splitName(name, [...this.upstreams.keys()]);
    if (!split) throw new Error(`no tool ${JSON.stringify(name)}: names are mcp__<server>__<tool> for the servers ${[...this.upstreams.keys()].join(", ")}`);
    const up = this.upstreams.get(split.server)!;
    await up.ensure();
    if (up.state !== "ready" || !up.client) throw new Error(`${split.server} is unavailable: ${up.error || "not connected"}`);
    if (!up.tools.some((t) => t.name === split.tool)) {
      const near = nearest(name, this.visibleTools().map((t) => t.full));
      throw new Error(`${name} does not exist${near ? `; nearest: ${near}` : ""}`);
    }
    const args = JSON.parse(argsJson);
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error(`call("${name}", args): args must be an object`);
    const raw = (await up.client.callTool({ name: split.tool, arguments: args }, undefined, {
      signal,
      timeout: RUN_TIMEOUT_MS,
      resetTimeoutOnProgress: true,
    })) as McpResult;
    let value: unknown;
    try {
      value = unwrapResult(raw);
    } catch (e) {
      throw new Error(`${name}: ${(e as Error).message}`);
    }
    const full = toJson(value);
    const shape = shapeOf(value);
    this.keep(n, value, full.length);
    this.rememberShape(name, shape);
    // The script gets the whole result; only one too big to hold (UPSTREAM_MAX) is cut, and the
    // marker says so. What reaches the model is capped later, at the returned value (RETURN_CAP).
    const capped = capValue(value, UPSTREAM_MAX, `; the result was over ${UPSTREAM_MAX} chars, narrow the request`);
    return { json: capped.text, chars: full.length, cut: capped.cut, shape };
  }

  private keep(n: number, value: unknown, chars: number): void {
    if (chars > RECALL_MAX_CHARS) return;
    this.kept.set(n, { value, chars });
    this.keptChars += chars;
    for (const [k, v] of this.kept) {
      if (this.kept.size <= RECALL_KEEP && this.keptChars <= RECALL_MAX_CHARS) break;
      this.kept.delete(k);
      this.keptChars -= v.chars;
    }
  }

  private rememberShape(name: string, shape: string): void {
    this.shapes.delete(name);
    this.shapes.set(name, shape);
    for (const k of this.shapes.keys()) {
      if (this.shapes.size <= SHAPES_MAX) break;
      this.shapes.delete(k);
    }
  }

  /**
   * CODE_MODE_CATALOG: the tool list for the `run` description, or undefined when the knob is off.
   * Waits briefly for the upstreams; a server that is not up by then is named so the model searches
   * for it. The last complete catalog is kept on disk and used when no upstream is up in time.
   */
  async catalog(): Promise<string | undefined> {
    if (!process.env.CODE_MODE_CATALOG) return undefined;
    const ups = [...this.upstreams.values()];
    await this.settle(ups, CATALOG_WAIT_MS);
    const file = join(this.paths.stateDir, "catalog.txt");
    const ready = ups.filter((u) => u.state === "ready");
    if (!ready.length) {
      try {
        return readFileSync(file, "utf8");
      } catch {
        // Nothing up yet and no earlier catalog: at least name the servers, so the model searches.
        return `servers still connecting: ${ups.map((u) => u.name).join(", ")} (search lists their tools once they are up)`;
      }
    }
    const notes = new Map(ready.map((u) => [u.name, u.notes] as const));
    let text = renderCatalog(this.visibleTools(), notes, CATALOG_MAX);
    const later = ups.filter((u) => u.state !== "ready").map((u) => u.name);
    if (later.length) text += `\nnot connected yet: ${later.join(", ")} (search lists their tools once they are)`;
    else {
      try {
        mkdirSync(this.paths.stateDir, { recursive: true });
        writeFileSync(file, text);
      } catch {
        // The cache only saves a wait in a later session.
      }
    }
    for (const u of ready) if (u.notes) this.told.add(u.name);
    return text;
  }

  /** Claude closed the session: stop the upstreams and remove the child program's private dir. */
  close(): void {
    for (const u of this.upstreams.values()) void u.client?.close().catch(() => {});
    if (this.program) rmSync(dirname(this.program), { recursive: true, force: true });
  }

  private saveShapes(): void {
    try {
      mkdirSync(this.paths.stateDir, { recursive: true });
      const tmp = join(this.paths.stateDir, `shapes.json.${process.pid}`);
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.shapes)));
      renameSync(tmp, join(this.paths.stateDir, "shapes.json"));
      writeFileSync(join(this.paths.stateDir, "calls.json"), JSON.stringify({ n: this.n }));
    } catch {
      // Shapes are a convenience; a read-only disk must not fail the run.
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The MCP surface

const TOOLS = [
  {
    name: "search",
    description:
      "Find MCP tools to use from `run`. Returns mcp__server__tool names with TypeScript-style argument types and, for tools called before, the shape of their result. detail: \"names\", \"signatures\" (default) or \"full\" (adds parameter docs). An empty query lists every tool. Servers that failed to connect are listed with their error.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to match against tool names, servers and descriptions; empty lists everything." },
        detail: { type: "string", enum: ["names", "signatures", "full"] },
      },
      required: ["query"],
    },
  },
  {
    name: "run",
    description:
      "Run JavaScript — the body of an async function — that calls MCP tools and returns only what the task needs. In the script: `await call(\"mcp__server__tool\", { ...args })` returns the tool's result (parsed JSON when the tool returns JSON); `await recall(n)` returns result #n of an earlier call again without calling; `await saveFile(name, data)` writes /workspace/.agent-out/<name> (CSV for an array with .csv, JSONL with .jsonl, else JSON or text) and returns the path; `await sleep(ms)`; `console.log`. Up to 8 calls run at once (use Promise.all). Filter, count and pick fields in the script and `return` a small value. No fetch, require, process, files or network. Limits: 120 s; return value 20k chars; console 4k. The script sees every tool result whole, so filter big results there. Names and arguments are checked before the script runs; look them up with search first.",
    inputSchema: {
      type: "object",
      properties: { code: { type: "string", description: "JavaScript: the body of an async function. `return` the result." } },
      required: ["code"],
    },
  },
];

async function serve(configPath: string): Promise<void> {
  const sdk = loadSdk();
  const parsed = parseConfig(readFileSync(configPath, "utf8"));
  if ("error" in parsed) throw new Error(`${configPath}: ${parsed.error}`);
  const home = join(homedir(), ".claude", "code-mode");
  const mode = new CodeMode(parsed.config, sdk, {
    stateDir: process.env.CODE_MODE_STATE_DIR || home,
    outDir: process.env.CODE_MODE_OUT_DIR || "/workspace/.agent-out",
  });
  const server = new sdk.Server(
    { name: "code-mode", version: "1" },
    {
      capabilities: { tools: {} },
      instructions: process.env.CODE_MODE_CATALOG
        ? "MCP tools are reached through this server: mcp__code-mode__run's description lists them; call them from one mcp__code-mode__run script that sees each result whole, filters it and returns only what is needed. mcp__code-mode__search gives parameter docs and result shapes."
        : "MCP tools are reached through this server: find them with mcp__code-mode__search, then call them from one mcp__code-mode__run script that sees each result whole, filters it and returns only what is needed.",
    }
  );
  server.setRequestHandler(sdk.types.ListToolsRequestSchema, async () => {
    const catalog = await mode.catalog();
    if (!catalog) return { tools: TOOLS };
    const run = TOOLS.find((t) => t.name === "run")!;
    // The list below replaces "look them up with search first": search is for what it leaves out.
    const head = run.description.replace(/ look them up with search first\.$/, " the list below has them; search gives parameter docs and result shapes.");
    const description = `${head}\n\nTools you can call:\n${catalog}`;
    return { tools: TOOLS.map((t) => (t === run ? { ...t, description } : t)) };
  });
  server.setRequestHandler(sdk.types.CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as { query?: string; detail?: Detail; code?: string };
    try {
      if (req.params.name === "search") return { content: [{ type: "text" as const, text: await mode.search(String(args.query ?? ""), args.detail) }] };
      if (req.params.name === "run") {
        const r = await mode.run(String(args.code ?? ""));
        return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
      }
      return { content: [{ type: "text" as const, text: `unknown tool ${req.params.name}; this server has search and run` }], isError: true };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${(e as Error)?.message ?? e}` }], isError: true };
    }
  });
  const transport = new sdk.StdioServerTransport();
  transport.onclose = () => {
    mode.close();
    setTimeout(() => process.exit(0), 500).unref();
  };
  await server.connect(transport);
  // Start every upstream now, in the background: Claude only waits for this server (two tools,
  // answered at once), and the model's first search should not pay for the upstreams' cold start.
  for (const u of mode.upstreams.values()) void u.ensure();
}

/** `--check`: what Phase 2's install runs before choosing code mode over the direct config. */
function check(configPath: string): number {
  let ok = true;
  try {
    console.log(`sdk: ${loadSdk().where}`);
  } catch (e) {
    console.log(`sdk: missing — ${(e as Error).message}`);
    ok = false;
  }
  let text = "";
  try {
    text = readFileSync(configPath, "utf8");
  } catch (e) {
    console.log(`config: cannot read ${configPath}: ${(e as Error).message}`);
    return 1;
  }
  const parsed = parseConfig(text);
  if ("error" in parsed) {
    console.log(`config: ${parsed.error}`);
    return 1;
  }
  for (const [name, s] of Object.entries(parsed.config.servers)) console.log(`server ${name}: ${s.type}`);
  if (parsed.config.deny.length) console.log(`deny: ${parsed.config.deny.join(", ")}`);
  console.log(`sandbox: ${describeSandbox(probeSandbox())}`);
  return ok ? 0 : 1;
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--check" && argv[1]) process.exit(check(argv[1]));
  else if (argv.length === 1 && !argv[0].startsWith("-")) {
    serve(argv[0]).catch((e) => {
      console.error(`code-mode: ${(e as Error)?.message ?? e}`);
      process.exit(1);
    });
  } else {
    console.error("usage: server.js <upstream-config.json> | server.js --check <upstream-config.json>");
    process.exit(2);
  }
}
