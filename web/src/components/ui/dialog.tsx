import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * shadcn-style dialog on the Radix primitive. On ≥640px a centred panel (settles in over 240ms on
 * the product curve, leaves in 180ms — the sheet's timing); under 640px it becomes a bottom sheet
 * that slides up from the edge, where a thumb can reach the close control. The body scrolls inside
 * `max-h-[85dvh]` with the title row pinned, so a long form never pushes its own heading off-screen.
 * Reduced motion: fade only. Dark mode drops the border in favour of the e5 shadow + a hairline.
 *
 * Desktop styles are the base and the phone sheet is `max-sm:` so a caller's `w-[…]` override
 * (SkillsPage passes 40rem) still wins on desktop without disturbing the full-width sheet.
 */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({
  className,
  children,
  title,
  description,
  actions,
  bodyClassName,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  /** Extra header controls, placed before the close button. */
  actions?: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="overlay" className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-[240ms] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[180ms]" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-popover text-popover-foreground fixed z-50 flex max-h-[85dvh] flex-col overflow-hidden shadow-e5 outline-none",
          "border dark:border-white/8",
          // ≥640px: centred panel.
          "top-1/2 left-1/2 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-[2%] data-[state=open]:duration-[240ms] data-[state=open]:ease-[cubic-bezier(0.22,1,0.36,1)]",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-[180ms]",
          // Phone: bottom sheet, full width, rounded top, slides up from the edge.
          "max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-t-2xl max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[max(0.5rem,env(safe-area-inset-bottom))]",
          "max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=closed]:slide-out-to-bottom",
          // Reduced motion: fade only, no travel or scale.
          "motion-reduce:data-[state=open]:zoom-in-100 motion-reduce:data-[state=open]:slide-in-from-bottom-0 motion-reduce:data-[state=closed]:zoom-out-100 motion-reduce:data-[state=closed]:slide-out-to-bottom-0",
          className
        )}
        {...props}
      >
        {/* Grab handle: only on the phone sheet, purely visual. */}
        <div className="bg-border mx-auto mt-2 h-1 w-9 shrink-0 rounded-full sm:hidden" aria-hidden />
        <div className="bg-popover sticky top-0 z-10 flex shrink-0 items-start gap-3 px-6 pt-5 pb-4 sm:pt-6">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="text-foreground text-h3 font-semibold tracking-[-0.01em]">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="text-muted-foreground mt-1 text-meta">{description}</DialogPrimitive.Description>}
          </div>
          {actions}
          <DialogPrimitive.Close className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-8 shrink-0 cursor-pointer place-items-center rounded-md transition-colors" aria-label="Close">
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 pb-6", bodyClassName)}>{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogTrigger, DialogClose, DialogContent };
