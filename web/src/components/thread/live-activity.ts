import type { TraceEvent } from "@/lib/trace";
import { parseMcpName } from "@/lib/mcp";

const SHELL = /^(bash|shell|sh|zsh|powershell|pwsh|cmd|terminal|exec)$/i;
const READ = /^(read|glob|grep|search|ls|cat|find)$/i;
const WRITE = /^(write|edit|multiedit|notebookedit|patch|apply_patch)$/i;

/**
 * The one thing the agent is doing right now, from the tail of the trace: "Editing rateLimit.ts",
 * "Running npm test", "Thinking", "Writing". Null once the last step has its result.
 */
export function liveActivity(events: TraceEvent[]): string | null {
  const last = events[events.length - 1];
  if (!last) return null;
  if (last.kind === "think") return last.streaming ? "Thinking" : null;
  if (last.kind === "say") return "Writing";
  if (last.kind !== "tool" || (last.result !== undefined && !last.streaming)) return null;
  const mcp = parseMcpName(last.name);
  if (mcp) return `Calling ${mcp.server}`;
  const first = (last.arg ?? "").split("\n")[0].trim();
  const file = first.split(/\s/)[0].split("/").pop();
  if (last.name === "Skill") return `Running ${first.match(/^[a-z0-9][a-z0-9-]{0,49}/)?.[0] ?? "a skill"}`;
  if (SHELL.test(last.name)) return first ? `Running ${first}` : "Running a command";
  if (WRITE.test(last.name)) return file ? `Editing ${file}` : "Editing";
  if (/^(webfetch|websearch|fetch)$/i.test(last.name)) return "Searching the web";
  if (READ.test(last.name)) return file && /^[\w./-]+$/.test(first) ? `Reading ${file}` : "Reading";
  if (/^(task|agent|delegate)$/i.test(last.name)) return "Delegating";
  if (/^(ask|askuserquestion)$/i.test(last.name)) return "Asking you";
  return last.name;
}
