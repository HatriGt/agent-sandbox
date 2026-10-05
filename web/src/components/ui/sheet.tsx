import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Side panel on the Radix Dialog primitive — the dialog's sibling for content that is a detour,
 * not a decision: settings for one row, a long list, a preview. Slides in from the right over a
 * fading backdrop (240ms in on the product curve, 180ms out so dismissal feels immediate); with
 * reduced motion the slide is dropped and only the fade remains. Esc/overlay close, focus trapped.
 */
const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

function SheetContent({
  className,
  children,
  title,
  description,
  side = "right",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: string; side?: "right" | "left" | "bottom" }) {
  const bottom = side === "bottom";
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="overlay" className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-[240ms] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[180ms]" />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "bg-popover text-popover-foreground fixed z-50 flex flex-col shadow-e5 outline-none",
          // Bottom: a phone sheet — full width, capped height, the home-indicator inset respected.
          bottom
            ? "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
            : "inset-y-0 w-[min(28rem,calc(100vw-2rem))] p-6",
          side === "right" && "right-0 border-l",
          side === "left" && "left-0 border-r",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-[240ms] data-[state=open]:ease-[cubic-bezier(0.32,0.72,0,1)]",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150 data-[state=closed]:ease-[cubic-bezier(0.22,1,0.36,1)]",
          side === "right" && "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
          side === "left" && "data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
          bottom && "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
          // Reduced motion: no travel, just the fade.
          "motion-reduce:data-[state=open]:slide-in-from-right-0 motion-reduce:data-[state=closed]:slide-out-to-right-0 motion-reduce:data-[state=open]:slide-in-from-left-0 motion-reduce:data-[state=closed]:slide-out-to-left-0 motion-reduce:data-[state=open]:slide-in-from-bottom-0 motion-reduce:data-[state=closed]:slide-out-to-bottom-0",
          className
        )}
        {...props}
      >
        {bottom && <span aria-hidden className="bg-line-strong mx-auto mb-3 block h-1 w-9 rounded-full" />}
        <div className={cn("flex items-start gap-3", bottom ? "mb-3" : "mb-5")}>
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="text-foreground text-h3 font-semibold tracking-[-0.01em]">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="text-muted-foreground mt-1 text-meta">{description}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-8 shrink-0 cursor-pointer place-items-center rounded-md transition-colors" aria-label="Close">
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent };
