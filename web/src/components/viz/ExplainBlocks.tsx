import * as React from "react";
import { Check, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { highlightTokens, useIsDark, type CodeToken } from "@/components/ui/code-block";
import { CodeRefLink } from "@/components/ui/code-ref";
import type { Annotated, CompareOption, Layer } from "@/lib/viz-extra";
import { VizFrame } from "./VizFrame";
import { useRowEntrance } from "./motion";

// ---------------------------------------------------------------- compare

/**
 * ```compare → the options of a decision side by side: one column each (stacked when narrow), the
 * pick ringed in the live accent with a "Recommended" badge, pros ✓ / cons ✗ / notes muted.
 */
export function CompareBlock({ options, source }: { options: CompareOption[]; source: string }) {
  const entrance = useRowEntrance(options.map((o) => o.name));
  const pick = options.find((o) => o.picked);
  return (
    <VizFrame title={pick ? `${options.length} options · ${pick.name} recommended` : `${options.length} options`} source={source}>
      <div className="grid gap-3 p-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr))]">
        {options.map((o) => (
          <section
            key={o.name}
            aria-label={o.picked ? `${o.name} (recommended)` : o.name}
            className={cn("min-w-0 rounded-lg border px-3 py-2.5", o.picked && "border-live/60 ring-live/25 ring-2", entrance(o.name).className)}
            style={entrance(o.name).style}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-foreground text-meta font-semibold [overflow-wrap:anywhere]">{o.name}</span>
              {o.picked && <span className="bg-live/12 text-live rounded-full px-1.5 py-px text-micro font-semibold">Recommended</span>}
            </div>
            {o.items.length > 0 && (
              <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
                {o.items.map((it, k) => (
                  <li key={k} className={cn("flex items-start gap-1.5 text-meta leading-snug", it.tone === "note" ? "text-muted-foreground" : "text-foreground")}>
                    {it.tone === "pro" ? (
                      <Check className="viz-mark text-ok mt-0.5 size-3.5 shrink-0" aria-label="pro" />
                    ) : it.tone === "con" ? (
                      <X className="viz-mark text-destructive mt-0.5 size-3.5 shrink-0" aria-label="con" />
                    ) : (
                      <Minus className="text-faint mt-0.5 size-3.5 shrink-0" aria-hidden />
                    )}
                    <span className="min-w-0 [overflow-wrap:anywhere]">{it.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </VizFrame>
  );
}

// ---------------------------------------------------------------- annotate

const EXT_LANG: Record<string, string> = { ts: "ts", mts: "ts", cts: "ts", tsx: "tsx", js: "js", mjs: "js", cjs: "js", jsx: "jsx", json: "json", sh: "bash", bash: "bash", zsh: "bash", diff: "diff", patch: "diff" };

/** Shiki tokens per line for `code`, re-run on theme flips; null until ready or when unbundled. */
function useTokens(code: string, language: string): CodeToken[][] | null {
  const dark = useIsDark();
  const [tokens, setTokens] = React.useState<CodeToken[][] | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    highlightTokens(code, language, dark).then(
      (t) => !cancelled && setTokens(t),
      () => !cancelled && setTokens(null)
    );
    return () => {
      cancelled = true;
    };
  }, [code, language, dark]);
  return tokens;
}

/**
 * ```annotate → a code walkthrough: numbered lines, a numbered marker in the gutter for every
 * annotated range, the notes beside the code (wide) or under it (narrow). Hovering or focusing a
 * note lights its lines; hovering an annotated line lights its note.
 */
export function AnnotateBlock({ data, source }: { data: Annotated; source: string }) {
  const lines = React.useMemo(() => data.code.split("\n"), [data.code]);
  const ext = data.file?.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() ?? "";
  const tokens = useTokens(data.code, EXT_LANG[ext] ?? "text");
  const [active, setActive] = React.useState<number | null>(null);
  const entrance = useRowEntrance(data.notes.map((n, i) => `${i}|${n.from}`));
  // First note covering each line → its marker / highlight owner.
  const owner = React.useMemo(() => {
    const m = new Map<number, number>();
    data.notes.forEach((n, i) => {
      for (let l = n.from; l <= n.to; l++) if (!m.has(l)) m.set(l, i);
    });
    return m;
  }, [data.notes]);
  const lit = active == null ? null : data.notes[active];
  const width = String(data.startLine + lines.length - 1).length;
  const title = `${data.notes.length} note${data.notes.length === 1 ? "" : "s"}`;
  return (
    <VizFrame title={title} source={source}>
      {/* On the box page the file header opens the file at the snippet's first line. */}
      {data.file && (
        <div className="text-muted-foreground border-b px-3 py-1.5 font-mono text-micro [overflow-wrap:anywhere]">
          {(() => {
            const label = (
              <>
                {data.file}
                {data.startLine > 1 && <span className="text-faint">:{data.startLine}</span>}
              </>
            );
            return (
              <CodeRefLink parsed={{ path: data.file, line: data.startLine }} fallback={label}>
                {label}
              </CodeRefLink>
            );
          })()}
        </div>
      )}
      <div className="@container">
        <div className="flex flex-col @[40rem]:flex-row">
          <div className="bg-muted/40 min-w-0 flex-1 overflow-x-auto py-2 font-mono text-code" role="presentation">
            {lines.map((text, i) => {
              const n = data.startLine + i;
              const note = owner.get(n);
              const isLit = lit != null && n >= lit.from && n <= lit.to;
              const isStart = note != null && data.notes[note].from === n;
              return (
                <div
                  key={i}
                  className={cn("flex min-w-max transition-colors duration-150 motion-reduce:transition-none", isLit && "bg-live/10")}
                  onMouseEnter={note != null ? () => setActive(note) : undefined}
                  onMouseLeave={note != null ? () => setActive(null) : undefined}
                >
                  <span className="text-faint w-5 shrink-0 select-none pl-1.5 text-center">
                    {isStart && (
                      <span aria-hidden className={cn("inline-grid size-4 place-items-center rounded-full text-[10px] font-semibold leading-none", isLit ? "bg-live text-background" : "bg-live/15 text-live")}>
                        {note + 1}
                      </span>
                    )}
                  </span>
                  <span className={cn("shrink-0 select-none pr-3 pl-1 text-right tabular-nums", isLit ? "text-foreground" : "text-faint", note != null && !isLit && "text-muted-foreground")} style={{ width: `${width + 2}ch` }}>
                    {n}
                  </span>
                  <span className="whitespace-pre pr-4">
                    {tokens?.[i]
                      ? tokens[i].map((t, k) => (
                          <span key={k} style={t.color ? { color: t.color } : undefined}>
                            {t.content}
                          </span>
                        ))
                      : text || " "}
                  </span>
                </div>
              );
            })}
          </div>
          <ol className="m-0 flex list-none flex-col gap-0.5 border-t p-2 @[40rem]:w-72 @[40rem]:shrink-0 @[40rem]:border-t-0 @[40rem]:border-l" aria-label="notes">
            {data.notes.map((n, i) => {
              const key = `${i}|${n.from}`;
              return (
                <li key={key} className={entrance(key).className} style={entrance(key).style}>
                  <button
                    type="button"
                    className={cn("flex w-full cursor-default items-start gap-2 rounded-md px-2 py-1.5 text-left text-meta outline-none transition-colors duration-150 motion-reduce:transition-none focus-visible:ring-live/40 focus-visible:ring-2", active === i ? "bg-live/10" : "hover:bg-muted/60")}
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  >
                    <span aria-hidden className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-semibold leading-none", active === i ? "bg-live text-background" : "bg-live/15 text-live")}>
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="text-muted-foreground mr-1.5 font-mono text-micro tabular-nums">{n.from === n.to ? `L${n.from}` : `L${n.from}–${n.to}`}</span>
                      <span className="text-foreground [overflow-wrap:anywhere]">{n.text}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </VizFrame>
  );
}

// ---------------------------------------------------------------- layers

/** ```layers → an architecture stack: full-width bands top → bottom, item chips, quiet connectors. */
export function LayersBlock({ layers, source }: { layers: Layer[]; source: string }) {
  const entrance = useRowEntrance(layers.map((l) => l.name));
  return (
    <VizFrame title={`${layers.length} layers`} source={source}>
      <ol className="m-0 list-none p-3" aria-label="layers, top to bottom">
        {layers.map((l, i) => (
          <li key={l.name} className={entrance(l.name).className} style={entrance(l.name).style}>
            {i > 0 && (
              <div aria-hidden className="flex h-3 justify-center">
                <span className="bg-line-strong w-px" />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2" style={{ background: `color-mix(in oklab, var(--viz-${(i % 8) + 1}) 7%, transparent)` }}>
              <span className="text-foreground flex w-28 shrink-0 items-center gap-2 text-meta font-semibold [overflow-wrap:anywhere]">
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: `var(--viz-${(i % 8) + 1})` }} />
                {l.name}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {l.items.map((it, k) => (
                  <span key={k} className="bg-card text-foreground rounded-md border px-1.5 py-0.5 font-mono text-micro [overflow-wrap:anywhere]">
                    {it}
                  </span>
                ))}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </VizFrame>
  );
}
