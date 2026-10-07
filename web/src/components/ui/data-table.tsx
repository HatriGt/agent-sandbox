import * as React from "react";
import { ArrowUp, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type TableProps } from "@/components/ui/table";

/**
 * The one data table of the app (fleet, automations, runs, scheduled, playbooks). Columns declare a
 * header, a cell renderer, an optional sort key and the breakpoint below which they hide; the table
 * owns sorting (asc → desc → off, as EasyUI), clickable rows (the row is the button, as Orbit; ↑/↓
 * or j/k move between them, Enter opens), an optional search toolbar, a trailing actions cell,
 * optional group heads, skeleton rows and the empty state. Bordered card by default; `bordered={false}`
 * is the frameless list. Visual language: DESIGN.md → Tables.
 */

export interface Column<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Present → the header sorts by this value. */
  sort?: (row: T) => string | number | null | undefined;
  align?: "start" | "center" | "end";
  /** Width class for the <col>, e.g. "w-28"; omit for the flexible column. */
  width?: string;
  /** Hide below this breakpoint (the primary column should carry a mobile meta line instead). */
  hideBelow?: "sm" | "md" | "lg";
  /** The column that names the row: bright ink and medium weight; every other column stays muted (Orbit). */
  primary?: boolean;
  className?: string;
}

const HIDE: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

type Sort = { id: string; dir: "asc" | "desc" } | null;

const NO_GHOSTS: ReadonlySet<string> = new Set();

/** Moves focus to the previous/next clickable row of the same body (ghost rows are never clickable). */
function focusSibling(row: HTMLElement, dir: 1 | -1) {
  const all = Array.from(row.parentElement?.querySelectorAll<HTMLElement>(":scope > tr[data-clickable]") ?? []);
  all[all.indexOf(row) + dir]?.focus();
}

const MIN_COL = 56;
const AUTO_MAX = 360;

/**
 * Column widths. Auto: once real rows paint, every sized column is fitted to its widest content
 * (header included, clamped 56–360px) and the flexible column takes the rest. Manual: dragging a
 * header edge sets that column in px and is remembered per table (localStorage); double-click the
 * edge to hand it back to auto.
 */
function useColumnWidths(storeKey: string | undefined, ready: boolean, signature: string) {
  const colgroup = React.useRef<HTMLTableColElement>(null);
  const [manual, setManual] = React.useState<Record<string, number>>(() => {
    if (!storeKey) return {};
    try {
      return JSON.parse(localStorage.getItem(`asb.cols.${storeKey}`) ?? "{}");
    } catch {
      return {};
    }
  });
  const [auto, setAuto] = React.useState<Record<string, number>>({});
  const fitted = React.useRef("");
  React.useLayoutEffect(() => {
    const table = colgroup.current?.closest("table");
    if (!ready || !table || fitted.current === signature) return;
    fitted.current = signature;
    const next: Record<string, number> = {};
    const cols = Array.from(colgroup.current!.children) as HTMLElement[];
    // Measure natural widths with one synchronous relayout: auto layout at max-content lets every
    // cell (truncating ones included) take its content's width; restored before paint.
    const saved = [table.style.tableLayout, table.style.width, table.style.minWidth];
    const savedCols = cols.map((c) => c.style.width);
    cols.forEach((c) => (c.style.width = "auto"));
    table.style.tableLayout = "auto";
    table.style.width = "max-content";
    table.style.minWidth = "0";
    cols.forEach((col, i) => {
      const id = col.dataset.col;
      if (!id || col.dataset.flex !== undefined) return;
      let w = 0;
      for (const row of Array.from(table.rows)) {
        const c = row.cells[i];
        if (c && c.colSpan === 1 && c.offsetParent) w = Math.max(w, c.getBoundingClientRect().width);
      }
      if (w > 0) next[id] = Math.min(AUTO_MAX, Math.max(MIN_COL, Math.ceil(w)));
    });
    [table.style.tableLayout, table.style.width, table.style.minWidth] = saved;
    cols.forEach((c, i) => (c.style.width = savedCols[i]));
    setAuto(next);
  }, [ready, signature]);
  const persist = (m: Record<string, number>) => {
    setManual(m);
    if (storeKey) localStorage.setItem(`asb.cols.${storeKey}`, JSON.stringify(m));
  };
  const startResize = (id: string, e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.closest("th")!;
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    document.documentElement.dataset.colResize = "";
    let latest = manual;
    const move = (ev: PointerEvent) => {
      latest = { ...manual, [id]: Math.max(MIN_COL, Math.round(startW + ev.clientX - startX)) };
      setManual(latest);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      delete document.documentElement.dataset.colResize;
      persist(latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const nudge = (id: string, th: HTMLElement | null, by: number) => {
    const w = manual[id] ?? th?.getBoundingClientRect().width ?? MIN_COL;
    persist({ ...manual, [id]: Math.max(MIN_COL, Math.round(w + by)) });
  };
  const reset = (id: string) => {
    const { [id]: _, ...rest } = manual;
    persist(rest);
  };
  return { colgroup, width: (id: string) => manual[id] ?? auto[id], isManual: (id: string) => id in manual, startResize, nudge, reset };
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  rowLabel,
  rowClickable,
  rowProps,
  groupOf,
  initialSort = null,
  loading,
  empty,
  minWidth,
  size,
  stickyHeader,
  containerClassName,
  "aria-label": ariaLabel,
  bordered = true,
  search,
  actions,
  toolbar,
  resizeKey,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Screen-reader name of a clickable row ("Open run 12"). */
  rowLabel?: (row: T) => string;
  /** Present → only rows it accepts are clickable (others render as plain rows). */
  rowClickable?: (row: T) => boolean;
  rowProps?: (row: T) => { className?: string; selected?: boolean; style?: React.CSSProperties; onMouseEnter?: () => void };
  /** Group head shown above the first row of each run of equal values (unsorted only). */
  groupOf?: (row: T) => string | null;
  initialSort?: Sort;
  loading?: boolean;
  empty?: React.ReactNode;
  minWidth?: string;
  size?: TableProps["size"];
  stickyHeader?: boolean;
  containerClassName?: string;
  "aria-label"?: string;
  /** Default true: the table sits in a rounded bordered card. False → Orbit's frameless list. */
  bordered?: boolean;
  /** Renders a search toolbar above the table (`/` focuses, Esc clears) that filters by `text(row)`. */
  search?: { placeholder: string; text: (row: T) => string };
  /** Trailing, right-aligned actions cell; fades in on row hover/focus (always shown on touch). */
  actions?: (row: T) => React.ReactNode;
  /** Extra controls at the right of the search toolbar. */
  toolbar?: React.ReactNode;
  /** Where dragged column widths are remembered; defaults to the aria-label. */
  resizeKey?: string;
}) {
  const cols = useColumnWidths(resizeKey ?? ariaLabel, !loading && rows.length > 0, `${columns.map((c) => c.id).join(",")}|${rows.length}`);
  const [sort, setSort] = React.useState<Sort>(initialSort);
  const sorted = React.useMemo(() => {
    const col = sort && columns.find((c) => c.id === sort.id);
    if (!col?.sort) return rows;
    const k = col.sort;
    const m = sort!.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = k(a);
      const y = k(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" })) * m;
    });
  }, [rows, columns, sort]);

  // Motion bookkeeping. Each row's entrance is decided once, the first time its key renders under
  // this sort epoch: first paint → "in" (staggered rise), after a sort → "sort" (quick re-stagger;
  // the epoch is in the React key so rows remount and replay), a key never seen before → "new"
  // (rise + one flash). Polling re-renders keep the stored value, so nothing replays on refresh.
  const [epoch, setEpoch] = React.useState(0);
  const seen = React.useRef<Set<string> | null>(null);
  const enterOf = React.useRef(new Map<string, "in" | "sort" | "new">());
  const cycle = (id: string) => {
    enterOf.current.clear();
    setEpoch((n) => n + 1);
    setSort((s) => (s?.id !== id ? { id, dir: "asc" } : s.dir === "asc" ? { id, dir: "desc" } : null));
  };
  React.useEffect(() => {
    // Not until real rows arrive: an empty first render must not make every later row "new".
    if (loading || (!seen.current && !rows.length)) return;
    seen.current ??= new Set();
    for (const r of rows) seen.current.add(rowKey(r));
  }, [rows, rowKey, loading]);

  // Search. Changing the query bumps the epoch so the rows still shown re-enter with the quick sort
  // stagger; rows that stop matching stay in place as inert "ghosts" for one fade, then drop out.
  const [query, setQuery] = React.useState("");
  const [ghosts, setGhosts] = React.useState<ReadonlySet<string>>(NO_GHOSTS);
  const ghostTimer = React.useRef<number>(undefined);
  React.useEffect(() => () => clearTimeout(ghostTimer.current), []);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const textOf = search?.text;
  const needle = query.trim().toLowerCase();
  const matches = (r: T, q = needle) => !q || !textOf || textOf(r).toLowerCase().includes(q);
  const shown = needle && textOf ? sorted.filter((r) => matches(r)) : sorted;
  const list = ghosts.size ? sorted.filter((r) => matches(r) || ghosts.has(rowKey(r))) : shown;
  const applyQuery = (next: string) => {
    const q = next.trim().toLowerCase();
    setQuery(next);
    if (q === needle) return;
    const gone = shown.filter((r) => !matches(r, q)).map(rowKey);
    enterOf.current.clear();
    setEpoch((n) => n + 1);
    clearTimeout(ghostTimer.current);
    setGhosts(gone.length ? new Set(gone) : NO_GHOSTS);
    if (gone.length) ghostTimer.current = window.setTimeout(() => setGhosts(NO_GHOSTS), 200);
  };
  const hasSearch = !!search;
  React.useEffect(() => {
    if (!hasSearch) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      const el = inputRef.current;
      if (!el || !el.offsetParent) return;
      e.preventDefault();
      el.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSearch]);

  const span = columns.length + (actions ? 1 : 0);
  const searchMiss = !!needle && !!search && shown.length === 0 && rows.length > 0;
  const grouped = !!groupOf && !sort;

  const table = (
    <Table
      aria-label={ariaLabel}
      variant={bordered ? "surface" : "plain"}
      size={size}
      stickyHeader={stickyHeader}
      containerClassName={containerClassName}
      className={cn("table-fixed", minWidth)}
      style={(() => {
        // Sized columns + 240px for the flexible one: below that the card scrolls sideways instead of crushing the name.
        const fixed = columns.reduce((s, c) => s + (cols.width(c.id) ?? 0), 0) + (actions ? 112 : 0);
        return fixed ? { minWidth: fixed + (columns.some((c) => !c.width) ? 240 : 0) } : undefined;
      })()}
      aria-busy={loading || undefined}
    >
      <colgroup ref={cols.colgroup}>
        {columns.map((c) => {
          const w = cols.width(c.id);
          // A manual width always wins; an auto fit only resizes columns that declared a width (the flexible one fills).
          const px = cols.isManual(c.id) || (w && c.width) ? w : undefined;
          return <col key={c.id} data-col={c.id} data-flex={c.width ? undefined : ""} style={px ? { width: px } : undefined} className={cn(!px && c.width, c.hideBelow && HIDE[c.hideBelow].replace(/table-cell/g, "table-column"))} />;
        })}
        {actions && <col className="w-28" />}
      </colgroup>
      <TableHeader>
        <TableRow>
          {columns.map((c) => {
            const on = sort?.id === c.id ? sort.dir : null;
            return (
              <TableHead key={c.id} align={c.align} aria-sort={on ? (on === "asc" ? "ascending" : "descending") : c.sort ? "none" : undefined} className={cn("group/th relative", c.hideBelow && HIDE[c.hideBelow])}>
                {c.sort ? (
                  <button
                    type="button"
                    onClick={() => cycle(c.id)}
                    className={cn("hover:text-foreground group/sort -mx-1.5 inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 uppercase transition-colors duration-150", on && "text-foreground", c.align === "end" && "flex-row-reverse")}
                  >
                    {c.header}
                    <span className="relative inline-grid size-3 place-items-center">
                      <ChevronsUpDown className={cn("absolute size-3 transition-[opacity,scale] duration-200 ease-(--ease-out-quint)", on ? "scale-75 opacity-0" : "opacity-30 group-hover/sort:opacity-70")} />
                      <ArrowUp className={cn("absolute size-3 transition-[opacity,rotate,scale] duration-200 ease-(--ease-out-quint)", on ? "opacity-100" : "scale-75 opacity-0", on === "desc" && "rotate-180")} />
                    </span>
                  </button>
                ) : (
                  c.header
                )}
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${typeof c.header === "string" ? c.header : c.id} column`}
                  tabIndex={0}
                  title="Drag to resize · double-click to fit"
                  onPointerDown={(e) => cols.startResize(c.id, e)}
                  onDoubleClick={() => cols.reset(c.id)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                    e.preventDefault();
                    cols.nudge(c.id, e.currentTarget.closest("th"), e.key === "ArrowRight" ? 16 : -16);
                  }}
                  className="dt-resize absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-none"
                />
              </TableHead>
            );
          })}
          {actions && (
            <TableHead align="end">
              <span className="sr-only">Actions</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          Array.from({ length: 4 }, (_, i) => (
            <TableRow key={`sk${i}`}>
              {columns.map((c) => (
                <TableCell key={c.id} className={cn(c.hideBelow && HIDE[c.hideBelow])}>
                  <span className="dt-shim block h-3 max-w-32 rounded-full" style={{ width: `${55 + ((i * 17 + c.id.length * 7) % 40)}%` }} />
                </TableCell>
              ))}
              {actions && <TableCell />}
            </TableRow>
          ))
        ) : searchMiss && !ghosts.size ? (
          <TableRow className="hover:bg-(--table-bg)">
            <TableCell colSpan={span} className="h-28 text-center whitespace-normal">
              <span className="flex flex-col items-center gap-2">
                <span>
                  No rows match <span className="text-foreground">“{query.trim()}”</span>
                </span>
                <Button size="xs" variant="outline" onClick={() => applyQuery("")}>
                  Clear search
                </Button>
              </span>
            </TableCell>
          </TableRow>
        ) : list.length === 0 ? (
          <TableRow className="hover:bg-(--table-bg)">
            <TableCell colSpan={span} className="text-muted-foreground h-28 text-center whitespace-normal">
              {empty ?? "Nothing here yet."}
            </TableCell>
          </TableRow>
        ) : (
          list.map((r, i) => {
            const g = grouped ? groupOf!(r) : null;
            const head = grouped && g && (i === 0 || groupOf!(list[i - 1]) !== g);
            const p = rowProps?.(r);
            const key = rowKey(r);
            const ghost = ghosts.has(key) && !matches(r);
            const click = !ghost && onRowClick && (rowClickable?.(r) ?? true) ? () => onRowClick(r) : undefined;
            let enter = enterOf.current.get(key);
            if (!enter) {
              enter = !seen.current ? "in" : !seen.current.has(key) ? "new" : "sort";
              enterOf.current.set(key, enter);
            }
            const motion = ghost
              ? { "data-enter": undefined, "data-new": undefined, style: p?.style }
              : { "data-enter": enter === "new" ? undefined : enter, "data-new": enter === "new" ? "" : undefined, style: { ...p?.style, "--i": i } as React.CSSProperties };
            return (
              <React.Fragment key={`${epoch}:${key}`}>
                {head && (
                  <TableRow className="hover:bg-(--table-bg)" data-enter={motion["data-enter"]} style={motion.style}>
                    <TableCell colSpan={span} className="text-faint bg-(--table-head-bg,var(--table-bg)) h-auto py-2 pt-4 text-[11px] font-medium tracking-[0.05em] uppercase">
                      {g}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow
                  data-clickable={click ? "" : undefined}
                  data-state={p?.selected ? "selected" : undefined}
                  data-leave={ghost ? "" : undefined}
                  aria-hidden={ghost || undefined}
                  inert={ghost || undefined}
                  tabIndex={click ? 0 : undefined}
                  aria-label={click && rowLabel ? rowLabel(r) : undefined}
                  onClick={click}
                  onMouseEnter={p?.onMouseEnter}
                  onKeyDown={
                    click
                      ? (e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            click();
                          } else if (e.key === "ArrowDown" || e.key === "j" || e.key === "ArrowUp" || e.key === "k") {
                            if (e.metaKey || e.ctrlKey || e.altKey) return;
                            e.preventDefault();
                            focusSibling(e.currentTarget, e.key === "ArrowDown" || e.key === "j" ? 1 : -1);
                          }
                        }
                      : undefined
                  }
                  className={p?.className}
                  data-enter={motion["data-enter"]}
                  data-new={motion["data-new"]}
                  style={motion.style}
                >
                  {columns.map((c) => (
                    <TableCell key={c.id} align={c.align} className={cn("overflow-hidden", c.hideBelow && HIDE[c.hideBelow], c.primary && "text-foreground font-medium", c.className)}>
                      {c.cell(r)}
                    </TableCell>
                  ))}
                  {actions && (
                    <TableCell align="end" className="overflow-visible" onClick={stopRow} onKeyDown={stopRow}>
                      <div className="dt-actions inline-flex items-center justify-end gap-1">{actions(r)}</div>
                    </TableCell>
                  )}
                </TableRow>
              </React.Fragment>
            );
          })
        )}
      </TableBody>
    </Table>
  );

  if (!search && !toolbar) return table;
  return (
    <div data-slot="data-table" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {search && (
          <>
            <label className="bg-card focus-within:ring-ring/40 focus-within:border-ring flex h-8 w-full max-w-72 min-w-0 items-center gap-1.5 rounded-md border px-2 transition-[border-color,box-shadow] duration-150 focus-within:ring-2 sm:w-64">
              <Search className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => applyQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  if (query) {
                    e.preventDefault();
                    e.stopPropagation();
                    applyQuery("");
                  } else e.currentTarget.blur();
                }}
                placeholder={search.placeholder}
                aria-label={search.placeholder}
                className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-meta outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {query ? (
                <button type="button" onClick={() => { applyQuery(""); inputRef.current?.focus(); }} aria-label="Clear search" className="text-muted-foreground hover:text-foreground hover:bg-muted pop-in cursor-pointer rounded p-0.5">
                  <X className="size-3.5" />
                </button>
              ) : (
                <kbd className="text-faint border-border hidden rounded border px-1 font-mono text-[10px] leading-4 sm:inline" aria-hidden>
                  /
                </kbd>
              )}
            </label>
            {!loading && (
              <span className="text-muted-foreground text-micro" aria-live="polite">
                {needle ? (
                  <>
                    <NumberTicker value={shown.length} from={rows.length} className="text-foreground" /> of <span className="tabular-nums">{rows.length}</span>
                  </>
                ) : (
                  <span className="tabular-nums">{rows.length}</span>
                )}
              </span>
            )}
          </>
        )}
        {toolbar && <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>}
      </div>
      {table}
    </div>
  );
}

/** Stops a click on a control inside a clickable row from also opening the row. */
export const stopRow = (e: React.SyntheticEvent) => e.stopPropagation();

/** Status as a dot + word (Orbit), never a filled pill. `pulse` for live work. */
export function StatusDot({ tone, pulse, children, className }: { tone: "ok" | "live" | "attention" | "destructive" | "muted"; pulse?: boolean; children: React.ReactNode; className?: string }) {
  const dot = { ok: "bg-ok", live: "bg-live", attention: "bg-attention", destructive: "bg-destructive", muted: "bg-faint" }[tone];
  const text = { ok: "text-ok", live: "text-live", attention: "text-attention-text", destructive: "text-destructive", muted: "text-muted-foreground" }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-meta font-medium", text, className)}>
      <span className={cn("relative inline-flex size-1.5 shrink-0 rounded-full", dot, pulse && "dt-ping")} />
      {pulse ? <span className="shimmer-text min-w-0 truncate [--shim-dim:color-mix(in_oklab,currentColor_70%,transparent)] [--shim-hi:var(--foreground)]">{children}</span> : children}
    </span>
  );
}

/** "a · b" meta line under a primary cell, with hairline dividers (sales-crm). */
export function MetaLine({ parts, className }: { parts: React.ReactNode[]; className?: string }) {
  const shown = parts.filter((p) => p != null && p !== false && p !== "");
  return (
    <span className={cn("text-muted-foreground flex min-w-0 items-center gap-2 text-micro", className)}>
      {shown.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="bg-border h-2.5 w-px shrink-0" aria-hidden />}
          <span className="min-w-0 truncate">{p}</span>
        </React.Fragment>
      ))}
    </span>
  );
}
