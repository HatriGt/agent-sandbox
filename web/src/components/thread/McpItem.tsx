import * as React from "react";
import { AlertTriangle, ChevronRight, Loader2, Plug } from "lucide-react";
import { analyzeResult, mcpSummary, type McpCall, type McpResultView } from "@/lib/mcp";
import type { TraceEvent } from "@/lib/trace";
import { cn } from "@/lib/utils";

/**
 * An MCP call, rendered exactly like a shell command — the terminal panel is the house style for
 * "the agent executed something and here is its output". Same dark ground, same header row, same
 * fold. The only differences from ShellItem: the label is `server · tool` instead of `Bash`, the
 * prompt glyph is the tool name rather than `$`, and the output is pretty-printed when it is JSON
 * (an MCP result as a one-line blob is unreadable; as indented JSON it is just terminal output).
 */

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

/** The result as terminal text: JSON is unwrapped/indented, everything else verbatim. */
function resultText(view: McpResultView, raw: string): string {
  switch (view.kind) {
    case "json":
      return view.pretty;
    case "table":
    case "kv":
      // Re-serialize the parsed value as indented JSON — same data, readable in a <pre>.
      return view.kind === "kv"
        ? JSON.stringify(Object.fromEntries(view.entries), null, 2)
        : JSON.stringify(view.rows.map((r) => Object.fromEntries(view.columns.map((c, i) => [c, r[i]]))), null, 2);
    case "text":
      return view.text;
    case "empty":
      return raw.trim() || "(no data returned)";
  }
}

export function McpItem({ event, call, live }: { event: ToolEvent; call: McpCall; live?: boolean }) {
  const [open, setOpen] = React.useState(!!event.failed);
  React.useEffect(() => {
    if (event.failed) setOpen(true);
  }, [event.failed]);
  const hasOutput = !!event.result;
  const view = React.useMemo(() => analyzeResult(event.result), [event.result]);
  const output = React.useMemo(() => (hasOutput ? resultText(view, event.result!) : ""), [view, event.result, hasOutput]);
  const lines = output ? output.replace(/\n+$/, "").split("\n").length : 0;

  return (
    <div className="enter min-w-0">
      <div className={cn("bg-trace overflow-hidden rounded-md border border-white/8", live && "ring-live/40 ring-1")}>
        <div className="flex items-center gap-2 border-b border-white/8 px-3 py-1.5">
          {live ? (
            <Loader2 className="text-live size-3 shrink-0 animate-spin" aria-hidden />
          ) : event.failed ? (
            <AlertTriangle className="text-destructive size-3 shrink-0" aria-hidden />
          ) : (
            <Plug className="text-trace-fg/60 size-3 shrink-0" aria-hidden />
          )}
          <span className="label text-trace-fg/60">
            {call.server} · {call.tool}
          </span>
          {live && <span className="label text-live">running</span>}
          {!live && event.failed && <span className="label text-destructive">failed</span>}
          {hasOutput && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="text-trace-fg/60 hover:text-trace-fg ml-auto flex cursor-pointer items-center gap-1 rounded px-1"
            >
              <span className="label">{open ? "hide output" : lines > 1 ? `${lines} lines` : "output"}</span>
              <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} aria-hidden />
            </button>
          )}
        </div>
        {event.arg && (
          <pre className="text-trace-fg px-3 py-2 font-mono text-code whitespace-pre-wrap [overflow-wrap:anywhere]">
            <span className="text-ok mr-2 shrink-0 select-none" aria-hidden>
              ›
            </span>
            {event.arg}
            {live && !hasOutput && <span className="caret text-live" aria-hidden>▍</span>}
          </pre>
        )}
        {hasOutput && open && (
          <pre className={cn("text-trace-fg/80 max-h-80 overflow-auto px-3 py-2 font-mono text-code whitespace-pre-wrap", event.arg && "border-t border-white/8")}>
            {output}
          </pre>
        )}
        {hasOutput && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn(
              "text-trace-fg/60 hover:text-trace-fg flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-mono text-micro",
              event.arg && "border-t border-white/8"
            )}
          >
            <span className="text-trace-fg/40 select-none">›</span>
            <span className="truncate">{mcpSummary(view)}</span>
          </button>
        )}
      </div>
    </div>
  );
}
