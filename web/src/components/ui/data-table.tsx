import * as React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type TableProps } from "@/components/ui/table";

/**
 * The one data table of the app (fleet, automations, runs, scheduled, playbooks). Columns declare a
 * header, a cell renderer, an optional sort key and the breakpoint below which they hide; the table
 * owns sorting (asc → desc → off, as EasyUI), clickable rows (the row is the button, as Orbit),
 * optional group heads, skeleton rows and the empty state. Visual language: DESIGN.md → Tables.
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
  className?: string;
}

const HIDE: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

type Sort = { id: string; dir: "asc" | "desc" } | null;

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
}) {
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

  const cycle = (id: string) => setSort((s) => (s?.id !== id ? { id, dir: "asc" } : s.dir === "asc" ? { id, dir: "desc" } : null));
  const grouped = !!groupOf && !sort;

  return (
    <Table aria-label={ariaLabel} size={size} stickyHeader={stickyHeader} containerClassName={containerClassName} className={cn("table-fixed", minWidth)} aria-busy={loading || undefined}>
      <colgroup>
        {columns.map((c) => (
          <col key={c.id} className={cn(c.width, c.hideBelow && HIDE[c.hideBelow].replace(/table-cell/g, "table-column"))} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {columns.map((c) => {
            const on = sort?.id === c.id ? sort.dir : null;
            return (
              <TableHead key={c.id} align={c.align} aria-sort={on ? (on === "asc" ? "ascending" : "descending") : c.sort ? "none" : undefined} className={cn(c.hideBelow && HIDE[c.hideBelow])}>
                {c.sort ? (
                  <button
                    type="button"
                    onClick={() => cycle(c.id)}
                    className={cn("hover:text-foreground -mx-1.5 inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 transition-colors", on && "text-foreground", c.align === "end" && "flex-row-reverse")}
                  >
                    {c.header}
                    {on === "asc" ? <ArrowUp className="size-3" /> : on === "desc" ? <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                  </button>
                ) : (
                  c.header
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          Array.from({ length: 4 }, (_, i) => (
            <TableRow key={`sk${i}`}>
              {columns.map((c) => (
                <TableCell key={c.id} className={cn(c.hideBelow && HIDE[c.hideBelow])}>
                  <span className="bg-muted block h-3.5 max-w-32 animate-pulse rounded" style={{ width: `${55 + ((i * 17 + c.id.length * 7) % 40)}%` }} />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : sorted.length === 0 ? (
          <TableRow className="hover:bg-(--table-bg)">
            <TableCell colSpan={columns.length} className="text-muted-foreground h-28 text-center whitespace-normal">
              {empty ?? "Nothing here yet."}
            </TableCell>
          </TableRow>
        ) : (
          sorted.map((r, i) => {
            const g = grouped ? groupOf!(r) : null;
            const head = grouped && g && (i === 0 || groupOf!(sorted[i - 1]) !== g);
            const p = rowProps?.(r);
            const click = onRowClick && (rowClickable?.(r) ?? true) ? () => onRowClick(r) : undefined;
            return (
              <React.Fragment key={rowKey(r)}>
                {head && (
                  <TableRow className="hover:bg-(--table-bg)">
                    <TableCell colSpan={columns.length} className="label text-faint bg-(--table-head-bg,var(--table-bg)) py-1.5">
                      {g}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow
                  data-clickable={click ? "" : undefined}
                  data-state={p?.selected ? "selected" : undefined}
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
                          }
                        }
                      : undefined
                  }
                  className={p?.className}
                  style={p?.style}
                >
                  {columns.map((c) => (
                    <TableCell key={c.id} align={c.align} className={cn("overflow-hidden", c.hideBelow && HIDE[c.hideBelow], c.className)}>
                      {c.cell(r)}
                    </TableCell>
                  ))}
                </TableRow>
              </React.Fragment>
            );
          })
        )}
      </TableBody>
    </Table>
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
      <span className="relative inline-flex size-1.5 shrink-0">
        {pulse && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", dot)} />}
        <span className={cn("relative size-1.5 rounded-full", dot)} />
      </span>
      {children}
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
