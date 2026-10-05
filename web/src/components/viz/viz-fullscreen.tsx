import * as React from "react";
import { Minus, Plus, Scan } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/**
 * True inside a VizFrame's fullscreen dialog. Renderers that own their zoom (the xyflow graph)
 * read it to switch to their interactive mode; everything else is wrapped in `ZoomPane`.
 */
export const VizFullscreenContext = React.createContext(false);

const MIN = 0.25;
const MAX = 4;
const STEP = 1.25;

type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

/**
 * The fullscreen card: ~96vw × 92vh dialog, the block re-rendered inside. Generic blocks get a
 * CSS transform pan/zoom (0.25–4×, buttons, `+` `-` `0`, Ctrl/⌘ + wheel, drag to pan); blocks
 * with `ownsZoom` draw their own interactive canvas and only get the space.
 */
export function VizFullscreen({
  open,
  onOpenChange,
  title,
  ownsZoom,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  ownsZoom?: boolean;
  children: React.ReactNode;
}) {
  const [view, setView] = React.useState<View>(FIT);
  React.useEffect(() => {
    if (open) setView(FIT);
  }, [open]);
  const zoomBy = React.useCallback((f: number) => setView((v) => ({ ...v, scale: Math.min(MAX, Math.max(MIN, v.scale * f)) })), []);
  const btn = "text-muted-foreground hover:text-foreground hover:bg-muted grid size-8 cursor-pointer place-items-center rounded-md transition-colors disabled:cursor-default disabled:opacity-40";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        className="h-[92dvh] max-h-[92dvh] w-[96vw] max-w-none sm:w-[96vw]"
        bodyClassName="flex overflow-hidden px-3 pb-3"
        data-viz-fullscreen
        onKeyDown={(e) => {
          if (ownsZoom || e.metaKey || e.ctrlKey || e.altKey) return;
          if (e.key === "+" || e.key === "=") zoomBy(STEP);
          else if (e.key === "-" || e.key === "_") zoomBy(1 / STEP);
          else if (e.key === "0") setView(FIT);
          else return;
          e.preventDefault();
        }}
        actions={
          ownsZoom ? undefined : (
            <div className="flex items-center gap-0.5" role="group" aria-label="Zoom">
              <button type="button" className={btn} onClick={() => zoomBy(1 / STEP)} disabled={view.scale <= MIN} aria-label="Zoom out">
                <Minus className="size-4" />
              </button>
              <span className="text-muted-foreground w-12 text-center text-micro tabular-nums" aria-live="polite" data-viz-zoom>
                {Math.round(view.scale * 100)}%
              </span>
              <button type="button" className={btn} onClick={() => zoomBy(STEP)} disabled={view.scale >= MAX} aria-label="Zoom in">
                <Plus className="size-4" />
              </button>
              <button type="button" className={btn} onClick={() => setView(FIT)} aria-label="Reset zoom">
                <Scan className="size-4" />
              </button>
            </div>
          )
        }
      >
        <VizFullscreenContext.Provider value>
          {ownsZoom ? (
            <div className="bg-card min-h-0 flex-1 overflow-hidden rounded-xl border">{children}</div>
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
  const drag = React.useRef<{ id: number; x: number; y: number } | null>(null);
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
  return (
    <div
      ref={ref}
      className="bg-card relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden rounded-xl border select-none active:cursor-grabbing"
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("button,a,input,[role=button]")) return;
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        d.x = e.clientX;
        d.y = e.clientY;
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <div className="absolute inset-0 grid place-items-center overflow-visible p-6">
        <div
          className="w-full max-w-[min(100%,72rem)] origin-center"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
