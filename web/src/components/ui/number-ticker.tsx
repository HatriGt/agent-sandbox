import * as React from "react";
import { useInView, useMotionValue, useSpring } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { cn } from "@/lib/utils";

/**
 * A number that counts up with a spring the first time it scrolls into view, and springs again
 * from its previous value when it changes. Always tabular so neighbouring text never jitters.
 * Reduced motion → the final value, immediately. `format` renders the (rounded) value — e.g. a
 * duration formatter — so the DOM text is always a real, readable number, never a half-step.
 */
export function NumberTicker({
  value,
  format = (n) => n.toLocaleString(),
  className,
  from = 0,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  /** Where the first count starts. */
  from?: number;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const mv = useMotionValue(reduce ? value : from);
  const spring = useSpring(mv, { stiffness: 140, damping: 26, mass: 0.8 });
  const fmt = React.useRef(format);
  fmt.current = format;

  React.useEffect(() => {
    if (reduce) {
      mv.jump(value);
      spring.jump(value);
      if (ref.current) ref.current.textContent = fmt.current(value);
      return;
    }
    if (inView) mv.set(value);
  }, [inView, value, reduce, mv, spring]);

  React.useEffect(
    () =>
      spring.on("change", (v) => {
        if (ref.current) ref.current.textContent = fmt.current(Math.round(v));
      }),
    [spring]
  );

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {format(reduce ? value : from)}
    </span>
  );
}
