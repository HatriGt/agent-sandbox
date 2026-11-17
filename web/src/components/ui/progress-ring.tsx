import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { cn } from "@/lib/utils";

/**
 * One ratio against a hard limit, drawn as a ring: the stroke springs to its new length when the
 * value changes, so a slot filling or an allowance draining is a motion, not a repaint. A Meter,
 * like `UsageMeter`, never a chart — it is always placed beside the number it stands for, and the
 * tone is the machine's own (live, ok, warn, destructive), never decoration.
 *
 * The track is a recessive step of the same ink; the arc starts at twelve o'clock and runs
 * clockwise. Under reduced motion the arc is set without a spring.
 */
export function ProgressRing({
  value,
  size = 18,
  stroke = 2.25,
  tone = "live",
  className,
  label,
}: {
  /** 0..1; clamped. */
  value: number;
  size?: number;
  stroke?: number;
  tone?: "live" | "ok" | "warn" | "destructive" | "sleep" | "foreground";
  className?: string;
  /** Spoken value, e.g. "72% of the allowance used". Omit when the number beside it is the label. */
  label?: string;
}) {
  const reduce = useReducedMotion();
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = size / 2;
  const toneClass = {
    live: "text-live",
    ok: "text-ok",
    warn: "text-warn",
    destructive: "text-destructive",
    sleep: "text-sleep",
    foreground: "text-foreground/70",
  }[tone];
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0 -rotate-90", toneClass, className)}
      role={label ? "meter" : undefined}
      aria-label={label}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      aria-valuenow={label ? Math.round(v * 100) : undefined}
      aria-hidden={label ? undefined : true}
    >
      <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="opacity-15" />
      <motion.circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: v }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 110, damping: 20, mass: 0.8 }}
      />
    </svg>
  );
}
