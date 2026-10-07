import * as React from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { cn } from "@/lib/utils";

/**
 * A toggle. The knob springs across (layout, not `left`), the track tints to --live when on, and the
 * focus ring is the console's. `size="sm"` for dense rows. Replaces the hand-rolled switches that
 * each animated differently.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  size = "md",
  className,
  ...props
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
} & Omit<React.ComponentProps<"button">, "onChange" | "onClick" | "type" | "role" | "aria-checked">) {
  const still = useReducedMotion();
  const dims = size === "sm" ? { track: "h-4 w-7 p-0.5", knob: "size-3" } : { track: "h-5 w-9 p-0.5", knob: "size-4" };
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      whileTap={disabled || still ? undefined : "press"}
      className={cn(
        "focus-visible:ring-live/40 no-press inline-flex shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "bg-live border-live justify-end" : "bg-muted border-border justify-start",
        dims.track,
        className
      )}
      {...(props as React.ComponentProps<typeof motion.button>)}
    >
      {/* The knob stretches toward the side it will travel to while held (iOS), then springs across. */}
      <motion.span
        layout={!still}
        variants={{ press: { scaleX: 1.25 } }}
        style={{ originX: checked ? 1 : 0 }}
        transition={still ? { duration: 0 } : { type: "spring", stiffness: 700, damping: 40 }}
        className={cn("block rounded-full bg-white shadow-e1", dims.knob)}
        aria-hidden
      />
    </motion.button>
  );
}
