import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** shadcn-style dialog on the Radix primitive: centred panel, dimmed backdrop, Esc/overlay close. */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({ className, children, title, description, ...props }: React.ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150" />
      <DialogPrimitive.Content
        className={cn(
          "bg-popover text-popover-foreground fixed top-1/2 left-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-6 shadow-e5 outline-none",
          // The panel settles in — rises 2% and scales from 96% on the product's signature curve —
          // and leaves faster than it arrived, so dismissal feels immediate.
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-[2%] data-[state=open]:duration-300 data-[state=open]:ease-[cubic-bezier(0.22,1,0.36,1)]",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-150",
          className
        )}
        {...props}
      >
        <div className="mb-5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="text-foreground text-h3 font-semibold tracking-[-0.01em]">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="text-muted-foreground mt-1 text-meta">{description}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-8 shrink-0 cursor-pointer place-items-center rounded-md" aria-label="Close">
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogTrigger, DialogClose, DialogContent };
