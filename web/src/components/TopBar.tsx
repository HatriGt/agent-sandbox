import { ChevronRight, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openPalette } from "@/components/CommandPalette";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; onClick?: () => void };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Desktop frame bar over the main column: where you are (breadcrumbs), the one search entry, and
 * the fleet's live pulse. Phones keep their own bar; this one is md+ only.
 */
export function TopBar({
  crumbs,
  working,
  waiting,
  onOpenWaiting,
  collapsed,
  onToggleSidebar,
}: {
  crumbs: Crumb[];
  working: number;
  waiting: number;
  onOpenWaiting: () => void;
  collapsed: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <div className="bg-sidebar hidden h-11 shrink-0 items-center gap-3 border-b px-3 md:flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={onToggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={!collapsed}>
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</TooltipContent>
      </Tooltip>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1 text-[13px]">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={`${i}:${c.label}`} className={cn("flex min-w-0 items-center gap-1", !last && "shrink-0")}>
                {i > 0 && <ChevronRight className="text-faint size-3.5 shrink-0" aria-hidden />}
                {c.onClick && !last ? (
                  <button type="button" onClick={c.onClick} className="text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer truncate rounded px-1.5 py-0.5 transition-colors duration-150">
                    {c.label}
                  </button>
                ) : (
                  <span aria-current={last ? "page" : undefined} className={cn("truncate px-1.5 py-0.5", last ? "text-foreground font-medium" : "text-muted-foreground")}>
                    {c.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <button
        type="button"
        onClick={openPalette}
        className="text-muted-foreground hover:text-foreground hover:border-line-strong bg-background/60 hover:bg-background flex h-7 w-64 shrink-0 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-left text-[13px] transition-[color,background-color,border-color] duration-150 lg:w-72"
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="flex-1 truncate">Search or jump to…</span>
        <Kbd keys={[isMac ? "⌘" : "Ctrl", "K"]} />
      </button>

      <div className="flex h-7 shrink-0 items-center rounded-md border px-2 text-[12px] tabular-nums" aria-live="polite">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", working > 0 ? "bg-live text-live dt-ping" : "bg-muted-foreground/50")} aria-hidden />
          <NumberTicker value={working} from={working} /> working
        </span>
        <span className="text-faint px-1.5" aria-hidden>·</span>
        {waiting > 0 ? (
          <button type="button" onClick={onOpenWaiting} className="text-attention-text hover:bg-attention/10 -mx-1 flex cursor-pointer items-center gap-1.5 rounded px-1 font-medium transition-colors duration-150">
            <span className="bg-attention size-1.5 rounded-full" aria-hidden />
            <NumberTicker value={waiting} from={waiting} /> need you
          </button>
        ) : (
          <span className="text-muted-foreground">0 need you</span>
        )}
      </div>
    </div>
  );
}
