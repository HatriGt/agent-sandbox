import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** A small anchored panel: the popover surface, e3 shadow, the same 150ms grow-in as the menus. */
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

function PopoverContent({ className, align = "end", sideOffset = 6, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "bg-popover text-popover-foreground z-50 w-80 rounded-xl border p-3 shadow-e3 outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 origin-(--radix-popover-content-transform-origin) data-[state=open]:zoom-in-95 data-[state=open]:duration-150 data-[state=open]:ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=closed]:animate-out data-[state=closed]:zoom-out-[0.97] data-[state=closed]:duration-100 data-[state=closed]:fade-out-0",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
