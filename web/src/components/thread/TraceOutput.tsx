import * as React from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import { outputStats, termLineKind, tokenizeJson, type JsonToken } from "@/lib/highlight";
import { cn } from "@/lib/utils";

/**
 * Colored output on the dark trace ground. Two modes, chosen by the caller:
 *  - "json": token-level coloring (keys / strings / numbers / literals), read like an editor.
 *  - "term": line-level coloring — errors red, warnings amber, passes green, diff +/-, stack paths
 *    dimmed-blue — so scanning a long shell output finds the line that matters without reading it.
 * Pure presentational; the tokenizers live in lib/highlight.ts and are unit-tested.
 */

const JSON_CLASS: Record<JsonToken["kind"], string | undefined> = {
  key: "text-sky-300",
  string: "text-emerald-300/90",
  number: "text-amber-300/90",
  bool: "text-violet-300",
  null: "text-violet-300/70",
  punct: "text-trace-fg/50",
  ws: undefined,
};

function JsonColored({ text }: { text: string }) {
  const toks = React.useMemo(() => tokenizeJson(text), [text]);
  return (
    <>
      {toks.map((t, i) =>
        JSON_CLASS[t.kind] ? (
          <span key={i} className={JSON_CLASS[t.kind]}>
            {t.text}
          </span>
        ) : (
          t.text
        )
      )}
    </>
  );
}

const TERM_CLASS: Record<ReturnType<typeof termLineKind>, string | undefined> = {
  error: "text-red-400",
  warn: "text-amber-300/90",
  ok: "text-emerald-300/90",
  add: "text-emerald-300/80",
  del: "text-red-400/80",
  path: "text-sky-300/80",
  plain: undefined,
};

function TermColored({ text }: { text: string }) {
  const lines = React.useMemo(() => text.split("\n"), [text]);
  return (
    <>
      {lines.map((l, i) => {
        const cls = TERM_CLASS[termLineKind(l)];
        return (
          <React.Fragment key={i}>
            {cls ? <span className={cls}>{l}</span> : l}
            {i < lines.length - 1 && "\n"}
          </React.Fragment>
        );
      })}
    </>
  );
}

export function TraceOutput({ text, mode, className }: { text: string; mode: "json" | "term"; className?: string }) {
  return (
    <div className={cn("group/out relative", className)}>
      <pre className="text-trace-fg/85 max-h-80 overflow-auto px-3 py-2 font-mono text-code whitespace-pre-wrap [overflow-wrap:anywhere]">
        {mode === "json" ? <JsonColored text={text} /> : <TermColored text={text} />}
      </pre>
      <CopyOutput text={text} />
    </div>
  );
}

/** Hover-revealed copy control in the panel's corner — output you can lift without opening a file. */
function CopyOutput({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked: nothing to signal */
        }
      }}
      aria-label={copied ? "Copied" : "Copy output"}
      className={cn(
        "absolute top-1.5 right-1.5 grid size-6 cursor-pointer place-items-center rounded-md border border-white/10 bg-white/5 backdrop-blur-sm transition-opacity",
        copied ? "opacity-100" : "opacity-0 group-hover/out:opacity-100 focus-visible:opacity-100"
      )}
    >
      {copied ? <Check className="text-emerald-400 size-3" strokeWidth={2.5} /> : <Copy className="text-trace-fg/70 size-3" />}
    </button>
  );
}

/**
 * The fold toggle for a dark panel, and it says what it hides: "212 lines · 3 errors" with the
 * error count in red — so a collapsed panel with problems inside cannot look identical to a clean
 * one. Shared by the shell and MCP panels.
 */
export function PanelFold({ open, text, onToggle }: { open: boolean; text: string; onToggle: () => void }) {
  const { lines, errors, warns } = React.useMemo(() => {
    const s = outputStats(text);
    return { lines: text.replace(/\n+$/, "").split("\n").length, ...s };
  }, [text]);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="text-trace-fg/60 hover:text-trace-fg ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded px-1"
    >
      {!open && errors > 0 && <span className="label text-red-400">{errors} {errors === 1 ? "error" : "errors"}</span>}
      {!open && errors === 0 && warns > 0 && <span className="label text-amber-300/90">{warns} {warns === 1 ? "warning" : "warnings"}</span>}
      <span className="label">{open ? "hide output" : lines > 1 ? `${lines} lines` : "output"}</span>
      <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} aria-hidden />
    </button>
  );
}
