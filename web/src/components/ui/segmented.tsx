import * as React from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { cn } from "@/lib/utils";

/**
 * A segmented control for a VALUE (role, plan, filter) — `AnimatedTabs` is for switching views.
 * Radio semantics: one `radiogroup`, arrow keys move the selection, the pill glides. `busy` shows the
 * option being saved at half opacity so an optimistic flip never looks final before the server says so.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "sm",
  disabled,
  busy,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode; disabled?: boolean; title?: string }[];
  ariaLabel: string;
  size?: "xs" | "sm";
  disabled?: boolean;
  busy?: T | null;
  className?: string;
}) {
  const still = useReducedMotion();
  const id = React.useId();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, step: number) => {
    const n = options.length;
    for (let i = 1; i <= n; i++) {
      const j = (from + step * i + n * n) % n;
      if (!options[j].disabled) {
        onChange(options[j].value);
        refs.current[j]?.focus();
        return;
      }
    }
  };
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("bg-muted inline-flex items-center gap-0.5 rounded-md p-0.5", size === "xs" ? "h-6" : "h-7", disabled && "opacity-50", className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled || o.disabled}
            title={o.title}
            onClick={() => !on && onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") move(i, 1);
              else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(i, -1);
              else return;
              e.preventDefault();
            }}
            className={cn(
              "relative isolate flex h-full cursor-pointer items-center gap-1 rounded px-2 text-micro font-medium whitespace-nowrap outline-none transition-[color,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              busy === o.value && "opacity-60"
            )}
          >
            {on && <motion.span layoutId={`${id}-pill`} className="bg-card shadow-e1 absolute inset-0 -z-10 rounded" transition={still ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42, mass: 0.7 }} aria-hidden />}
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
