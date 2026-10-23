import * as React from "react";
import { ChevronRight } from "lucide-react";
import { SHORTCUTS, type OpenOpts, type ShortcutId } from "@/lib/workspace-model";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
/**
 * VS Code's twistie: a 16px chevron-right that turns 90deg when the folder is open, the row's foreground
 * at 80%, no hover box of its own (the row is the hit area). It overhangs its 14px slot by 1px each side
 * so a folder's icon starts where a file's does and names at one depth share an x.
 */
export const Twistie = ({ open }: { open: boolean }) => <ChevronRight strokeWidth={1.5} className={cn("text-foreground/80 -mx-px size-4 shrink-0 transition-transform duration-100 ease-out motion-reduce:transition-none", open && "rotate-90")} aria-hidden />;
