import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { cn } from "@/lib/utils";

/**
 * Direction-aware segmented tabs. One pill glides between options (shared layoutId), and the
 * paired <TabPanel> slides content in from the side you moved toward. Roving tabindex + arrow /
 * Home / End keys; reduced motion collapses every slide to an instant swap.
 */
export type TabItem<T extends string> = {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
  title?: string;
};

const SPRING = { type: "spring", stiffness: 520, damping: 42, mass: 0.7 } as const;

export function AnimatedTabs<T extends string>({
  value,
  onChange,
  items,
  ariaLabel,
  size = "sm",
  className,
  idBase,
}: {
  value: T;
  onChange: (v: T) => void;
  items: TabItem<T>[];
  ariaLabel?: string;
  size?: "sm" | "md";
  className?: string;
  /** Pass the same idBase to <TabPanel> to wire aria-controls / aria-labelledby. */
  idBase?: string;
}) {
  const reduce = useReducedMotion();
  const auto = React.useId();
  const base = idBase ?? auto;
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, step: number) => {
    const n = items.length;
    for (let i = 1; i <= n; i++) {
      const j = (from + step * i + n * n) % n;
      if (!items[j].disabled) {
        onChange(items[j].value);
        refs.current[j]?.focus();
        return;
      }
    }
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") move(i, 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(i, -1);
    else if (e.key === "Home") move(-1, 1);
    else if (e.key === "End") move(items.length, -1);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("bg-muted inline-flex items-center gap-0.5 rounded-md p-0.5", size === "sm" ? "h-7" : "h-9", className)}
    >
      {items.map((it, i) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${it.value}`}
            aria-selected={on}
            aria-controls={`${base}-panel`}
            tabIndex={on ? 0 : -1}
            disabled={it.disabled}
            title={it.title}
            onClick={() => onChange(it.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "relative isolate flex cursor-pointer items-center gap-1 rounded font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              size === "sm" ? "h-6 px-2 text-micro" : "h-8 px-3 text-meta",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {on && (
              <motion.span
                layoutId={`${base}-pill`}
                className="bg-card shadow-e1 absolute inset-0 -z-10 rounded"
                transition={reduce ? { duration: 0 } : SPRING}
                aria-hidden
              />
            )}
            {it.icon}
            {it.label}
            {it.badge}
          </button>
        );
      })}
    </div>
  );
}

/** Remembers the previous index so a panel knows which way to slide: +1 forward, -1 back. */
export function useTabDirection<T>(value: T, order: readonly T[]) {
  const idx = order.indexOf(value);
  const prev = React.useRef(idx);
  const dir = React.useRef(0);
  if (prev.current !== idx) {
    dir.current = idx > prev.current ? 1 : -1;
    prev.current = idx;
  }
  return dir.current;
}

/** Content for the active tab; slides in from the direction of travel, the old one out the other way. */
export function TabPanel<T extends string>({
  value,
  order,
  idBase,
  className,
  children,
}: {
  value: T;
  order: readonly T[];
  idBase?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const dir = useTabDirection(value, order);
  const dx = reduce ? 0 : 14;
  return (
    <div className={cn("relative min-h-0 overflow-hidden", className)}>
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.div
          key={value}
          role="tabpanel"
          id={idBase ? `${idBase}-panel` : undefined}
          aria-labelledby={idBase ? `${idBase}-tab-${value}` : undefined}
          custom={dir}
          variants={{
            enter: (d: number) => ({ opacity: 0, x: d * dx }),
            center: { opacity: 1, x: 0 },
            exit: (d: number) => ({ opacity: 0, x: -d * dx }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: reduce ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="h-full"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
