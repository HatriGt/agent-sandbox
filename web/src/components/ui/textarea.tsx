import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground bg-card flex min-h-16 w-full rounded-md border px-3 py-2",
        "text-sm shadow-none outline-none transition-[color,border-color,box-shadow]",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "disabled:cursor-not-allowed disabled:opacity-50 resize-none field-sizing-content",
        className
      )}
      {...props}
    />
  );
}
export { Textarea };
