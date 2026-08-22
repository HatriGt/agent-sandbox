import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The composer input. Enter sends, Shift+Enter newlines — the convention every chat user already
 * has in their fingers. Grown by CSS (field-sizing) rather than measured in JS per keystroke.
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
      "placeholder:text-ash max-h-52 min-h-12 w-full resize-none bg-transparent px-5 pt-3.5 pb-1",
      "text-[16px] leading-relaxed outline-none field-sizing-content disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Composer.displayName = "Composer";
