/**
 * Code mode, the decision (docs/plan-code-mode.md §13): which of an owner's MCP servers go behind
 * the in-box script server and which stay direct, for one install. Pure, so the rule is testable
 * and the MCP page can show the same words the install acted on.
 *
 * The bench (§7) says the script pays where a task makes many calls — paging, fan-out, bulk writes
 * — and costs a little where one or two calls do the job. A server with many tools is the former
 * kind of server; a browser or debugger wants one step at a time. Owners override per server.
 */

export type ServerCodeMode = "wrap" | "direct";

export interface DecideServer {
  /** The owner's per-server override from the MCP page, when set. */
  codeMode?: ServerCodeMode;
  type?: string;
  command?: string;
  args?: readonly string[];
  url?: string;
}

export interface DecideInput {
  setting: "auto" | "on" | "off";
  servers: Record<string, DecideServer>;
  /** Tool counts learned from earlier runs (src/code-mode/knowledge.ts); a server missing here is unknown. */
  toolCounts: Record<string, number>;
}

export interface Decision {
  wrapped: string[];
  direct: string[];
  /** One short reason per server, for the MCP page and the install note. */
  why: Record<string, string>;
}

/** A server with this many tools or more goes behind the script in auto mode. */
export const WRAP_MIN_TOOLS = 10;

/** Servers that work one step at a time (a browser, a debugger): direct in auto mode. */
const INTERACTIVE_RE = /(chrome|devtools|playwright|puppeteer|browser|computer-use|selenium)/i;

export function decideCodeMode(input: DecideInput): Decision {
  const wrapped: string[] = [];
  const direct: string[] = [];
  const why: Record<string, string> = {};
  for (const name of Object.keys(input.servers).sort()) {
    const s = input.servers[name];
    const [mode, reason] = decideOne(name, s, input.setting, input.toolCounts[name]);
    (mode === "wrap" ? wrapped : direct).push(name);
    why[name] = reason;
  }
  return { wrapped, direct, why };
}

function decideOne(name: string, s: DecideServer, setting: DecideInput["setting"], count: number | undefined): [ServerCodeMode, string] {
  if (setting === "off") return ["direct", "code mode is off"];
  if (s.codeMode === "direct") return ["direct", "set to direct"];
  if (s.codeMode === "wrap") return ["wrap", "set to code mode"];
  if (setting === "on") return ["wrap", "code mode is always on"];
  const text = `${name} ${s.command ?? ""} ${(s.args ?? []).join(" ")} ${s.url ?? ""}`;
  if (INTERACTIVE_RE.test(text)) return ["direct", "works one step at a time"];
  if (count === undefined) return ["wrap", "tool count not known yet; learned from this run"];
  if (count >= WRAP_MIN_TOOLS) return ["wrap", `${count} tools`];
  return ["direct", `${count} tool${count === 1 ? "" : "s"}`];
}
