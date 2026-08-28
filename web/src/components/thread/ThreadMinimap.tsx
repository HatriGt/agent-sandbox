import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * A minimap for the conversation: a small stack of bars sitting in the vertical middle of the
 * thread, one bar per turn you sent (task, follow-ups, answers). The bar for the turn currently in
 * view is long and solid; hover any bar for a card with your message and how the agent began its
 * reply; click to jump there. Desktop only — on a phone the thread is the map.
 */
export interface Turn {
  id: string;
  label: string;
  you: string;
  reply?: string;
}

export function ThreadMinimap({ turns, scrollerRef }: { turns: Turn[]; scrollerRef: React.RefObject<HTMLElement | null> }) {
  const [active, setActive] = React.useState(0);
  const [hover, setHover] = React.useState<number | null>(null);

  const measure = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const y = el.scrollTop + el.clientHeight * 0.4;
    let idx = 0;
    turns.forEach((t, i) => {
      const node = el.querySelector<HTMLElement>(`[data-turn="${t.id}"]`);
      if (node && node.offsetTop <= y) idx = i;
    });
    // At the very bottom the last turn is the one you are reading, whatever its offset.
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) idx = turns.length - 1;
    setActive(idx);
  }, [turns, scrollerRef]);

  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure, scrollerRef]);

  if (turns.length < 2) return null;

  const jump = (id: string) => {
    scrollerRef.current?.querySelector<HTMLElement>(`[data-turn="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav aria-label="Conversation map" className="group/map absolute top-1/2 left-0 z-10 hidden w-12 -translate-y-1/2 min-[1120px]:block" onMouseLeave={() => setHover(null)}>
      {/* A faint rail appears when the pointer is near, so the ticks read as one control. */}
      <span className="bg-border/80 absolute top-0 bottom-0 left-[13px] w-px opacity-0 transition-opacity duration-200 group-hover/map:opacity-100" aria-hidden />
      <ol className="flex flex-col gap-[7px] py-2 pl-2">
        {turns.map((t, i) => {
          const on = i === active;
          return (
            <li key={t.id} className="relative flex h-[7px] items-center">
              <button
                type="button"
                onClick={() => jump(t.id)}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`Jump to ${t.label}: ${t.you.slice(0, 60)}`}
                aria-current={on ? "true" : undefined}
                className="group no-press -my-1 flex h-4 w-10 cursor-pointer items-center"
              >
                <span
                  className={cn(
                    "block h-[3px] rounded-full transition-[width,background-color] duration-200",
                    on ? "bg-foreground w-7" : hover === i ? "bg-foreground/60 w-6" : "bg-muted-foreground/40 w-3.5 group-hover:bg-foreground/60"
                  )}
                />
              </button>
              <AnimatePresence>
                {hover === i && (
                  <motion.div
                    initial={{ opacity: 0, x: -6, scale: 0.98 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -6, scale: 0.98 }}
                    transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                    className="bg-popover text-popover-foreground pointer-events-none absolute top-1/2 left-full z-20 w-80 -translate-y-1/2 rounded-xl border p-3.5 shadow-e3"
                  >
                    <p className="label text-muted-foreground mb-1">
                      {t.label} · {i + 1}/{turns.length}
                    </p>
                    <p className="text-foreground line-clamp-2 text-meta font-medium">{t.you}</p>
                    {t.reply && <p className="text-muted-foreground mt-1.5 line-clamp-3 text-micro leading-relaxed">{t.reply}</p>}
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
