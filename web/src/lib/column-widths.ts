import * as React from "react";

/**
 * Column widths for every table the user can shape (ui/data-table and viz/DataTable). Every column's
 * header is measured on first paint and is a hard floor: no column (fitted, dragged, declared or
 * flexible) is ever narrower than its own label + sort icon. Auto: once real rows paint, every
 * non-flex column is fitted to its widest content (clamped to 360px). Manual: dragging a header edge
 * sets that column in px and is remembered per table (localStorage `asb.cols.<key>`); double-click
 * the edge to hand it back to auto. The first drag on an unshaped table snapshots every column's
 * rendered width first, so a table that was laid out by the browser does not jump when it becomes
 * fixed-layout.
 */

export const MIN_COL = 56;
const AUTO_MAX = 360;

/** A short stable key for a table shape (title + header texts), so the same table in a later turn keeps its widths. */
export function shapeKey(parts: string[]): string {
  let h = 2166136261;
  for (const ch of parts.join("\u0001")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export interface ColumnWidths {
  colgroup: React.RefObject<HTMLTableColElement | null>;
  floor: (id: string) => number | undefined;
  fit: (id: string) => number | undefined;
  /** Manual, else fitted, never under the header's own width. */
  width: (id: string) => number | undefined;
  isManual: (id: string) => boolean;
  /** At least one column has a manual width. */
  shaped: boolean;
  startResize: (id: string, e: React.PointerEvent<HTMLElement>) => void;
  nudge: (id: string, th: HTMLElement | null, by: number) => void;
  reset: (id: string) => void;
}

/**
 * The header's own footprint (label, sort icon, padding). At max-content a `th` box is as wide as the
 * column's widest cell, so measuring the box would make the flexible column's floor the width of
 * its longest title and push the table past its card.
 */
function labelWidth(th: HTMLTableCellElement): number {
  let w = 0;
  for (const node of Array.from(th.childNodes)) {
    if (node instanceof HTMLElement) {
      if (node.classList.contains("dt-resize")) continue;
      // A sort button overhangs the cell padding with negative margins; its net footprint is what counts.
      const m = getComputedStyle(node);
      w += node.getBoundingClientRect().width + parseFloat(m.marginLeft) + parseFloat(m.marginRight);
    } else {
      const range = document.createRange();
      range.selectNode(node);
      for (const r of Array.from(range.getClientRects())) w += r.width;
    }
  }
  const s = getComputedStyle(th);
  return w + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
}

export function useColumnWidths(storeKey: string | undefined, ready: boolean, signature: string): ColumnWidths {
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
  const [floor, setFloor] = React.useState<Record<string, number>>({});
  React.useLayoutEffect(() => {
    const table = colgroup.current?.closest("table");
    const key = `${ready}|${signature}`;
    if (!table || fitted.current === key) return;
    fitted.current = key;
    const fit: Record<string, number> = {};
    const head: Record<string, number> = {};
    const cols = Array.from(colgroup.current!.children) as HTMLElement[];
    // One synchronous relayout before paint: auto layout at max-content lets every cell (truncating
    // ones included) take its content's natural width; everything is restored afterwards.
    const saved = [table.style.tableLayout, table.style.width, table.style.minWidth];
    const savedCols = cols.map((c) => c.style.width);
    cols.forEach((c) => (c.style.width = "auto"));
    table.style.tableLayout = "auto";
    table.style.width = "max-content";
    table.style.minWidth = "0";
    const headRow = table.tHead?.rows[0];
    cols.forEach((col, i) => {
      const id = col.dataset.col;
      if (!id) return;
      const th = headRow?.cells[i];
      if (th?.offsetParent) head[id] = Math.ceil(labelWidth(th)) + 2;
      if (!ready || col.dataset.flex !== undefined) return;
      let w = 0;
      for (const row of Array.from(table.tBodies[0]?.rows ?? [])) {
        const c = row.cells[i];
        if (c && c.colSpan === 1 && c.offsetParent) w = Math.max(w, c.getBoundingClientRect().width);
      }
      if (w > 0) fit[id] = Math.min(AUTO_MAX, Math.max(MIN_COL, Math.ceil(w) + 2));
    });
    [table.style.tableLayout, table.style.width, table.style.minWidth] = saved;
    cols.forEach((c, i) => (c.style.width = savedCols[i]));
    setFloor(head);
    if (ready) setAuto(fit);
  }, [ready, signature]);
  const shaped = Object.keys(manual).length > 0;
  const persist = (m: Record<string, number>) => {
    setManual(m);
    if (storeKey) localStorage.setItem(`asb.cols.${storeKey}`, JSON.stringify(m));
  };
  // Before the first manual width, every non-flex column keeps the width it is rendered at.
  const snapshot = () => {
    if (shaped) return;
    const headRow = colgroup.current?.closest("table")?.tHead?.rows[0];
    if (!headRow) return;
    const rendered: Record<string, number> = {};
    (Array.from(colgroup.current!.children) as HTMLElement[]).forEach((col, i) => {
      const id = col.dataset.col;
      const th = headRow.cells[i];
      if (id && col.dataset.flex === undefined && th?.offsetParent) rendered[id] = Math.round(th.getBoundingClientRect().width);
    });
    setAuto(rendered);
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
    snapshot();
    let latest = manual;
    const move = (ev: PointerEvent) => {
      latest = { ...manual, [id]: Math.max(floor[id] ?? MIN_COL, Math.round(startW + ev.clientX - startX)) };
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
    snapshot();
    const w = manual[id] ?? th?.getBoundingClientRect().width ?? MIN_COL;
    persist({ ...manual, [id]: Math.max(floor[id] ?? MIN_COL, Math.round(w + by)) });
  };
  const reset = (id: string) => {
    const { [id]: _, ...rest } = manual;
    persist(rest);
  };
  return {
    colgroup,
    floor: (id) => floor[id],
    fit: (id) => auto[id],
    width: (id) => {
      const w = manual[id] ?? auto[id];
      return w === undefined ? undefined : Math.max(w, floor[id] ?? 0);
    },
    isManual: (id) => id in manual,
    shaped,
    startResize,
    nudge,
    reset,
  };
}

/**
 * Props for the grip on a header's right edge: an 8px hit area straddling the edge (styled by
 * `.dt-resize` in index.css: hairline on header hover, live accent while dragged or focused,
 * `col-resize` cursor document-wide during a drag). Drag resizes, ←/→ nudge 16px, double-click
 * resets. Spread onto a <span> inside a `relative` <th>.
 */
export function columnGrip(id: string, label: string, cols: ColumnWidths, className?: string): React.ComponentProps<"span"> {
  const width = cols.width(id);
  return {
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": `Resize ${label}`,
    "aria-valuenow": width === undefined ? undefined : Math.round(width),
    "aria-valuemin": cols.floor(id) ?? MIN_COL,
    tabIndex: 0,
    title: "Drag to resize · double-click to fit",
    onPointerDown: (e) => cols.startResize(id, e),
    onDoubleClick: () => cols.reset(id),
    onClick: (e) => e.stopPropagation(),
    onKeyDown: (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      cols.nudge(id, e.currentTarget.closest("th"), e.key === "ArrowRight" ? 16 : -16);
    },
    className: `dt-resize absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-none${className ? ` ${className}` : ""}`,
  };
}
