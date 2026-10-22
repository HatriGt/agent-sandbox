import * as React from "react";
import { ArrowUp, ChevronsUpDown, Pin, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { cellNumber, csvField } from "@/lib/viz";
import { columnGrip, MIN_COL, shapeKey, useColumnWidths } from "@/lib/column-widths";
import { VizFrame } from "./VizFrame";
import { ChartBlock } from "./ChartBlock";
import { AnimatedTabs } from "@/components/ui/animated-tabs";
import type { ChartSpec } from "@/lib/viz";

/**
 * Every markdown table (and ```csv / ```tsv fence) renders through this: sortable headers,
 * numeric columns detected and right-aligned in tabular figures, and a quiet magnitude bar behind
 * the values of numeric columns so the biggest row is visible without reading every number.
 * Cells keep their original rendered nodes (inline code, links survive); sorting uses the text.
 * Columns are the browser's fit until a header edge is dragged; from then on the table is
 * fixed-layout with the dragged widths, remembered per table shape (`asb.cols.viz:<shape>`), and
 * scrolls sideways under a sticky first column when it outgrows the card.
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

  // Widths are remembered by table shape, so the same table in a later turn keeps them.
  const cols = useColumnWidths(`viz:${shapeKey([title ?? "", ...headTexts])}`, texts.length > 0, `${headTexts.join(",")}|${texts.length}`);
  const shaped = cols.shaped;
  const widthOf = (c: number) => cols.width(String(c)) ?? cols.floor(String(c)) ?? MIN_COL;
  const minWidth = shaped ? head.reduce<number>((s, _, c) => s + widthOf(c), 0) : undefined;
  const edges = useScrollEdges();

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

  const span = head.length + (shaped ? 1 : 0);
  const cellPad = "px-3 py-2";
  const hairline = "border-t-0 border-b border-border/50";
  // Text stays on one line (a wide table scrolls) until a column is shaped; then it wraps to the width the user chose.
  const textWrap = shaped ? "whitespace-normal [overflow-wrap:anywhere]" : "whitespace-nowrap";
  // The sticky first column paints its own background, so hover and pinned tints live in one
  // variable the row and its first cell both read; a mixed opaque colour covers scrolled content.
  const rowTint = "[--row-bg:var(--card)] hover:[--row-bg:color-mix(in_oklab,var(--muted)_50%,var(--card))] focus-visible:[--row-bg:color-mix(in_oklab,var(--muted)_60%,var(--card))] data-pinned:[--row-bg:color-mix(in_oklab,var(--muted)_40%,var(--card))]";
  const stickyCell = "sticky left-0 z-[1] in-data-scrolled-start:shadow-[inset_-1px_0_0_var(--border),8px_0_12px_-8px_color-mix(in_oklab,var(--foreground)_18%,transparent)]";

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
      <div ref={edges} className="relative">
        <div className="max-h-96 overflow-auto overscroll-x-none">
          <table className={cn("w-full border-separate border-spacing-0 text-meta", shaped && "table-fixed")} style={minWidth ? { minWidth } : undefined}>
            <colgroup ref={cols.colgroup}>
              {head.map((_, c) => {
                const w = shaped ? cols.width(String(c)) : undefined;
                return <col key={c} data-col={String(c)} style={w ? { width: w } : undefined} />;
              })}
              {shaped && <col data-flex="" />}
            </colgroup>
            <thead data-slot="table-header">
              {/* The row sticks to the top; each header is a plain positioned cell so a grip's 4px overflow paints above the next header. */}
              <tr className="bg-card sticky top-0 z-10">
                {head.map((h, c) => {
                  const on = sort?.col === c ? sort.dir : null;
                  const label = headTexts[c] || `column ${c + 1}`;
                  return (
                    <th
                      key={c}
                      scope="col"
                      aria-sort={on ? (on === 1 ? "ascending" : "descending") : "none"}
                      className={cn("group/th bg-card relative border-b text-left align-bottom", cellPad, numeric[c] && "text-right", c === 0 && stickyCell, c === 0 && "z-20")}
                    >
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
                        className={cn(
                          "group/sort -mx-1.5 inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-micro font-medium tracking-[0.05em] uppercase whitespace-nowrap transition-colors duration-150",
                          on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                          numeric[c] && "flex-row-reverse"
                        )}
                      >
                        {h}
                        <span className="relative inline-grid size-3 shrink-0 place-items-center" aria-hidden>
                          <ChevronsUpDown className={cn("absolute size-3 transition-[opacity,scale] duration-200 ease-(--ease-out-quint)", on ? "scale-75 opacity-0" : "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60")} />
                          <ArrowUp className={cn("absolute size-3 transition-[opacity,rotate,scale] duration-200 ease-(--ease-out-quint)", on ? "opacity-100" : "scale-75 opacity-0", on === -1 && "rotate-180")} />
                        </span>
                      </button>
                      <span {...columnGrip(String(c), label, cols, "group-last/th:right-0")} />
                    </th>
                  );
                })}
                {shaped && <th aria-hidden className="bg-card border-b p-0" />}
              </tr>
            </thead>
            <tbody className="[&>tr:last-child>td]:border-b-0">
              {order.length === 0 && (
                <tr>
                  <td colSpan={span} className="text-faint px-3 py-3 text-center text-micro">
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
                    className={cn("bg-(--row-bg) cursor-pointer outline-none transition-[background-color] duration-[120ms]", rowTint)}
                  >
                    {rows[ri].map((cell, c) => {
                      const sticky = c === 0 && cn(stickyCell, "bg-(--row-bg)");
                      if (!numeric[c]) {
                        // Support-matrix cells: a lone ✓ / ✗ / yes / no wears the functional hue
                        // (still the glyph/word itself, never color alone).
                        const t = (texts[ri][c] ?? "").trim().toLowerCase();
                        const tone = ["✓", "✔", "yes"].includes(t) ? "text-ok" : ["✗", "✘", "no", "×"].includes(t) ? "text-destructive" : ["—", "-", "n/a"].includes(t) ? "text-faint" : "";
                        return (
                          <td key={c} className={cn(hairline, cellPad, "align-top", textWrap, tone, tone && "text-center font-medium", sticky)}>
                            {c === 0 && pinned && <Pin className="text-muted-foreground mr-1 inline size-3 -translate-y-px" aria-label="pinned" />}
                            {cell}
                          </td>
                        );
                      }
                      const n = cellNumber(texts[ri][c] ?? "");
                      const frac = n !== null && maxima[c] > 0 ? Math.abs(n) / maxima[c] : 0;
                      return (
                        <td key={c} className={cn(hairline, cellPad, "relative overflow-hidden text-right align-top whitespace-nowrap tabular-nums", sticky)}>
                          {/* Magnitude bar: 2px, baseline-anchored, series-1 hue at low alpha — context, not chart. */}
                          {frac > 0 && (
                            <span
                              aria-hidden
                              className="absolute right-3 bottom-1.5 h-0.5 rounded-full opacity-30"
                              style={{ width: `${Math.max(4, frac * 56)}px`, background: "var(--viz-1)" }}
                            />
                          )}
                          {cell}
                        </td>
                      );
                    })}
                    {shaped && <td className={cn(hairline, "p-0")} />}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Soft edge at the right while there is more that way; the left edge is the sticky column's own shadow. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[color-mix(in_oklab,var(--foreground)_7%,transparent)] to-transparent opacity-0 transition-opacity duration-150 in-data-scrolled-end:opacity-100"
        />
      </div>
      {texts.length > 8 && (
        <div className="flex items-center gap-2 border-t px-3 py-1.5">
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
          <span className="text-faint shrink-0 text-micro tabular-nums" aria-live="polite">
            {texts.length} rows{order.length !== texts.length && ` · ${order.length} shown`}
          </span>
        </div>
      )}
    </VizFrame>
  );
}

const rowKey = (r: string[]) => r.join("\u0001");

/**
 * Marks the wrapper `data-scrolled-start` / `data-scrolled-end` while its scroll container has
 * content hidden that way, so the sticky column's edge and the right-hand fade only show when
 * there is something to scroll to.
 */
function useScrollEdges() {
  const [wrap, setWrap] = React.useState<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const el = wrap?.firstElementChild as HTMLElement | null;
    if (!wrap || !el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      wrap.toggleAttribute("data-scrolled-start", el.scrollLeft > 0.5);
      wrap.toggleAttribute("data-scrolled-end", el.scrollLeft < max - 0.5);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [wrap]);
  return setWrap;
}

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
