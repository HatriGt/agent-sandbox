import type { TraceEvent } from "@/lib/trace";

export interface TranscriptHead {
  title: string;
  machine: string;
  url?: string;
}

export type TranscriptFormat = "md" | "json";

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
export function toMarkdown(events: TraceEvent[], head: TranscriptHead): string {
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
        // A message that opens with a quoted passage (`> ` lines) nests it under the label on its own line.
        out.push((e.text.trimStart().startsWith(">") ? "> **You:**\n> \n> " : "> **You:** ") + e.text.trim().replace(/\n/g, "\n> "), "");
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

/**
 * The conversation as JSON for another agent to read: the head, then every trace event as it was
 * parsed (your turns, the agent's prose, thinking, tool calls with their results, plans, lifecycle).
 * Nothing is folded or shortened, so a tool's full output travels with the record.
 */
export function toJson(events: TraceEvent[], head: TranscriptHead): string {
  return JSON.stringify({ ...head, exportedAt: new Date().toISOString(), format: "agent-sandbox/transcript@1", events }, null, 2) + "\n";
}

/** A file name for the export: the title as a slug, the day, the extension. */
export function transcriptFilename(title: string, format: TranscriptFormat, now = new Date()): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "transcript"}-${now.toISOString().slice(0, 10)}.${format}`;
}

/** Save text as a download (Blob, no network). */
export function downloadText(filename: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
