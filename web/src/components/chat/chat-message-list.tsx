import * as React from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Auto-scrolling message list. Sticks to the bottom while the user is already there, and stops
 * fighting them the moment they scroll up — a live-updating transcript that yanks you back to the
 * bottom mid-read is the classic chat-UI failure. When detached it offers an explicit way back.
 */
function ChatMessageList({ className, children, ...props }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = React.useState(true);

  const onScroll = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  });

  const toBottom = () => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setPinned(true);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        className={cn("flex h-full flex-col gap-3 overflow-y-auto p-3", className)}
        {...props}
      >
        {children}
      </div>
      {!pinned && (
        <Button
          size="sm"
          variant="secondary"
          onClick={toBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-[0_4px_12px_-4px_rgba(0,0,0,.4)]"
        >
          <ArrowDown /> Latest
        </Button>
      )}
    </div>
  );
}
export { ChatMessageList };
