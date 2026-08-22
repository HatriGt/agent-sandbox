import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Squarer than the shadcn default (radius 5–7px, not 8–10) and flatter: this is an instrument, and
// pill-shaped translucent buttons are the look we are deliberately not shipping.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium cursor-pointer " +
    "transition-[background-color,border-color,color] duration-150 outline-none shrink-0 " +
    "disabled:pointer-events-none disabled:opacity-40 " +
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        signal: "bg-signal text-[var(--signal-ink)] hover:brightness-110 active:brightness-95",
        outline: "border border-[var(--line-strong)] text-ink hover:bg-[var(--surface)]",
        ghost: "text-ink-dim hover:text-ink hover:bg-[var(--surface)]",
        danger:
          "border border-[var(--danger)]/40 text-[var(--danger)] bg-[var(--danger-wash)] hover:bg-[var(--danger)] hover:text-[var(--bg)]",
      },
      size: {
        sm: "h-7 px-2.5 text-[12.5px]",
        md: "h-9 px-3.5 text-[13.5px]",
        icon: "size-8",
        // 44px minimum for anything a thumb hits.
        touch: "min-h-11 min-w-11 px-3",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
