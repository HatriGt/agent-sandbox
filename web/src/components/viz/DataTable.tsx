import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { cellNumber, csvField } from "@/lib/viz";
import { VizFrame } from "./VizFrame";

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
}: {
  head: React.ReactNode[];
  rows: React.ReactNode[][];
  /** Plain-text mirror of `rows`, used for sorting, CSV copy, and numeric detection. */
  texts: string[][];
  title?: string;
}) {
  const [sort, setSort] = React.useState<{ col: number; dir: 1 | -1 } | null>(null);

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
  const maxima = React.useMemo(
    () =>
      head.map((_, c) =>
        numeric[c] ? Math.max(...texts.map((r) => Math.abs(cellNumber(r[c] ?? "") ?? 0)), 0) : 0
      ),
    [head, texts, numeric]
  );

  const order = React.useMemo(() => {
    const idx = texts.map((_, i) => i);
    if (!sort) return idx;
    const { col, dir } = sort;
    return [...idx].sort((a, b) => {
      const ta = texts[a][col] ?? "";
      const tb = texts[b][col] ?? "";
      if (numeric[col]) return ((cellNumber(ta) ?? 0) - (cellNumber(tb) ?? 0)) * dir;
      return ta.localeCompare(tb) * dir;
    });
  }, [texts, sort, numeric]);

  const headTexts = React.useMemo(() => head.map((h) => (typeof h === "string" ? h : "")), [head]);
  const csv = React.useMemo(
    () => [headTexts, ...texts].map((r) => r.map(csvField).join(",")).join("\n"),
    [headTexts, texts]
  );

  return (
    <VizFrame title={title ?? `${texts.length} ${texts.length === 1 ? "row" : "rows"}`} source={csv} rawLanguage="text">
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
            {order.map((ri) => (
              <tr key={ri} className="border-border/50 hover:bg-muted/50 border-b last:border-0">
                {rows[ri].map((cell, c) => {
                  if (!numeric[c]) {
                    // Support-matrix cells: a lone ✓ / ✗ / yes / no wears the functional hue
                    // (still the glyph/word itself, never color alone).
                    const t = (texts[ri][c] ?? "").trim().toLowerCase();
                    const tone = ["✓", "✔", "yes"].includes(t) ? "text-ok" : ["✗", "✘", "no", "×"].includes(t) ? "text-destructive" : ["—", "-", "n/a"].includes(t) ? "text-faint" : "";
                    return (
                      <td key={c} className={cn("px-3 py-1.5 align-top", tone, tone && "text-center font-medium")}>
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
            ))}
          </tbody>
        </table>
      </div>
    </VizFrame>
  );
}
