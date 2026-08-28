import type { TraceEvent } from "@/lib/trace";

const SHELL = new Set(["Bash", "Shell", "Terminal", "Run", "Exec", "sh", "bash"]);
const WRITES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export interface RunStats {
  steps: number;
  files: number;
  commands: number;
  failed: number;
  turns: number;
}

/** What a finished run amounted to, read off the trace: tool calls, distinct files written, commands run. */
export function runStats(events: TraceEvent[]): RunStats {
  const files = new Set<string>();
  let steps = 0;
  let commands = 0;
  let failed = 0;
  let turns = 0;
  for (const e of events) {
    if (e.kind === "you") turns++;
    if (e.kind !== "tool") continue;
    steps++;
    if (e.failed) failed++;
    if (SHELL.has(e.name)) commands++;
    else if (WRITES.has(e.name) && e.arg) files.add(e.arg.split(/\s+/)[0]);
  }
  return { steps, files: files.size, commands, failed, turns };
}

/**
 * The conversation as Markdown for pasting into a PR, a ticket or a doc. Your messages are quoted,
 * the agent's prose is kept as written, tool work is folded into a list so the record stays readable.
 */
export function toMarkdown(events: TraceEvent[], head: { title: string; machine: string; url?: string }): string {
  const out: string[] = [`# ${head.title}`, "", `_${head.machine}${head.url ? ` · ${head.url}` : ""}_`, ""];
  let tools: string[] = [];
  const flush = () => {
    if (!tools.length) return;
    out.push("<details><summary>Worked · " + tools.length + (tools.length === 1 ? " step" : " steps") + "</summary>", "", ...tools, "", "</details>", "");
    tools = [];
  };
  for (const e of events) {
    switch (e.kind) {
      case "you":
        flush();
        out.push("> **You:** " + e.text.trim().replace(/\n/g, "\n> "), "");
        break;
      case "say":
        flush();
        out.push(e.text.trim(), "");
        break;
      case "ask":
        flush();
        out.push("**Agent asked:**", "", e.text.trim(), "");
        break;
      case "tool":
        tools.push(`- \`${e.name}\`${e.arg ? " " + e.arg.split("\n")[0].slice(0, 160) : ""}${e.failed ? " — failed" : ""}`);
        break;
      case "lifecycle":
        flush();
        out.push(`_${e.label}${e.detail ? " · " + e.detail : ""}_`, "");
        break;
      default:
        break;
    }
  }
  flush();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
