import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * A minimap for the conversation: one tick per turn you sent (task, follow-ups, answers), laid out
 * along a slim rail in proportion to where each turn sits in the scrollable thread. Hover a tick for
 * a preview card (your message, then how the agent began its reply); click to jump there. The tick
 * for the turn currently in view is emphasised. Desktop only — on a phone the thread is the map.
 */
export interface Turn {
  id: string;
  label: string;
  you: string;
  reply?: string;
}

export function ThreadMinimap({ turns, scrollerRef }: { turns: Turn[]; scrollerRef: React.RefObject<HTMLElement | null> }) {
  const [positions, setPositions] = React.useState<number[]>([]);
  const [active, setActive] = React.useState(0);
  const [hover, setHover] = React.useState<number | null>(null);

  const measure = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const total = Math.max(1, el.scrollHeight - el.clientHeight);
    const tops = turns.map((t) => {
      const node = el.querySelector<HTMLElement>(`[data-turn="${t.id}"]`);
      return node ? node.offsetTop : 0;
    });
    setPositions(tops.map((top) => Math.min(1, top / Math.max(1, el.scrollHeight))));
    const y = el.scrollTop + el.clientHeight * 0.35;
    let idx = 0;
    tops.forEach((top, i) => {
      if (top <= y) idx = i;
    });
    setActive(idx);
    void total;
  }, [turns, scrollerRef]);

  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure, scrollerRef]);

  if (turns.length < 2) return null;

  const jump = (id: string) => {
    const el = scrollerRef.current;
    const node = el?.querySelector<HTMLElement>(`[data-turn="${id}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="absolute top-0 bottom-0 left-2 z-10 hidden w-8 lg:block" aria-label="Conversation map">
      <div className="relative h-full py-6">
        {turns.map((t, i) => (
          <button
            key={t.id}
            type="button"
            onClick={() => jump(t.id)}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={`Jump to: ${t.label}`}
            className="group absolute left-0 flex h-4 w-8 cursor-pointer items-center"
            style={{ top: `calc(${(positions[i] ?? 0) * 100}% - 0.5rem)` }}
          >
            <span
              className={cn(
                "block h-0.5 rounded-full transition-all duration-200",
                i === active ? "bg-foreground w-6" : "bg-muted-foreground/45 w-3.5 group-hover:w-5 group-hover:bg-foreground/70"
              )}
            />
          </button>
        ))}
        <AnimatePresence>
          {hover !== null && turns[hover] && (
            <motion.div
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.14 }}
              className="bg-popover text-popover-foreground pointer-events-none absolute left-10 z-20 w-72 rounded-xl border p-3.5 shadow-[0_1px_2px_oklch(0_0_0/0.06),0_16px_40px_-16px_oklch(0_0_0/0.4)]"
              style={{ top: `calc(${(positions[hover] ?? 0) * 100}% - 0.75rem)` }}
            >
              <p className="text-foreground line-clamp-2 text-meta font-medium">{turns[hover].you}</p>
              {turns[hover].reply && <p className="text-muted-foreground mt-1.5 line-clamp-3 text-micro leading-relaxed">{turns[hover].reply}</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
