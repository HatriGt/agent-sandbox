import * as React from "react";
import { Minus, Plus, Scan } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

/**
 * True inside a VizFrame's fullscreen dialog. Renderers that own their zoom (the xyflow graph)
 * read it to switch to their interactive mode; everything else is wrapped in `ZoomPane`.
 */
export const VizFullscreenContext = React.createContext(false);

/** Told when a frame's fullscreen opens or closes. */
export const VizFullscreenGate = React.createContext<((open: boolean) => void) | null>(null);

/**
 * How a block uses the fullscreen:
 *  · `flow`   — a document (table, json, log, list): fills the dialog's width, top-aligned, its own
 *               scroller runs the dialog's height. No zoom: text is read, not inspected.
 *  · `canvas` — a picture (chart, diagram, flow): centred on a dot grid, pan by drag, zoom by
 *               buttons, `+` `-` `0`, Ctrl/⌘ + wheel. Blocks that `ownsZoom` get the space only.
 */
export type VizFullscreenMode = "flow" | "canvas";

const MIN = 0.25;
const MAX = 4;
const STEP = 1.25;

type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

/**
 * The fullscreen: a 96vw × 92vh sheet with a dense 44px header (the block's title, the zoom group
 * for a canvas, the Esc cap, close) and the block re-rendered beneath it. The sheet IS the frame —
 * no second card inside it — so a table reads as the same table, larger, not as a widget floating
 * in a white field.
 */
export function VizFullscreen({
  open,
  onOpenChange,
  title,
  mode,
  ownsZoom,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  mode: VizFullscreenMode;
  ownsZoom?: boolean;
  children: React.ReactNode;
}) {
  const [view, setView] = React.useState<View>(FIT);
  React.useEffect(() => {
    if (open) setView(FIT);
  }, [open]);
  const zoomBy = React.useCallback((f: number) => setView((v) => ({ ...v, scale: Math.min(MAX, Math.max(MIN, v.scale * f)) })), []);
  const canvas = mode === "canvas";
  const zoomable = canvas && !ownsZoom;
  const btn = "viz-press text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 cursor-pointer place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default disabled:opacity-40";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        dense
        // Opens from 0.98 + fade, no travel; closes softer (back to 0.98). Blocks that own their zoom
        // (the xyflow canvas) fade only: a scale-in makes them fit-view a shrunken box mid-animation.
        className={cn(
          "h-[92dvh] max-h-[92dvh] w-[96vw] max-w-none sm:w-[96vw] data-[state=open]:slide-in-from-bottom-0",
          ownsZoom ? "data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100" : "data-[state=open]:zoom-in-98 data-[state=closed]:zoom-out-98"
        )}
        bodyClassName="flex flex-col overflow-hidden p-0"
        // Chrome repaints a backdrop-filter layer whenever the page under it changes, and the
        // transcript re-renders on every 3s poll, so the blur flickered behind the canvas.
        // Nearly opaque, unblurred scrim: nothing behind a 96vw card is worth seeing anyway.
        overlayClassName="bg-background/90 backdrop-blur-none"
        data-viz-fullscreen
        data-viz-mode={mode}
        // Esc on a chart with a pinned/highlighted value clears that first; the next Esc closes.
        onEscapeKeyDown={(e) => {
          if ((e.target as Element | null)?.closest?.("[data-viz-pinned]")) e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (!zoomable || e.metaKey || e.ctrlKey || e.altKey) return;
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
          if (e.key === "+" || e.key === "=") zoomBy(STEP);
          else if (e.key === "-" || e.key === "_") zoomBy(1 / STEP);
          else if (e.key === "0") setView(FIT);
          else return;
          e.preventDefault();
        }}
        actions={
          <>
            {zoomable && (
              <div className="bg-muted/50 mr-1 flex items-center gap-0.5 rounded-lg border p-0.5" role="group" aria-label="Zoom">
                <button type="button" className={btn} onClick={() => zoomBy(1 / STEP)} disabled={view.scale <= MIN} aria-label="Zoom out" title="Zoom out (−)">
                  <Minus className="size-3.5" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground w-11 cursor-pointer rounded-md text-center text-micro font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  onClick={() => setView(FIT)}
                  aria-live="polite"
                  aria-label="Reset zoom"
                  title="Reset (0)"
                  data-viz-zoom
                >
                  {Math.round(view.scale * 100)}%
                </button>
                <button type="button" className={btn} onClick={() => zoomBy(STEP)} disabled={view.scale >= MAX} aria-label="Zoom in" title="Zoom in (+)">
                  <Plus className="size-3.5" strokeWidth={1.75} />
                </button>
                <button type="button" className={btn} onClick={() => setView(FIT)} aria-label="Fit" title="Fit (0)">
                  <Scan className="size-3.5" strokeWidth={1.75} />
                </button>
              </div>
            )}
            <Kbd className="mr-1 hidden sm:inline-flex" aria-hidden>
              Esc
            </Kbd>
          </>
        }
      >
        <VizFullscreenContext.Provider value>
          {!canvas ? (
            <FlowPane>{children}</FlowPane>
          ) : ownsZoom ? (
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
          ) : (
            <ZoomPane view={view} setView={setView} zoomBy={zoomBy}>
              {children}
            </ZoomPane>
          )}
        </VizFullscreenContext.Provider>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A document in fullscreen: the block's body at the sheet's full width, top-aligned, scrolling in
 * the sheet when it is taller. Blocks whose body is a capped scroller (table, json, log, tree) lift
 * the cap here (`in-data-viz-fullscreen:max-h-(--viz-full)`) so their own scroller — sticky header,
 * sideways scroll — runs the sheet's height instead of a 24rem window inside it.
 */
function FlowPane({ children }: { children: React.ReactNode }) {
  return (
    <div className="viz-swap min-h-0 flex-1 overflow-auto" style={{ "--viz-full": "calc(92dvh - 2.75rem)" } as React.CSSProperties}>
      {children}
    </div>
  );
}

/**
 * A picture in fullscreen: centred on a dot grid (the ground says "this pans"), 0.25–4× by
 * transform. The block keeps a reading width (64rem) at 100% so a three-bar chart does not become
 * three slabs; zoom is for detail, not for filling the screen.
 */
function ZoomPane({
  view,
  setView,
  zoomBy,
  children,
}: {
  view: View;
  setView: React.Dispatch<React.SetStateAction<View>>;
  zoomBy: (f: number) => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  // Ctrl/⌘ + wheel zooms; React's wheel listener is passive, so preventDefault needs a native one.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);
  const panned = view.x !== 0 || view.y !== 0 || view.scale !== 1;
  return (
    <div
      ref={ref}
      className="viz-canvas-ground relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
      data-panned={panned || undefined}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("button,a,input,[role=button]")) return;
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        d.x = e.clientX;
        d.y = e.clientY;
        d.moved = true;
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <div className="absolute inset-0 grid place-items-center overflow-visible p-8">
        <div
          className={cn("bg-card w-full max-w-[min(100%,64rem)] origin-center rounded-xl border shadow-e2", !panned && "viz-swap")}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          {children}
        </div>
      </div>
      <p className="text-faint pointer-events-none absolute right-3 bottom-2 text-micro tabular-nums select-none" aria-hidden>
        Drag to pan · Ctrl + wheel to zoom
      </p>
    </div>
  );
}
