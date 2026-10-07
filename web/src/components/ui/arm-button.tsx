import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The two-click destructive action. First click ARMS: the button flips to the filled `destructive`
 * variant, its label swaps to `armedLabel` and a hairline underline drains over `autoDisarmMs` —
 * the visible fuse — after which it quietly disarms. Blur or Escape disarms too. The second click
 * calls `onConfirm` and shows Button's spinner while the promise is pending. Label swaps use
 * `layout` + popLayout so the row never jumps; reduced motion skips the slide and the drain.
 */
export function ArmButton({
  onConfirm,
  label,
  armedLabel = "Confirm?",
  variant = "danger",
  size = "xs",
  icon,
  disabled,
  busy,
  className,
  autoDisarmMs = 3000,
}: {
  onConfirm: () => void | Promise<void>;
  label: React.ReactNode;
  armedLabel?: React.ReactNode;
  variant?: "danger" | "ghost" | "outline";
  size?: "xs" | "sm" | "icon-xs" | "icon-sm";
  icon?: React.ReactNode;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  autoDisarmMs?: number;
}) {
  const still = useReducedMotion();
  const [armed, setArmed] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const loading = busy || pending;
  const iconOnly = size === "icon-xs" || size === "icon-sm";

  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), autoDisarmMs);
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setArmed(false);
    document.addEventListener("keydown", onEsc);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onEsc);
    };
  }, [armed, autoDisarmMs]);

  // The component may unmount as a result of onConfirm (a deleted row); guard the trailing setState.
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const click = async () => {
    if (loading) return;
    if (!armed) return setArmed(true);
    setArmed(false);
    try {
      const r = onConfirm();
      if (r && typeof (r as Promise<void>).then === "function") {
        setPending(true);
        await r;
      }
    } finally {
      if (alive.current) setPending(false);
    }
  };

  const text = armed ? armedLabel : label;
  return (
    <Button
      type="button"
      size={armed && iconOnly ? (size === "icon-xs" ? "xs" : "sm") : size}
      variant={armed ? "destructive" : variant}
      loading={loading}
      disabled={disabled}
      onClick={() => void click()}
      onBlur={() => setArmed(false)}
      aria-label={iconOnly && typeof label === "string" ? label : undefined}
      data-armed={armed || undefined}
      // Armed wins over any caller colour (a ghost's `text-muted-foreground` must not grey out the fill).
      className={cn("relative overflow-hidden", className, armed && "text-white opacity-100")}
    >
      {/* Button's `loading` swaps the FIRST component child for its spinner — keep an inert slot here
          when there is no icon, so the label is never the one that gets swapped out. */}
      {icon ?? <span hidden aria-hidden />}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={armed ? "armed" : "idle"}
          layout
          initial={still ? { opacity: 0 } : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={still ? { opacity: 0 } : { opacity: 0, y: -5 }}
          transition={{ duration: still ? 0.1 : 0.16, ease: [0.22, 1, 0.36, 1] }}
          className={cn("inline-block whitespace-nowrap", iconOnly && !armed && "sr-only")}
        >
          {text}
        </motion.span>
      </AnimatePresence>
      {/* The fuse: drains left→right over autoDisarmMs while armed. */}
      <AnimatePresence>
        {armed && !loading && (
          <motion.span
            key="fuse"
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left bg-white/70"
            initial={{ scaleX: 1, opacity: 1 }}
            animate={still ? { scaleX: 1 } : { scaleX: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: autoDisarmMs / 1000, ease: "linear" }}
          />
        )}
      </AnimatePresence>
    </Button>
  );
}
