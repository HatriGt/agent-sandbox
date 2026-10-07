import * as React from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { cn } from "@/lib/utils";

/**
 * A settings page's index: one line per `<section aria-labelledby>` inside the scrolling container,
 * the current one marked by a pill that glides as you scroll (IntersectionObserver, no scroll
 * handlers). Clicking scrolls the section into view. Sections are discovered from the DOM after
 * mount, so a page that shows sections conditionally (admin only, saas only) needs no wiring.
 */
export function SectionNav({ scrollRef, className }: { scrollRef: React.RefObject<HTMLElement | null>; className?: string }) {
  const reduce = useReducedMotion();
  const [items, setItems] = React.useState<{ id: string; label: string }[]>([]);
  const [active, setActive] = React.useState<string | null>(null);

  React.useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const collect = () => {
      const found: { id: string; label: string }[] = [];
      root.querySelectorAll<HTMLElement>("section[aria-labelledby]").forEach((sec) => {
        const h = document.getElementById(sec.getAttribute("aria-labelledby") ?? "");
        const label = h?.firstChild?.textContent?.trim() || h?.textContent?.trim();
        if (sec.id === "" && h) sec.id = `sec-${h.id}`;
        if (label && sec.id) found.push({ id: sec.id, label });
      });
      setItems((prev) => (prev.length === found.length && prev.every((p, i) => p.id === found[i].id) ? prev : found));
    };
    collect();
    // Sections mount as their data arrives; watch for them.
    const mo = new MutationObserver(collect);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [scrollRef]);

  React.useEffect(() => {
    const root = scrollRef.current;
    if (!root || !items.length) return;
    const ratios = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set((e.target as HTMLElement).id, e.isIntersecting ? e.intersectionRatio : 0);
        let best: string | null = null;
        let bestRatio = 0;
        for (const it of items) {
          const r = ratios.get(it.id) ?? 0;
          if (r > bestRatio) {
            best = it.id;
            bestRatio = r;
          }
        }
        if (best) setActive(best);
      },
      { root, rootMargin: "-10% 0px -55% 0px", threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }
    );
    for (const it of items) {
      const el = document.getElementById(it.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [items, scrollRef]);

  if (items.length < 3) return null;
  return (
    <nav aria-label="On this page" className={cn("flex flex-col gap-0.5", className)}>
      {items.map((it) => {
        const on = it.id === active;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => document.getElementById(it.id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })}
            aria-current={on ? "location" : undefined}
            className={cn(
              "relative isolate cursor-pointer rounded-md px-2.5 py-1.5 text-left text-meta transition-colors duration-150",
              on ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {on && (
              <motion.span
                layoutId="section-nav-pill"
                className="bg-accent absolute inset-0 -z-10 rounded-md"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 40, mass: 0.8 }}
                aria-hidden
              >
                <span className="bg-live absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full" />
              </motion.span>
            )}
            {it.label}
          </button>
        );
      })}
    </nav>
  );
}
