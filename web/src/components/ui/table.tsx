import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Table primitive, adapted from HextaUI's table (MIT, https://hextaui.com/docs/table) and tuned to
 * Orbit / sales-crm density (see DESIGN.md → Inspiration → Tables). Density and colours live in CSS
 * variables on the frame, so `size` and `variant` restyle every cell without per-cell classes.
 * The scroll container marks `data-scrolled-*` so the head gains a hairline once you scroll and the
 * sides fade when there is more to the left/right.
 */

function useScrollEdges(el: HTMLDivElement | null) {
  React.useLayoutEffect(() => {
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.toggleAttribute("data-scrolled-start", el.scrollLeft > 0.5);
      el.toggleAttribute("data-scrolled-end", el.scrollLeft < max - 0.5);
      el.toggleAttribute("data-scrolled-top", el.scrollTop > 0.5);
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
  }, [el]);
}

/* Orbit's measures: 38px rows / 30px head, hairlines at ~6% ink, hover a 2.5–3% ink wash on 120ms.
   `plain` is Orbit's frameless list under a top hairline; `surface` is the bordered card (DataTable's
   default): rounded-xl hairline, card fill, shadow-xs, head row tinted like bg-muted/40 (mixed opaque
   so a sticky head still covers the rows under it). */
const tableVariants = cva(
  "group/table relative w-full min-w-0 [--table-bg:transparent] [--table-hover:color-mix(in_oklab,var(--foreground)_3%,transparent)] [--table-line:color-mix(in_oklab,var(--foreground)_7%,transparent)]",
  {
    variants: {
      variant: {
        plain: "border-t border-(--table-line) [--table-head-bg:var(--background)]",
        surface:
          "isolate overflow-hidden rounded-xl border bg-card shadow-xs [--table-bg:var(--card)] [--table-head-bg:color-mix(in_oklab,var(--muted)_40%,var(--card))]",
      },
      size: {
        sm: "[--table-cell-px:--spacing(2)] [--table-cell-py:--spacing(1.5)] [--table-head-h:--spacing(7.5)] [--table-row-h:34px]",
        default: "[--table-cell-px:--spacing(2.5)] [--table-cell-py:--spacing(2)] [--table-head-h:--spacing(7.5)] [--table-row-h:38px]",
      },
    },
    defaultVariants: { variant: "plain", size: "default" },
  }
);

export type TableProps = React.ComponentProps<"table"> &
  VariantProps<typeof tableVariants> & {
    stickyHeader?: boolean;
    containerClassName?: string;
  };

function Table({ className, variant, size, stickyHeader, containerClassName, ...props }: TableProps) {
  const [el, setEl] = React.useState<HTMLDivElement | null>(null);
  useScrollEdges(el);
  return (
    <div data-slot="table-frame" data-variant={variant ?? "plain"} className={tableVariants({ variant, size })}>
      <div
        ref={setEl}
        data-slot="table-container"
        data-sticky-header={stickyHeader ? "" : undefined}
        className={cn(
          "relative w-full overflow-x-auto overscroll-x-none rounded-[inherit] [--fade-end:0px] [--fade-start:0px] data-sticky-header:overflow-y-auto",
          "mask-[linear-gradient(to_right,transparent,#000_var(--fade-start),#000_calc(100%-var(--fade-end)),transparent)] data-scrolled-end:[--fade-end:--spacing(8)] data-scrolled-start:[--fade-start:--spacing(8)]",
          containerClassName
        )}
      >
        <table data-slot="table" className={cn("w-full border-separate border-spacing-0 text-meta", className)} {...props} />
      </div>
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:hover:bg-transparent", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("[&>tr:last-child>*]:border-b-0", className)} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "group/row relative bg-(--table-bg) transition-[background-color] duration-[120ms] hover:bg-(--table-hover) data-[state=selected]:bg-muted",
        "data-clickable:cursor-pointer data-clickable:outline-none data-clickable:focus-visible:bg-(--table-hover) data-clickable:active:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]",
        className
      )}
      {...props}
    />
  );
}

type Align = "start" | "center" | "end";

const cellBase =
  "border-b border-(--table-line) align-middle whitespace-nowrap data-[align=center]:text-center data-[align=end]:text-end data-[align=end]:tabular-nums first:ps-4 last:pe-4";

function TableHead({ className, align, ...props }: Omit<React.ComponentProps<"th">, "align"> & { align?: Align }) {
  return (
    <th
      data-slot="table-head"
      data-align={align}
      scope="col"
      className={cn(
        cellBase,
        "text-faint h-(--table-head-h) bg-(--table-head-bg,var(--table-bg)) px-(--table-cell-px) text-start text-[11px] font-medium tracking-[0.05em] uppercase",
        "in-data-scrolled-top:shadow-[inset_0_-1px_0_var(--border)] in-data-sticky-header:sticky in-data-sticky-header:top-0 in-data-sticky-header:z-2",
        className
      )}
      {...props}
    />
  );
}

function TableCell({ className, align, ...props }: Omit<React.ComponentProps<"td">, "align"> & { align?: Align }) {
  return <td data-slot="table-cell" data-align={align} className={cn(cellBase, "text-muted-foreground h-(--table-row-h) px-(--table-cell-px) py-(--table-cell-py)", className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, tableVariants };
