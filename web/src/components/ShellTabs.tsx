import * as React from "react";
import { Home, X } from "lucide-react";
import { motion } from "motion/react";
import type { BoxView } from "@/lib/api";
import type { ConsoleRoute } from "@/lib/route";
import { useReducedMotion } from "@/lib/motion-pref";
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

export function ShellTabs({
  tabs,
  activeKey,
  homeActive,
  gone,
  boxes,
  onSelect,
  onHome,
  onClose,
}: {
  tabs: ShellTab[];
  activeKey: string | null;
  homeActive: boolean;
  gone: Set<string>;
  boxes: BoxView[];
  onSelect: (r: TabRoute) => void;
  onHome: () => void;
  onClose: (key: string) => void;
}) {
  const reduce = useReducedMotion();
  const byName = React.useMemo(() => new Map(boxes.map((b) => [b.name, b])), [boxes]);
  const underline = (
    <motion.span
      layoutId="shell-tab-active"
      className="bg-live absolute inset-x-0 -bottom-px h-0.5 rounded-full"
      transition={reduce ? { duration: 0 } : { duration: 0.24, ease: EASE }}
      aria-hidden
    />
  );
  return (
    <div role="tablist" aria-label="Open tabs" className="bg-sidebar hidden h-9 shrink-0 items-stretch overflow-x-auto border-b px-1.5 [scrollbar-width:none] md:flex">
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
  );
}
