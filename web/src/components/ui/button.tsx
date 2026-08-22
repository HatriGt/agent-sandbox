import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Every variant carries the full state set: hover, focus-visible, active, disabled. A control that
// ships with half of these reads as a prototype.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium " +
    "cursor-pointer transition-[background-color,border-color,color,box-shadow] duration-150 " +
    "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground hover:bg-accent/90 active:bg-accent/80",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border",
        outline: "border border-border bg-card hover:bg-secondary text-foreground",
        ghost: "hover:bg-secondary text-muted-foreground hover:text-foreground",
        destructive:
          "border border-destructive/40 text-destructive bg-destructive/10 hover:bg-destructive hover:text-destructive-foreground",
        attention: "bg-attention text-attention-foreground hover:bg-attention/90",
      },
      size: {
        // 44px min touch target on the sizes used for primary actions; sm is desktop-dense chrome.
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-11 rounded-md px-6",
        touch: "min-h-11 px-4 py-2",
        icon: "size-9",
        "icon-touch": "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  // asChild is Radix's polymorphic API — valid here because this Button is built on Radix Slot.
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
