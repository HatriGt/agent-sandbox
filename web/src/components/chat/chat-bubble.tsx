import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Chat primitives in the shadcn-chat shape (ChatBubble / ChatBubbleAvatar / ChatBubbleMessage /
 * ChatMessageList / ChatInput), vendored into the project the way shadcn distributes components.
 *
 * One product-specific rule is baked into the variants: this app has TWO conversational lanes that
 * must never be mistaken for each other — the DRIVER (the agent doing the work; you steer it by
 * answering its questions) and the CO-PILOT (a read-only observer). `sent` is always you. `driver`
 * and `copilot` are visually distinct receives, not one generic "assistant" bubble.
 */

const chatBubbleVariants = cva("flex gap-2.5 items-end group relative", {
  variants: {
    variant: {
      sent: "self-end flex-row-reverse max-w-[85%]",
      received: "self-start max-w-[92%]",
    },
  },
  defaultVariants: { variant: "received" },
});

function ChatBubble({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof chatBubbleVariants>) {
  return <div data-slot="chat-bubble" className={cn(chatBubbleVariants({ variant }), className)} {...props} />;
}

const chatBubbleMessageVariants = cva("rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words", {
  variants: {
    variant: {
      sent: "bg-accent text-accent-foreground rounded-br-sm",
      driver: "bg-secondary text-secondary-foreground rounded-bl-sm border",
      copilot: "bg-card text-card-foreground rounded-bl-sm border border-dashed",
      attention: "bg-attention/12 text-foreground border border-attention/40 rounded-bl-sm",
      error: "bg-destructive/10 text-destructive border border-destructive/40 rounded-bl-sm",
    },
  },
  defaultVariants: { variant: "driver" },
});

function ChatBubbleMessage({
  className,
  variant,
  isLoading,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof chatBubbleMessageVariants> & { isLoading?: boolean }) {
  return (
    <div data-slot="chat-bubble-message" className={cn(chatBubbleMessageVariants({ variant }), className)} {...props}>
      {isLoading ? (
        <div className="flex items-center gap-1.5 py-0.5" role="status" aria-label="waiting for a reply">
          <span className="size-1.5 rounded-full bg-current opacity-60 animate-bounce [animation-delay:-0.3s]" />
          <span className="size-1.5 rounded-full bg-current opacity-60 animate-bounce [animation-delay:-0.15s]" />
          <span className="size-1.5 rounded-full bg-current opacity-60 animate-bounce" />
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function ChatBubbleAvatar({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="chat-bubble-avatar"
      aria-hidden
      className={cn(
        "size-7 shrink-0 rounded-md border bg-card grid place-items-center text-muted-foreground [&_svg]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function ChatBubbleSkeleton() {
  return (
    <div className="flex gap-2.5 items-end">
      <Skeleton className="size-7 rounded-md" />
      <Skeleton className="h-12 w-56 rounded-lg" />
    </div>
  );
}

export { ChatBubble, ChatBubbleMessage, ChatBubbleAvatar, ChatBubbleSkeleton };
