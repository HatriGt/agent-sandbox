import * as React from "react";
import { motion } from "motion/react";
import { ArrowUp, Check, ChevronsUpDown, Columns3, Copy, Pin, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { cellNumber, csvField } from "@/lib/viz";
import { columnGrip, MIN_COL, shapeKey, useColumnWidths } from "@/lib/column-widths";
import { useReducedMotion } from "@/lib/motion-pref";
import { count, VizEmpty, VizFrame, VizSearch } from "./VizFrame";
import { ChartBlock } from "./ChartBlock";
import { FIRST_CAP } from "./motion";
import { AnimatedTabs } from "@/components/ui/animated-tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InlineOnly, VizFullscreenContext } from "./viz-fullscreen";
import { IconSwap } from "./motion";
import type { ChartSpec } from "@/lib/viz";

/** Rows glide to their new place on sort / pin / filter up to this many; past it they jump (FLIP cost). */
const FLIP_CAP = 60;
/** Row reorder: a critically damped spring (no bounce), interruptible by the next sort. */
const REORDER = { type: "spring", duration: 0.3, bounce: 0 } as const;

type RowIn = "first" | "new" | "back";

/**
 * How each row entered, fixed per mounted row so a re-render never restarts it: rows on first paint
 * rise in a capped stagger, rows that stream in later rise as a batch, a row that returns when a
 * filter clears only fades (it was already seen). A row that leaves the filter is forgotten, so its
 * return counts as "back".
 */
function useTableEntrance(visible: number[]) {
  const map = React.useRef(new Map<number, { kind: RowIn; i: number }>());
  const everSeen = React.useRef(new Set<number>());
  const mounted = React.useRef(false);
  const live = new Set(visible);
  for (const k of [...map.current.keys()]) if (!live.has(k)) map.current.delete(k);
  let batch = 0;
  visible.forEach((k, idx) => {
    if (map.current.has(k)) return;
    const kind: RowIn = !mounted.current ? "first" : everSeen.current.has(k) ? "back" : "new";
    map.current.set(k, { kind, i: kind === "first" ? Math.min(idx, FIRST_CAP) : batch++ });
    everSeen.current.add(k);
  });
  React.useEffect(() => {
    mounted.current = true;
  }, []);
  return (k: number) => map.current.get(k) ?? { kind: "back" as RowIn, i: 0 };
}

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
  // Column order and hidden columns are by original index, so they survive rows streaming in.
  // Both are reached from the sheet (drag a header, the Columns menu) and the card follows: the
  // body is one set of elements mounted in both places.
  const [colOrder, setColOrder] = React.useState<number[] | null>(null);
  const [hidden, setHidden] = React.useState<number[]>([]);
  const [density, setDensity] = React.useState<"cozy" | "compact">("cozy");
  const [drop, setDrop] = React.useState<{ col: number; side: "before" | "after" } | null>(null);
  const [dragging, setDragging] = React.useState<number | null>(null);
  const allOrder = React.useMemo(() => {
    const ids = head.map((_, i) => i);
    if (!colOrder) return ids;
    const kept = colOrder.filter((c) => c < head.length);
    return [...kept, ...ids.filter((i) => !kept.includes(i))];
  }, [colOrder, head]);
  const visible = React.useMemo(() => allOrder.filter((c) => !hidden.includes(c)), [allOrder, hidden]);
  const moveCol = (from: number, to: number, side: "before" | "after") => {
    if (from === to) return;
    const o = allOrder.filter((c) => c !== from);
    o.splice(o.indexOf(to) + (side === "after" ? 1 : 0), 0, from);
    setColOrder(o);
  };
  // Alt+←/→ on a header moves the column one place among the visible ones.
  const nudgeCol = (c: number, by: -1 | 1) => {
    const vi = visible.indexOf(c);
    const to = visible[vi + by];
    if (to !== undefined) moveCol(c, to, by < 0 ? "before" : "after");
  };

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
  // Identifiers are numbers without magnitude: no bar for a column headed id / # / port / year /
  // "claim header id" (the last word decides), nor for a column whose values all sit within 15%
  // of each other — eight claim ids near 933700 drew eight full-length bars that read as links.
  const idLike = React.useMemo(
    () => head.map((h) => /(^|[\s_./-])(ids?|#|no\.?|nr|num|pk|index|idx|port|pid|year|version|code|key|sku|uuid|guid|hash|zip|phone)$/i.test(typeof h === "string" ? h.trim() : "")),
    [head]
  );
  const maxima = React.useMemo(
    () =>
      head.map((_, c) => {
        if (!numeric[c] || idLike[c]) return 0;
        const abs = texts.map((r) => cellNumber(r[c] ?? "")).filter((n): n is number => n !== null).map(Math.abs);
        if (abs.length === 0) return 0;
        const max = Math.max(...abs);
        const min = Math.min(...abs);
        return abs.length > 1 && max > 0 && min / max > 0.85 ? 0 : max;
      }),
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
  const minWidth = shaped ? visible.reduce<number>((s, c) => s + widthOf(c), 0) : undefined;
  const edges = useScrollEdges();
  const reduced = useReducedMotion();
  const entrance = useTableEntrance(order);
  const flip = !reduced && order.length <= FLIP_CAP;

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

  const span = visible.length + (shaped ? 1 : 0);
  const cellPad = density === "compact" ? "px-2.5 py-1" : "px-3 py-2";
  const dirty = sort !== null || colOrder !== null || hidden.length > 0 || pins.length > 0 || query !== "" || density !== "cozy";
  const reset = () => {
    setSort(null);
    setColOrder(null);
    setHidden([]);
    setPins([]);
    setQuery("");
    setDensity("cozy");
  };
  // What is on screen, as CSV: the shown rows in their order, the visible columns in theirs.
  const csvShown = () => [visible.map((c) => headTexts[c]), ...order.map((ri) => visible.map((c) => texts[ri][c] ?? ""))].map((r) => r.map(csvField).join(",")).join("\n");
  const hairline = "border-t-0 border-b border-border/50";
  // Text stays on one line (a wide table scrolls) until a column is shaped; then it wraps to the width the user chose.
  const textWrap = shaped ? "whitespace-normal [overflow-wrap:anywhere]" : "whitespace-nowrap";
  // The sticky first column paints its own background, so hover and pinned tints live in one
  // variable the row and its first cell both read; a mixed opaque colour covers scrolled content.
  // A pinned row keeps a faint live-hue ground (persistent, not a hover look-alike); hover deepens it.
  const rowTint =
    "[--row-bg:var(--card)] hover:[--row-bg:color-mix(in_oklab,var(--muted)_50%,var(--card))] focus-visible:[--row-bg:color-mix(in_oklab,var(--muted)_60%,var(--card))] data-pinned:[--row-bg:color-mix(in_oklab,var(--live)_6%,var(--card))] data-pinned:hover:[--row-bg:color-mix(in_oklab,var(--live)_9%,var(--card))] active:[--row-bg:color-mix(in_oklab,var(--muted)_70%,var(--card))]";
  const stickyCell = "sticky left-0 z-[1] in-data-scrolled-start:shadow-[inset_-1px_0_0_var(--border),8px_0_12px_-8px_color-mix(in_oklab,var(--foreground)_18%,transparent)]";
  // The sticky header always has its hairline; the 1px drop only shows once rows scroll under it.
  const headShadow = "transition-[box-shadow] duration-150 in-data-scrolled-top:shadow-[0_1px_0_var(--border),0_2px_3px_-2px_color-mix(in_oklab,var(--foreground)_14%,transparent)]";

  return (
    <VizFrame title={title ?? count(texts.length, "row")} source={csv}
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
      <TableToolbar
        query={query}
        onQuery={setQuery}
        shown={order.length}
        total={texts.length}
        columns={allOrder.map((c) => ({ c, label: headTexts[c] || `column ${c + 1}`, on: !hidden.includes(c) }))}
        onToggleColumn={(c) => setHidden((h) => (h.includes(c) ? h.filter((x) => x !== c) : visible.length > 1 ? [...h, c] : h))}
        onShowAll={() => setHidden([])}
        density={density}
        onDensity={setDensity}
        csv={csvShown}
        dirty={dirty}
        onReset={reset}
      />
      <div ref={edges} className="relative">
        <div className="max-h-96 overflow-auto overscroll-x-none in-data-viz-fullscreen:max-h-[calc(var(--viz-full)-2.5rem)]">
          <table className={cn("w-full border-separate border-spacing-0 text-meta", shaped && "table-fixed")} style={minWidth ? { minWidth } : undefined}>
            <colgroup ref={cols.colgroup}>
              {visible.map((c) => {
                const w = shaped ? cols.width(String(c)) : undefined;
                return <col key={c} data-col={String(c)} style={w ? { width: w } : undefined} />;
              })}
              {shaped && <col data-flex="" />}
            </colgroup>
            <thead data-slot="table-header">
              {/* The row sticks to the top; each header is a plain positioned cell so a grip's 4px overflow paints above the next header. */}
              <tr className="bg-card sticky top-0 z-10">
                {visible.map((c, vi) => {
                  const h = head[c];
                  const on = sort?.col === c ? sort.dir : null;
                  const label = headTexts[c] || `column ${c + 1}`;
                  return (
                    <th
                      key={c}
                      scope="col"
                      aria-sort={on ? (on === 1 ? "ascending" : "descending") : "none"}
                      // Drag a header to reorder (the edge grip resizes, and must not start a drag).
                      draggable={visible.length > 1}
                      data-dragging={dragging === c || undefined}
                      data-drop={drop?.col === c ? drop.side : undefined}
                      onDragStart={(e) => {
                        if ((e.target as HTMLElement).closest(".dt-resize")) return e.preventDefault();
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", label);
                        setDragging(c);
                      }}
                      onDragOver={(e) => {
                        if (dragging === null || dragging === c) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        const r = e.currentTarget.getBoundingClientRect();
                        const side = e.clientX < r.left + r.width / 2 ? "before" : "after";
                        if (drop?.col !== c || drop.side !== side) setDrop({ col: c, side });
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && drop?.col === c) setDrop(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragging !== null && drop?.col === c) moveCol(dragging, c, drop.side);
                        setDrop(null);
                        setDragging(null);
                      }}
                      onDragEnd={() => {
                        setDrop(null);
                        setDragging(null);
                      }}
                      className={cn("group/th bg-card relative border-b text-left align-bottom", cellPad, headShadow, numeric[c] && "text-right", vi === 0 && stickyCell, vi === 0 && "z-20")}
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
                        onKeyDown={(e) => {
                          if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
                          e.preventDefault();
                          nudgeCol(c, e.key === "ArrowLeft" ? -1 : 1);
                        }}
                        title="Sort · drag to reorder · Alt+←/→ to move"
                        className={cn(
                          "group/sort viz-press -mx-1.5 inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-micro font-medium tracking-[0.05em] uppercase whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                          on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                          numeric[c] && "flex-row-reverse"
                        )}
                      >
                        {h}
                        {/* Both glyphs stay mounted and cross-fade through a blur; the arrow turns for direction. */}
                        <span className="relative inline-grid size-3 shrink-0 place-items-center" aria-hidden>
                          <ChevronsUpDown
                            strokeWidth={1.75}
                            className={cn(
                              "absolute size-3 transition-[opacity,scale,filter] duration-150 ease-(--viz-ease)",
                              // The sheet shows every column's sort glyph faintly: the affordance is on display there.
                              on ? "scale-25 opacity-0 blur-[4px]" : "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60 in-data-viz-fullscreen:opacity-35 in-data-viz-fullscreen:group-hover/sort:opacity-70"
                            )}
                          />
                          <ArrowUp
                            strokeWidth={2}
                            className={cn("absolute size-3 transition-[opacity,rotate,scale,filter] duration-150 ease-(--viz-ease)", on ? "opacity-100" : "scale-25 opacity-0 blur-[4px]", on === -1 && "rotate-180")}
                          />
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
                  <td colSpan={span} className="p-0">
                    <VizEmpty onClear={() => setQuery("")}>No rows match “{query}”</VizEmpty>
                  </td>
                </tr>
              )}
              {order.map((ri) => {
                const key = rowKey(texts[ri]);
                const pinned = pins.includes(key);
                const togglePin = () => setPins((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
                const ent = entrance(ri);
                // Bars grow once, on the row's first mount; a row returning from a filter shows its bar as is.
                const grow = ent.kind !== "back";
                return (
                  <motion.tr
                    key={ri}
                    layout={flip ? "position" : false}
                    transition={REORDER}
                    style={{ "--i": ent.i } as React.CSSProperties}
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
                      "bg-(--row-bg) no-press cursor-pointer outline-none transition-[background-color] duration-150 ease-(--viz-ease) focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                      rowTint,
                      ent.kind === "first" ? "viz-in" : ent.kind === "new" ? "viz-row-new" : "viz-fade"
                    )}
                  >
                    {visible.map((c, vi) => {
                      const cell = rows[ri][c];
                      const sticky = vi === 0 && cn(stickyCell, "bg-(--row-bg) transition-[background-color] duration-150 ease-(--viz-ease)");
                      if (!numeric[c]) {
                        // Support-matrix cells: a lone ✓ / ✗ / yes / no wears the functional hue
                        // (still the glyph/word itself, never color alone).
                        const t = (texts[ri][c] ?? "").trim().toLowerCase();
                        const tone = ["✓", "✔", "yes"].includes(t) ? "text-ok" : ["✗", "✘", "no", "×"].includes(t) ? "text-destructive" : ["—", "-", "n/a"].includes(t) ? "text-faint" : "";
                        return (
                          <td key={c} className={cn(hairline, cellPad, "align-top", textWrap, tone, tone && "text-center font-medium", sticky)}>
                            {vi === 0 && pinned && <Pin className="viz-mark text-live mr-1 inline size-3 -translate-y-px" strokeWidth={2} aria-label="pinned" />}
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
                              // Grows from its right anchor once (first mount of the row); a new
                              // maximum while streaming tweens the width instead of re-growing.
                              className={cn("viz-tween-w absolute right-3 bottom-1.5 h-0.5 origin-right rounded-full opacity-30", grow && "viz-grow-x")}
                              style={{ width: `${Math.max(4, frac * 56)}px`, background: "var(--viz-1)" }}
                            />
                          )}
                          {cell}
                        </td>
                      );
                    })}
                    {shaped && <td className={cn(hairline, "p-0")} />}
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {texts.length > 8 && (
        <InlineOnly>
          <VizSearch
            className="border-t"
            value={query}
            onChange={setQuery}
            placeholder="Filter rows"
            count={order.length !== texts.length ? `${order.length} of ${texts.length}` : count(texts.length, "row")}
          />
        </InlineOnly>
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
      wrap.toggleAttribute("data-scrolled-top", el.scrollTop > 0.5);
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

const TOOL_BUTTON =
  "viz-press text-muted-foreground hover:text-foreground hover:bg-muted/70 inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-micro font-medium whitespace-nowrap transition-[color,background-color] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0";

/**
 * The toolbar the table grows in the sheet (nothing in the card): the row filter with its count,
 * a hint for the header gestures, the Columns menu (show/hide by original order), density, copy
 * of what is shown as CSV, and Reset once anything differs from how the agent wrote the table.
 */
function TableToolbar({
  query,
  onQuery,
  shown,
  total,
  columns,
  onToggleColumn,
  onShowAll,
  density,
  onDensity,
  csv,
  dirty,
  onReset,
}: {
  query: string;
  onQuery: (q: string) => void;
  shown: number;
  total: number;
  columns: { c: number; label: string; on: boolean }[];
  onToggleColumn: (c: number) => void;
  onShowAll: () => void;
  density: "cozy" | "compact";
  onDensity: (d: "cozy" | "compact") => void;
  csv: () => string;
  dirty: boolean;
  onReset: () => void;
}) {
  const full = React.useContext(VizFullscreenContext);
  const [copied, setCopied] = React.useState(false);
  if (!full) return null;
  const off = columns.filter((c) => !c.on).length;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(csv());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied */
    }
  };
  return (
    <div className="flex h-10 items-center gap-1 border-b pr-2" data-table-toolbar>
      <VizSearch className="min-w-0 flex-1" value={query} onChange={onQuery} placeholder="Filter rows" count={shown !== total ? `${shown} of ${total}` : count(total, "row")} />
      <span className="text-faint mr-2 hidden text-micro whitespace-nowrap xl:inline" aria-hidden>
        Click a header to sort · drag it to reorder · drag its edge to resize
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={TOOL_BUTTON} aria-label="Columns">
            <Columns3 strokeWidth={1.75} />
            Columns
            {off > 0 && <span className="text-faint tabular-nums">· {off} hidden</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1.5" aria-label="Columns">
          <div className="max-h-72 overflow-auto">
            {columns.map((col) => (
              <button
                key={col.c}
                type="button"
                role="menuitemcheckbox"
                aria-checked={col.on}
                onClick={() => onToggleColumn(col.c)}
                className="hover:bg-accent flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-meta outline-none transition-[background-color] duration-100 focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <span className={cn("grid size-4 shrink-0 place-items-center rounded border transition-[background-color,border-color] duration-100", col.on ? "bg-foreground border-foreground text-background" : "border-line-strong")} aria-hidden>
                  {col.on && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="truncate">{col.label}</span>
              </button>
            ))}
          </div>
          {off > 0 && (
            <button type="button" onClick={onShowAll} className="text-muted-foreground hover:text-foreground hover:bg-accent mt-1 flex h-8 w-full cursor-pointer items-center rounded-md border-t px-2 text-micro font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              Show all columns
            </button>
          )}
        </PopoverContent>
      </Popover>
      <AnimatedTabs
        ariaLabel="Row density"
        size="sm"
        className="mx-1"
        value={density}
        onChange={onDensity}
        items={[
          { value: "cozy", label: "Cozy" },
          { value: "compact", label: "Compact" },
        ]}
      />
      <button type="button" onClick={copy} className={TOOL_BUTTON} aria-label={copied ? "Copied" : "Copy shown rows as CSV"}>
        <IconSwap on={copied} offIcon={<Copy strokeWidth={1.75} />} onIcon={<Check className="text-ok" strokeWidth={2.25} />} />
        Copy CSV
      </button>
      <button type="button" onClick={onReset} disabled={!dirty} className={TOOL_BUTTON} aria-label="Reset sort, order, columns and filter">
        <RotateCcw strokeWidth={1.75} />
        Reset
      </button>
    </div>
  );
}

/** Table ⇄ Chart, in the card header. Only offered when the data has one obvious chart in it. */
function ViewSwitch({ view, onChange }: { view: "table" | "chart"; onChange: (v: "table" | "chart") => void }) {
  // Switching swaps the whole block for a ChartBlock (a different frame), which would close the
  // sheet under the reader: the switch lives in the card only.
  if (React.useContext(VizFullscreenContext)) return null;
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
