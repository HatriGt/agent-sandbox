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
  "re-reads an earlier result without calling the tool again.";

/**
 * The --mcp-config Claude Code gets with code mode on: one stdio server, ours. `alwaysLoad` keeps its
 * two tools out of Claude Code's ToolSearch deferral (verified on 2.1.322 in the §7.1 bench: without
 * it the model spent a round trip searching for them). R is where the image bakes the SDK.
 */
export function codeModeWrapperConfig(): { mcpServers: Record<string, unknown> } {
  return {
    mcpServers: {
      "code-mode": {
        type: "stdio",
        command: "node",
        args: [CODE_MODE_SERVER, CODE_MODE_UPSTREAM_PATH],
        env: { R: "/usr/local/lib/node_modules" },
        alwaysLoad: true,
      },
    },
  };
}

/**
 * Every file to write into CODE_MODE_DIR, in order. The package.json makes node load the `.js`
 * files as ES modules, which is what tsc emits. Reads dist/code-mode/box/*.js next to this module,
 * so it works from the built controller (dist), not from the TypeScript sources under tsx (it
 * throws there, and the install falls back to the direct config with a note saying so).
 */
export function codeModeFiles(): Array<{ name: string; contents: string }> {
  return [
    { name: "package.json", contents: JSON.stringify({ type: "module" }) + "\n" },
    ...CODE_MODE_MODULES.map((name) => ({ name, contents: readFileSync(new URL(`./box/${name}`, import.meta.url), "utf8") })),
    { name: CODE_MODE_PROMPT_FILE, contents: CODE_MODE_PROMPT + "\n" },
  ];
}
