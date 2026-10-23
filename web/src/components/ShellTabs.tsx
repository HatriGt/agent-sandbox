import * as React from "react";
import { ChevronRight, Home, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { motion } from "motion/react";
import type { BoxView } from "@/lib/api";
import type { ConsoleRoute } from "@/lib/route";
import { useReducedMotion } from "@/lib/motion-pref";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openPalette } from "@/components/CommandPalette";
import { cn } from "@/lib/utils";

export type TabRoute = Extract<ConsoleRoute, { view: "box" } | { view: "automation-runs" } | { view: "pr" }>;
export type ShellTab = { key: string; route: TabRoute; label: string };

const STORE = "asb-tabs";
const MAX_TABS = 8;
const EASE = [0.2, 0.8, 0.2, 1] as const;

export function tabKey(r: ConsoleRoute): string | null {
  if (r.view === "box") return `box:${r.name}`;
  if (r.view === "automation-runs") return `automation-runs:${r.id}`;
  if (r.view === "pr") return `pr:${r.name}:${r.repo}#${r.number}`;
  return null;
}

function readTabs(): ShellTab[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((t): t is ShellTab => !!t && typeof t === "object" && typeof t.key === "string" && !!t.route && tabKey(t.route) === t.key).slice(-MAX_TABS);
  } catch {
    return [];
  }
}

/**
 * Editor-style tabs: every box / automation runs / PR page the user opens. Persisted, capped (oldest
 * evicted), and box tabs whose machine left the fleet close after one confirming poll.
 */
export function useShellTabs({
  route,
  label,
  fleet,
  fleetAt,
  go,
}: {
  route: ConsoleRoute;
  /** Label of the current route, when it is tabbable. */
  label: string;
  /** Raw fleet boxes (null until the first snapshot). */
  fleet: BoxView[] | null;
  fleetAt: number | null;
  go: (r: ConsoleRoute) => void;
}) {
  const [tabs, setTabs] = React.useState<ShellTab[]>(readTabs);
  React.useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(tabs));
    } catch {
      /* private mode */
    }
  }, [tabs]);

  const activeKey = tabKey(route);
  // Open (or relabel) the tab for the current route.
  React.useEffect(() => {
    if (!activeKey) return;
    setTabs((prev) => {
      const i = prev.findIndex((t) => t.key === activeKey);
      if (i >= 0) return prev[i].label === label ? prev : prev.map((t, j) => (j === i ? { ...t, label } : t));
      return [...prev, { key: activeKey, route: route as TabRoute, label }].slice(-MAX_TABS);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, label]);

  // Gone boxes: dimmed on the first poll without them, closed on the next poll still without them.
  const missingSince = React.useRef(new Map<string, number>());
  const names = React.useMemo(() => (fleet ? new Set(fleet.map((b) => b.name)) : null), [fleet]);
  const gone = React.useMemo(() => {
    const s = new Set<string>();
    if (!names) return s;
    for (const t of tabs) if (t.route.view === "box" && !names.has(t.route.name)) s.add(t.key);
    return s;
  }, [tabs, names]);
  React.useEffect(() => {
    if (!names || fleetAt == null) return;
    const seen = missingSince.current;
    const close: string[] = [];
    for (const k of [...seen.keys()]) if (!gone.has(k)) seen.delete(k);
    for (const k of gone) {
      const at = seen.get(k);
      if (at == null) seen.set(k, fleetAt);
      else if (at !== fleetAt) close.push(k);
    }
    if (close.length) {
      for (const k of close) seen.delete(k);
      setTabs((prev) => prev.filter((t) => !close.includes(t.key)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetAt]);

  const close = React.useCallback(
    (key: string) => {
      const i = tabs.findIndex((t) => t.key === key);
      if (i < 0) return;
      const rest = tabs.filter((t) => t.key !== key);
      setTabs(rest);
      if (key === activeKey) {
        const next = rest[i] ?? rest[i - 1];
        go(next ? next.route : { view: "hub" });
      }
    },
    [tabs, activeKey, go]
  );

  // Alt+W closes the active tab; Alt+[ / Alt+] cycle (Home included). Ctrl+W belongs to the browser.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.code === "KeyW") {
        if (!activeKey) return;
        e.preventDefault();
        close(activeKey);
        return;
      }
      if (e.code !== "BracketLeft" && e.code !== "BracketRight") return;
      e.preventDefault();
      const order: (string | null)[] = [null, ...tabs.map((t) => t.key)];
      const cur = Math.max(0, order.indexOf(route.view === "hub" ? null : activeKey));
      const n = (cur + (e.code === "BracketRight" ? 1 : -1) + order.length) % order.length;
      const target = order[n];
      go(target == null ? { view: "hub" } : tabs.find((t) => t.key === target)!.route);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs, activeKey, route.view, close, go]);

  return { tabs, activeKey, gone, close };
}

export type Crumb = { label: string; onClick?: () => void };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The one desktop frame bar (md+; phones keep their own): sidebar toggle · Home · the open tabs ·
 * search · the fleet's live pulse. The active tab IS the location, so there is no breadcrumb trail
 * for tab routes. A route that is not a tab (settings pages, fleet, history…) shows its crumb trail
 * as a non-closable page tab after Home, so where you are is never lost.
 */
export function ShellBar({
  tabs,
  activeKey,
  homeActive,
  crumbs,
  gone,
  boxes,
  working,
  waiting,
  collapsed,
  onToggleSidebar,
  onOpenWaiting,
  onSelect,
  onHome,
  onClose,
}: {
  tabs: ShellTab[];
  activeKey: string | null;
  homeActive: boolean;
  /** The current route's trail; rendered as the page tab when the route is neither Home nor a tab. */
  crumbs: Crumb[];
  gone: Set<string>;
  boxes: BoxView[];
  working: number;
  waiting: number;
  collapsed: boolean;
  onToggleSidebar: () => void;
  onOpenWaiting: () => void;
  onSelect: (r: TabRoute) => void;
  onHome: () => void;
  onClose: (key: string) => void;
}) {
  const reduce = useReducedMotion();
  const byName = React.useMemo(() => new Map(boxes.map((b) => [b.name, b])), [boxes]);
  const pageTab = !homeActive && !activeKey ? crumbs : null;
  const underline = (
    <motion.span
      layoutId="shell-tab-active"
      className="bg-live absolute inset-x-0 -bottom-px h-0.5 rounded-full"
      transition={reduce ? { duration: 0 } : { duration: 0.24, ease: EASE }}
      aria-hidden
    />
  );
  return (
    <div data-shell-bar className="bg-sidebar hidden h-10 shrink-0 items-stretch gap-2 pr-3 pl-1.5 md:flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={onToggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={!collapsed} className="my-auto">
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</TooltipContent>
      </Tooltip>

      <div role="tablist" aria-label="Open tabs" className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]">
        <button
          type="button"
          role="tab"
          aria-selected={homeActive}
          onClick={onHome}
          className={cn(
            "relative flex shrink-0 cursor-pointer items-center gap-1.5 px-3 text-[13px] transition-colors duration-150",
            homeActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Home className="size-3.5" aria-hidden />
          Home
          {homeActive && underline}
        </button>
        {pageTab && (
          <nav aria-label="Breadcrumb" role="tab" aria-selected className="relative flex min-w-0 shrink-0 items-center px-3">
            <ol className="flex min-w-0 items-center gap-0.5 text-[13px]">
              {pageTab.map((c, i) => {
                const last = i === pageTab.length - 1;
                return (
                  <li key={`${i}:${c.label}`} className="flex min-w-0 items-center gap-0.5">
                    {i > 0 && <ChevronRight className="text-faint size-3.5 shrink-0" aria-hidden />}
                    {c.onClick && !last ? (
                      <button type="button" onClick={c.onClick} className="text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer truncate rounded px-1 py-0.5 transition-colors duration-150">
                        {c.label}
                      </button>
                    ) : (
                      <span aria-current={last ? "page" : undefined} className={cn("truncate px-1 py-0.5", last ? "text-foreground" : "text-muted-foreground")}>
                        {c.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            {underline}
          </nav>
        )}
        {tabs.map((t) => {
          const active = t.key === activeKey;
          const box = t.route.view === "box" ? byName.get(t.route.name) : undefined;
          const isGone = gone.has(t.key);
          const state = box?.runState;
          return (
            <div
              key={t.key}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              title={isGone ? `${t.label} (no longer in the fleet)` : t.label}
              onClick={() => onSelect(t.route)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(t.route);
                }
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(t.key);
                }
              }}
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault();
              }}
              className={cn(
                "group relative flex max-w-52 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 pr-1.5 pl-3 text-[13px] outline-none transition-[color,opacity] duration-150 focus-visible:bg-muted",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                isGone && "opacity-45"
              )}
            >
              {state === "running" ? (
                <span className="bg-live text-live dt-ping size-1.5 shrink-0 rounded-full" aria-label="Working" />
              ) : state === "waiting" ? (
                <span className="bg-attention size-1.5 shrink-0 rounded-full" aria-label="Needs you" />
              ) : null}
              <span className="min-w-0 truncate">{t.label}</span>
              <button
                type="button"
                aria-label={`Close ${t.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.key);
                }}
                className={cn(
                  "hover:bg-muted text-faint hover:text-foreground grid size-4 shrink-0 cursor-pointer place-items-center rounded transition-opacity duration-150",
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                )}
              >
                <X className="size-3" />
              </button>
              {active && underline}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => openPalette()}
        className="text-muted-foreground hover:text-foreground hover:border-line-strong bg-background/60 hover:bg-background my-auto flex h-7 w-56 shrink-0 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-left text-[13px] transition-[color,background-color,border-color] duration-150"
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="flex-1 truncate">Search or jump to…</span>
        <Kbd keys={[isMac ? "⌘" : "Ctrl", "K"]} />
      </button>

      <div className="my-auto flex h-7 shrink-0 items-center rounded-md border px-2 text-[12px] tabular-nums" aria-live="polite">
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

