import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Copy → Check with the icon swapping in place and the label kept to a fixed width. */
export function CopyButton({ copied, onClick, size = "sm", className, ...props }: { copied: boolean; onClick: () => void; size?: "sm" | "xs" | "icon" | "icon-sm" } & Omit<React.ComponentProps<typeof Button>, "onClick" | "size" | "children">) {
  const still = useReducedMotion();
  const iconOnly = size === "icon" || size === "icon-sm";
  return (
    <Button size={size} variant="outline" onClick={onClick} className={cn(!iconOnly && "min-w-[5.25rem]", className)} aria-label={iconOnly ? (copied ? "Copied" : "Copy") : undefined} {...props}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? "ok" : "copy"}
          initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
          transition={{ type: "spring", stiffness: 600, damping: 30 }}
          className="inline-flex"
        >
          {copied ? <Check className="text-ok size-4" /> : <Copy className="size-4" />}
        </motion.span>
      </AnimatePresence>
      {!iconOnly && (copied ? "Copied" : "Copy")}
    </Button>
  );
}

/** Clipboard write with a 1.6s "copied" window; the toast covers browsers that refuse the API. */
export function useCopy(): [copied: boolean, copy: (text: string) => Promise<void>] {
  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy — select it and copy it manually");
    }
  }, []);
  return [copied, copy];
}

/**
 * A secret shown exactly once. Springs in, the border flashes --live for a beat so the eye lands on
 * it, the value is a `select-all` mono chip and the Copy button confirms in place. `Done` is the only
 * way out — and the caller drops the value for good. Reduced motion: plain fade, no flash.
 */
export function SecretReveal({ value, onDone, title, footer, className }: { value: string; onDone: () => void; title: React.ReactNode; footer?: React.ReactNode; className?: string }) {
  const still = useReducedMotion();
  const [copied, copy] = useCopy();
  return (
    <motion.div
      role="status"
      initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.98, transition: { duration: 0.14 } }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className={cn("bg-card raised relative rounded-xl p-4", className)}
    >
      {!still && (
        <motion.span
          aria-hidden
          className="ring-live pointer-events-none absolute -inset-px rounded-xl ring-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.8, 0] }}
          transition={{ duration: 1.1, delay: 0.15, times: [0, 0.3, 1], ease: "easeOut" }}
        />
      )}
      <p className="text-foreground text-meta font-medium">{title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="bg-muted text-foreground min-w-0 flex-1 basis-48 truncate rounded-md px-2.5 py-1.5 font-mono text-code select-all">{value}</code>
        <div className="flex items-center gap-2">
          <CopyButton copied={copied} onClick={() => void copy(value)} />
          <Button size="sm" variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
      {footer && <p className="text-muted-foreground mt-2 text-micro">{footer}</p>}
    </motion.div>
  );
}
