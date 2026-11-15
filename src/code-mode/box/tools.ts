/**
 * Code mode, the pure half: JSON schema → TypeScript-style signatures, tool search, repairing
 * model-written code, the pre-run name/argument check and the deny-list policy.
 *
 * Shipped into the box next to server.js (see src/code-mode/index.ts) and imported by it, so it must
 * not import anything outside this directory. Nothing here touches the network, the file system or
 * the SDK — that keeps every rule here unit-testable on any OS.
 */
import vm from "node:vm";

/** One upstream tool as code mode knows it. `full` is the name scripts use: mcp__<server>__<tool>. */
export interface ToolDef {
  server: string;
  name: string;
  full: string;
  description: string;
  inputSchema: unknown;
}

export type Detail = "names" | "signatures" | "full";

export const fullName = (server: string, tool: string) => `mcp__${server}__${tool}`;

// ---------------------------------------------------------------------------------------------
// Policy

/**
 * The deny rule that matches a tool, if any. Rules are full names where `*` matches any run of
 * characters ("mcp__jira__*", "mcp__*__delete_*"); everything else is literal, so a rule can never
 * be read as a regular expression by accident.
 */
export function deniedBy(full: string, deny: readonly string[]): string | undefined {
  for (const rule of deny) {
    const re = new RegExp("^" + rule.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    if (re.test(full)) return rule;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// JSON schema → TypeScript-style type text

const MAX_DEPTH = 4;
const MAX_UNION = 12;
const IDENT = /^[A-Za-z_$][\w$]*$/;

type Schema = Record<string, unknown>;
const isObj = (v: unknown): v is Schema => !!v && typeof v === "object" && !Array.isArray(v);

/** Resolve a local "#/a/b" pointer against the root schema; anything else is unresolvable. */
function resolveRef(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#")) return undefined;
  let cur: unknown = root;
  for (const raw of ref.slice(1).split("/").filter(Boolean)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObj(cur) && !Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const propKey = (k: string) => (IDENT.test(k) ? k : JSON.stringify(k));
const paren = (t: string) => (/[|&]/.test(t) && !/^[{[(]/.test(t) ? `(${t})` : t);
function union(parts: string[], joiner = " | "): string {
  const uniq = [...new Set(parts)];
  if (uniq.includes("unknown") && joiner === " | ") return "unknown";
  const shown = uniq.slice(0, MAX_UNION);
  return shown.join(joiner) + (uniq.length > MAX_UNION ? `${joiner}…` : "");
}

/**
 * The type text for one schema. `stack` holds the $refs being expanded on the way down: meeting one
 * again is a cycle and reads `unknown` (Cloudflare's json-schema-types does the same), and past
 * MAX_DEPTH nested objects collapse to `object` so one deep schema cannot flood a search result.
 */
export function schemaToType(schema: unknown, root: unknown = schema, depth = 0, stack: readonly string[] = []): string {
  if (schema === true || schema === undefined) return "unknown";
  if (schema === false) return "never";
  if (!isObj(schema)) return "unknown";
  if (typeof schema.$ref === "string") {
    if (stack.includes(schema.$ref)) return "unknown";
    const target = resolveRef(root, schema.$ref);
    return target === undefined ? "unknown" : schemaToType(target, root, depth, [...stack, schema.$ref]);
  }
  const nullable = schema.nullable === true ? " | null" : "";
  if ("const" in schema) return JSON.stringify(schema.const) + nullable;
  if (Array.isArray(schema.enum)) return union(schema.enum.map((v) => JSON.stringify(v))) + nullable;
  for (const key of ["anyOf", "oneOf"] as const) {
    if (Array.isArray(schema[key])) return union((schema[key] as unknown[]).map((s) => schemaToType(s, root, depth, stack))) + nullable;
  }
  if (Array.isArray(schema.allOf)) return union((schema.allOf as unknown[]).map((s) => paren(schemaToType(s, root, depth, stack))), " & ") + nullable;
  if (Array.isArray(schema.type)) {
    return union((schema.type as unknown[]).map((t) => schemaToType({ ...schema, type: t }, root, depth, stack))) + nullable;
  }
  const t = schema.type ?? (isObj(schema.properties) ? "object" : isObj(schema.items) || Array.isArray(schema.items) ? "array" : undefined);
  switch (t) {
    case "string":
      return "string" + nullable;
    case "number":
    case "integer":
      return "number" + nullable;
    case "boolean":
      return "boolean" + nullable;
    case "null":
      return "null";
    case "array": {
      const tuple = Array.isArray(schema.prefixItems) ? schema.prefixItems : Array.isArray(schema.items) ? schema.items : undefined;
      if (tuple) return `[${(tuple as unknown[]).map((s) => schemaToType(s, root, depth + 1, stack)).join(", ")}]` + nullable;
      return `${paren(schemaToType(schema.items, root, depth + 1, stack))}[]` + nullable;
    }
    case "object":
      return objectType(schema, root, depth, stack) + nullable;
    default:
      return "unknown";
  }
}

function objectType(schema: Schema, root: unknown, depth: number, stack: readonly string[]): string {
  const props = isObj(schema.properties) ? schema.properties : {};
  const keys = Object.keys(props);
  const extra = schema.additionalProperties;
  const index = extra === undefined || extra === false ? "" : `[key: string]: ${schemaToType(extra, root, depth + 1, stack)}`;
  if (!keys.length) return index ? `{ ${index} }` : extra === false ? "{}" : "Record<string, unknown>";
  if (depth >= MAX_DEPTH) return "object";
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const fields = keys.map((k) => `${propKey(k)}${required.has(k) ? "" : "?"}: ${schemaToType(props[k], root, depth + 1, stack)}`);
  if (index) fields.push(index);
  return `{ ${fields.join("; ")} }`;
}

/** The `@param` lines for the top-level properties that carry a description ("full" detail). */
function paramDocs(schema: unknown): string[] {
  if (!isObj(schema) || !isObj(schema.properties)) return [];
  return Object.entries(schema.properties)
    .filter(([, p]) => isObj(p) && typeof p.description === "string" && p.description.trim())
    .map(([k, p]) => `@param ${k} - ${oneLine(String((p as Schema).description), 300)}`);
}

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
};

/** The first sentence or line of a description, for the "signatures" level. */
function summary(desc: string): string {
  const first = desc.trim().split(/\n\s*\n|\n/)[0] ?? "";
  const sentence = first.match(/^.*?[.!?](\s|$)/)?.[0] ?? first;
  return oneLine(sentence, 200);
}

/** One tool, rendered for search output at the requested detail. */
export function renderTool(tool: ToolDef, detail: Detail, shape?: string): string {
  if (detail === "names") return `${tool.full} — ${oneLine(summary(tool.description) || "(no description)", 120)}`;
  const lines = [`### ${tool.full}`, detail === "full" ? oneLine(tool.description, 2000) : summary(tool.description)];
  const args = schemaToType(tool.inputSchema);
  lines.push(`args: ${args.length > 3000 ? args.slice(0, 3000) + " …(cut)" : args}`);
  if (detail === "full") lines.push(...paramDocs(tool.inputSchema));
  if (shape) lines.push(`returns (earlier call): ${shape}`);
  return lines.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------------------------
// Search

/** "listJiraIssues", "list_jira-issues" and "LIST JIRA ISSUES" all become [list, jira, issues]. */
export function tokens(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Cloudflare's weights: a hit in the tool's own name says far more than one in its server's name,
// which says more than a word somewhere in a long description.
const W_NAME = 10;
const W_SERVER = 5;
const W_DESC = 2;
export const MAX_RESULTS = 30;

/** "items" finds get_item and "issue" finds listIssues: a plural s is not a different word. */
const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/**
 * Rank tools for a query. With one or two query words every word must hit (a short query is
 * precise); longer queries are sentences, so 60% of their words is enough.
 */
export function searchTools(tools: readonly ToolDef[], query: string, limit = MAX_RESULTS): ToolDef[] {
  const q = tokens(query).map(stem);
  if (!q.length) return [...tools].sort((a, b) => a.full.localeCompare(b.full));
  const need = q.length <= 2 ? q.length : Math.ceil(q.length * 0.6);
  const exact = query.trim();
  const scored: Array<{ tool: ToolDef; score: number }> = [];
  for (const tool of tools) {
    const name = tokens(tool.name).map(stem), server = tokens(tool.server).map(stem);
    const desc = tool.description.toLowerCase();
    const descWords = new Set(tokens(tool.description).map(stem));
    let score = 0, hits = 0;
    for (const w of q) {
      let s = 0;
      if (name.includes(w)) s += W_NAME;
      else if (name.some((n) => n.startsWith(w) || (w.length > 3 && n.includes(w)))) s += W_NAME / 2;
      if (server.includes(w) || server.some((n) => n.startsWith(w))) s += W_SERVER;
      if (descWords.has(w)) s += W_DESC;
      else if (w.length > 3 && desc.includes(w)) s += W_DESC / 2;
      if (s) hits++;
      score += s;
    }
    if (tool.full === exact || tool.name === exact) score += 100;
    if (hits >= need) scored.push({ tool, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.tool.full.localeCompare(b.tool.full))
    .slice(0, limit)
    .map((s) => s.tool);
}

/**
 * The tool list that goes into the `run` tool's description (CODE_MODE_CATALOG), so the model can
 * write its first script without a `search` round trip. Each request carries it, so it is budgeted:
 * one line per tool with its argument types while that fits in `max` chars, else names with a short
 * summary, else bare names per server, else as many as fit and a count of the rest. Sorted, so the
 * text is the same from one session to the next and the prompt cache keeps it. `notes` are the
 * upstream servers' own MCP instructions, which a direct configuration would have shown the model.
 */
export function renderCatalog(tools: readonly ToolDef[], notes: ReadonlyMap<string, string>, max: number): string {
  const sorted = [...tools].sort((a, b) => a.full.localeCompare(b.full));
  const head = [...notes].filter(([, t]) => t.trim()).map(([s, t]) => `${s} says: ${oneLine(t, 600)}`);
  const fits = (lines: string[]) => [...head, ...lines].join("\n").length <= max;
  // Argument types matter more than prose (without them the model searches anyway), so the summary
  // shrinks before the types go.
  const args = sorted.map((t) => {
    const a = schemaToType(t.inputSchema);
    return a.length > 300 ? a.slice(0, 300) + "…" : a;
  });
  for (const n of [100, 60, 40]) {
    const sig = sorted.map((t, i) => `${t.full}(${args[i]}) — ${oneLine(summary(t.description), n)}`);
    if (fits(sig)) return [...head, ...sig].join("\n");
  }
  const named = sorted.map((t) => `${t.full} — ${oneLine(summary(t.description), 60)}`);
  if (fits(named)) return [...head, ...named, "(argument types: search)"].join("\n");
  const byServer = new Map<string, string[]>();
  for (const t of sorted) byServer.set(t.server, [...(byServer.get(t.server) ?? []), t.name]);
  const bare = [...byServer].map(([s, ns]) => `mcp__${s}__: ${ns.join(", ")}`);
  if (fits(bare)) return [...head, ...bare, "(descriptions and argument types: search)"].join("\n");
  const out: string[] = [];
  let used = head.join("\n").length;
  let shown = 0;
  for (const t of sorted) {
    if (used + t.full.length + 80 > max) break;
    out.push(t.full);
    used += t.full.length + 1;
    shown++;
  }
  return [...head, ...out, `…and ${sorted.length - shown} more tools: find them with search`].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Repairing model-written code

/** Compile (never run) code as the body of an async function; the error names the body's line. */
export function syntaxError(body: string): string | undefined {
  try {
    new vm.Script(`(async function () {\n${body}\n})`, { filename: "script.js", lineOffset: -1 });
    return undefined;
  } catch (e) {
    const err = e as Error;
    const line = Number(String(err.stack ?? "").match(/script\.js:(\d+)/)?.[1]);
    const text = Number.isFinite(line) && line > 0 ? body.split("\n")[line - 1] : undefined;
    return `${err.name}: ${err.message}` + (text !== undefined ? ` at line ${line}: ${text.trim()}` : "");
  }
}

const compilesAsExpression = (s: string) => {
  try {
    new vm.Script(`(async function () {\n(\n${s}\n)\n})`);
    return true;
  } catch {
    return false;
  }
};

const FUNCTION_HEAD = /^(async\s+)?(function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;

/**
 * Turn what a model writes into the body of an async function, the way Cloudflare's normalize does
 * it, with the compiler as the parser (no acorn in the box): strip a ``` fence, drop `export
 * default`, call a lone function, and `return` a trailing expression. Returns the body or the
 * syntax error a model can act on.
 */
export function normalizeCode(src: string): { code: string } | { error: string } {
  let s = src.replace(/\r\n?/g, "\n").trim();
  const fence = s.match(/^```[\w+-]*[ \t]*\n([\s\S]*?)\n?```$/);
  if (fence) s = fence[1].trim();
  s = s.replace(/^export\s+default\s+/, "");
  if (!s) return { error: "the script is empty: write the body of an async function and `return` the result" };
  if (FUNCTION_HEAD.test(s) && compilesAsExpression(s.replace(/;\s*$/, ""))) {
    s = `return await (${s.replace(/;\s*$/, "")})();`;
  } else if (!syntaxError(s)) {
    s = withTrailingReturn(s);
  }
  const err = syntaxError(s);
  return err ? { error: err } : { code: s };
}

/**
 * Find the shortest run of last lines that is one expression and make it the return value. The
 * compiler decides what an expression is, so a tail that is a statement (`return x`, a `for` block)
 * or only part of one (`})` closing `rows.map(r => {`) simply does not match and the search moves up.
 * A tail starting with `{` is a block, never an object to return.
 */
function withTrailingReturn(s: string): string {
  const lines = s.split("\n");
  for (let k = 1; k <= Math.min(lines.length, 40); k++) {
    const tail = lines.slice(-k).join("\n").trim().replace(/;\s*$/, "");
    if (!tail || tail.startsWith("{") || !compilesAsExpression(tail)) continue;
    // `return (` shares the tail's first line so error line numbers still match what the model wrote.
    const candidate = `${lines.slice(0, -k).join("\n")}\nreturn (${tail}\n);`.replace(/^\n/, "");
    if (!syntaxError(candidate)) return candidate;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// Pre-run check

/** Blank out comments (keeping strings and line breaks) so a commented-out call is not checked. */
export function maskComments(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < src.length && src[i] !== "\n") (out += " "), i++;
    } else if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) out += src[i] === "\n" ? "\n" : " ";
    } else if (c === '"' || c === "'" || c === "`") {
      const start = i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      out += src.slice(start, ++i);
    } else (out += c), i++;
  }
  return out;
}

/** The text of a balanced {...} starting at `at` (strings respected), or undefined. */
function balancedObject(src: string, at: number): string | undefined {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
    } else if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      if (--depth === 0) return src.slice(at + 1, i);
    }
  }
  return undefined;
}

/**
 * The top-level keys of an object literal's inside, or undefined when the literal has a spread or a
 * computed key — then its keys are only known at run time and the check leaves it alone.
 */
export function literalKeys(inner: string): string[] | undefined {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"' || c === "'" || c === "`") {
      const start = i++;
      while (i < inner.length && inner[i] !== c) i += inner[i] === "\\" ? 2 : 1;
      cur += inner.slice(start, i + 1);
      continue;
    }
    if ("{[(".includes(c)) depth++;
    if ("}])".includes(c)) depth--;
    if (c === "," && depth === 0) (parts.push(cur), (cur = ""));
    else cur += c;
  }
  parts.push(cur);
  const keys: string[] = [];
  for (const raw of parts.map((p) => p.trim()).filter(Boolean)) {
    if (raw.startsWith("...") || raw.startsWith("[")) return undefined;
    const m = raw.match(/^(?:(["'])((?:\\.|(?!\1).)*)\1|([A-Za-z_$][\w$]*|\d+))\s*(?=[:(,]|$)/);
    if (!m) return undefined;
    keys.push(m[2] ?? m[3]);
  }
  return keys;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** The closest candidate by edit distance (also comparing bare tool names), for "did you mean". */
export function nearest(name: string, candidates: readonly string[]): string | undefined {
  const bare = (s: string) => s.replace(/^mcp__.*?__/, "");
  let best: string | undefined, bestD = Infinity;
  for (const c of candidates) {
    const d = Math.min(distance(name, c), distance(bare(name), bare(c)) + 1);
    if (d < bestD) (best = c), (bestD = d);
  }
  return best;
}

/** What the pre-run check needs to know about the upstream servers. */
export interface CheckContext {
  /** Server names in the upstream file. */
  servers: readonly string[];
  /** Tools of servers whose tool list is known; a server missing here is not checked by tool. */
  tools: ReadonlyMap<string, readonly ToolDef[]>;
  deny: readonly string[];
}

/** Split a full name into a configured server and the tool; the longest server name wins. */
export function splitName(full: string, servers: readonly string[]): { server: string; tool: string } | undefined {
  const hit = servers.filter((s) => full.startsWith(`mcp__${s}__`)).sort((a, b) => b.length - a.length)[0];
  return hit === undefined ? undefined : { server: hit, tool: full.slice(`mcp__${hit}__`.length) };
}

/** The literal tool names a script calls, with their 1-based lines, so the server can connect them first. */
export function literalCalls(code: string): Array<{ name: string; line: number; at: number }> {
  const src = maskComments(code);
  const out: Array<{ name: string; line: number; at: number }> = [];
  // The name counts as literal only when the string is the whole first argument: `"mcp__s__" + t`
  // is built at run time and is checked when it is called.
  const re = /(^|[^.\w$])call\s*\(\s*(["'`])((?:\\.|(?!\2).)*)\2(?=\s*[,)])/g;
  for (let m; (m = re.exec(src)); ) {
    if (m[2] === "`" && m[3].includes("${")) continue;
    const at = m.index + m[1].length;
    out.push({ name: m[3], line: src.slice(0, at).split("\n").length, at: m.index + m[0].length });
  }
  return out;
}

/**
 * Refuse a script before it runs when a literal `call("name", {...})` names a tool that does not
 * exist or is denied, or passes an argument the schema does not have / leaves out a required one.
 * A write near the top of a script must never fire because a later line has a typo. Calls built
 * from variables or spreads are only checked when they run.
 */
export function precheck(code: string, ctx: CheckContext): string | undefined {
  const src = maskComments(code);
  const lines = code.split("\n");
  const all = [...ctx.tools.values()].flat().map((t) => t.full);
  for (const c of literalCalls(code)) {
    const where = `line ${c.line}: ${lines[c.line - 1]?.trim()}`;
    const rule = deniedBy(c.name, ctx.deny);
    if (rule) return `refused before running: ${c.name} is denied by the rule "${rule}" (codeMode.deny). ${where}`;
    const split = splitName(c.name, ctx.servers);
    if (!split) {
      const near = nearest(c.name, all);
      return `refused before running: no tool ${JSON.stringify(c.name)} — names are mcp__<server>__<tool> for the servers ${ctx.servers.join(", ")}.${near ? ` Nearest: ${near}.` : ""} ${where}`;
    }
    const known = ctx.tools.get(split.server);
    if (!known) continue;
    const tool = known.find((t) => t.name === split.tool);
    if (!tool) {
      const near = nearest(c.name, all);
      return `refused before running: ${c.name} does not exist.${near ? ` Nearest: ${near}.` : ""} ${where}`;
    }
    const argProblem = checkArgs(src, c.at, tool);
    if (argProblem) return `refused before running: ${argProblem} ${where}`;
  }
  return undefined;
}

function checkArgs(src: string, at: number, tool: ToolDef): string | undefined {
  const rest = src.slice(at);
  const m = rest.match(/^\s*(\)|,\s*(\{|\)))/);
  // A second argument that is not an object literal (a variable, a call) is checked at run time.
  if (!m) return undefined;
  let keys: string[] | undefined = [];
  if (m[2] === "{") {
    const inner = balancedObject(src, at + rest.indexOf("{", m[0].length - 1));
    keys = inner === undefined ? undefined : literalKeys(inner);
  }
  if (!keys) return undefined;
  const schema = isObj(tool.inputSchema) ? tool.inputSchema : {};
  const props = isObj(schema.properties) ? Object.keys(schema.properties) : undefined;
  const open = schema.additionalProperties !== undefined && schema.additionalProperties !== false;
  if (props && !open) {
    for (const k of keys) {
      if (!props.includes(k)) {
        const near = nearest(k, props);
        return `${tool.full} has no argument ${JSON.stringify(k)} (arguments: ${props.join(", ") || "none"}${near ? `; nearest: ${near}` : ""}).`;
      }
    }
  }
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const missing = required.filter((r) => !keys!.includes(r));
  if (missing.length) return `${tool.full} needs ${missing.map((k) => JSON.stringify(k)).join(", ")} (required).`;
  return undefined;
}
