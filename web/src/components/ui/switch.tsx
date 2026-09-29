import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
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
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "focus-visible:ring-live/40 inline-flex shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "bg-live border-live justify-end" : "bg-muted border-border justify-start",
        dims.track,
        className
      )}
      {...props}
    >
      <motion.span
        layout={!still}
        transition={still ? { duration: 0 } : { type: "spring", stiffness: 700, damping: 40 }}
        className={cn("block rounded-full bg-white shadow-e1", dims.knob)}
        aria-hidden
      />
    </button>
  );
}
