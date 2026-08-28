import * as React from "react";
import { createPortal } from "react-dom";
import { Download, Maximize2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * An in-page image viewer: dimmed backdrop, the picture centred and fitted, a small toolbar with
 * zoom out / percentage / zoom in / fit / download / close. Scroll or pinch to zoom around the cursor,
 * drag to pan when zoomed, double-click to toggle fit ↔ 100%, Esc or backdrop click to leave.
 * Rendered in a portal so it floats over side panes; the trigger element stays where it was.
 */
export function Lightbox({ src, name, open, onClose }: { src: string | null; name: string; open: boolean; onClose: () => void }) {
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [fit, setFit] = React.useState(1); // scale at which the image fits the viewport
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  const drag = React.useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);

  const reset = React.useCallback(
    (nat = natural) => {
      const st = stageRef.current;
      if (!st || !nat) return;
      const pad = 96;
      const f = Math.min(1, (st.clientWidth - pad) / nat.w, (st.clientHeight - pad) / nat.h);
      setFit(f);
      setScale(f);
      setOffset({ x: 0, y: 0 });
    },
    [natural]
  );

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoom(1.25);
      else if (e.key === "-") zoom(0.8);
      else if (e.key === "0") reset();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);

  const zoom = (factor: number, at?: { x: number; y: number }) => {
    setScale((s) => {
      const next = Math.min(8, Math.max(fit * 0.5, s * factor));
      if (at) {
        // Keep the point under the cursor fixed while zooming.
        const k = next / s;
        setOffset((o) => ({ x: at.x - (at.x - o.x) * k, y: at.y - (at.y - o.y) * k }));
      }
      return next;
    });
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const st = stageRef.current!.getBoundingClientRect();
    const at = { x: e.clientX - st.left - st.width / 2, y: e.clientY - st.top - st.height / 2 };
    zoom(e.deltaY < 0 ? 1.12 : 0.89, at);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (scale <= fit + 0.001) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setOffset({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) });
  };
  const onPointerUp = () => (drag.current = null);

  const pct = Math.round(scale * 100);
  const zoomed = scale > fit + 0.001;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[100] flex flex-col bg-black/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Image ${name}`}
          onClick={onClose}
        >
          {/* Toolbar */}
          <div className="flex h-12 shrink-0 items-center gap-2 px-4 text-white/80" onClick={(e) => e.stopPropagation()}>
            <p className="min-w-0 flex-1 truncate font-mono text-meta">
              {name}
              {natural && (
                <span className="ml-2 text-white/50">
                  {natural.w}×{natural.h}
                </span>
              )}
            </p>
            <div className="flex items-center gap-0.5 rounded-md bg-white/10 p-0.5">
              <Tool label="Zoom out (−)" onClick={() => zoom(0.8)}>
                <Minus className="size-4" />
              </Tool>
              <button type="button" onClick={() => (zoomed ? reset() : setScale(1))} className="w-14 cursor-pointer rounded-md text-center text-meta tabular-nums hover:bg-white/10" title={zoomed ? "Fit to screen" : "Actual size"}>
                {pct}%
              </button>
              <Tool label="Zoom in (+)" onClick={() => zoom(1.25)}>
                <Plus className="size-4" />
              </Tool>
            </div>
            <Tool label="Fit to screen (0)" onClick={() => reset()}>
              {zoomed ? <Maximize2 className="size-4" /> : <RotateCcw className="size-4" />}
            </Tool>
            {src && (
              <a href={src} download={name} className="grid size-8 place-items-center rounded-md hover:bg-white/10" aria-label="Download" title="Download">
                <Download className="size-4" />
              </a>
            )}
            <Tool label="Close (Esc)" onClick={onClose}>
              <X className="size-4" />
            </Tool>
          </div>

          {/* Stage */}
          <div
            ref={stageRef}
            className={cn("relative min-h-0 flex-1 touch-none overflow-hidden select-none", zoomed ? (drag.current ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in")}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={(e) => {
              e.stopPropagation();
              zoomed ? reset() : setScale(Math.max(1, fit * 2));
            }}
          >
            {src ? (
              <motion.img
                key={src}
                src={src}
                alt={name}
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  const nat = { w: img.naturalWidth, h: img.naturalHeight };
                  setNatural(nat);
                  reset(nat);
                }}
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="absolute top-1/2 left-1/2 max-w-none rounded-md shadow-e5"
                style={{
                  width: natural ? natural.w : undefined,
                  height: natural ? natural.h : undefined,
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                  transition: drag.current ? "none" : "transform 120ms ease-out",
                }}
              />
            ) : (
              <div className="absolute top-1/2 left-1/2 size-16 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-xl bg-white/10" />
            )}
          </div>
          <p className="shrink-0 pb-3 text-center text-micro text-white/40" onClick={(e) => e.stopPropagation()}>
            Scroll to zoom · drag to pan · double-click to toggle · Esc to close
          </p>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function Tool({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="grid size-8 cursor-pointer place-items-center rounded-md hover:bg-white/10">
      {children}
    </button>
  );
}
