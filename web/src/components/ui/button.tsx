import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Every action is a full pill (see DESIGN.md). `secondary` and `icon-sm` are kept because the
 * registry's message-scroller asks for them by name.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap " +
    "transition-colors duration-150 outline-none disabled:pointer-events-none disabled:opacity-40 " +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // THE action. Azure fill, white text — the only filled-accent element in a view where possible.
        default: "bg-azure text-[var(--accent-fg)] hover:brightness-110 active:brightness-95",
        primary: "bg-azure text-[var(--accent-fg)] hover:brightness-110 active:brightness-95",
        // Secondary: hairline pill, fills with a surface shift on hover (never a shadow).
        outline: "border border-[var(--line)] text-ink hover:bg-[var(--surface)]",
        secondary: "border border-[var(--line)] bg-[var(--surface)] text-ink hover:bg-[var(--raised)]",
        ghost: "text-ash hover:bg-[var(--surface)] hover:text-ink",
        danger: "text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]",
        link: "text-azure-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4.5 text-meta",
        sm: "h-8 px-3.5 text-meta",
        lg: "h-12 px-6 text-body",
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-9",
        "icon-lg": "size-11",
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
