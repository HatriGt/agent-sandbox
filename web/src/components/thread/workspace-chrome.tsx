import * as React from "react";
import { SHORTCUTS, type OpenOpts, type ShortcutId } from "@/lib/workspace-model";
import { toast } from "sonner";

/** Bits the workspace pane's pieces share: menu styling, motion constants, the open-a-file signature. */
export type Open = (path: string, opts?: OpenOpts) => void;

export const SPRING = { type: "spring", stiffness: 500, damping: 40 } as const;
export const EASE = [0.22, 1, 0.36, 1] as const;
export const MENU_CONTENT = "bg-popover text-popover-foreground z-50 min-w-[13rem] rounded-xl border p-1.5 shadow-e3 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-150 data-[state=open]:ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=closed]:animate-out data-[state=closed]:zoom-out-[0.97] data-[state=closed]:duration-100 data-[state=closed]:fade-out-0";
export const MENU_ITEM = "flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-meta outline-none select-none transition-[background-color,transform] duration-100 ease-[cubic-bezier(0.22,1,0.36,1)] data-[highlighted]:bg-accent active:scale-[0.985] data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&_svg]:text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0";
export const MENU_ITEM_DESTRUCTIVE = "text-destructive data-[highlighted]:bg-destructive/10 [&_svg]:text-destructive";
export const MENU_SEP = "bg-border my-1.5 h-px";
export const MenuHint = ({ children }: { children: React.ReactNode }) => <span className="text-faint ml-auto pl-4 text-micro">{children}</span>;
export const shortcutLabel = (id: ShortcutId) => SHORTCUTS.find((s) => s.id === id)?.label;
export const copyText = (text: string) => navigator.clipboard?.writeText(text).catch(() => toast.error("Could not copy"));
