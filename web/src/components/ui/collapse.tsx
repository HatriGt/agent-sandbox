import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * The one expand/collapse. Height animates from 0 to auto with a short fade, so a disclosure never
 * snaps open and shoves the page; reduced motion swaps to a plain fade. `unmount` (default) removes
 * the children when closed; pass `unmount={false}` to keep state (an editor, a scrolled list) alive.
 */
export function Collapse({
  open,
  children,
  className,
  unmount = true,
  duration = 0.22,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
  unmount?: boolean;
  duration?: number;
}) {
  const still = useReducedMotion();
  const variants = { closed: { opacity: 0, height: 0 }, open: { opacity: 1, height: "auto" } };
  const transition = { duration: still ? 0.12 : duration, ease: [0.22, 1, 0.36, 1] as const };
  if (!unmount) {
    return (
      <motion.div
        initial={false}
        animate={open ? "open" : "closed"}
        variants={variants}
        transition={transition}
        className={cn("overflow-hidden", className)}
        aria-hidden={!open}
        style={{ pointerEvents: open ? undefined : "none" }}
      >
        {children}
      </motion.div>
    );
  }
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div initial="closed" animate="open" exit="closed" variants={variants} transition={transition} className={cn("overflow-hidden", className)}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
