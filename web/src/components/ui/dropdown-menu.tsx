import * as React from "react";
import { DropdownMenu as DM } from "radix-ui";
import { cn } from "@/lib/utils";

/** A small, quiet menu: popover surface, e3 shadow, one destructive item at most, separated. */
const DropdownMenu = DM.Root;
const DropdownMenuTrigger = DM.Trigger;

function DropdownMenuContent({ className, ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={6}
        collisionPadding={8}
        className={cn(
          "bg-popover text-popover-foreground z-50 min-w-[13rem] rounded-xl border p-1.5 shadow-e3 outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          className
        )}
        {...props}
      />
    </DM.Portal>
  );
}

function DropdownMenuItem({ className, destructive, ...props }: React.ComponentProps<typeof DM.Item> & { destructive?: boolean }) {
  return (
    <DM.Item
      className={cn(
        "flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-meta outline-none select-none",
        "data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        "[&_svg]:text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0",
        destructive && "text-destructive data-[highlighted]:bg-destructive/10 [&_svg]:text-destructive",
        className
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DM.Separator>) {
  return <DM.Separator className={cn("bg-border my-1.5 h-px", className)} {...props} />;
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("label text-faint px-2 pt-1.5 pb-1", className)} {...props} />;
}

/** Right-aligned hint inside an item: a shortcut or the current state. */
function MenuHint({ children }: { children: React.ReactNode }) {
  return <span className="text-faint ml-auto pl-4 text-micro">{children}</span>;
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, MenuHint };
