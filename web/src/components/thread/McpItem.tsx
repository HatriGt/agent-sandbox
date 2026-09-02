import * as React from "react";
import { AlertTriangle, Check, Zap } from "lucide-react";
import { analyzeResult, mcpSummary, serverHue, type McpCall, type McpResultView } from "@/lib/mcp";
import type { TraceEvent } from "@/lib/trace";
import { PanelFold, TraceOutput } from "./TraceOutput";
import { cn } from "@/lib/utils";

/**
 * An MCP call: the shell panel's dark terminal body — because an external call IS a terminal kind
 * of operation — under a header that carries the server's identity: a hue-stable chip (hashed from
 * the server name, tuned for the dark ground) flowing along a dashed connector into the humanized
 * tool name. While in flight the connector's energy moves and the chip pings; the JSON result is
 * token-colored like an editor. Collapsed, the summary is shape-derived ("42 rows"), never the
 * blob's first line.
 */

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

/** Server identity chip on the dark ground: brighter tint, low-alpha fill, same hue every run. */
export function ServerChip({ server, live }: { server: string; live?: boolean }) {
  const hue = serverHue(server);
  const style = {
    "--srv": `oklch(0.78 0.13 ${hue})`,
    "--srv-soft": `oklch(0.78 0.13 ${hue} / 0.12)`,
    "--srv-line": `oklch(0.78 0.13 ${hue} / 0.4)`,
  } as React.CSSProperties;
  return (
    <span
      style={style}
      className="relative inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--srv-line)] bg-[var(--srv-soft)] px-1.5 py-0.5 font-mono text-micro font-semibold text-[var(--srv)]"
    >
      <span className="relative grid size-3 place-items-center" aria-hidden>
        {live && <span className="absolute inset-0 rounded-full bg-[var(--srv)] opacity-40 mcp-ping motion-reduce:hidden" />}
        <Zap className="size-3" strokeWidth={2.5} />
      </span>
      {server}
    </span>
  );
}

/** Dashed connector chip → tool. Energy flows while the call is out. */
function Connector({ live, failed }: { live?: boolean; failed?: boolean }) {
  return (
    <svg className="h-2 w-5 shrink-0" viewBox="0 0 20 8" aria-hidden>
      <path
        d="M1 4 H19"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="3 4"
        className={cn(live ? "text-live flow-dash motion-reduce:animate-none" : failed ? "text-destructive/70" : "text-trace-fg/30")}
      />
    </svg>
  );
}

export function McpItem({ event, call, live }: { event: ToolEvent; call: McpCall; live?: boolean }) {
  const [open, setOpen] = React.useState(!!event.failed);
  React.useEffect(() => {
    if (event.failed) setOpen(true);
  }, [event.failed]);
  const hasOutput = !!event.result;
  const view = React.useMemo(() => analyzeResult(event.result), [event.result]);
  const { output, isJson } = React.useMemo(() => renderable(view, event.result ?? ""), [view, event.result]);

  return (
    <div className="enter min-w-0">
      <div className={cn("bg-trace overflow-hidden rounded-md border border-white/8", live && "ring-live/40 ring-1")}>
        <div className="flex min-w-0 items-center gap-2 border-b border-white/8 px-3 py-1.5">
          <ServerChip server={call.server} live={live} />
          <Connector live={live} failed={event.failed} />
          <span className="text-trace-fg/80 min-w-0 truncate text-micro font-medium">{call.label}</span>
          {live && <span className="label text-live shrink-0">running</span>}
          {!live && event.failed && (
            <span className="text-destructive flex shrink-0 items-center gap-1 text-micro font-medium">
              <AlertTriangle className="size-3" aria-hidden /> failed
            </span>
          )}
          {!live && !event.failed && hasOutput && (
            <span className="text-trace-fg/50 flex shrink-0 items-center gap-1 text-micro tabular-nums">
              <Check className="text-emerald-400/80 size-3" strokeWidth={2.5} aria-hidden />
              {mcpSummary(view)}
            </span>
          )}
          {hasOutput && <PanelFold open={open} text={output} onToggle={() => setOpen((v) => !v)} />}
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
          <TraceOutput text={output} mode={isJson ? "json" : "term"} className={cn(event.arg && "border-t border-white/8")} />
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

/**
 * First contact with an MCP server in a run: a link being established, drawn as one — the sandbox
 * node, energy across a dashed path, the server's identity chip, a check that draws in. It reads
 * as a moment ("the wire is up"), and a server that SHOULD appear but never does is visible by
 * absence. Rendered once per server, where its first call happened.
 */
export function McpConnectItem({ server }: { server: string }) {
  const hue = serverHue(server);
  return (
    <div className="enter flex items-center gap-3 py-0.5" role="status">
      <span className="label text-muted-foreground shrink-0">MCP</span>
      <span className="border-line-strong bg-card text-muted-foreground inline-flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-micro font-medium">
        <span className="bg-live size-1.5 rounded-full" aria-hidden />
        sandbox
      </span>
      <svg className="h-2 w-8 shrink-0" viewBox="0 0 32 8" aria-hidden>
        <path
          d="M1 4 H31"
          fill="none"
          stroke={`oklch(0.65 0.13 ${hue})`}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="3 4"
          className="flow-dash-once motion-reduce:animate-none"
        />
      </svg>
      <span
        style={{
          "--srv-l": `oklch(0.5 0.13 ${hue})`,
          "--srv-d": `oklch(0.78 0.13 ${hue})`,
          "--srv-soft": `oklch(0.65 0.13 ${hue} / 0.1)`,
          "--srv-line": `oklch(0.65 0.13 ${hue} / 0.4)`,
        } as React.CSSProperties}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--srv-line)] bg-[var(--srv-soft)] px-1.5 py-0.5 font-mono text-micro font-semibold text-[var(--srv-l)] dark:text-[var(--srv-d)]"
      >
        <Zap className="size-3" strokeWidth={2.5} aria-hidden />
        {server}
      </span>
      <svg className="text-ok size-3.5 shrink-0" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M2.5 7.5 L5.5 10.5 L11.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="14" className="wire-check motion-reduce:[stroke-dashoffset:0]" />
      </svg>
      <span className="text-faint text-micro">connected</span>
      <span className="bg-border h-px flex-1" aria-hidden />
    </div>
  );
}

/** The result as terminal text plus whether it should get JSON token coloring. */
function renderable(view: McpResultView, raw: string): { output: string; isJson: boolean } {
  switch (view.kind) {
    case "json":
      return { output: view.pretty, isJson: true };
    case "table":
      return {
        output: JSON.stringify(view.rows.map((r) => Object.fromEntries(view.columns.map((c, i) => [c, r[i]]))), null, 2),
        isJson: true,
      };
    case "kv":
      return { output: JSON.stringify(Object.fromEntries(view.entries), null, 2), isJson: true };
    case "text":
      return { output: view.text, isJson: false };
    case "empty":
      return { output: raw.trim() || "(no data returned)", isJson: false };
  }
}
