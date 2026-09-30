import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A key cap: the shortcut hint that sits beside a label or inside a button (`⌘S`, `Esc`, `/`).
 * Hairline plate, tabular figures, inherits the muted colour so it never competes with the label.
 *
 *   · `keys` renders a chord as one cap per key (`["g", "f"]`), the caps sitting 2px apart.
 *   · `tone="inverse"` is for a cap on a filled (primary) button, where the muted plate vanishes.
 */
export function Kbd({
  className,
  children,
  keys,
  tone = "default",
  ...props
}: React.ComponentProps<"kbd"> & { keys?: string[]; tone?: "default" | "inverse" }) {
  const cap = cn(
    "tabular inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-sans text-micro font-medium",
    tone === "inverse" ? "bg-primary-foreground/15 text-primary-foreground/85 border border-primary-foreground/10" : "text-muted-foreground bg-muted/70 border",
    className
  );
  if (keys && keys.length) {
    return (
      <span className="inline-flex items-center gap-0.5" aria-label={keys.join(" ")} {...(props as React.ComponentProps<"span">)}>
        {keys.map((k, i) => (
          <kbd key={i} className={cap} aria-hidden>
            {k}
          </kbd>
        ))}
      </span>
    );
  }
  return (
    <kbd className={cap} {...props}>
      {children}
    </kbd>
  );
}
