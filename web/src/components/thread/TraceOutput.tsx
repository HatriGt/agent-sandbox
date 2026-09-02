import * as React from "react";
import { termLineKind, tokenizeJson, type JsonToken } from "@/lib/highlight";
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
    <pre className={cn("text-trace-fg/85 max-h-80 overflow-auto px-3 py-2 font-mono text-code whitespace-pre-wrap [overflow-wrap:anywhere]", className)}>
      {mode === "json" ? <JsonColored text={text} /> : <TermColored text={text} />}
    </pre>
  );
}
