import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { cn } from "@/lib/utils";

/**
 * Crossfade between states — skeleton→content, loading→list, label A→label B. Give each state a
 * distinct `state` key; the old one fades and lifts out while the new one fades in from 4px below.
 * `mode="wait"` (default) keeps heights from stacking; use `layout` on the parent if the size changes.
 */
export function Swap({
  state,
  children,
  className,
  mode = "wait",
  y = 4,
}: {
  state: string | number | boolean;
  children: React.ReactNode;
  className?: string;
  mode?: "wait" | "popLayout" | "sync";
  y?: number;
}) {
  const still = useReducedMotion();
  return (
    <AnimatePresence mode={mode} initial={false}>
      <motion.div
        key={String(state)}
        initial={still ? { opacity: 0 } : { opacity: 0, y }}
        animate={{ opacity: 1, y: 0 }}
        exit={still ? { opacity: 0 } : { opacity: 0, y: -y }}
        transition={{ duration: still ? 0.1 : 0.18, ease: [0.22, 1, 0.36, 1] }}
        className={cn("min-w-0", className)}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Staggered entrance for a list: each child rises in a beat after the previous one (capped, so a
 * 200-row table does not take four seconds). Wrap the ROWS, not the container.
 */
export function StaggerItem({ index, children, className, step = 0.024, cap = 12 }: { index: number; children: React.ReactNode; className?: string; step?: number; cap?: number }) {
  const still = useReducedMotion();
  return (
    <motion.div
      initial={still ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: still ? 0.1 : 0.24, delay: Math.min(index, cap) * step, ease: [0.22, 1, 0.36, 1] }}
      className={cn("min-w-0", className)}
    >
      {children}
    </motion.div>
  );
}
