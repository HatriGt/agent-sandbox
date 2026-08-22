import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Auto-growing chat textarea. Enter sends, Shift+Enter makes a newline — the convention every chat
 * user already has in their fingers. `field-sizing-content` does the growth in CSS so there is no
 * measure-then-set layout thrash on each keystroke.
 */
const ChatInput = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea"> & { onSubmitMessage?: () => void }
>(({ className, onSubmitMessage, onKeyDown, ...props }, ref) => (
  <textarea
    ref={ref}
    data-slot="chat-input"
    rows={1}
    onKeyDown={(e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        onSubmitMessage?.();
      }
      onKeyDown?.(e);
    }}
    className={cn(
      "placeholder:text-muted-foreground max-h-40 min-h-11 w-full resize-none bg-transparent px-3 py-2.5",
      "text-sm leading-relaxed outline-none field-sizing-content disabled:opacity-50",
      className
    )}
    {...props}
  />
));
ChatInput.displayName = "ChatInput";

export { ChatInput };
