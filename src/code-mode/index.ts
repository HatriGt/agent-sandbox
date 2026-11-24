/**
 * Code mode, controller side: the files that make up the in-box server, for installMcpConfig to
 * ship into ~/.claude/code-mode/ (over the install exec's stdin), the wrapper config Claude Code is
 * given instead of the servers themselves, and the system-prompt paragraph that goes with it. The
 * box program is authored in TypeScript under ./box and compiled by tsc with everything else, so the
 * controller ships the same compiled JavaScript the tests exercised; there is no bundler and none is
 * needed — the four modules import only each other, node built-ins and the SDK (resolved in the box
 * from the global node_modules).
 */
import { readFileSync } from "node:fs";

/** What an owner's runs learned about their servers (src/code-mode/knowledge.ts keeps and merges it). */
export interface McpKnowledge {
  /** mcp__server__tool → the shape of its last result (never values; box/result.ts shapeOf). */
  shapes: Record<string, string>;
  /** server → tools it listed when last connected. */
  toolCounts: Record<string, number>;
  updatedAt?: number;
}

/** The file the box reads and writes under CODE_MODE_DIR. */
export const CODE_MODE_KNOWLEDGE_FILE = "knowledge.json";

/** The file contents the install ships into the box (no timestamp: the box never needs it). */
export function knowledgeFile(k: McpKnowledge): string {
  return JSON.stringify({ shapes: k.shapes, toolCounts: k.toolCounts }) + "\n";
}

/** The compiled box modules; server.js imports the other three. */
export const CODE_MODE_MODULES = ["server.js", "runner.js", "tools.js", "result.js"] as const;

/** Where the box keeps them; `node ${CODE_MODE_DIR}/server.js <upstream>` starts the server. */
export const CODE_MODE_DIR = "/root/.claude/code-mode";
export const CODE_MODE_SERVER = `${CODE_MODE_DIR}/server.js`;

/** The operator's real servers (mode 600, guarded like /root/.agent-mcp.json): only server.js reads it. */
export const CODE_MODE_UPSTREAM_PATH = "/root/.agent-mcp.upstream.json";

/** The paragraph Claude Code's launch appends to its system prompt while the wrapper is installed. */
export const CODE_MODE_PROMPT_FILE = "prompt.txt";
export const CODE_MODE_PROMPT_PATH = `${CODE_MODE_DIR}/${CODE_MODE_PROMPT_FILE}`;

/**
 * How the model is told to work with the two tools. Kept equal to bench/code-mode/code-mode-prompt.txt
 * (a test checks), which is the text the §7.1 bench measured, updated for whole results.
 */
export const CODE_MODE_PROMPT =
  "MCP tools are reached through code mode: there are no direct mcp__<server>__<tool> tools in this session. " +
  "To use one, first call mcp__code-mode__search with a few words (it returns the exact tool names and argument types), " +
  "then call mcp__code-mode__run with JavaScript — the body of an async function — that does the whole job in one script: " +
  '`await call("mcp__server__tool", {...})` for each call (follow every next_cursor page in a loop, fan out lookups with Promise.all), ' +
  "then filter, join, count or sort in the script and `return` only the values the task needs, never whole result lists. " +
  "The script sees every result whole, however big, so do the filtering there; `await recall(n)` with the call number the summary names " +
  "re-reads an earlier result without calling the tool again. " +
  "The tools behind code mode are not in ToolSearch and are never called directly: mcp__code-mode__run's description names them per server, " +
  "and search with select:<name> gives one tool's argument types. A call to a tool that creates, changes or removes something pauses the run " +
  "and asks the operator itself (an Approve/Decline card): end your turn, and when their answer comes back as yes call run with the resume id it gave you.";

/**
 * The paragraph for one install: the bench text, then which servers are behind the script and which
 * stay direct, so the model knows the names to search for and never guesses a server it cannot see
 * (two of the first hundred runs guessed `mcp__github__…` without a search; §13.1).
 */
export function codeModePromptFor(wrapped: readonly string[], direct: readonly string[] = []): string {
  const parts = [CODE_MODE_PROMPT];
  if (wrapped.length) parts.push(`Servers behind code mode: ${wrapped.join(", ")}.`);
  if (direct.length) {
    const one = direct.length === 1;
    parts.push(
      `The ${one ? "server" : "servers"} ${direct.join(", ")} ${one ? "is" : "are"} direct instead: ` +
        `${one ? "its" : "their"} mcp__<server>__<tool> tools are in this session as usual and are not reachable from a script.`
    );
  }
  return parts.join(" ");
}

/** The wrapper's own entry in a --mcp-config. */
export function codeModeWrapperEntry(): Record<string, unknown> {
  return {
    type: "stdio",
    command: "node",
    args: [CODE_MODE_SERVER, CODE_MODE_UPSTREAM_PATH],
    env: { R: "/usr/local/lib/node_modules" },
    alwaysLoad: true,
  };
}

/**
 * The --mcp-config Claude Code gets with code mode on: one stdio server, ours. `alwaysLoad` keeps its
 * two tools out of Claude Code's ToolSearch deferral (verified on 2.1.322 in the §7.1 bench: without
 * it the model spent a round trip searching for them). R is where the image bakes the SDK.
 */
export function codeModeWrapperConfig(): { mcpServers: Record<string, unknown> } {
  return { mcpServers: { "code-mode": codeModeWrapperEntry() } };
}

/**
 * The --mcp-config for an install where some servers go behind the script and the rest stay direct
 * (§13.2): the wrapper entry first, then every direct server exactly as the direct config had it.
 * The wrapped servers are not in it — they live in the upstream file, which only server.js reads.
 */
export function codeModeMixedConfig(conf: { mcpServers: Record<string, unknown> }, wrapped: readonly string[]): { mcpServers: Record<string, unknown> } {
  const wrap = new Set(wrapped);
  const mcpServers: Record<string, unknown> = { "code-mode": codeModeWrapperEntry() };
  for (const [name, spec] of Object.entries(conf.mcpServers)) if (!wrap.has(name) && name !== "code-mode") mcpServers[name] = spec;
  return { mcpServers };
}

/** The upstream file for server.js: only the wrapped servers, plus the deny list when there is one. */
export function codeModeUpstreamConfig(
  conf: { mcpServers: Record<string, unknown>; codeMode?: unknown },
  wrapped: readonly string[]
): { mcpServers: Record<string, unknown>; codeMode?: unknown } {
  const mcpServers: Record<string, unknown> = {};
  for (const name of wrapped) if (conf.mcpServers[name] !== undefined) mcpServers[name] = conf.mcpServers[name];
  return conf.codeMode ? { mcpServers, codeMode: conf.codeMode } : { mcpServers };
}

/**
 * Every file to write into CODE_MODE_DIR, in order. The package.json makes node load the `.js`
 * files as ES modules, which is what tsc emits. Reads dist/code-mode/box/*.js next to this module,
 * so it works from the built controller (dist), not from the TypeScript sources under tsx (it
 * throws there, and the install falls back to the direct config with a note saying so).
 */
export function codeModeFiles(opts: { prompt?: string; knowledge?: McpKnowledge } = {}): Array<{ name: string; contents: string }> {
  const files = [
    { name: "package.json", contents: JSON.stringify({ type: "module" }) + "\n" },
    ...CODE_MODE_MODULES.map((name) => ({ name, contents: readFileSync(new URL(`./box/${name}`, import.meta.url), "utf8") })),
    { name: CODE_MODE_PROMPT_FILE, contents: (opts.prompt ?? CODE_MODE_PROMPT) + "\n" },
  ];
  // What earlier runs learned (shapes, tool counts): the box starts from it and adds to it.
  if (opts.knowledge) files.push({ name: CODE_MODE_KNOWLEDGE_FILE, contents: knowledgeFile(opts.knowledge) });
  return files;
}

export const CODE_MODE_KNOWLEDGE_PATH = `${CODE_MODE_DIR}/${CODE_MODE_KNOWLEDGE_FILE}`;
