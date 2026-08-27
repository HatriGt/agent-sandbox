import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn textarea, minus the stock `dark:bg-input/30` inset. Every textarea in this app lives inside a
 * composer surface that already carries the border and fill, so the inset painted a second, lighter
 * rectangle inside the composer in dark mode — it read as a rendering glitch, not a field.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-body outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
