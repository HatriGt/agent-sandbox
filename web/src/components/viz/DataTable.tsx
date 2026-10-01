import * as React from "react";
import { ArrowDown, ArrowUp, Pin, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { cellNumber, csvField } from "@/lib/viz";
import { VizFrame } from "./VizFrame";
import { ChartBlock } from "./ChartBlock";
import { AnimatedTabs } from "@/components/ui/animated-tabs";
import type { ChartSpec } from "@/lib/viz";

/**
 * Every markdown table (and ```csv / ```tsv fence) renders through this: sortable headers,
 * numeric columns detected and right-aligned in tabular figures, and a quiet magnitude bar behind
 * the values of numeric columns so the biggest row is visible without reading every number.
 * Cells keep their original rendered nodes (inline code, links survive); sorting uses the text.
 */
export function DataTable({
  head,
  rows,
  texts,
  title,
  actions,
  noChart,
}: {
  head: React.ReactNode[];
  rows: React.ReactNode[][];
  /** Plain-text mirror of `rows`, used for sorting, CSV copy, and numeric detection. */
  texts: string[][];
  title?: string;
  /** Extra header controls (ChartBlock's table view passes its chart switch here). */
  actions?: React.ReactNode;
  /** Never offer the Table/Chart switch (the host is already a chart). */
  noChart?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  // Pinned rows are keyed by their text, so a pin survives rows streaming in or re-sorting.
  const [pins, setPins] = React.useState<string[]>([]);
  const [sort, setSort] = React.useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [view, setView] = React.useState<"table" | "chart">("table");

  // A column is numeric when ≥80% of its non-empty cells parse as numbers.
  const numeric = React.useMemo(
    () =>
      head.map((_, c) => {
        const vals = texts.map((r) => r[c] ?? "").filter((t) => t.trim());
        if (vals.length === 0) return false;
        return vals.filter((t) => cellNumber(t) !== null).length >= vals.length * 0.8;
      }),
    [head, texts]
  );
  // Identifiers are numbers without magnitude: no bar for id / # / port / year columns.
  const idLike = React.useMemo(() => head.map((h) => /^(id|#|no\.?|pk|index|idx|port|pid|year|version|code)$/i.test(typeof h === "string" ? h.trim() : "")), [head]);
  const maxima = React.useMemo(
    () =>
      head.map((_, c) =>
        numeric[c] && !idLike[c] ? Math.max(...texts.map((r) => Math.abs(cellNumber(r[c] ?? "") ?? 0)), 0) : 0
      ),
    [head, texts, numeric, idLike]
  );

  const order = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    let idx = texts.map((_, i) => i);
    if (q) idx = idx.filter((i) => texts[i].some((t) => (t ?? "").toLowerCase().includes(q)));
    const pinRank = (i: number) => {
      const k = pins.indexOf(rowKey(texts[i]));
      return k < 0 ? Infinity : k;
    };
    const { col, dir } = sort ?? { col: -1, dir: 1 };
    return [...idx].sort((a, b) => {
      const pa = pinRank(a);
      const pb = pinRank(b);
      if (pa !== pb) return pa < pb ? -1 : 1;
      if (col < 0) return a - b;
      const ta = texts[a][col] ?? "";
      const tb = texts[b][col] ?? "";
      if (numeric[col]) return ((cellNumber(ta) ?? 0) - (cellNumber(tb) ?? 0)) * dir;
      return ta.localeCompare(tb) * dir;
    });
  }, [texts, sort, numeric, query, pins]);

  const headTexts = React.useMemo(() => head.map((h) => (typeof h === "string" ? h : "")), [head]);
  const csv = React.useMemo(
    () => [headTexts, ...texts].map((r) => r.map(csvField).join(",")).join("\n"),
    [headTexts, texts]
  );

  // A small table with one label column and a few numeric ones is also a bar chart: offer the
  // switch, never force it (the table stays the default — it is what the agent wrote).
  const chart = React.useMemo<ChartSpec | null>(() => {
    const labelCols = numeric.map((n, i) => (!n ? i : -1)).filter((i) => i >= 0);
    const numCols = numeric.map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
    if (noChart || labelCols.length !== 1 || numCols.length < 1 || numCols.length > 3 || texts.length < 2 || texts.length > 12) return null;
    const labels = texts.map((row) => row[labelCols[0]] ?? "");
    const series = numCols.map((c) => ({ name: headTexts[c] || `col ${c + 1}`, data: texts.map((row) => cellNumber(row[c] ?? "") ?? 0) }));
    return { type: "bar", labels, series };
  }, [numeric, texts, headTexts, noChart]);

  if (chart && view === "chart") {
    return (
      <ChartBlock
        spec={chart}
        source={csv}
        noTable
        actions={
          <>
            {actions}
            <ViewSwitch view={view} onChange={setView} />
          </>
        }
      />
    );
  }

  return (
    <VizFrame title={title ?? `${texts.length} ${texts.length === 1 ? "row" : "rows"}`} source={csv}
      rawLanguage="text"
      actions={
        actions || chart ? (
          <>
            {actions}
            {chart && <ViewSwitch view={view} onChange={setView} />}
          </>
        ) : undefined
      }
    >
      {texts.length > 8 && (
        <label className="flex items-center gap-2 border-b px-3 py-1.5">
          <Search className="text-faint size-3.5 shrink-0" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Filter rows"
            aria-label="Filter rows"
            className="text-foreground placeholder:text-faint min-w-0 flex-1 bg-transparent text-meta outline-none"
          />
          {query && (
            <span className="text-faint shrink-0 text-micro tabular-nums" aria-live="polite">
              {order.length} of {texts.length}
            </span>
          )}
        </label>
      )}
      <div className="max-h-96 overflow-auto">
        <table className="w-full border-collapse text-meta">
          <thead>
            <tr className="bg-card sticky top-0 z-10 border-b text-left">
              {head.map((h, c) => {
                const on = sort?.col === c;
                return (
                  <th key={c} className={cn("px-3 py-1.5", numeric[c] && "text-right")}>
                    <button
                      type="button"
                      onClick={() =>
                        setSort((s) =>
                          s?.col === c
                            ? s.dir === -1 && numeric[c]
                              ? { col: c, dir: 1 }
                              : s.dir === 1 && !numeric[c]
                                ? { col: c, dir: -1 }
                                : null
                            : { col: c, dir: numeric[c] ? -1 : 1 }
                        )
                      }
                      aria-sort={on ? (sort!.dir === 1 ? "ascending" : "descending") : undefined}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1 text-micro font-medium",
                        on ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {h}
                      {on && (sort!.dir === 1 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {order.length === 0 && (
              <tr>
                <td colSpan={head.length} className="text-faint px-3 py-3 text-center text-micro">
                  No rows match “{query}”
                </td>
              </tr>
            )}
            {order.map((ri) => {
              const key = rowKey(texts[ri]);
              const pinned = pins.includes(key);
              const togglePin = () => setPins((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
              return (
              <tr
                key={ri}
                tabIndex={0}
                aria-selected={pinned}
                data-pinned={pinned || undefined}
                onClick={(e) => {
                  // Links and buttons inside cells keep their own click; selecting text never pins.
                  if ((e.target as HTMLElement).closest("a, button")) return;
                  if (window.getSelection()?.toString()) return;
                  togglePin();
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    togglePin();
                  }
                }}
                className={cn(
                  "border-border/50 hover:bg-muted/50 focus-visible:bg-muted/60 cursor-pointer border-b outline-none last:border-0",
                  pinned && "bg-muted/40"
                )}
              >
                {rows[ri].map((cell, c) => {
                  if (!numeric[c]) {
                    // Support-matrix cells: a lone ✓ / ✗ / yes / no wears the functional hue
                    // (still the glyph/word itself, never color alone).
                    const t = (texts[ri][c] ?? "").trim().toLowerCase();
                    const tone = ["✓", "✔", "yes"].includes(t) ? "text-ok" : ["✗", "✘", "no", "×"].includes(t) ? "text-destructive" : ["—", "-", "n/a"].includes(t) ? "text-faint" : "";
                    return (
                      <td key={c} className={cn("px-3 py-1.5 align-top", tone, tone && "text-center font-medium")}>
                        {c === 0 && pinned && <Pin className="text-muted-foreground mr-1 inline size-3 -translate-y-px" aria-label="pinned" />}
                        {cell}
                      </td>
                    );
                  }
                  const n = cellNumber(texts[ri][c] ?? "");
                  const frac = n !== null && maxima[c] > 0 ? Math.abs(n) / maxima[c] : 0;
                  return (
                    <td key={c} className="relative px-3 py-1.5 text-right align-top whitespace-nowrap tabular-nums">
                      {/* Magnitude bar: 2px, baseline-anchored, series-1 hue at low alpha — context, not chart. */}
                      {frac > 0 && (
                        <span
                          aria-hidden
                          className="absolute right-3 bottom-1 h-0.5 rounded-full opacity-30"
                          style={{ width: `${Math.max(4, frac * 56)}px`, background: "var(--viz-1)" }}
                        />
                      )}
                      {cell}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </VizFrame>
  );
}

const rowKey = (r: string[]) => r.join("\u0001");

/** Table ⇄ Chart, in the card header. Only offered when the data has one obvious chart in it. */
function ViewSwitch({ view, onChange }: { view: "table" | "chart"; onChange: (v: "table" | "chart") => void }) {
  return (
    <AnimatedTabs
      ariaLabel="View as"
      size="sm"
      className="mr-1"
      value={view}
      onChange={onChange}
      items={[
        { value: "table", label: "Table" },
        { value: "chart", label: "Chart" },
      ]}
    />
  );
}
