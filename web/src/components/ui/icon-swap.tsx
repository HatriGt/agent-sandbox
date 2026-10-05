import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Crossfade between two (or more) icons that share one slot — Sun↔Moon, Bell↔BellOff, Copy↔Check,
 * Loader↔ArrowUp. The outgoing glyph shrinks and blurs out while the incoming one grows in, both
 * in the same 160 ms so nothing ever reads as "two icons". Popped layout keeps the slot's size.
 *
 * Give each state a distinct `state` key; `rotate` adds a quarter-turn (theme toggles, chevrons).
 * Under reduced motion `MotionConfig reducedMotion="user"` drops the transform; the fade stays.
 */
export function IconSwap({
  state,
  children,
  className,
  rotate = false,
}: {
  state: string | number | boolean;
  children: React.ReactNode;
  className?: string;
  rotate?: boolean;
}) {
  return (
    <span className={cn("relative inline-grid place-items-center [&>*]:col-start-1 [&>*]:row-start-1", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={String(state)}
          initial={{ opacity: 0, scale: 0.6, rotate: rotate ? -90 : 0, filter: "blur(2px)" }}
          animate={{ opacity: 1, scale: 1, rotate: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.6, rotate: rotate ? 90 : 0, filter: "blur(2px)" }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="inline-grid place-items-center"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
