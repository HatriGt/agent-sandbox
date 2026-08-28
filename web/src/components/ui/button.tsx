import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Console actions. Every colour here is a theme utility (`text-primary-foreground`, `text-destructive`)
 * rather than an arbitrary `text-[var(--x)]`: theme utilities are what tailwind-merge can classify, and
 * the size utilities they sit beside are registered in `lib/utils.ts`, so a variant's colour can no
 * longer be dropped by its own size class.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap " +
    "transition-[color,background-color,border-color,box-shadow,opacity] duration-150 outline-none " +
    "disabled:pointer-events-none disabled:opacity-40 " +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // THE action: ink fill, contrast text. Ideally the only filled element in view.
        default: "bg-primary text-primary-foreground shadow-e1 hover:bg-primary/80 active:bg-primary/80",
        primary: "bg-primary text-primary-foreground shadow-e1 hover:bg-primary/80 active:bg-primary/80",
        // Secondary: hairline panel that fills on hover — never a shadow.
        outline: "border border-border bg-card text-foreground hover:bg-muted hover:border-line-strong",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/60",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        // Destructive is text-only until armed; the caller flips to `destructive` for the confirm step.
        danger: "text-destructive hover:bg-destructive/10",
        destructive: "bg-destructive text-white shadow-e1 hover:bg-destructive/80",
        // Amber: the one state with a deadline. Used for "Answer" on a waiting machine.
        attention: "bg-attention text-attention-ink shadow-e1 hover:bg-attention/80",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5 text-meta",
        sm: "h-8 px-3 text-meta",
        xs: "h-7 px-2.5 text-micro",
        lg: "h-11 px-5 text-body",
        icon: "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
        // 44px floor for anything a thumb hits.
        touch: "min-h-11 px-4",
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
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
