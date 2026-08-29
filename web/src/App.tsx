import * as React from "react";
import { Link, useLocation } from "react-router";
import { Bell, BellOff, Flame, Keyboard, LayoutGrid, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Pause, Plug, Plus, Search, Sun, TriangleAlert, UserRound } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { api, type FleetLifecycle, type FleetSnapshot } from "@/lib/api";
import { POLL_MS, isUp, isVisible, threadSort } from "@/lib/format";
import { legacyHashTarget, useConsoleRoute, useGo } from "@/lib/route";
import { usePoll } from "@/hooks/usePoll";
import { prefetch } from "@/lib/cache";
import { useStableBoxes } from "@/hooks/useStableBoxes";
import { useSessionRuns } from "@/hooks/useSessionRuns";
import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { MachineList } from "@/components/MachineList";
import { Hub } from "@/components/Hub";
import { Account } from "@/components/Account";
import { Connect } from "@/components/Connect";
import { Capacity } from "@/components/Capacity";
import { CommandPalette, openPalette, type PaletteAction } from "@/components/CommandPalette";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { Toaster } from "@/components/ui/sonner";
import { getMe, signOut } from "@/lib/auth";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Thread, type Aside } from "@/components/thread/Thread";
import { BootingThread } from "@/components/thread/BootingThread";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

// Secondary pages are code-split: the thread — the page you live in — never pays for them.
const Sandboxes = React.lazy(() => import("@/components/Sandboxes").then((m) => ({ default: m.Sandboxes })));
const Integrations = React.lazy(() => import("@/components/Integrations").then((m) => ({ default: m.Integrations })));
/** Hovering the nav item warms the chunk and both payloads, so the page paints complete on click. */
function prefetchIntegrations() {
  void import("@/components/Integrations");
  void prefetch("accounts", api.accounts).catch(() => {});
  void prefetch("mcp", api.mcpServers).catch(() => {});
}

const NO_LIFECYCLE: FleetLifecycle = { capacity: 0, poolSize: 0 };
const FLEET_CACHE_KEY = "asb-fleet-cache";

/** Last fleet snapshot this browser saw, for an instant first paint (then the poll corrects it). */
function readFleetCache(): FleetSnapshot | null {
  try {
    const raw = sessionStorage.getItem(FLEET_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as FleetSnapshot) : null;
    // Stale beyond a minute is worse than a skeleton: the machines may all be gone.
    return parsed && Array.isArray(parsed.boxes) && Date.now() - parsed.at < 60_000 ? parsed : null;
  } catch {
    return null;
  }
}
function writeFleetCache(s: FleetSnapshot) {
  try {
    sessionStorage.setItem(FLEET_CACHE_KEY, JSON.stringify(s));
  } catch {
    /* quota / private mode */
  }
}

/** "Updated 3s ago" — ticks once a second, but only re-renders itself, not the whole console. */
function Freshness({ updatedAt }: { updatedAt: number | null }) {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (!updatedAt) return <>connecting</>;
  const secs = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  return <>{secs < 2 ? "just now" : `${secs}s ago`}</>;
}

function usePersisted(key: string, initial: boolean) {
  const [v, setV] = React.useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : raw === "1";
    } catch {
      return initial;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, [key, v]);
  return [v, setV] as const;
}

export default function App() {
  const [dark, setDark] = usePersisted("asb-dark", false);
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  const [collapsed, setCollapsed] = usePersisted("asb-collapsed", false);

  const cached = React.useRef(readFleetCache());
  const { data, error, live, updatedAt } = usePoll<FleetSnapshot>((signal) => api.fleet(signal), POLL_MS, [], {
    initial: cached.current,
    onData: writeFleetCache,
  });
  const { runs, remember } = useSessionRuns();
  const lifecycle = data?.lifecycle ?? NO_LIFECYCLE;

  // Routing (react-router, browser history). A legacy `#/box/x` link is translated once on load.
  const route = useConsoleRoute();
  const go = useGo();
  const { hash } = useLocation();
  React.useEffect(() => {
    const legacy = legacyHashTarget(hash);
    if (legacy) go(legacy, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const view = route.view;
  const selected = route.view === "box" ? route.name : null;
  const [mobileRail, setMobileRail] = React.useState(() => route.view === "hub");

  const [booting, setBooting] = React.useState<{ task: string; known: Map<string, string>; warm: boolean } | null>(null);
  const [pending, setPending] = React.useState<{ id: string; task: string }[]>([]);
  const [asides, setAsides] = React.useState<Record<string, Aside[]>>({});
  const [replies, setReplies] = React.useState<Record<string, string[]>>({});

  const reported = React.useMemo(() => (data && Array.isArray(data.boxes) ? data.boxes.filter(isVisible) : null), [data]);
  const boxes = useStableBoxes(reported);
  // The Machines list shows RUNS. An unclaimed warm box is capacity, not a run — it lives in the
  // capacity strip and the fleet view. Hiding it here also makes a warm claim read as one clean
  // transition: the "booting" placeholder becomes the claimed row, with no idle row shuffling around.
  const runs_ = React.useMemo(() => boxes.filter((b) => b.role !== "pool-free"), [boxes]);
  const warmReady = boxes.filter((b) => b.role === "pool-free" && isUp(b)).length;
  const selectedBox = boxes.find((b) => b.name === selected) ?? null;
  const waiting = runs_.filter((b) => b.runState === "waiting");
  const working = runs_.filter((b) => b.runState === "running" && isUp(b)).length;

  const open = React.useCallback(
    (name: string) => {
      setBooting(null);
      go({ view: "box", name });
      setMobileRail(false);
    },
    [go]
  );
  const newTask = React.useCallback(() => {
    setBooting(null);
    go({ view: "hub" });
    setMobileRail(false);
  }, [go]);
  const backToRail = () => setMobileRail(true);
  const showFleet = React.useCallback(() => {
    go({ view: "fleet" });
    setMobileRail(false);
  }, [go]);
  const showAccounts = React.useCallback(() => {
    go({ view: "integrations" });
    setMobileRail(false);
  }, [go]);
  const showAccount = React.useCallback(() => {
    go({ view: "account" });
    setMobileRail(false);
  }, [go]);
  const showConnect = React.useCallback(() => {
    go({ view: "connect" });
    setMobileRail(false);
  }, [go]);

  const notify = useNotifications(boxes, open);
  const [shortcuts, setShortcuts] = React.useState(false);
  const paletteActions = React.useMemo<PaletteAction[]>(
    () => [
      { id: "fleet", label: "Fleet view", hint: "g f", icon: <LayoutGrid />, run: showFleet },
      { id: "integrations", label: "Integrations", hint: "g a", icon: <Plug />, run: showAccounts },
      { id: "theme", label: dark ? "Switch to light theme" : "Switch to dark theme", icon: dark ? <Sun /> : <Moon />, run: () => setDark(!dark) },
      { id: "account", label: "Account", icon: <UserRound />, run: showAccount },
      { id: "keys", label: "Keyboard shortcuts", hint: "?", icon: <Keyboard />, run: () => setShortcuts(true) },
    ],
    [showFleet, showAccounts, showAccount, dark, setDark]
  );

  React.useEffect(() => {
    if (booting || !data) return;
    if (selected && !boxes.some((b) => b.name === selected)) go({ view: "hub" }, { replace: true });
  }, [selected, data, boxes, booting, go]);

  // Attach to the delegated box the instant it surfaces: a cold boot is a brand-new session box; a
  // warm claim is an existing pool-free box whose role flips to pool-claimed (same name).
  React.useEffect(() => {
    if (!booting) return;
    const fresh = boxes.find((b) => {
      if (b.role === "pool-free") return false;
      const before = booting.known.get(b.name);
      if (before === undefined) return true;
      return before === "pool-free" && b.role === "pool-claimed";
    });
    if (!fresh) return;
    go({ view: "box", name: fresh.name });
    setBooting(null);
    setPending([]);
  }, [booting, boxes, go]);

  // Keyboard: n new · j/k machines · / composer · g f fleet · g a accounts.
  const focusComposer = React.useRef<(() => void) | null>(null);
  const onFocusRequest = React.useCallback((f: () => void) => {
    focusComposer.current = f;
  }, []);
  React.useEffect(() => {
    let pendingG = false;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "g") {
        pendingG = true;
        window.setTimeout(() => (pendingG = false), 800);
        return;
      }
      if (pendingG && e.key === "f") return showFleet();
      if (pendingG && e.key === "a") return showAccounts();
      if (e.key === "n") return newTask();
      if (e.key === "?") return setShortcuts(true);
      if (e.key === "/") {
        e.preventDefault();
        focusComposer.current?.();
        return;
      }
      if (e.key === "j" || e.key === "k") {
        const sorted = [...runs_].sort(threadSort);
        if (!sorted.length) return;
        const i = sorted.findIndex((b) => b.name === selected);
        const next = e.key === "j" ? Math.min(sorted.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
        open(sorted[next].name);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [runs_, selected, open, newTask, showFleet, showAccounts]);

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
          answer: res.timedOut ? `${res.answer}\n\n_(time cap reached — this answer may be partial)_` : res.answer,
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

  const health = !live && !data ? "offline" : waiting.length ? "attention" : "ok";
  const loading = !data && !error;
  const paneKey =
    view === "fleet" ? "fleet" : view === "integrations" ? "integrations" : view === "account" ? "account" : view === "connect" ? "connect" : booting && !selectedBox ? "booting" : selectedBox ? `box:${selectedBox.name}` : view === "box" && !data ? "box-loading" : "hub";

  return (
    <TooltipProvider delayDuration={400}>
      <Toaster position="top-center" />
      <div
        className={cn(
          "bg-background grid h-full grid-cols-1 transition-[grid-template-columns] duration-200",
          collapsed ? "md:grid-cols-[3.5rem_minmax(0,1fr)]" : "md:grid-cols-[17rem_minmax(0,1fr)]"
        )}
      >
        <aside className={cn("bg-card flex min-h-0 flex-col overflow-hidden md:border-r", mobileRail ? "flex" : "hidden md:flex")}>
          <div className={cn("flex h-14 shrink-0 items-center gap-2.5 px-3", collapsed && "md:justify-center md:px-0")}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/" aria-label="Agent Sandbox home" className="bg-primary text-primary-foreground hover:bg-primary/80 grid size-8 shrink-0 place-items-center rounded-md transition-colors">
                  <Logo className="size-[18px]" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Home page</TooltipContent>
            </Tooltip>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <Link to="/" className="text-foreground hover:text-live block truncate text-body leading-tight font-semibold tracking-[-0.01em] transition-colors">
                    Agent Sandbox
                  </Link>
                  <p className="text-muted-foreground flex items-center gap-1.5 text-micro leading-tight">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        health === "offline" && "bg-destructive",
                        health === "attention" && "bg-attention",
                        health === "ok" && "bg-ok breathe"
                      )}
                      aria-hidden
                    />
                    {data ? (
                      <span className="tabular truncate">
                        {runs_.length} {runs_.length === 1 ? "run" : "runs"}
                        {working > 0 && <> · {working} working</>}
                        {waiting.length > 0 && <span className="text-attention-text"> · {waiting.length} waiting</span>}
                      </span>
                    ) : error ? (
                      <span className="text-destructive font-medium">offline</span>
                    ) : (
                      <span>connecting…</span>
                    )}
                  </p>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" className="hidden md:inline-flex">
                  <PanelLeftClose className="size-4" />
                </Button>
              </>
            )}
          </div>

          {collapsed ? (
            <nav className="flex flex-1 flex-col items-center gap-1.5 px-2 pt-1 pb-3" aria-label="Sections">
              <RailIcon onClick={newTask} icon={<Plus />} label="New task (n)" primary />
              <RailIcon onClick={openPalette} icon={<Search />} label="Search machines (⌘K)" />
              <RailIcon active={view === "fleet"} onClick={showFleet} icon={<LayoutGrid />} label="Fleet" badge={boxes.length || undefined} dot={waiting.length > 0} />
              <span className="contents" onMouseEnter={prefetchIntegrations}>
                <RailIcon active={view === "integrations"} onClick={showAccounts} icon={<Plug />} label="Integrations" />
              </span>
              <div className="mt-auto flex flex-col items-center gap-1.5">
                <RailIcon onClick={() => setDark(!dark)} icon={dark ? <Moon /> : <Sun />} label={dark ? "Light theme" : "Dark theme"} />
                <RailIcon onClick={() => setCollapsed(false)} icon={<PanelLeftOpen />} label="Expand sidebar" />
              </div>
            </nav>
          ) : (
            <>
              <div className="flex flex-col gap-2 px-3 pt-1 pb-3">
                <Button variant="primary" onClick={newTask} className="w-full justify-center">
                  <Plus />
                  New task
                  <kbd className="text-primary-foreground/60 ml-auto">n</kbd>
                </Button>
                <button
                  type="button"
                  onClick={openPalette}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md border px-3 text-left text-meta transition-colors"
                >
                  <Search className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1">Search machines</span>
                  <kbd className="text-muted-foreground rounded border px-1.5 py-0.5">⌘K</kbd>
                </button>
              </div>

              <AnimatePresence initial={false}>
                {waiting.length > 0 && (
                  <motion.button
                    key="queue"
                    type="button"
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: "auto", marginBottom: 8 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    onClick={() => open(waiting[0].name)}
                    className="border-attention/50 bg-attention/10 hover:bg-attention/20 mx-3 flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-md border px-3 py-2.5 text-left transition-colors"
                  >
                    <Pause className="text-attention-text size-4 shrink-0" strokeWidth={2.5} aria-hidden />
                    <span className="text-foreground min-w-0 flex-1 truncate text-meta font-medium">
                      {waiting.length === 1 ? "1 machine needs you" : `${waiting.length} machines need you`}
                    </span>
                    <span className="text-attention-text text-micro font-semibold">Answer →</span>
                  </motion.button>
                )}
              </AnimatePresence>

              <div className="flex items-center gap-2 px-4 pt-2 pb-1">
                <p className="text-foreground text-meta font-semibold">Machines</p>
                <span className="ml-auto">
                  {lifecycle.capacity > 0 ? (
                    <Capacity boxes={boxes} capacity={lifecycle.capacity} size="sm" />
                  ) : (
                    runs_.length > 0 && <span className="text-muted-foreground tabular text-micro">{runs_.length}</span>
                  )}
                </span>
              </div>

              {error && (
                <p role="alert" className="text-destructive mx-4 mb-2 flex items-start gap-1.5 text-micro">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {error}
                </p>
              )}

              <MachineList boxes={runs_} pending={pending} selected={view === "box" ? selected : null} loading={loading} onSelect={open} sleepTtlSec={lifecycle.sleepTtlSec} />

              {/* Warm capacity is a fact about the fleet, not a run: one quiet line, not a list row. */}
              {warmReady > 0 && (
                <button
                  type="button"
                  onClick={showFleet}
                  className="text-muted-foreground hover:text-foreground mx-3 mb-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-micro transition-colors"
                >
                  <Flame className="text-ok size-3.5 shrink-0" aria-hidden />
                  {warmReady === 1 ? "1 warm machine ready" : `${warmReady} warm machines ready`} — a new task starts in seconds
                </button>
              )}

              <div className="flex flex-col gap-0.5 border-t px-2 py-2">
                <NavItem active={view === "fleet"} onClick={showFleet} icon={<LayoutGrid />} label="Fleet view" badge={boxes.length || undefined} shortcut="g f" />
                <span className="contents" onMouseEnter={prefetchIntegrations}>
                  <NavItem active={view === "integrations"} onClick={showAccounts} icon={<Plug />} label="Integrations" shortcut="g a" />
                </span>
                {getMe()?.mode === "saas" && (
                  <NavItem
                    active={view === "account" || view === "connect"}
                    onClick={showAccount}
                    icon={
                      getMe()?.kind === "user" ? (
                        <span className="bg-live/10 text-live grid size-4 place-items-center rounded-full text-[9px] font-semibold uppercase">{((getMe() as { name: string | null; login: string }).name || (getMe() as { login: string }).login).slice(0, 1)}</span>
                      ) : (
                        <UserRound />
                      )
                    }
                    label={getMe()?.kind === "user" ? (getMe() as { name: string | null; login: string }).name || (getMe() as { login: string }).login : "Operator"}
                  />
                )}
                <div className="flex items-center justify-between px-2.5 pt-1">
                  <p className="text-muted-foreground text-micro">{live ? <>Updated <Freshness updatedAt={updatedAt} /></> : data ? "Reconnecting…" : error ? "Offline — retrying" : "Connecting…"}</p>
                  <div className="flex items-center">
                    {notify.supported && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon-xs" onClick={() => void notify.toggle()} aria-pressed={notify.enabled} aria-label="Desktop notifications">
                            {notify.enabled ? <Bell className="text-live" /> : <BellOff />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {notify.enabled ? "Notifying when a machine needs you or finishes" : "Notify me when a machine needs me or finishes"}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {getMe()?.kind === "user" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Sign out"
                            onClick={() =>
                              api
                                .logout()
                                .catch(() => {})
                                .finally(() => signOut())
                            }
                          >
                            <LogOut />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Sign out {getMe()?.kind === "user" ? (getMe() as { login: string }).login : ""}</TooltipContent>
                      </Tooltip>
                    )}
                    <Button variant="ghost" size="icon-xs" onClick={() => setDark(!dark)} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
                      {dark ? <Moon /> : <Sun />}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </aside>

        <main className={cn("bg-background flex min-h-0 min-w-0 flex-col overflow-hidden", mobileRail ? "hidden md:flex" : "flex")}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={paneKey}
              className="min-h-0 flex-1"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            >
              <React.Suspense fallback={<PageSkeleton />}>
                {view === "fleet" ? (
                  <Sandboxes
                    boxes={boxes}
                    lifecycle={lifecycle}
                    loading={loading}
                    onOpen={open}
                    onDestroyed={() => {}}
                    onBack={backToRail}
                  />
                ) : view === "integrations" ? (
                  <Integrations onBack={backToRail} />
                ) : view === "account" ? (
                  <Account onBack={backToRail} onConnect={showConnect} />
                ) : view === "connect" ? (
                  <Connect welcome={new URLSearchParams(location.search).has("welcome")} onDone={() => go({ view: "hub" })} onBack={showAccount} />
                ) : booting && !selectedBox ? (
                  <BootingThread task={booting.task} warm={booting.warm} onBack={backToRail} />
                ) : view === "box" && !selectedBox && !data ? (
                  <ThreadPageSkeleton />
                ) : selectedBox ? (
                  <Thread
                    box={selectedBox}
                    lifecycle={lifecycle}
                    asides={asides[selectedBox.name] ?? []}
                    replies={replies[selectedBox.name] ?? []}
                    onAsk={(q) => void ask(selectedBox.name, q)}
                    onReplied={(text) =>
                      setReplies((prev) => ({ ...prev, [selectedBox.name]: [...(prev[selectedBox.name] ?? []), text] }))
                    }
                    onBack={backToRail}
                    onNew={newTask}
                    onFocusRequest={onFocusRequest}
                    onReplyFailed={(text) =>
                      setReplies((prev) => {
                        const list = [...(prev[selectedBox.name] ?? [])];
                        const i = list.lastIndexOf(text);
                        if (i >= 0) list.splice(i, 1);
                        return { ...prev, [selectedBox.name]: list };
                      })
                    }
                    onTornDown={(name) => {
                      go({ view: "hub" });
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
                    lifecycle={lifecycle}
                    loading={loading}
                    sessionRuns={runs}
                    onBooting={(task) =>
                      setBooting({
                        task,
                        known: new Map(boxes.map((b) => [b.name, b.role])),
                        warm: warmReady > 0,
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
              </React.Suspense>
            </motion.div>
          </AnimatePresence>
        </main>

        <CommandPalette boxes={runs_} actions={paletteActions} onOpen={open} onNew={newTask} />
        <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
      </div>
    </TooltipProvider>
  );
}

/** Placeholder while a code-split page loads (sub-100ms on a warm cache; shaped like a page). */
/** The thread page before the fleet has answered: header, connected strip and transcript placeholders. */
function ThreadPageSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-label="Loading run">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <span className="bg-muted h-6 w-16 animate-pulse rounded-full" />
        <span className="bg-muted h-3.5 w-72 animate-pulse rounded" />
        <span className="bg-muted ml-auto h-3 w-40 animate-pulse rounded" />
      </div>
      <div className="h-9 shrink-0 border-b" />
      <div className="mx-auto w-full max-w-3xl flex-1 px-6 pt-8">
        <div className="bg-muted ml-auto h-11 w-[46%] animate-pulse rounded-xl" />
        <div className="mt-8 space-y-2.5">
          <div className="bg-muted h-2.5 w-14 animate-pulse rounded" />
          <div className="bg-muted h-3.5 w-[92%] animate-pulse rounded" />
          <div className="bg-muted h-3.5 w-[78%] animate-pulse rounded" />
          <div className="bg-muted h-3.5 w-[85%] animate-pulse rounded" />
        </div>
        <div className="bg-muted mt-7 h-8 w-56 animate-pulse rounded-full" />
        <div className="mt-7 space-y-2.5">
          <div className="bg-muted h-2.5 w-14 animate-pulse rounded" />
          <div className="bg-muted h-3.5 w-[88%] animate-pulse rounded" />
          <div className="bg-muted h-3.5 w-[64%] animate-pulse rounded" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-6 pb-4">
        <div className="bg-card h-24 rounded-xl border" />
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-9" aria-busy="true">
      <Bar className="h-7 w-40" />
      <Bar className="mt-3 h-3 w-[70%]" />
      <Bar className="mt-2 h-3 w-[50%]" />
      <div className="mt-8 flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Bar key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function NavItem({
  active,
  onClick,
  icon,
  label,
  badge,
  shortcut,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-meta transition-colors [&_svg]:size-4",
        "relative",
        active ? "bg-accent text-foreground font-medium before:bg-live before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:rounded-full" : "text-muted-foreground hover:text-foreground hover:bg-muted"
      )}
    >
      {icon}
      {label}
      <span className="ml-auto flex items-center gap-2">
        {shortcut && <kbd className="text-faint hidden group-hover:inline">{shortcut}</kbd>}
        {badge != null && <span className="text-muted-foreground tabular text-micro">{badge}</span>}
      </span>
    </button>
  );
}

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
            "relative grid size-10 cursor-pointer place-items-center rounded-md transition-colors [&_svg]:size-4",
            primary
              ? "bg-primary text-primary-foreground hover:bg-primary/80"
              : active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          {icon}
          {dot && <span className="bg-attention ring-card absolute top-1.5 right-1.5 size-2 rounded-full ring-2" aria-hidden />}
          {badge != null && !dot && (
            <span className="bg-live ring-card absolute top-0.5 right-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[9px] leading-4 font-semibold text-white ring-2 tabular-nums">
              {badge}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
