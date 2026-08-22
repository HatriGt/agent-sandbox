import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The composer input. Enter sends, Shift+Enter newlines. Grown by CSS (field-sizing) rather than by
 * measuring in JS on every keystroke.
 */
export const Composer = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea"> & { onSend?: () => void }
>(({ className, onSend, onKeyDown, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={1}
    onKeyDown={(e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        onSend?.();
      }
      onKeyDown?.(e);
    }}
    className={cn(
      "text-ink placeholder:text-ink-faint max-h-48 min-h-11 w-full resize-none bg-transparent px-3.5 py-3",
      "text-[14.5px] leading-relaxed outline-none field-sizing-content disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Composer.displayName = "Composer";
