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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  deniedBy,
  isWriteTool,
  MAX_RESULTS,
  renderCatalog,
  renderIndex,
  fullName,
  literalCalls,
  nearest,
  normalizeCode,
  precheck,
  renderTool,
  SEARCH_BUDGET,
  searchTools,
  selectTools,
  SHOWN_RESULTS,
  splitName,
  tokens,
  type Detail,
  type ToolDef,
} from "./tools.js";
import { callLine, capValue, explainError, fileContents, formatRun, previewOf, safeFileName, shapeOf, size, toJson, unwrapResult, UPSTREAM_MAX, type CallLine, type McpResult } from "./result.js";
import { describeSandbox, probeSandbox, runInSandbox, RunPaused, writeChildProgram, type BridgeHooks, type CallReply, type Sandbox } from "./runner.js";

const RUN_TIMEOUT_MS = 120_000;
const CONNECT_TIMEOUT_MS = 30_000;
/** How long `search` waits for upstreams that are still connecting before answering without them. */
const SEARCH_WAIT_MS = 10_000;
const RECALL_KEEP = 50;
const RECALL_MAX_CHARS = 8_000_000;
const SHAPES_MAX = 500;
/** Saved scripts kept per box (the owner's blob keeps as many; knowledge.ts caps it the same). */
const SNIPPETS_MAX = 40;
/** A clean script with this many calls is worth keeping for the next run without being asked. */
const SNIPPET_MIN_CALLS = 3;
/** Runs waiting for the operator's approval, newest kept; and the file they survive a new process in. */
const PAUSED_MAX = 8;
const PAUSED_FILE = "paused.json";
const PAUSED_PERSIST_MAX = 4_000_000;
/** Where remembered shapes, tool counts and saved scripts live (src/code-mode/knowledge.ts ships and harvests it). */
const KNOWLEDGE_FILE = "knowledge.json";
/** The per-server tool names the `run` description carries (every request; the prompt cache keeps it). */
const INDEX_MAX = 2_500;
/** And the saved scripts it names after the tools. */
const INDEX_SNIPPETS_MAX = 700;
/**
 * The box's question file (src/drivers/sentinels.ts QUESTION_MARK): the driver's one channel to
 * the operator. While it exists every tool call the agent makes is denied (the ask-gate hook), so
 * a pause that writes it ends the turn at the pause — the model cannot approve on its own, which
 * it did when the pause only asked it to ask ("you explicitly asked for this change, so I'll
 * proceed", then run {resume}). The resume path deletes the file with the operator's answer.
 */
export const QUESTION_FILE_DEFAULT = "/workspace/.agent.question";
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
  /** Tools whose call pauses the run for the operator, on top of the write tools found by name/annotation. */
  approve: string[];
  /** Tools that never pause, whatever their name says (`*` turns approval off). */
  allow: string[];
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const strMap = (v: unknown) => !v || (typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string"));

/** Read `{mcpServers, codeMode?: {deny, approve, allow}}`; every problem is reported, a bad server is not skipped. */
export function parseConfig(text: string): { config: UpstreamConfig } | { error: string } {
  let raw: { mcpServers?: unknown; codeMode?: { deny?: unknown; approve?: unknown; allow?: unknown } };
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
  const lists: Record<"deny" | "approve" | "allow", string[]> = { deny: [], approve: [], allow: [] };
  for (const key of ["deny", "approve", "allow"] as const) {
    const v = raw.codeMode?.[key] ?? [];
    if (!Array.isArray(v) || !v.every((d) => typeof d === "string")) problems.push(`codeMode.${key} must be a list of tool names`);
    else lists[key] = v as string[];
  }
  if (problems.length) return { error: problems.join("; ") };
  if (!Object.keys(servers).length) return { error: "mcpServers is empty" };
  return { config: { servers, ...lists } };
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
          const a = (t.annotations ?? {}) as { readOnlyHint?: unknown; destructiveHint?: unknown };
          tools.push({
            server: this.name,
            name: t.name,
            full: fullName(this.name, t.name),
            description: t.description ?? "",
            inputSchema: t.inputSchema,
            ...(a.readOnlyHint === true ? { readOnly: true } : {}),
            ...(a.destructiveHint === true ? { destructive: true } : {}),
          });
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
  "call() resolves to the tool's structured result when it has one (use its fields directly: r.rows, not r.structuredContent.rows), else to its text parsed as JSON when it is JSON, else the text; a failed call throws, so wrap a call you can do without in try/catch. " +
  "A tool marked [approval] changes something: its call pauses the run until the operator approves (run tells you how to resume).";

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
  /** The box's question file: a pause writes the approval question there (none: the model is told to ask). */
  questionFile?: string;
}

/** A script kept for later runs: the owner's blob carries it to the next box (knowledge.ts). */
export interface Snippet {
  description: string;
  code: string;
  /** The tools it called, for search and for the model to judge it by. */
  calls: string[];
  savedAt: number;
  runs: number;
}

/** One call a run made, so a resumed run answers it from here instead of calling again. */
interface Recorded {
  n: number;
  name: string;
  argsJson: string;
  reply?: CallReply;
  error?: string;
}

/** A call the operator approved, matched by its place in the sequence and what it was. */
interface Approved {
  seq: number;
  name: string;
  argsJson: string;
}

/** What one `run` carries from start to finish, and across a pause. */
interface RunState {
  id?: string;
  code: string;
  inputJson?: string;
  /** Calls in the order the script made them (the same script makes them in the same order). */
  record: Recorded[];
  approved: Approved[];
  /** The call the run stopped at, waiting for the operator. */
  pending?: Approved & { n: number };
  pausedAt?: number;
  /** The pause wrote the operator's question itself (the question file), so the turn ends there. */
  asked?: boolean;
  /** Per execution: the next sequence number and the n → seq map the hooks share. */
  seq: number;
  seqOf: Map<number, number>;
  replayed: Set<number>;
  /** Naming for the saved script (`save`) or the saved script this run came from. */
  save?: string;
  description?: string;
  snippet?: string;
}

export interface RunArgs {
  code?: unknown;
  snippet?: unknown;
  input?: unknown;
  resume?: unknown;
  save?: unknown;
  description?: unknown;
}

export class CodeMode {
  readonly upstreams: Map<string, Upstream>;
  private shapes = new Map<string, string>();
  /** server → tools it listed, from this and earlier boxes; what the controller's auto decision reads. */
  private toolCounts = new Map<string, number>();
  /** Scripts kept for later runs, from this and earlier boxes; search lists the ones that match. */
  private snippets = new Map<string, Snippet>();
  private paused = new Map<string, RunState>();
  private kept = new Map<number, { value: unknown; chars: number }>();
  private keptChars = 0;
  /** Call numbers continue across server processes (`claude -c` starts a new one), so #n never means two results. */
  private n = 0;
  /** Servers whose notes this session has already shown (in a search or the catalog). */
  private told = new Set<string>();
  /** The last tools/list answered while an upstream was still connecting (so a list_changed is owed). */
  listedIncomplete = false;
  private sandbox?: Sandbox;
  private program?: string;

  constructor(
    readonly config: UpstreamConfig,
    sdk: Sdk,
    readonly paths: Paths
  ) {
    this.upstreams = new Map(Object.entries(config.servers).map(([name, spec]) => [name, new Upstream(name, spec, sdk)]));
    try {
      const k = JSON.parse(readFileSync(join(paths.stateDir, KNOWLEDGE_FILE), "utf8")) as {
        shapes?: Record<string, unknown>;
        toolCounts?: Record<string, unknown>;
        snippets?: Record<string, unknown>;
      };
      for (const [name, v] of Object.entries(k.shapes ?? {})) if (typeof v === "string") this.shapes.set(name, v);
      for (const [name, v] of Object.entries(k.toolCounts ?? {})) if (typeof v === "number") this.toolCounts.set(name, v);
      for (const [name, v] of Object.entries(k.snippets ?? {})) {
        const s = v as Partial<Snippet> | undefined;
        if (s && typeof s.code === "string" && s.code.trim()) {
          this.snippets.set(name, {
            description: typeof s.description === "string" ? s.description : "",
            code: s.code,
            calls: Array.isArray(s.calls) ? s.calls.filter((c): c is string => typeof c === "string") : [],
            savedAt: typeof s.savedAt === "number" ? s.savedAt : 0,
            runs: typeof s.runs === "number" ? s.runs : 0,
          });
        }
      }
    } catch {
      // Nothing learned yet: the owner's first run, or a box from before knowledge.json.
      try {
        for (const [k, v] of Object.entries(JSON.parse(readFileSync(join(paths.stateDir, "shapes.json"), "utf8")))) {
          if (typeof v === "string") this.shapes.set(k, v);
        }
      } catch {
        // No shapes either.
      }
    }
    try {
      const n = Number(JSON.parse(readFileSync(join(paths.stateDir, "calls.json"), "utf8")).n);
      if (Number.isSafeInteger(n) && n > 0) this.n = n;
    } catch {
      // First session in this box: numbering starts at #1.
    }
    try {
      // A run that paused in an earlier process (the operator answered after a `claude -c`) resumes here.
      const p = JSON.parse(readFileSync(join(paths.stateDir, PAUSED_FILE), "utf8")) as Record<string, RunState>;
      for (const [id, r] of Object.entries(p)) {
        if (r && typeof r.code === "string" && Array.isArray(r.record) && r.pending) {
          this.paused.set(id, { ...r, id, approved: Array.isArray(r.approved) ? r.approved : [], seq: 0, seqOf: new Map(), replayed: new Set() });
        }
      }
    } catch {
      // Nothing paused.
    }
  }

  /** The servers this session can reach from a script, for the model's benefit wherever a name helps. */
  serverNames(): string[] {
    return [...this.upstreams.keys()];
  }

  private visibleTools(): ToolDef[] {
    return [...this.upstreams.values()].flatMap((u) => (u.state === "ready" ? u.tools : [])).filter((t) => !deniedBy(t.full, this.config.deny));
  }

  private async settle(ups: Upstream[], ms: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.all(ups.map((u) => u.ensure())), new Promise((r) => (timer = setTimeout(r, ms)))]);
    clearTimeout(timer);
  }

  /**
   * Whether a call to this tool waits for the operator: the owner's allow list wins, then their
   * approve list, then the tool's own annotation or the words of its name (isWriteTool).
   */
  needsApproval(tool: ToolDef): boolean {
    if (deniedBy(tool.full, this.config.allow)) return false;
    if (deniedBy(tool.full, this.config.approve)) return true;
    return isWriteTool(tool);
  }

  private renderHit(t: ToolDef, level: Detail): string {
    const text = renderTool(t, level, this.shapes.get(t.full));
    return this.needsApproval(t) ? text.replace(t.full, `${t.full} [approval]`) : text;
  }

  /**
   * One search answer: exact names (`select:a,b`) or ranked words, the first SHOWN_RESULTS hits at
   * the asked detail while SEARCH_BUDGET lasts, the rest one line each up to MAX_RESULTS, then a
   * count; saved scripts that match; the servers that are down. Readers rank first (searchTools).
   */
  async search(query: string, detail: Detail = "signatures"): Promise<string> {
    await this.settle([...this.upstreams.values()], SEARCH_WAIT_MS);
    const q = String(query ?? "").trim();
    const visible = this.visibleTools();
    const picked = selectTools(visible, q);
    const level: Detail = q ? (["names", "signatures", "full"].includes(detail) ? detail : "signatures") : "names";
    const all = picked ? picked.hits : searchTools(visible, q, Infinity);
    const out = [HOW_TO, ""];
    if (picked?.missing.length) {
      for (const m of picked.missing) {
        const near = nearest(m, visible.map((t) => t.full));
        out.push(`no tool ${JSON.stringify(m)}${near ? `; nearest: ${near}` : ""}`);
      }
      out.push("");
    }
    for (const u of this.upstreams.values()) {
      if (u.state !== "ready" || !u.notes || this.told.has(u.name) || !all.some((t) => t.server === u.name)) continue;
      this.told.add(u.name);
      out.push(`${u.name} says: ${u.notes}`, "");
    }
    let rendered = 0, named = 0, used = 0;
    for (const t of all) {
      if (q && rendered + named >= MAX_RESULTS) break;
      const asLevel = level !== "names" && rendered < SHOWN_RESULTS && used < SEARCH_BUDGET;
      const text = this.renderHit(t, asLevel ? level : "names");
      out.push(...text.split("\n"));
      if (asLevel) (out.push(""), rendered++);
      else named++;
      used += text.length;
    }
    if (!all.length && !picked) out.push(`No tool matched ${JSON.stringify(q)} on ${this.serverNames().join(", ")}. Try fewer or other words, or an empty query to list every tool.`);
    if (named && level !== "names") out.push("", `(one line each above the fold: argument types with select:<name>)`);
    if (all.length > rendered + named) out.push("", `${rendered + named} of ${all.length} matching tools shown; use more specific words, or select:<name> for one.`);
    const snips = this.matchSnippets(q);
    if (snips.length) {
      out.push("", "Saved scripts from earlier runs — rerun one with mcp__code-mode__run {snippet: <name>, input: {...}} (the script reads `input`):");
      for (const [name, s] of snips) out.push(`- ${name}: ${s.description || "(no description)"} (calls ${s.calls.join(", ") || "none"}; ${size(s.code.length)} chars)`);
    }
    const down = [...this.upstreams.values()].filter((u) => u.state !== "ready");
    if (down.length) {
      out.push("", "unavailable:");
      for (const u of down) out.push(u.state === "failed" ? `- ${u.name}: ${u.error}` : `- ${u.name}: still connecting; search again in a few seconds`);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  }

  /** Saved scripts whose name, description or called tools share a word with the query (all, for an empty one). */
  private matchSnippets(q: string): Array<[string, Snippet]> {
    const words = tokens(q);
    const list = [...this.snippets].sort((a, b) => b[1].savedAt - a[1].savedAt);
    if (!words.length) return list.slice(0, 10);
    return list.filter(([name, s]) => {
      const have = new Set(tokens(`${name} ${s.description} ${s.calls.join(" ")}`));
      return words.some((w) => have.has(w));
    }).slice(0, 10);
  }

  /** The text for one `run` and whether it is an error result. */
  async run(args: RunArgs): Promise<{ text: string; isError: boolean }> {
    if (args.resume !== undefined && args.resume !== null && args.resume !== "") return this.resume(String(args.resume));
    let code = typeof args.code === "string" ? args.code : "";
    let snippet: string | undefined;
    if (args.snippet !== undefined && args.snippet !== null && args.snippet !== "") {
      snippet = String(args.snippet);
      const s = this.snippets.get(snippet);
      if (!s) {
        const near = nearest(snippet, [...this.snippets.keys()]);
        return { text: `Error: no saved script ${JSON.stringify(snippet)}${near ? `; nearest: ${near}` : ""}. search lists the saved scripts.`, isError: true };
      }
      code = s.code;
      s.runs++;
    }
    if (!code.trim()) return { text: "Error: run needs code (the body of an async function), or snippet (a saved script's name), or resume (a paused run's id).", isError: true };
    const run: RunState = {
      code,
      inputJson: args.input === undefined ? undefined : toJson(args.input),
      record: [],
      approved: [],
      seq: 0,
      seqOf: new Map(),
      replayed: new Set(),
      save: typeof args.save === "string" && args.save.trim() ? args.save.trim() : undefined,
      description: typeof args.description === "string" ? args.description : undefined,
      snippet,
    };
    return this.execute(run);
  }

  /** The operator approved the call a run paused at: the same script, its calls so far replayed. */
  private async resume(id: string): Promise<{ text: string; isError: boolean }> {
    const run = this.paused.get(id);
    if (!run) {
      const ids = [...this.paused.keys()];
      return {
        text: `Error: no paused run ${JSON.stringify(id)}${ids.length ? ` (paused: ${ids.join(", ")})` : ""}. Run the script again; the call that needs approval pauses it again.`,
        isError: true,
      };
    }
    // The approval is the operator's: while their question is still open nothing resumes.
    if (run.asked && this.paths.questionFile && existsSync(this.paths.questionFile)) {
      return {
        text: `Error: the operator has not answered yet — the approval question for run ${id} is still open. End your turn now; their answer continues this session, and only a yes resumes.`,
        isError: true,
      };
    }
    this.paused.delete(id);
    if (run.pending) run.approved.push({ seq: run.pending.seq, name: run.pending.name, argsJson: run.pending.argsJson });
    run.pending = undefined;
    run.pausedAt = undefined;
    this.persistPaused();
    return this.execute(run);
  }

  private async execute(run: RunState): Promise<{ text: string; isError: boolean }> {
    const norm = normalizeCode(run.code);
    if ("error" in norm) return { text: `Error: the script did not compile — ${norm.error}`, isError: true };
    const names = literalCalls(norm.code).map((c) => splitName(c.name, [...this.upstreams.keys()])?.server);
    const named = [...new Set(names)].filter((s): s is string => !!s).map((s) => this.upstreams.get(s)!);
    await this.settle(named, CONNECT_TIMEOUT_MS);
    const known = new Map([...this.upstreams.values()].filter((u) => u.state === "ready").map((u) => [u.name, u.tools] as const));
    const refused = precheck(norm.code, { servers: [...this.upstreams.keys()], tools: known, deny: this.config.deny });
    if (refused) return { text: `Error: ${refused}`, isError: true };

    this.sandbox ??= probeSandbox();
    this.program ??= writeChildProgram();
    run.seq = 0;
    run.seqOf = new Map();
    run.replayed = new Set();
    const r = await runInSandbox(norm.code, { sandbox: this.sandbox, program: this.program, hooks: this.hooks(run), timeoutMs: RUN_TIMEOUT_MS, input: run.inputJson });
    for (const c of r.calls) if (run.replayed.has(c.n)) c.replayed = true;
    if (r.paused !== undefined) {
      const text = this.pause(run, r.paused, r.logs, r.calls);
      this.saveKnowledge();
      return { text, isError: false };
    }
    if (r.error === undefined) this.keepSnippet(run, r.calls);
    this.saveKnowledge();
    const text = formatRun({ ...r, error: r.error === undefined ? undefined : explainError(r.error) });
    return { text, isError: r.error !== undefined };
  }

  /**
   * The run stopped at a call that needs the operator: keep it (and what it already got) under an
   * id, and tell the model how to ask and how to resume. Nothing was sent for the paused call.
   */
  private pause(run: RunState, paused: string, logs: string[], calls: CallLine[]): string {
    run.id ??= Math.random().toString(36).slice(2, 8);
    run.pausedAt = Date.now();
    // Only complete calls replay; the record ends at the first one that had no answer.
    const firstHole = run.record.findIndex((c) => !c || (c.reply === undefined && c.error === undefined));
    if (firstHole >= 0) run.record.length = firstHole;
    this.paused.set(run.id, run);
    for (const k of this.paused.keys()) {
      if (this.paused.size <= PAUSED_MAX) break;
      this.paused.delete(k);
    }
    this.persistPaused();
    const p = run.pending!;
    const argsText = p.argsJson.length > 600 ? `${p.argsJson.slice(0, 599)}…` : p.argsJson;
    const done = run.record.length;
    run.asked = this.askOperator(run, paused, argsText);
    this.persistPaused();
    const replay = `the ${done} call${done === 1 ? "" : "s"} already made ${done === 1 ? "is" : "are"} answered from ${done === 1 ? "its" : "their"} recorded result${done === 1 ? "" : "s"} (no new calls), and this call goes through`;
    const out = [
      `Paused: call #${p.n} ${p.name} ${argsText} changes something, so it waits for the operator's approval; nothing was sent for it.`,
      run.asked
        ? `The operator has been asked (a card with Approve and Decline; ${paused}). End your turn now, with a short note of what waits: every further tool call is denied until they answer, and a resume before their answer is refused. ` +
          `Their answer continues this session. If it is yes, call mcp__code-mode__run with {"resume": "${run.id}"}: the script runs again, ${replay}. ` +
          "If it is no, do not resume: report what was not done. A different script needs no resume."
        : `Ask the operator whether to go ahead, naming the tool and its arguments (${paused}). ` +
          `If they approve, call mcp__code-mode__run with {"resume": "${run.id}"}: the script runs again, ${replay}. ` +
          "If they decline, do not resume: report what was not done. A different script needs no resume.",
    ];
    const log = logs.join("\n");
    if (log) out.push("--- console ---", log.slice(0, 4000));
    if (calls.length) {
      out.push(`--- ${calls.length} MCP call${calls.length === 1 ? "" : "s"} before the pause ---`);
      for (const c of calls) out.push(callLine(c));
    }
    return out.join("\n");
  }

  /**
   * Put the approval question in front of the operator: the question file, in the shape the
   * controller's card parses (one sentence, context lines, an Options block; src/drivers/prompts.ts).
   * False when there is no file to write (a server outside a box) or the write failed, in which
   * case the pause text asks the model to ask.
   */
  private askOperator(run: RunState, why: string, argsText: string): boolean {
    if (!this.paths.questionFile || !run.pending) return false;
    const p = run.pending;
    const done = run.record.length;
    const text = [
      `Approve call #${p.n} ${p.name}? It changes something, so the script paused before sending it.`,
      "",
      `Arguments: ${argsText.length > 300 ? `${argsText.slice(0, 299)}…` : argsText}`,
      `Why it waits: ${why}.`,
      `${done} call${done === 1 ? "" : "s"} already made replay${done === 1 ? "s" : ""} from ${done === 1 ? "its" : "their"} record; nothing was sent for this one (run ${run.id}).`,
      "",
      "Options:",
      "- Approve | send the call and finish the script",
      "- Decline | send nothing and report what was not done",
      "",
    ].join("\n");
    try {
      writeFileSync(this.paths.questionFile, text);
      return true;
    } catch {
      return false;
    }
  }

  private persistPaused(): void {
    try {
      mkdirSync(this.paths.stateDir, { recursive: true });
      const file = join(this.paths.stateDir, PAUSED_FILE);
      if (!this.paused.size) {
        rmSync(file, { force: true });
        return;
      }
      const plain: Record<string, unknown> = {};
      for (const [id, r] of this.paused) {
        plain[id] = { code: r.code, inputJson: r.inputJson, record: r.record, approved: r.approved, pending: r.pending, pausedAt: r.pausedAt, asked: r.asked, save: r.save, description: r.description, snippet: r.snippet };
      }
      const text = JSON.stringify(plain);
      // A record too big for the disk stays in memory only (a new process would ask again).
      if (text.length <= PAUSED_PERSIST_MAX) writeFileSync(file, text);
    } catch {
      // Persistence is a convenience; a read-only disk must not fail the run.
    }
  }

  /**
   * Keep a script for later runs: when the model named it (`save`), or on its own when it ran clean
   * with SNIPPET_MIN_CALLS calls or more. A rerun of a saved script is counted, not re-saved. The
   * name is the model's, else the server and the tools it called; the description the model's, else
   * the script's first comment line.
   */
  private keepSnippet(run: RunState, calls: CallLine[]): void {
    if (run.snippet && !run.save) return;
    const ok = calls.filter((c) => c.state === "ok");
    if (!run.save && (ok.length < SNIPPET_MIN_CALLS || ok.length < calls.length)) return;
    const tools = [...new Set(ok.map((c) => c.name))];
    const names = [...this.upstreams.keys()];
    const bare = (full: string) => splitName(full, names)?.tool ?? full;
    const servers = [...new Set(tools.map((t) => splitName(t, names)?.server).filter(Boolean))];
    const auto = `${servers.join("+") || "script"}.${tools.slice(0, 3).map(bare).join("+")}${tools.length > 3 ? `+${tools.length - 3}` : ""}`;
    const name = (run.save ?? auto).replace(/[^\w.+-]+/g, "-").slice(0, 80);
    const comment = run.code.split("\n").map((l) => l.trim()).find((l) => l.startsWith("//"))?.replace(/^\/\/\s*/, "");
    const description = (run.description ?? comment ?? `calls ${tools.map(bare).join(", ")}`).replace(/\s+/g, " ").slice(0, 200);
    this.snippets.delete(name);
    this.snippets.set(name, { description, code: run.code, calls: tools, savedAt: Date.now(), runs: 1 });
    for (const k of this.snippets.keys()) {
      if (this.snippets.size <= SNIPPETS_MAX) break;
      this.snippets.delete(k);
    }
  }

  private hooks(run: RunState): BridgeHooks {
    return {
      nextN: () => {
        const seq = run.seq++;
        const rec = run.record[seq];
        const n = rec ? rec.n : ++this.n;
        run.seqOf.set(n, seq);
        return n;
      },
      call: async (n, name, argsJson, signal) => {
        const seq = run.seqOf.get(n) ?? run.seq++;
        const rec = run.record[seq];
        if (rec && rec.name === name && rec.argsJson === argsJson) {
          if (rec.reply) {
            run.replayed.add(n);
            return rec.reply;
          }
          if (rec.error !== undefined) throw new Error(rec.error);
        }
        // A call the record does not have (or has differently: the script changed): from here on live.
        if (rec) run.record.length = seq;
        try {
          const reply = await this.callUpstream(run, seq, n, name, argsJson, signal);
          run.record[seq] = { n, name, argsJson, reply };
          return reply;
        } catch (e) {
          if (!(e instanceof RunPaused)) run.record[seq] = { n, name, argsJson, error: String((e as Error)?.message ?? e) };
          throw e;
        }
      },
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

  private async callUpstream(run: RunState, seq: number, n: number, name: string, argsJson: string, signal: AbortSignal): Promise<CallReply> {
    const rule = deniedBy(name, this.config.deny);
    if (rule) throw new Error(`refused: ${name} is denied by the rule "${rule}" (codeMode.deny)`);
    const split = splitName(name, [...this.upstreams.keys()]);
    if (!split) throw new Error(`no tool ${JSON.stringify(name)}: names are mcp__<server>__<tool> for the servers ${[...this.upstreams.keys()].join(", ")}`);
    const up = this.upstreams.get(split.server)!;
    await up.ensure();
    if (up.state !== "ready" || !up.client) throw new Error(`${split.server} is unavailable: ${up.error || "not connected"}`);
    const tool = up.tools.find((t) => t.name === split.tool);
    if (!tool) {
      const near = nearest(name, this.visibleTools().map((t) => t.full));
      throw new Error(`${name} does not exist${near ? `; nearest: ${near}` : ""}`);
    }
    const args = JSON.parse(argsJson);
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error(`call("${name}", args): args must be an object`);
    if (this.needsApproval(tool) && !run.approved.some((a) => a.seq === seq && a.name === name && a.argsJson === argsJson)) {
      run.pending = { seq, n, name, argsJson };
      throw new RunPaused(`${name} ${deniedBy(name, this.config.approve) ? "is on the approve list" : tool.destructive ? "is marked destructive by its server" : "creates, changes or removes something by its name"}`);
    }
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
    return { json: capped.text, chars: full.length, cut: capped.cut, shape, preview: previewOf(value) };
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
   * The per-server tool names for the `run` description (renderIndex): waits briefly for the
   * upstreams; one not up by then is named as still connecting, and the list is sent again
   * (tools/list_changed) once every upstream has settled.
   */
  async index(): Promise<string> {
    const ups = [...this.upstreams.values()];
    await this.settle(ups, CATALOG_WAIT_MS);
    const lines: string[] = [];
    const visible = this.visibleTools();
    if (visible.length) lines.push(renderIndex(visible, INDEX_MAX));
    const later = ups.filter((u) => u.state !== "ready");
    this.listedIncomplete = later.some((u) => u.state !== "failed");
    if (later.length) lines.push(`${visible.length ? "not connected yet" : "servers still connecting"}: ${later.map((u) => u.name).join(", ")} (search lists their tools once they are up)`);
    // The saved scripts too, newest first, so a run that never searches still knows it can rerun one.
    const snips = [...this.snippets].sort((a, b) => b[1].savedAt - a[1].savedAt);
    if (snips.length) {
      let line = "Saved scripts (run {snippet: name, input}; search for more): ";
      let shown = 0;
      for (const [name, s] of snips) {
        const piece = `${shown ? "; " : ""}${name} — ${s.description.slice(0, 80)}`;
        if (line.length + piece.length > INDEX_SNIPPETS_MAX) break;
        line += piece;
        shown++;
      }
      if (shown < snips.length) line += `; +${snips.length - shown} more`;
      lines.push(line);
    }
    return lines.join("\n");
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

  /**
   * What this box has learned, for the next server process and for the controller to harvest when
   * the run ends: every remembered shape, the tool count of every upstream that has connected, and
   * the saved scripts.
   */
  private saveKnowledge(): void {
    try {
      for (const u of this.upstreams.values()) if (u.state === "ready") this.toolCounts.set(u.name, u.tools.length);
      mkdirSync(this.paths.stateDir, { recursive: true });
      const tmp = join(this.paths.stateDir, `${KNOWLEDGE_FILE}.${process.pid}`);
      writeFileSync(tmp, JSON.stringify({ shapes: Object.fromEntries(this.shapes), toolCounts: Object.fromEntries(this.toolCounts), snippets: Object.fromEntries(this.snippets) }));
      renameSync(tmp, join(this.paths.stateDir, KNOWLEDGE_FILE));
      writeFileSync(join(this.paths.stateDir, "calls.json"), JSON.stringify({ n: this.n }));
    } catch {
      // Knowledge is a convenience; a read-only disk must not fail the run.
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The MCP surface

const TOOLS = [
  {
    name: "search",
    description:
      "Find MCP tools to use from `run` (they are not in ToolSearch). Words rank tools, readers first; `select:mcp__a__b,mcp__c__d` or exact names return just those. Returns mcp__server__tool names with TypeScript-style argument types, for tools called before the shape of their result, and saved scripts that match. detail: \"names\", \"signatures\" (default) or \"full\" (adds parameter docs). An empty query lists every tool. Servers that failed to connect are listed with their error.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to match against tool names, servers and descriptions; select:<name>,<name> for exact names; empty lists everything." },
        detail: { type: "string", enum: ["names", "signatures", "full"] },
      },
      required: ["query"],
    },
  },
  {
    name: "run",
    description:
      "Run JavaScript — the body of an async function — that calls MCP tools and returns only what the task needs. In the script: `await call(\"mcp__server__tool\", { ...args })` returns the tool's result (parsed JSON when the tool returns JSON); `await recall(n)` returns result #n of an earlier call again without calling; `await saveFile(name, data)` writes /workspace/.agent-out/<name> (CSV for an array with .csv, JSONL with .jsonl, else JSON or text) and returns the path; `await sleep(ms)`; `console.log`; `input` is the value run was given. Up to 8 calls run at once (use Promise.all). Filter, count and pick fields in the script and `return` a small value. No fetch, require, process, files or network. Limits: 120 s; return value 20k chars; console 4k. The script sees every tool result whole, so filter big results there. Names and arguments are checked before the script runs; argument types come from search. A call to a tool that creates, changes or removes something pauses the run and puts an Approve/Decline question to the operator itself: end your turn, and after their yes run {resume: id} (calls already made are replayed from their record). {snippet, input} reruns a saved script; {save, description} with code keeps this one.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript: the body of an async function. `return` the result." },
        input: { description: "Any JSON the script reads as `input`." },
        snippet: { type: "string", description: "The name of a saved script to run instead of code (search lists them)." },
        resume: { type: "string", description: "The id of a run that paused for approval; continues it after the operator said yes." },
        save: { type: "string", description: "Keep this script under this name for later runs." },
        description: { type: "string", description: "What the saved script does and what `input` it takes." },
      },
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
    questionFile: process.env.CODE_MODE_QUESTION_FILE || QUESTION_FILE_DEFAULT,
  });
  const server = new sdk.Server(
    { name: "code-mode", version: "1" },
    {
      capabilities: { tools: { listChanged: true } },
      instructions:
        (process.env.CODE_MODE_CATALOG
          ? "MCP tools are reached through this server: mcp__code-mode__run's description lists them; call them from one mcp__code-mode__run script that sees each result whole, filters it and returns only what is needed. mcp__code-mode__search gives parameter docs and result shapes."
          : "MCP tools are reached through this server: mcp__code-mode__run's description names them per server, mcp__code-mode__search gives argument types (select:<name> for one), then call them from one mcp__code-mode__run script that sees each result whole, filters it and returns only what is needed.") +
        ` Servers behind it: ${mode.serverNames().join(", ")}. Their tools are not in ToolSearch and never direct.`,
    }
  );
  server.setRequestHandler(sdk.types.ListToolsRequestSchema, async () => {
    const catalog = await mode.catalog();
    const run = TOOLS.find((t) => t.name === "run")!;
    // Without the catalog the description still names every tool per server (renderIndex), so the
    // model writes its first script without a search and never guesses a name (what two of the
    // first hundred runs did); search is for argument types and result shapes.
    if (!catalog) {
      const index = await mode.index();
      return { tools: TOOLS.map((t) => (t === run ? { ...t, description: `${t.description}\n\nTools (argument types: search):\n${index}` } : t)) };
    }
    // The list below replaces "argument types come from search": search is for what it leaves out.
    const head = run.description.replace(/ argument types come from search\./, " the list below has them; search gives parameter docs and result shapes.");
    const description = `${head}\n\nTools you can call:\n${catalog}`;
    return { tools: TOOLS.map((t) => (t === run ? { ...t, description } : t)) };
  });
  server.setRequestHandler(sdk.types.CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as { query?: string; detail?: Detail } & RunArgs;
    try {
      if (req.params.name === "search") return { content: [{ type: "text" as const, text: await mode.search(String(args.query ?? ""), args.detail) }] };
      if (req.params.name === "run") {
        const r = await mode.run(args);
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
  // Once they have all settled, a tools/list answered while one was still connecting is offered
  // again, so the run description gets that server's names too.
  void Promise.all([...mode.upstreams.values()].map((u) => u.ensure())).then(() => {
    if (mode.listedIncomplete) server.sendToolListChanged().catch(() => {});
  });
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
  if (parsed.config.approve.length) console.log(`approve: ${parsed.config.approve.join(", ")}`);
  if (parsed.config.allow.length) console.log(`allow: ${parsed.config.allow.join(", ")}`);
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
