import * as React from "react";
import {
  LayoutGrid,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PauseCircle,
  Plus,
  Search,
  Sun,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import { api, type BoxView } from "@/lib/api";
import { POLL_MS, isUp } from "@/lib/format";
import { usePoll } from "@/hooks/usePoll";
import { useStableBoxes } from "@/hooks/useStableBoxes";
import { useSessionRuns } from "@/hooks/useSessionRuns";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { MachineList } from "@/components/MachineList";
import { Hub } from "@/components/Hub";
import { Sandboxes } from "@/components/Sandboxes";
import { CommandPalette } from "@/components/CommandPalette";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Thread, type Aside } from "@/components/thread/Thread";
import { BootingThread } from "@/components/thread/BootingThread";
import { cn } from "@/lib/utils";

/**
 * "updated 3s ago" — recomputed on a 1s timer so it stays true between polls. Honest freshness beats
 * a claimed interval: this endpoint's latency grows with the number of machines.
 */
function useFreshness(updatedAt: number | null) {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (!updatedAt) return "connecting";
  const secs = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  return secs < 2 ? "just now" : `${secs}s ago`;
}

/** Light by default (blue-on-white product theme); persisted, toggling the `.dark` class on <html>. */
function useTheme() {
  const [dark, setDark] = React.useState(() => {
    try {
      return localStorage.getItem("asb-theme") === "dark";
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("asb-theme", dark ? "dark" : "light");
    } catch {
      /* private mode: the toggle still works for this session */
    }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

/** Sidebar collapse, persisted. Collapsed = a slim icon rail; expanded = the full machines list. */
function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem("asb-rail") === "collapsed";
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem("asb-rail", collapsed ? "collapsed" : "expanded");
    } catch {
      /* private mode: still works for this session */
    }
  }, [collapsed]);
  return { collapsed, toggle: () => setCollapsed((c) => !c) };
}

type View = "chat" | "sandboxes";

export default function App() {
  const { dark, toggle } = useTheme();
  const { collapsed, toggle: toggleRail } = useSidebarCollapsed();
  const { data, error, live, updatedAt } = usePoll<BoxView[]>((signal) => api.monitor(signal), POLL_MS);
  const freshness = useFreshness(updatedAt);
  const { runs, remember } = useSessionRuns();

  const [view, setView] = React.useState<View>("chat");
  const [selected, setSelected] = React.useState<string | null>(null);
  // Mobile is a single-pane device: either the machines rail OR the workspace (Hub/Thread/Sandboxes)
  // is on screen, never both. `mobileRail` decides which. It starts on the rail (the home/list), and
  // any navigation INTO the workspace (new task, open a box, switch to sandboxes) flips to the
  // workspace; the in-workspace "back" controls flip it back. On md+ this is irrelevant — the grid
  // shows both panes — so it only gates the `hidden`/`flex` classes below at the mobile breakpoint.
  const [mobileRail, setMobileRail] = React.useState(true);
  // A delegate in flight: the box name is not known until the run reaches a boundary (which can be
  // a minute out), so we show a booting thread with the submitted task from the moment it's sent —
  // the user watches the machine come up rather than staring at the Hub. Cleared when the delegate
  // resolves to a box (which we then select) or errors (which returns to the Hub).
  //
  // `known` snapshots the box names that existed at submit time: a warm claim (or a cold boot)
  // surfaces a NEW box in monitor.json within ~1-2s (a poll tick), long before `delegate.json`
  // resolves. As soon as that new box appears we attach to its real Thread — so a warm claim never
  // sits on the "booting a fresh microVM" placeholder. `warm` on the boot state is inferred from the
  // role of that new box (pool-claimed = warm fast path; session = cold boot) so the copy is honest.
  const [booting, setBooting] = React.useState<{ task: string; known: Set<string>; warm: boolean } | null>(null);
  const [pending, setPending] = React.useState<{ id: string; task: string }[]>([]);
  const [asides, setAsides] = React.useState<Record<string, Aside[]>>({});
  // Replies this browser sent, per machine: the server keeps no transcript of them.
  const [replies, setReplies] = React.useState<Record<string, string[]>>({});

  // Filter to running, then hold a machine briefly after it stops being reported: a box being
  // reaped at its max-duration makes the host disagree with itself for a few seconds, and without
  // this its card blinked in and out once a second.
  const reported = React.useMemo(() => (data ? data.filter(isUp) : null), [data]);
  const boxes = useStableBoxes(reported);
  const selectedBox = boxes.find((b) => b.name === selected) ?? null;
  const waiting = boxes.filter((b) => b.runState === "waiting");
  const working = boxes.filter((b) => b.runState === "running").length;

  // A machine that vanished (destroyed, auto-stopped) must not leave a dead pane behind. A box that
  // was JUST delegated has not appeared in monitor.json yet, so guard on `booting`: never unselect
  // while a delegate is in flight, or the newly-opened thread would flip back to the Hub.
  React.useEffect(() => {
    if (booting) return;
    if (selected && data && !boxes.some((b) => b.name === selected)) setSelected(null);
  }, [selected, data, boxes, booting]);

  // Attach to the delegated box the instant it surfaces. A warm claim (fast path) and a cold boot
  // both appear in monitor.json as a box that wasn't there at submit time; the FIRST such new box is
  // ours. Selecting it swaps the transient BootingThread for the real, SSE-streaming Thread within a
  // poll tick — so a warm claim is never misreported as "booting a fresh microVM". We also record
  // whether it's warm (pool-claimed) purely to keep the placeholder copy honest for the sub-second
  // window before this fires. `Hub.onStarted` still runs when delegate.json resolves; `open()` there
  // is idempotent with this (same box), and it also persists the run to session history.
  React.useEffect(() => {
    if (!booting) return;
    const fresh = boxes.find((b) => !booting.known.has(b.name));
    if (!fresh) return;
    const warm = fresh.role === "pool-claimed";
    if (warm !== booting.warm) setBooting((prev) => (prev ? { ...prev, warm } : prev));
    setSelected(fresh.name);
    setBooting(null);
    setView("chat");
    // The box is now a real row in the list, so the transient "booting" placeholder in the sidebar
    // is redundant — clear it, otherwise it lingers (and lies as "booting") for the rest of the
    // ~50s delegate call while the thread already shows the claimed warm box.
    setPending([]);
  }, [booting, boxes]);

  const open = (name: string) => {
    setBooting(null);
    setSelected(name);
    setView("chat");
    setMobileRail(false); // reveal the workspace pane on mobile
  };
  const newTask = () => {
    setBooting(null);
    setSelected(null);
    setView("chat");
    setMobileRail(false); // the Hub lives in the workspace pane — show it on mobile
  };
  /** Mobile-only: leave the workspace pane and return to the machines rail. No-op visually on md+. */
  const backToRail = () => setMobileRail(true);
  /** Switch the workspace to a section and reveal it on mobile. */
  const showChat = () => {
    setView("chat");
    setMobileRail(false);
  };
  const showSandboxes = () => {
    setView("sandboxes");
    setSelected(null);
    setMobileRail(false);
  };

  /** Ask the co-pilot; the pending note renders immediately so the thread never looks frozen. */
  const ask = async (name: string, question: string) => {
    let index = 0;
    setAsides((prev) => {
      const list = [...(prev[name] ?? []), { question }];
      index = list.length - 1;
      return { ...prev, [name]: list };
    });
    try {
      const res = await api.ask(name, question);
      setAsides((prev) => {
        const list = [...(prev[name] ?? [])];
        list[index] = {
          question,
          answer: res.timedOut ? `${res.answer}\n\n(time cap reached — this answer may be partial)` : res.answer,
        };
        return { ...prev, [name]: list };
      });
    } catch (e) {
      setAsides((prev) => {
        const list = [...(prev[name] ?? [])];
        list[index] = { question, error: e instanceof Error ? e.message : String(e) };
        return { ...prev, [name]: list };
      });
    }
  };

  return (
    <TooltipProvider delayDuration={400}>
      <Toaster position="bottom-center" />
      {/* Floating shell: a tinted canvas holds two elevated panels — the sidebar and the workspace —
          each a rounded card with its own hairline + soft shadow, separated by a gap. On mobile the
          panels go full-bleed (no gap/radius) so no screen space is wasted. The rail narrows to a slim
          icon strip when collapsed. */}
      <div
        className={cn(
          "bg-muted/40 grid h-full grid-cols-1 gap-0 md:gap-2.5 md:p-2.5",
          collapsed ? "md:grid-cols-[4rem_minmax(0,1fr)]" : "md:grid-cols-[13.5rem_minmax(0,1fr)]"
        )}
      >
      {/* ───────────── machines (floating rail) ───────────── */}
      <aside
        className={cn(
          "bg-card flex min-h-0 flex-col overflow-hidden md:rounded-xl md:border md:shadow-sm",
          // Mobile: the rail shows only when `mobileRail` is set; otherwise the workspace has the
          // screen. On md+ the grid always shows it.
          mobileRail ? "flex" : "hidden md:flex"
        )}
      >
        <header className={cn("px-3 pt-2 pb-3", collapsed && "md:px-2")}>
          {/* Collapse toggle: top-anchored on its own row — always the first control in the rail, in a
              fixed spot, so re-expanding is predictable whether the rail is open or a slim strip.
              Desktop only (mobile uses full-screen panes). */}
          <div className={cn("hidden md:flex", collapsed ? "justify-center" : "justify-end")}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleRail}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
            </Button>
          </div>

          {/* Brand row: mark + wordmark on the left, theme toggle on the right. */}
          <div className={cn("mt-1 flex items-center gap-2.5", collapsed && "md:mt-2 md:justify-center")}>
            <span className="bg-primary text-primary-foreground grid size-8 shrink-0 place-items-center rounded-[10px] shadow-sm ring-1 ring-black/5 dark:ring-white/10">
              <Logo className="size-[18px]" />
            </span>
            {!collapsed && (
              <>
                <p className="text-ink min-w-0 flex-1 truncate text-body leading-tight font-semibold tracking-tight">
                  Agent Sandbox
                </p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={toggle}
                  aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
                >
                  {dark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
                </Button>
              </>
            )}
          </div>

          {/* Health line: its own full-width row so it never crowds the controls. A semantic dot
              (green live / amber if any waiting / red offline) + plain-case counts; freshness is
              demoted to a quiet right-aligned timestamp so the live count reads first. */}
          {!collapsed && (
            <p className="mt-2.5 flex items-center gap-1.5 text-micro leading-none">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  !live ? "bg-destructive" : waiting.length ? "bg-attention" : "bg-ok breathe"
                )}
                aria-hidden
              />
              {live ? (
                <>
                  <span className="text-ink tabular font-medium">
                    {boxes.length} {boxes.length === 1 ? "machine" : "machines"}
                  </span>
                  {working > 0 && <span className="text-azure-text tabular">· {working} working</span>}
                  {waiting.length > 0 && (
                    <span className="text-attention-text tabular">· {waiting.length} waiting</span>
                  )}
                  <span className="text-ash/70 tabular ml-auto shrink-0" title={`updated ${freshness}`}>
                    {freshness}
                  </span>
                </>
              ) : (
                <span className="text-destructive font-medium">offline</span>
              )}
            </p>
          )}
        </header>

        {collapsed ? (
          /* Collapsed: an icon-only rail. Machines list is hidden; a dot on the Chat icon signals
             waiting. Tooltips name each control so the strip stays legible. */
          <nav className="flex flex-col items-center gap-1.5 px-2 pb-3" aria-label="Sections">
            <RailIcon onClick={newTask} icon={<Plus />} label="New task" primary />
            <RailIcon
              onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
              icon={<Search />}
              label="Search machines (⌘K)"
            />
            <div className="bg-border my-1 h-px w-6" aria-hidden />
            <RailIcon
              active={view === "chat"}
              onClick={showChat}
              icon={<MessageSquare />}
              label="Chat"
              dot={waiting.length > 0}
            />
            <RailIcon
              active={view === "sandboxes"}
              onClick={showSandboxes}
              icon={<LayoutGrid />}
              label={`Sandboxes${boxes.length ? ` (${boxes.length})` : ""}`}
              badge={boxes.length || undefined}
            />
            <div className="bg-border my-1 h-px w-6" aria-hidden />
            <RailIcon
              onClick={toggle}
              icon={dark ? <Moon /> : <Sun />}
              label={dark ? "Switch to light theme" : "Switch to dark theme"}
            />
          </nav>
        ) : (
          <>
            {/* Search pill — the reference's prominent "Search ⌘K" affordance, wired to the palette. */}
            <div className="flex flex-col gap-2 px-3 pb-3">
              <button
                type="button"
                onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
                className="text-ash hover:text-ink hover:bg-[var(--surface)] flex w-full cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-left text-meta transition-colors"
              >
                <Search className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">Search</span>
                <kbd className="stamp rounded border bg-[var(--surface)] px-1.5 py-0.5">⌘K</kbd>
              </button>
              <Button variant="primary" size="default" onClick={newTask} className="w-full justify-center rounded-md">
                <Plus />
                New task
              </Button>
            </div>

            {/* Primary nav. "Sandboxes" is its own destination: the chat answers "what am I building",
                this answers "what is running on my VPS, and does any of it need me". */}
            <div className="flex flex-col gap-0.5 px-3 pb-1">
              <NavItem active={view === "chat"} onClick={showChat} icon={<MessageSquare />} label="Chat" />
              <NavItem
                active={view === "sandboxes"}
                onClick={showSandboxes}
                icon={<LayoutGrid />}
                label="Sandboxes"
                badge={boxes.length || undefined}
              />
            </div>

            {/* A halted machine blocks on a person — the only thing here with a deadline. */}
            {waiting.length > 0 && (
              <button
                type="button"
                onClick={() => open(waiting[0].name)}
                className="mx-3 mt-2 mb-1 flex cursor-pointer items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--attention)_45%,transparent)] bg-[color-mix(in_srgb,var(--attention)_12%,transparent)] px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--attention)_18%,transparent)]"
              >
                <PauseCircle className="size-4 shrink-0 text-[var(--attention-text)]" aria-hidden />
                <span className="text-ink text-meta font-medium">{waiting.length} waiting on you</span>
                <span className="stamp ml-auto text-[var(--attention-text)]">answer →</span>
              </button>
            )}

            <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
              <Waypoints className="text-ash size-3.5" aria-hidden />
              <p className="stamp text-ash">machines</p>
              {boxes.length > 0 && <span className="stamp text-ash tabular ml-auto">{boxes.length}</span>}
            </div>

            {error && (
              <p role="alert" className="mx-4 mb-2 flex items-start gap-1.5 text-micro text-[var(--danger)]">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            <MachineList
              boxes={boxes}
              pending={pending}
              selected={view === "chat" ? selected : null}
              loading={!data && !error}
              onSelect={open}
            />

            {/* Bottom identity/status row — the reference's user-profile footer, mapped to a live
                connection stamp for our single-tenant console. */}
            <div className="border-t px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className="bg-accent text-accent-foreground grid size-7 shrink-0 place-items-center rounded-full text-meta font-semibold">
                  A
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-ink truncate text-meta font-medium">Operator</p>
                  <p className="stamp text-ash truncate">{live ? `connected · ${freshness}` : "offline"}</p>
                </div>
              </div>
            </div>
          </>
        )}
      </aside>

      {/* ───────────── main (floating workspace) ───────────── */}
      <main
        className={cn(
          "bg-card flex min-h-0 min-w-0 flex-col overflow-hidden md:rounded-xl md:border md:shadow-sm",
          // Mobile: the workspace (Hub/Thread/Sandboxes) shows when the rail is dismissed. On md+ the
          // grid always shows it beside the rail.
          mobileRail ? "hidden md:flex" : "flex"
        )}
      >
        <div className="min-h-0 flex-1">
          {view === "sandboxes" ? (
            <Sandboxes
              boxes={boxes}
              onOpen={open}
              onDestroyed={(name) => {
                if (selected === name) setSelected(null);
              }}
              onBack={backToRail}
            />
          ) : booting && !selectedBox ? (
            <BootingThread task={booting.task} warm={booting.warm} onBack={backToRail} />
          ) : selectedBox ? (
            <Thread
              box={selectedBox}
              asides={asides[selectedBox.name] ?? []}
              replies={replies[selectedBox.name] ?? []}
              onAsk={(q) => void ask(selectedBox.name, q)}
              onReplied={(text) =>
                setReplies((prev) => ({ ...prev, [selectedBox.name]: [...(prev[selectedBox.name] ?? []), text] }))
              }
              onBack={backToRail}
              onNew={newTask}
              onTornDown={(name) => {
                setSelected(null);
                setAsides((prev) => {
                  const { [name]: _gone, ...rest } = prev;
                  return rest;
                });
                setReplies((prev) => {
                  const { [name]: _dropped, ...rest } = prev;
                  return rest;
                });
              }}
            />
          ) : (
            <Hub
              boxes={boxes}
              sessionRuns={runs}
              onBooting={(task) =>
                setBooting({
                  task,
                  known: new Set(boxes.map((b) => b.name)),
                  // Infer warm from live pool state: an idle pool-free box means the claim reuses a
                  // pre-booted box (no microVM boot), so the copy is honest from the first frame
                  // rather than asserting a cold boot the user can see is false.
                  warm: boxes.some((b) => b.role === "pool-free"),
                })
              }
              onStarted={(box, task) => {
                remember(box, task);
                open(box);
              }}
              onFailed={() => setBooting(null)}
              onPending={(p) => setPending((prev) => [...prev, p])}
              onSettled={(id) => setPending((prev) => prev.filter((p) => p.id !== id))}
              onOpen={open}
              onBack={backToRail}
            />
          )}
        </div>
      </main>

        <CommandPalette boxes={boxes} onOpen={open} onNew={newTask} />
      </div>
    </TooltipProvider>
  );
}

function NavItem({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-body transition-colors",
        "[&_svg]:size-4",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-[var(--nav-ink)] hover:text-ink hover:bg-[var(--surface)]"
      )}
    >
      {icon}
      {label}
      {badge != null && <span className="stamp text-ash tabular ml-auto">{badge}</span>}
    </button>
  );
}

/** A single control in the collapsed rail: a square icon button with a tooltip label. */
function RailIcon({
  active,
  onClick,
  icon,
  label,
  badge,
  dot,
  primary,
}: {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  dot?: boolean;
  primary?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative grid size-10 cursor-pointer place-items-center rounded-lg transition-colors [&_svg]:size-4",
            primary
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : active
                ? "bg-accent text-accent-foreground"
                : "text-ash hover:text-ink hover:bg-[var(--surface)]"
          )}
        >
          {icon}
          {dot && (
            <span
              className="bg-[var(--attention)] absolute right-1.5 top-1.5 size-2 rounded-full ring-2 ring-[var(--card)]"
              aria-hidden
            />
          )}
          {badge != null && !dot && (
            <span className="stamp bg-[var(--surface)] text-ash tabular absolute -right-1 -top-1 min-w-4 rounded-full border px-1 text-center">
              {badge}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
