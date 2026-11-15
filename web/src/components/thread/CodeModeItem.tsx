import * as React from "react";
import { AlertTriangle, Check, ChevronRight, Code2 } from "lucide-react";
import { analyzeResult, mcpSummary, parseCodeModeResult, scriptHeadline, scriptServers, type CodeModeCall } from "@/lib/mcp";
import type { TraceEvent } from "@/lib/trace";
import { highlightTokens, type CodeToken } from "@/components/ui/code-block";
import { cn } from "@/lib/utils";
import { Connector, ServerChip, renderable } from "./McpItem";
import { PanelFold, TraceOutput } from "./TraceOutput";

/**
 * A code-mode `run` call (docs/plan-code-mode.md): Claude wrote one script that called the
 * operator's MCP servers itself. Same dark terminal body as McpItem; the header says "code mode" and
 * the script's first line instead of a server and a tool. Body, top to bottom: the script (folded
 * past SCRIPT_FOLD lines, token-colored as JS), the calls it made (server chip, tool, size, shape),
 * the value it returned through the MCP result views, then its console. Collapsed: "N calls · 3 rows",
 * never the blob.
 */

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

const SCRIPT_FOLD = 12;

/** "41k" chars → "41k chars"; failed/unfinished say so instead. */
function callSize(c: CodeModeCall): string {
  if (c.failed !== undefined) return "failed";
  if (c.unfinished) return "did not finish";
  const n = c.chars;
  return n < 1000 ? `${n} chars` : n < 1_000_000 ? `${Math.round(n / 1000)}k chars` : `${(n / 1_000_000).toFixed(1)}M chars`;
}

function CodeModeChip({ live }: { live?: boolean }) {
  return (
    <span className="relative inline-flex shrink-0 items-center gap-1.5 rounded-md border border-violet-300/40 bg-violet-300/12 px-1.5 py-0.5 font-mono text-micro font-semibold text-violet-200">
      <span className="relative grid size-3 place-items-center" aria-hidden>
        {live && <span className="absolute inset-0 rounded-full bg-violet-300 opacity-40 mcp-ping motion-reduce:hidden" />}
        <Code2 className="size-3" strokeWidth={2.5} />
      </span>
      code mode
    </span>
  );
}

/** The script, JS token-colored once the shared shiki core has the grammar; plain mono until then. */
function Script({ code }: { code: string }) {
  const lines = React.useMemo(() => code.split("\n"), [code]);
  const long = lines.length > SCRIPT_FOLD + 2;
  const [open, setOpen] = React.useState(false);
  const [tokens, setTokens] = React.useState<CodeToken[][] | null>(null);
  React.useEffect(() => {
    let alive = true;
    highlightTokens(code, "javascript", true).then(
      (t) => alive && setTokens(t),
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [code]);
  const shown = long && !open ? SCRIPT_FOLD : lines.length;
  return (
    <div className="group/out relative">
      <pre className="text-trace-fg/85 max-h-96 overflow-auto px-3 py-2 font-mono text-code whitespace-pre-wrap [overflow-wrap:anywhere]">
        {lines.slice(0, shown).map((l, i) => (
          <React.Fragment key={i}>
            {tokens?.[i] ? tokens[i].map((t, j) => (t.color ? <span key={j} style={{ color: t.color }}>{t.content}</span> : t.content)) : l}
            {i < shown - 1 && "\n"}
          </React.Fragment>
        ))}
      </pre>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="text-trace-fg/60 hover:text-trace-fg flex w-full cursor-pointer items-center gap-2 border-t border-white/8 px-3 py-1 text-left font-mono text-micro"
        >
          <ChevronRight className={cn("size-3 transition-transform duration-150", open && "rotate-90")} aria-hidden />
          {open ? "show less" : `${lines.length - SCRIPT_FOLD} more lines`}
        </button>
      )}
    </div>
  );
}

function CallList({ calls }: { calls: CodeModeCall[] }) {
  return (
    <ol className="divide-y divide-white/5 px-3 py-1" aria-label="MCP calls the script made">
      {calls.map((c) => {
        const bad = c.failed !== undefined || c.unfinished;
        return (
          <li key={c.n} className="flex min-w-0 items-center gap-2 py-1 font-mono text-micro">
            <span className="text-trace-fg/35 w-6 shrink-0 text-right tabular-nums">#{c.n}</span>
            <ServerChip server={c.server || "?"} />
            <span className="text-trace-fg/80 shrink-0 font-medium">{c.tool}</span>
            <span className={cn("shrink-0 tabular-nums", bad ? "text-destructive" : "text-trace-fg/50")}>
              {bad && <AlertTriangle className="mr-1 inline size-3 align-[-2px]" aria-hidden />}
              {callSize(c)}
              {c.cut && " · cut copy"}
            </span>
            <span className="text-trace-fg/45 min-w-0 truncate" title={c.failed ?? c.shape}>
              {c.failed ?? c.shape}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="label text-trace-fg/40 border-t border-white/8 px-3 pt-1.5">{children}</div>;
}

export function CodeModeItem({ event, live }: { event: ToolEvent; live?: boolean }) {
  const [open, setOpen] = React.useState(!!event.failed);
  React.useEffect(() => {
    if (event.failed) setOpen(true);
  }, [event.failed]);
  const hasOutput = !!event.result;
  const parsed = React.useMemo(() => parseCodeModeResult(event.result), [event.result]);
  const view = React.useMemo(
    () => (parsed.error ? ({ kind: "text", text: parsed.value } as const) : analyzeResult(parsed.value)),
    [parsed]
  );
  const { output, isJson } = React.useMemo(() => renderable(view, parsed.value), [view, parsed.value]);
  const failed = !!event.failed || parsed.error;
  const headline = scriptHeadline(event.code ?? event.arg) || "script";
  const n = parsed.calls.length;
  const summary = `${n} ${n === 1 ? "call" : "calls"} · ${parsed.error ? scriptHeadline(parsed.value, 80) : mcpSummary(view)}`;
  const servers = React.useMemo(() => scriptServers(event.code), [event.code]);

  return (
    <div className="enter min-w-0">
      <div className={cn("bg-trace overflow-hidden rounded-md border", live ? "border-live/40" : "border-white/8")}>
        <div className="flex min-w-0 items-center gap-2 border-b border-white/8 px-3 py-1.5">
          <CodeModeChip live={live} />
          <Connector live={live} failed={failed} />
          <span className="text-trace-fg/80 min-w-0 truncate font-mono text-micro font-medium" title={headline}>
            {headline}
          </span>
          {live && (
            <span className="label text-live shrink-0">
              running{servers.length ? ` · ${servers.join(", ")}` : ""}
            </span>
          )}
          {!live && failed && (
            <span className="text-destructive flex shrink-0 items-center gap-1 text-micro font-medium">
              <AlertTriangle className="size-3" aria-hidden /> failed
            </span>
          )}
          {!live && !failed && hasOutput && (
            <span className="text-trace-fg/50 flex shrink-0 items-center gap-1 text-micro tabular-nums">
              <Check className="text-emerald-400/80 size-3" strokeWidth={2.5} aria-hidden />
              <span className="hidden sm:inline">{summary}</span>
            </span>
          )}
          {hasOutput && <PanelFold open={open} text={event.result ?? ""} onToggle={() => setOpen((v) => !v)} />}
        </div>
        {event.code ? (
          <Script code={event.code} />
        ) : (
          event.arg && (
            <pre className="text-trace-fg px-3 py-2 font-mono text-code whitespace-pre-wrap [overflow-wrap:anywhere]">
              <span className="text-ok mr-2 shrink-0 select-none" aria-hidden>
                ›
              </span>
              {event.arg}
              {live && !hasOutput && <span className="caret text-live" aria-hidden>▍</span>}
            </pre>
          )
        )}
        {hasOutput && open && (
          <>
            {n > 0 && (
              <>
                <SectionLabel>{parsed.totals ?? `${n} MCP calls`}</SectionLabel>
                <CallList calls={parsed.calls} />
              </>
            )}
            <SectionLabel>{parsed.error ? "error" : "returned"}</SectionLabel>
            <TraceOutput text={output} mode={isJson ? "json" : "term"} />
            {parsed.hint && (
              // The server's note that some returned fields were undefined (a misspelt field name,
              // usually): shown under the value, as the model sees it, so the reader knows why a
              // column is missing.
              <p className="text-warn/90 px-3 pb-2 font-mono text-micro [overflow-wrap:anywhere]">{parsed.hint}</p>
            )}
            {parsed.console && (
              <>
                <SectionLabel>console</SectionLabel>
                <TraceOutput text={parsed.console} mode="term" />
              </>
            )}
          </>
        )}
        {hasOutput && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-trace-fg/60 hover:text-trace-fg flex w-full cursor-pointer items-center gap-2 border-t border-white/8 px-3 py-1.5 text-left font-mono text-micro"
          >
            <span className="text-trace-fg/40 select-none">›</span>
            <span className="truncate">{summary}</span>
          </button>
        )}
      </div>
    </div>
  );
}
