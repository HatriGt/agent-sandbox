import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0",
  {
    variants: {
      variant: {
        // State colours never rely on hue alone: each carries a text label, and running/waiting
        // also carry a distinguishing dot treatment.
        live: "border-live/35 bg-live/12 text-live",
        attention: "border-attention/40 bg-attention/15 text-attention",
        info: "border-info/35 bg-info/12 text-info",
        muted: "border-border bg-muted text-muted-foreground",
        outline: "border-border text-muted-foreground",
      },
    },
    defaultVariants: { variant: "muted" },
  }
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
