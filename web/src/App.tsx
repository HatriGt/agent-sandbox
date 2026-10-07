import * as React from "react";
import { Link, useLocation, useNavigationType } from "react-router";
import { ArrowRight, Bell, BellOff, Brain, ChevronRight, Clock, Flame, Keyboard, Layers, LayoutGrid, ListChecks, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Pause, Plug, PlugZap, Plus, Search, Shield, Sun, UserRound, WifiOff, Workflow, Zap } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { api, type FleetLifecycle, type FleetSnapshot } from "@/lib/api";
import { POLL_MS, isUp, isVisible, threadSort, threadTitle } from "@/lib/format";
import { questionHeadline } from "@/lib/question";
import { legacyHashTarget, useConsoleRoute, useGo } from "@/lib/route";
import type { AutopilotTab } from "@/components/AutopilotPage";
import { usePoll } from "@/hooks/usePoll";
import { prefetch } from "@/lib/cache";
import { useStableBoxes } from "@/hooks/useStableBoxes";
import { dropWatchCache } from "@/hooks/useWatchStream";
import { useSessionRuns } from "@/hooks/useSessionRuns";
import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Logo } from "@/components/ui/logo";
import { MachineList } from "@/components/MachineList";
import { Hub } from "@/components/Hub";
import { Account } from "@/components/Account";
import { Connect } from "@/components/Connect";
import { Admin } from "@/components/Admin";
import { PageEnter } from "@/components/ui/page";
import { TrialBadge } from "@/components/TrialBadge";
import { Capacity } from "@/components/Capacity";
import { CommandPalette, openPalette, type PaletteAction } from "@/components/CommandPalette";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { Toaster } from "@/components/ui/sonner";
import { getMe, signOut } from "@/lib/auth";
import { Tooltip, TooltipContent, TooltipKbd, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Thread, type Aside } from "@/components/thread/Thread";
import { BootingThread } from "@/components/thread/BootingThread";
import { Bar } from "@/components/thread/Skeletons";
import { Collapse } from "@/components/ui/collapse";
import { IconSwap } from "@/components/ui/icon-swap";
import { NumberTicker } from "@/components/ui/number-ticker";
import { cn } from "@/lib/utils";

// Secondary pages are code-split: the thread — the page you live in — never pays for them.
const Sandboxes = React.lazy(() => import("@/components/Sandboxes").then((m) => ({ default: m.Sandboxes })));
const Integrations = React.lazy(() => import("@/components/Integrations").then((m) => ({ default: m.Integrations })));
const SkillsPage = React.lazy(() => import("@/components/SkillsPage").then((m) => ({ default: m.SkillsPage })));
const MemoryPage = React.lazy(() => import("@/components/Memory").then((m) => ({ default: m.MemoryPage })));
const AutopilotPage = React.lazy(() => import("@/components/AutopilotPage").then((m) => ({ default: m.AutopilotPage })));
const AutomationRunsPage = React.lazy(() => import("@/components/AutomationRunsPage").then((m) => ({ default: m.AutomationRunsPage })));
const HarnessesPage = React.lazy(() => import("@/components/HarnessesPage").then((m) => ({ default: m.HarnessesPage })));
const History = React.lazy(() => import("@/components/History").then((m) => ({ default: m.History })));
const PullRequestPage = React.lazy(() => import("@/components/pr/PullRequestPage").then((m) => ({ default: m.PullRequestPage })));
/** Hovering the nav item warms the chunk and both payloads, so the page paints complete on click. */
function prefetchIntegrations() {
  void import("@/components/Integrations");
  void prefetch("accounts", api.accounts).catch(() => {});
  void prefetch("mcp", api.mcpServers).catch(() => {});
}
function prefetchHistory() {
  void import("@/components/History");
}

function prefetchSkills() {
  void import("@/components/SkillsPage");
  void prefetch("skills", api.skills).catch(() => {});
}

const NO_LIFECYCLE: FleetLifecycle = { capacity: 0, poolSize: 0 };
const FLEET_CACHE_KEY = "asb-fleet-cache";

/** Last fleet snapshot this browser saw, for an instant first paint (then the poll corrects it). */
function readFleetCache(): FleetSnapshot | null {
  try {
    const raw = sessionStorage.getItem(FLEET_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as FleetSnapshot & { cachedAt?: number }) : null;
    // Stale beyond a minute is worse than a skeleton: the machines may all be gone. TTL against the
    // CLIENT clock (`cachedAt`, stamped at write) — `at` is server time, and a skewed client clock
    // made the cache permanently fresh (or never used) against it.
    const at = parsed?.cachedAt ?? parsed?.at ?? 0;
    return parsed && Array.isArray(parsed.boxes) && Date.now() - at < 60_000 ? parsed : null;
  } catch {
    return null;
  }
}
function writeFleetCache(s: FleetSnapshot) {
  try {
    sessionStorage.setItem(FLEET_CACHE_KEY, JSON.stringify({ ...s, cachedAt: Date.now() }));
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

/**
 * The fleet poll failed. A person reads one plain sentence about what it means for them; the raw
 * controller error ("msb ls failed (exit 255): Host key verification failed.") stays available
 * behind a disclosure for whoever has to fix the host, never as the headline.
 */
function explainFleetError(raw: string): string {
  const r = raw.toLowerCase();
  if (/host key|permission denied|publickey|ssh/.test(r)) return "The controller can't reach the machine host over SSH.";
  if (/401|unauthori|forbidden|403/.test(r)) return "This token is no longer accepted by the controller.";
  if (/failed to fetch|networkerror|load failed|abort|timeout|timed out/.test(r)) return "The controller isn't answering.";
  if (/502|503|504|bad gateway|unavailable/.test(r)) return "The controller is restarting or being deployed.";
  return "The fleet can't be read right now.";
}
/**
 * Offline is a CONDITION, not a failure of yours: the notice, the brand line and the footer all
 * speak in one quiet voice (muted ink, a breathing dot for "still trying") — red stays reserved
 * for a run that failed. The raw error waits behind a disclosure for whoever fixes the host.
 */
function ConnectionNotice({ error, stale }: { error: string; stale: boolean }) {
  return (
    <div role="status" className="offline-notice text-foreground mx-3 mb-2 rounded-lg border px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span className="bg-muted text-muted-foreground mt-px grid size-5 shrink-0 place-items-center rounded-full" aria-hidden>
          <WifiOff className="size-3" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-meta leading-snug font-medium">{stale ? "Connection lost" : "Can't reach the fleet"}</p>
          <p className="text-muted-foreground mt-0.5 text-micro leading-snug">
            {explainFleetError(error)} {stale ? "Showing the last snapshot." : ""}
          </p>
          <p className="text-faint mt-1 flex items-center gap-1.5 text-micro">
            <span className="bg-muted-foreground/60 breathe size-1.5 rounded-full" aria-hidden />
            Retrying every {Math.round(POLL_MS / 1000)}s
          </p>
        </div>
      </div>
      <details className="group mt-1.5">
        <summary className="text-faint hover:text-foreground -mx-1 flex w-fit cursor-pointer list-none items-center gap-1 rounded px-1 py-0.5 text-micro select-none [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3 transition-transform duration-150 group-open:rotate-90" aria-hidden />
          Details
        </summary>
        <pre className="stamp text-muted-foreground bg-muted/70 mt-1.5 max-h-24 overflow-auto rounded-md px-2 py-1.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{error}</pre>
      </details>
    </div>
  );
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
  // Thread density: chat (default) folds the agent's work to one line per stretch; trace shows every step.
  const [traceDensity, setTraceDensity] = usePersisted("asb-trace-density", false);

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
  // Phone: the rail is a left drawer over the page (Sheet), never a replacement for it.
  const [mobileRail, setMobileRail] = React.useState(false);

  const [booting, setBooting] = React.useState<{
    task: string;
    known: Map<string, string>;
    warm: boolean;
    loaded: boolean;
    /** Set when delegate returns: the assigned box. The pane morphs to "connecting to <name>". */
    machine?: string;
    /** Repos attached because the task named them — shown inline, in the pane and the thread. */
    inferred?: string[];
  } | null>(null);
  const bootingRef = React.useRef(booting);
  bootingRef.current = booting;
  // The inline "Attached from the task" note, keyed by box, surviving the booting→thread swap.
  const [inferredNotes, setInferredNotes] = React.useState<Record<string, string[]>>({});
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
  // The fleet reports a cold-booting box (boxStatus "creating"/"starting") but `isVisible` hides it
  // until it is up. A box URL for such a box is a run being born — never "unknown, go home".
  const selectedRaw = React.useMemo(
    () => (selected && data && Array.isArray(data.boxes) ? data.boxes.find((b) => b.name === selected) ?? null : null),
    [selected, data]
  );
  // The box this tab just launched. Booting pane → live Thread for it share ONE pane key, so the
  // hand-off is a content change inside a mounted pane rather than a second keyed swap.
  const [launched, setLaunched] = React.useState<string | null>(null);
  // The launched run's task as typed: the Task bubble must never blink out while the fleet has not
  // yet reported the box (or its task) — the launch shell and the Thread both render it from here.
  const launchTask = React.useRef("");
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
    // Land ready to type: the hub composer is the whole point of "n". Two frames — one for the
    // route change to commit, one for the Hub to mount.
    requestAnimationFrame(() => requestAnimationFrame(() => (document.getElementById("new-task") as HTMLTextAreaElement | null)?.focus()));
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
  const showSkills = React.useCallback(() => {
    go({ view: "skills" });
    setMobileRail(false);
  }, [go]);
  const showMemory = React.useCallback(() => {
    go({ view: "memory" });
    setMobileRail(false);
  }, [go]);
  const showHarnesses = React.useCallback(() => {
    go({ view: "harnesses" });
    setMobileRail(false);
  }, [go]);
  const showWorkflows = React.useCallback(() => {
    go({ view: "workflows" });
    setMobileRail(false);
  }, [go]);
  const showAutomations = React.useCallback(() => go({ view: "automations" }), [go]);
  const goAutopilot = React.useCallback((t: AutopilotTab) => go({ view: t === "playbooks" ? "workflows" : t }), [go]);
  const showHistory = React.useCallback(() => {
    go({ view: "history" });
    setMobileRail(false);
  }, [go]);
  const showAccount = React.useCallback(() => {
    go({ view: "account" });
    setMobileRail(false);
  }, [go]);
  const showAdmin = React.useCallback(() => {
    go({ view: "admin" });
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
      { id: "fleet", label: "Fleet view", hint: "g f", icon: <LayoutGrid />, group: "Go to", run: showFleet },
      { id: "automations", label: "Autopilot", icon: <Workflow />, group: "Go to", run: showAutomations },
      { id: "history", label: "History", hint: "g h", icon: <Clock />, group: "Go to", run: showHistory },
      { id: "skills", label: "Skills", hint: "g s", icon: <Zap />, group: "Go to", run: showSkills },
      { id: "memory", label: "Memory", icon: <Brain />, group: "Go to", keywords: "notes remembered learned across runs", run: showMemory },
      { id: "harnesses", label: "Harnesses", icon: <Layers />, group: "Go to", keywords: "drivers rules hooks egress budget compare bundle", run: showHarnesses },
      { id: "workflows", label: "Playbooks", icon: <ListChecks />, group: "Go to", keywords: "workflows steps pipeline checks retry yaml autopilot", run: showWorkflows },
      { id: "integrations", label: "Integrations", hint: "g a", icon: <Plug />, group: "Go to", run: showAccounts },
      { id: "account", label: "Account", icon: <UserRound />, group: "Go to", keywords: "settings profile keys notifications", run: showAccount },
      ...(getMe()?.mode === "saas" && getMe()?.role === "admin" ? [{ id: "admin", label: "Admin · users", icon: <Shield />, group: "Go to", keywords: "people members", run: showAdmin }] : []),
      { id: "connect", label: "Connect an IDE", icon: <PlugZap />, group: "Go to", keywords: "cursor claude code mcp api key", run: showConnect },
      { id: "theme", label: dark ? "Switch to light theme" : "Switch to dark theme", icon: dark ? <Sun /> : <Moon />, keywords: "theme dark light mode appearance", run: () => setDark(!dark) },
      { id: "sidebar", label: collapsed ? "Expand sidebar" : "Collapse sidebar", icon: collapsed ? <PanelLeftOpen /> : <PanelLeftClose />, keywords: "rail navigation", run: () => setCollapsed(!collapsed) },
      { id: "keys", label: "Keyboard shortcuts", hint: "?", icon: <Keyboard />, keywords: "help keys", run: () => setShortcuts(true) },
    ],
    [showFleet, showAutomations, showHistory, showSkills, showMemory, showHarnesses, showWorkflows, showAccounts, showAccount, showAdmin, showConnect, dark, setDark, collapsed, setCollapsed]
  );

  React.useEffect(() => {
    if (booting || !data) return;
    if (selected && !boxes.some((b) => b.name === selected) && !selectedRaw) go({ view: "hub" }, { replace: true });
  }, [selected, selectedRaw, data, boxes, booting, go]);

  // Attach to the delegated box the instant it surfaces: a cold boot is a brand-new session box; a
  // warm claim is an existing pool-free box whose role flips to pool-claimed (same name).
  React.useEffect(() => {
    if (!booting) return;
    // Cold-tab guard: if the fleet had not loaded when the task was submitted, `known` is an empty
    // snapshot and EVERY box in the first poll would look "fresh" — attaching would drop the user
    // into some pre-existing run's thread. Re-baseline off that first real snapshot instead; only a
    // box appearing AFTER it counts as ours.
    if (!booting.loaded) {
      if (data) setBooting({ ...booting, loaded: true, known: new Map(boxes.map((b) => [b.name, b.role])) });
      return;
    }
    // Once delegate has returned, the box NAME is known — attach on it directly (exact, no
    // heuristics). The role diff below remains for the window before delegate resolves.
    const fresh = booting.machine
      ? boxes.find((b) => b.name === booting.machine && b.role !== "pool-free")
      : boxes.find((b) => {
          if (b.role === "pool-free") return false;
          const before = booting.known.get(b.name);
          if (before === undefined) return true;
          return before === "pool-free" && b.role === "pool-claimed";
        });
    if (!fresh) return;
    // A warm claim reuses the pool box's NAME: anything cached about it (a hover prefetch of the
    // idle pool box) is the previous life's log and would be spliced ahead of the new run's output.
    if (booting.known.get(fresh.name) === "pool-free") dropWatchCache(fresh.name);
    launchTask.current = booting.task;
    setLaunched(fresh.name);
    if (selected !== fresh.name) go({ view: "box", name: fresh.name });
    setBooting(null);
    setPending([]);
  }, [booting, boxes, go, selected]);

  // Keyboard: n new · j/k machines · / composer · g f fleet · g a accounts.
  const focusComposer = React.useRef<(() => void) | null>(null);
  const onFocusRequest = React.useCallback((f: () => void) => {
    focusComposer.current = f;
  }, []);
  // A `g x` shortcut flashes the nav item it landed on (150ms bg-muted pulse) so the keystroke has a
  // visible echo even when the page it opens is already showing.
  const [flash, setFlash] = React.useState<string | null>(null);
  const flashTimer = React.useRef<number | null>(null);
  const pulse = React.useCallback((id: string) => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setFlash(id);
    flashTimer.current = window.setTimeout(() => setFlash(null), 150);
  }, []);
  React.useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

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
      if (pendingG && e.key === "f") return (pulse("fleet"), showFleet());
      if (pendingG && e.key === "h") return (pulse("history"), showHistory());
      if (pendingG && e.key === "s") return (pulse("skills"), showSkills());
      if (pendingG && e.key === "a") return (pulse("integrations"), showAccounts());
      if (e.key === "n") return newTask();
      if (e.key === "?") return setShortcuts(true);
      if (e.key === "/") {
        e.preventDefault();
        // The thread's SendBar registers a focuser; on the hub (or if the ref is a stale closure
        // from an unmounted thread) fall back to the hub composer so "/" always does something.
        const hub = document.getElementById("new-task") as HTMLTextAreaElement | null;
        if (hub) hub.focus();
        else focusComposer.current?.();
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
  }, [runs_, selected, open, newTask, showFleet, showHistory, showSkills, showAccounts, pulse]);

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
    // view "box" with no matching box yet is a JUST-STARTED session: delegate returned and the URL
    // moved, but the fleet snapshot won't list the new box until the next poll. Falling through to
    // "hub" here rendered the composer on top of the box URL for a few seconds (observed live), so
    // hold the box-loading skeleton until the box surfaces (or the cleanup effect routes home).
    // Once the booting pane knows its machine it shares that box's pane key, so the swap to the real
    // Thread is a content change inside one pane — not a fade-out/fade-in remount (the jump-cut).
    view === "fleet" ? "fleet" : view === "history" ? "history" : view === "automations" ? "automations" : route.view === "automation-runs" ? `automation-runs:${route.id}` : view === "skills" ? "skills" : view === "memory" ? "memory" : view === "integrations" ? "integrations" : view === "account" ? "account" : view === "connect" ? "connect" : view === "welcome" ? "welcome" : view === "admin" ? "admin" : route.view === "pr" ? `pr:${route.repo}#${route.number}` : (booting && !selectedBox) || (view === "box" && selected === launched) ? "launch" : selectedBox ? `box:${selectedBox.name}` : view === "box" && selectedRaw ? `box:${selectedRaw.name}` : view === "box" ? "box-loading" : "hub";

  const reduceMotion = useReducedMotion();
  // Direction-aware pane motion: deeper (hub → page → box) enters from the right on phones, going
  // back enters from the left; desktop keeps the plain 6px rise. Transform + opacity only.
  const narrow = useNarrow();
  const depth = paneDepth(paneKey);
  const prevDepth = React.useRef(depth);
  const paneDir = depth === prevDepth.current ? 0 : depth > prevDepth.current ? 1 : -1;
  React.useEffect(() => {
    prevDepth.current = depth;
  }, [depth]);
  // Send → thread is ONE short fade: the outgoing hub leaves instantly (no exit beat under
  // mode="wait", which read as a blank frame) and the launch shell fades in without a slide.
  const paneCustom: PaneCustom = { dir: paneDir, launch: paneKey === "launch" };

  // View change: the page's scroller goes back to the top and focus lands on its h1 (or the main
  // region), so keyboard and screen-reader users start at the heading, not wherever focus was
  // stranded. Browser back (POP) restores the scroll offset that pane had when it was left.
  const mainRef = React.useRef<HTMLElement>(null);
  const navType = useNavigationType();
  const scrollMemory = React.useRef(new Map<string, number>());
  const scroller = () => mainRef.current?.querySelector<HTMLElement>("[data-scroll], .overflow-y-auto") ?? null;
  React.useLayoutEffect(() => {
    const key = paneKey;
    return () => {
      // Runs as the pane is about to swap: remember where the outgoing pane was scrolled to.
      const el = scroller();
      if (el) scrollMemory.current.set(key, el.scrollTop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneKey]);
  React.useEffect(() => {
    let alive = true;
    // Two frames: one for the pane to commit, one for a code-split page to mount behind Suspense.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!alive) return;
        const el = scroller();
        if (el) el.scrollTop = navType === "POP" ? (scrollMemory.current.get(paneKey) ?? 0) : 0;
        const active = document.activeElement as HTMLElement | null;
        // Something on the page (the hub composer via "n", a dialog) already claimed focus — leave it.
        if (active && active !== document.body && mainRef.current?.contains(active) && active.tagName !== "MAIN") return;
        if (active && (active.closest("[role=dialog]") || active.closest("[cmdk-root]"))) return;
        const h1 = mainRef.current?.querySelector<HTMLElement>("h1");
        const target = h1 ?? mainRef.current;
        if (!target) return;
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        // Programmatic focus is for screen readers, not for the eye: no ring on the title.
        target.style.outline = "none";
        target.focus({ preventScroll: true });
      })
    );
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneKey]);

  // The expanded rail body is rendered twice — in the desktop <aside> and inside the phone drawer.
  const railBody = (
    <>
      <div className="flex flex-col gap-2 px-3 pt-1 pb-3">
        <Button variant="primary" onClick={newTask} className="w-full justify-center">
          <Plus />
          New task
          <Kbd tone="inverse" className="ml-auto">n</Kbd>
        </Button>
        <button
          type="button"
          onClick={openPalette}
          className="text-muted-foreground hover:text-foreground hover:border-line-strong bg-background/60 hover:bg-background flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md border px-3 text-left text-meta transition-[color,background-color,border-color] duration-150"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">Search</span>
          <Kbd keys={["⌘", "K"]} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {waiting.length > 0 && (
          <motion.button
            key="queue"
            type="button"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0, marginBottom: 0, scale: 0.96 }}
            animate={{ opacity: 1, height: "auto", marginBottom: 8, scale: 1 }}
            exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0, marginBottom: 0, scale: 0.97, transition: { duration: 0.15 } }}
            transition={reduceMotion ? { duration: 0 } : { height: { duration: 0.25, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.2 }, scale: { type: "spring", stiffness: 420, damping: 26 } }}
            onClick={() => open(waiting[0].name)}
            className="border-attention/40 bg-card shadow-e1 hover:border-attention/70 hover:shadow-e2 group mx-3 flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-[border-color,box-shadow] duration-150"
          >
            <span className="bg-attention text-attention-ink grid size-6 shrink-0 place-items-center rounded-full" aria-hidden>
              <Pause className="size-3" strokeWidth={3} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-foreground block truncate text-meta font-medium">{waiting.length === 1 ? "1 machine needs you" : `${waiting.length} machines need you`}</span>
              <span className="text-muted-foreground block truncate text-micro">{questionHeadline(waiting[0].question) || threadTitle(waiting[0])}</span>
            </span>
            <span className="text-attention-text flex shrink-0 items-center gap-0.5 text-micro font-semibold">
              Answer
              <ArrowRight className="size-3 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      <div className="flex h-7 items-center gap-2 px-4 pt-1">
        <p className="label text-faint">Machines</p>
        <span className="ml-auto">
          {lifecycle.capacity > 0 ? (
            <Capacity boxes={boxes} capacity={lifecycle.capacity} size="sm" />
          ) : (
            runs_.length > 0 && <NumberTicker value={runs_.length} from={runs_.length} className="text-muted-foreground tabular text-micro" />
          )}
        </span>
      </div>

      <Collapse open={!!error && !live}>
        <ConnectionNotice error={error ?? ""} stale={!!data} />
      </Collapse>

      <MachineList boxes={runs_} pending={pending} selected={view === "box" ? selected : null} loading={loading} offline={!!error && !live && !data} onSelect={open} sleepTtlSec={lifecycle.sleepTtlSec} />

      {/* Warm capacity is a fact about the fleet, not a run: one quiet line, not a list row. */}
      <Collapse open={warmReady > 0}>
        <button
          type="button"
          onClick={showFleet}
          className="text-muted-foreground hover:text-foreground mx-3 mb-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-micro transition-colors"
        >
          <Flame className="text-ok size-3.5 shrink-0" aria-hidden />
          {warmReady === 1 ? "1 warm machine ready" : `${warmReady} warm machines ready`} — a new task starts in seconds
        </button>
      </Collapse>

      <div className="flex flex-col gap-0.5 border-t px-2 py-2">
        <NavItem active={view === "fleet"} flash={flash === "fleet"} onClick={showFleet} icon={<LayoutGrid />} label="Fleet view" badge={boxes.length || undefined} shortcut="g f" />
        <NavItem active={view === "automations" || view === "automation-runs" || view === "scheduled" || view === "workflows"} onClick={showAutomations} icon={<Workflow />} label="Autopilot" />
        <span className="contents" onMouseEnter={prefetchHistory}>
          <NavItem active={view === "history"} flash={flash === "history"} onClick={showHistory} icon={<Clock />} label="History" shortcut="g h" />
        </span>
        <span className="contents" onMouseEnter={prefetchSkills}>
          <NavItem active={view === "skills"} flash={flash === "skills"} onClick={showSkills} icon={<Zap />} label="Skills" shortcut="g s" />
        </span>
        <NavItem active={view === "memory"} onClick={showMemory} icon={<Brain />} label="Memory" />
        <NavItem active={view === "harnesses"} onClick={showHarnesses} icon={<Layers />} label="Harnesses" />
        <span className="contents" onMouseEnter={prefetchIntegrations}>
          <NavItem active={view === "integrations"} flash={flash === "integrations"} onClick={showAccounts} icon={<Plug />} label="Integrations" shortcut="g a" />
        </span>
        <TrialBadge className="mx-2.5 mt-1 self-start" />
        {/* Account/Connect must be reachable in token mode too — the operator uses
            notifications, API keys and the IDE wizard just like a saas user. */}
        <NavItem
          active={view === "account" || view === "connect" || view === "admin" || view === "welcome"}
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

        <div className="flex h-8 items-center justify-between pl-2.5 pr-1">
          <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-micro" aria-live="polite">
            <span
              className={cn("size-1.5 shrink-0 rounded-full", live ? "bg-ok" : "bg-muted-foreground/60 breathe")}
              aria-hidden
            />
            <span className="tabular truncate">{live ? <>Updated <Freshness updatedAt={updatedAt} /></> : error ? "Reconnecting…" : "Connecting…"}</span>
          </p>
          <div className="flex items-center">
            {notify.supported && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={() => void notify.toggle()} aria-pressed={notify.enabled} aria-label="Desktop notifications">
                    <IconSwap state={notify.enabled} rotate>{notify.enabled ? <Bell className="text-live" /> : <BellOff />}</IconSwap>
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" onClick={() => setDark(!dark)} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
                  <IconSwap state={dark} rotate>{dark ? <Moon /> : <Sun />}</IconSwap>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{dark ? "Light theme" : "Dark theme"}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </>
  );

  const healthDot = (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        health === "offline" && "bg-muted-foreground/60 breathe",
        health === "attention" && "bg-attention",
        health === "ok" && "bg-ok breathe"
      )}
      aria-hidden
    />
  );
  const healthLine = data ? (
    <span className="tabular truncate">
      <NumberTicker value={runs_.length} from={runs_.length} /> {runs_.length === 1 ? "run" : "runs"}
      {working > 0 && <> · <NumberTicker value={working} from={working} /> working</>}
      {waiting.length > 0 && <span className="text-attention-text"> · <NumberTicker value={waiting.length} from={waiting.length} /> waiting</span>}
    </span>
  ) : error ? (
    <span>offline · retrying</span>
  ) : (
    <span>connecting…</span>
  );

  return (
    <TooltipProvider>
      <Toaster />
      <div
        className={cn(
          "bg-background grid h-full grid-cols-1 transition-[grid-template-columns] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          collapsed ? "md:grid-cols-[3.5rem_minmax(0,1fr)]" : "md:grid-cols-[17rem_minmax(0,1fr)]"
        )}
      >
        {/* Phone nav drawer: the same rail, over the page instead of in place of it. */}
        <Sheet open={mobileRail} onOpenChange={setMobileRail}>
          <SheetContent side="left" title="Agent Sandbox" className="w-[min(20rem,calc(100vw-3rem))] md:hidden">
            <div className="-mx-3 flex flex-col">{railBody}</div>
          </SheetContent>
        </Sheet>

        <aside className="bg-sidebar hidden min-h-0 flex-col overflow-hidden md:flex md:border-r" data-collapsed={collapsed || undefined}>
          <div className={cn("flex h-14 shrink-0 items-center gap-2.5 px-3", collapsed && "md:justify-center md:px-0")}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/" aria-label="Agent Sandbox home" className="bg-primary text-primary-foreground hover:bg-primary/80 relative grid size-8 shrink-0 place-items-center rounded-md transition-colors">
                  <Logo className="size-[18px]" />
                  {/* Collapsed: the brand line is gone, so the tile carries the one fact it held — attention or offline. */}
                  {collapsed && health !== "ok" && (
                    <span className={cn("ring-sidebar pop-in absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2", health === "attention" ? "bg-attention" : "bg-muted-foreground breathe")} aria-hidden />
                  )}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                {collapsed ? (
                  <span className="flex items-center gap-1.5">
                    Agent Sandbox · {healthLine}
                  </span>
                ) : (
                  "Home page"
                )}
              </TooltipContent>
            </Tooltip>
            {!collapsed && (
              <>
                <div className="rail-reveal min-w-0 flex-1">
                  <Link to="/" className="text-foreground hover:text-live block truncate text-body leading-tight font-semibold tracking-[-0.01em] transition-colors">
                    Agent Sandbox
                  </Link>
                  <p className="text-muted-foreground flex items-center gap-1.5 text-micro leading-tight">
                    {healthDot}
                    {healthLine}
                  </p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" className="rail-reveal hidden md:inline-flex">
                      <PanelLeftClose className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Collapse sidebar</TooltipContent>
                </Tooltip>
              </>
            )}
          </div>

          {/* The two rail bodies crossfade (the column width tweens underneath), so a collapse reads
              as one motion instead of a jump-cut between two layouts. */}
          {collapsed ? (
            <nav key="rail" className="rail-reveal flex flex-1 flex-col items-center gap-1.5 px-2 pt-1 pb-3" aria-label="Sections">
              <RailIcon onClick={newTask} icon={<Plus />} label="New task" shortcut="n" primary />
              <RailIcon onClick={openPalette} icon={<Search />} label="Search" shortcut="⌘K" />
              <RailIcon active={view === "fleet"} flash={flash === "fleet"} onClick={showFleet} icon={<LayoutGrid />} label="Fleet view" shortcut="g f" badge={boxes.length || undefined} dot={waiting.length > 0} />
              <RailIcon active={view === "automations" || view === "automation-runs" || view === "scheduled" || view === "workflows"} onClick={showAutomations} icon={<Workflow />} label="Autopilot" />
              <span className="contents" onMouseEnter={prefetchHistory}>
                <RailIcon active={view === "history"} flash={flash === "history"} onClick={showHistory} icon={<Clock />} label="History" shortcut="g h" />
              </span>
              <span className="contents" onMouseEnter={prefetchSkills}>
                <RailIcon active={view === "skills"} flash={flash === "skills"} onClick={showSkills} icon={<Zap />} label="Skills" shortcut="g s" />
              </span>
              <RailIcon active={view === "memory"} onClick={showMemory} icon={<Brain />} label="Memory" />
              <RailIcon active={view === "harnesses"} onClick={showHarnesses} icon={<Layers />} label="Harnesses" />
              <span className="contents" onMouseEnter={prefetchIntegrations}>
                <RailIcon active={view === "integrations"} flash={flash === "integrations"} onClick={showAccounts} icon={<Plug />} label="Integrations" shortcut="g a" />
              </span>
              <div className="mt-auto flex flex-col items-center gap-1.5">
                <RailIcon active={view === "account" || view === "connect" || view === "admin" || view === "welcome"} onClick={showAccount} icon={<UserRound />} label={getMe()?.kind === "user" ? "Account" : "Operator"} />
                <RailIcon onClick={() => setDark(!dark)} icon={<IconSwap state={dark} rotate>{dark ? <Moon /> : <Sun />}</IconSwap>} label={dark ? "Light theme" : "Dark theme"} />
                <RailIcon onClick={() => setCollapsed(false)} icon={<PanelLeftOpen />} label="Expand sidebar" />
              </div>
            </nav>
          ) : (
            <div key="body" className="rail-reveal flex min-h-0 flex-1 flex-col">
              {railBody}
            </div>
          )}
        </aside>

        <main ref={mainRef} tabIndex={-1} className="bg-background flex min-h-0 min-w-0 flex-col overflow-hidden outline-none">
          {/* Phone top bar: menu (opens the drawer), identity + health, new task. Desktop has the rail. */}
          <div className="bg-card flex h-11 shrink-0 items-center gap-1 border-b px-1.5 md:hidden">
            <Button variant="ghost" size="icon-sm" onClick={() => setMobileRail(true)} aria-label="Open menu" aria-expanded={mobileRail}>
              <Menu className="size-4" />
            </Button>
            <Link to="/" className="text-foreground flex min-w-0 flex-1 items-center gap-2 px-1 text-meta font-semibold tracking-[-0.01em]">
              <span className="truncate">Agent Sandbox</span>
              <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-micro font-normal">
                {healthDot}
                {healthLine}
              </span>
            </Link>
            <Button variant="ghost" size="icon-sm" onClick={newTask} aria-label="New task">
              <Plus className="size-4" />
            </Button>
          </div>
          <AnimatePresence mode="wait" initial={false} custom={paneCustom}>
            <motion.div
              key={paneKey}
              className="min-h-0 flex-1"
              custom={paneCustom}
              variants={paneVariants(!!reduceMotion, narrow)}
              initial="enter"
              animate="center"
              exit="exit"
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
                ) : view === "automations" || view === "scheduled" ? (
                  <PageEnter className="h-full min-h-0">
                    <AutopilotPage tab={view} onTab={goAutopilot} onBack={backToRail} onOpenBox={(b) => go({ view: "box", name: b })} onOpenRuns={(id) => go({ view: "automation-runs", id })} />
                  </PageEnter>
                ) : route.view === "automation-runs" ? (
                  <PageEnter className="h-full min-h-0">
                    <AutomationRunsPage id={route.id} onBack={showAutomations} onOpenBox={(b) => go({ view: "box", name: b })} />
                  </PageEnter>
                ) : view === "history" ? (
                  <PageEnter className="h-full min-h-0">
                    <History onBack={backToRail} onAgain={newTask} />
                  </PageEnter>
                ) : view === "skills" ? (
                  <PageEnter className="h-full min-h-0">
                    <SkillsPage onBack={backToRail} />
                  </PageEnter>
                ) : view === "memory" ? (
                  <PageEnter className="h-full min-h-0">
                    <MemoryPage onBack={backToRail} />
                  </PageEnter>
                ) : view === "harnesses" ? (
                  <PageEnter className="h-full min-h-0">
                    <HarnessesPage onBack={backToRail} onOpenBox={(b) => go({ view: "box", name: b })} />
                  </PageEnter>
                ) : view === "workflows" ? (
                  <PageEnter className="h-full min-h-0">
                    <AutopilotPage tab="playbooks" onTab={goAutopilot} onBack={backToRail} onOpenBox={(b) => go({ view: "box", name: b })} onOpenRuns={(id) => go({ view: "automation-runs", id })} />
                  </PageEnter>
                ) : view === "integrations" ? (
                  <PageEnter className="h-full min-h-0">
                    <Integrations onBack={backToRail} />
                  </PageEnter>
                ) : view === "account" ? (
                  <PageEnter className="h-full min-h-0">
                    <Account onBack={backToRail} onConnect={showConnect} onAdmin={showAdmin} />
                  </PageEnter>
                ) : view === "admin" ? (
                  <PageEnter className="h-full min-h-0">
                    <Admin onBack={showAccount} />
                  </PageEnter>
                ) : view === "connect" ? (
                  <PageEnter className="h-full min-h-0">
                    <Connect onDone={showAccount} onBack={showAccount} />
                  </PageEnter>
                ) : view === "welcome" ? (
                  <PageEnter className="h-full min-h-0">
                    <Connect welcome onDone={() => go({ view: "hub" })} onBack={() => go({ view: "hub" })} />
                  </PageEnter>
                ) : route.view === "pr" ? (
                  <PageEnter className="h-full min-h-0">
                    <PullRequestPage session={route.name} repo={route.repo} number={route.number} />
                  </PageEnter>
                ) : booting && !selectedBox ? (
                  <BootingThread task={booting.task} warm={booting.warm} machine={booting.machine} inferred={booting.inferred} onBack={backToRail} />
                ) : view === "box" && !selectedBox && (selectedRaw || (selected && selected === launched)) ? (
                  // Reopened (or refreshed) while the machine is still booting, or just launched and
                  // not yet in the fleet: the same launch shell, never a blank pane or a bounce home.
                  // The Thread takes over once it is up.
                  <BootingThread task={selectedRaw?.task || (selected === launched ? launchTask.current : "")} warm={false} machine={selected ?? undefined} inferred={selected ? inferredNotes[selected] : undefined} onBack={backToRail} />
                ) : view === "box" && !selectedBox && !data ? (
                  <ThreadPageSkeleton />
                ) : selectedBox ? (
                  <Thread
                    box={!selectedBox.task && selectedBox.name === launched && launchTask.current ? { ...selectedBox, task: launchTask.current } : selectedBox}
                    lifecycle={lifecycle}
                    inferredRepos={inferredNotes[selectedBox.name]}
                    asides={asides[selectedBox.name] ?? []}
                    replies={replies[selectedBox.name] ?? []}
                    onAsk={(q) => void ask(selectedBox.name, q)}
                    onReplied={(text) =>
                      setReplies((prev) => ({ ...prev, [selectedBox.name]: [...(prev[selectedBox.name] ?? []), text] }))
                    }
                    onBack={backToRail}
                    onNew={newTask}
                    density={traceDensity ? "trace" : "chat"}
                    onDensity={(d) => setTraceDensity(d === "trace")}
                    onFocusRequest={onFocusRequest}
                    onRepliesFlushed={() => setReplies((prev) => ({ ...prev, [selectedBox.name]: [] }))}
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
                    offline={!!error && !live}
                    sessionRuns={runs}
                    onBooting={(task) =>
                      setBooting({
                        task,
                        known: new Map(boxes.map((b) => [b.name, b.role])),
                        warm: warmReady > 0,
                        // A cold tab (no fleet snapshot yet) must re-baseline `known` off the first
                        // real poll before the attach effect may fire — see that effect.
                        loaded: !!data,
                      })
                    }
                    onStarted={(box, task, inferred) => {
                      remember(box, task);
                      if (inferred?.length) setInferredNotes((prev) => ({ ...prev, [box]: inferred }));
                      // Navigate NOW so the URL is the run's (a refresh or share lands on it), while the
                      // booting pane stays up under the same "launch" pane key — no second keyed swap,
                      // which under AnimatePresence mode="wait" could strand the pane blank when it
                      // landed mid-exit of the hub. The attach effect swaps in the real Thread.
                      if (bootingRef.current) {
                        setBooting({ ...bootingRef.current, machine: box, inferred });
                        launchTask.current = task;
                        setLaunched(box);
                        go({ view: "box", name: box });
                      }
                    }}
                    onFailed={() => {
                      setBooting(null);
                      setLaunched(null);
                    }}
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
        <Bar className="h-6 w-16 rounded-full" />
        <Bar className="h-3.5 w-72" />
        <Bar className="ml-auto h-3 w-40" />
      </div>
      <div className="h-9 shrink-0 border-b" />
      <div className="mx-auto w-full max-w-3xl flex-1 px-6 pt-8">
        <Bar className="ml-auto h-11 w-[46%] rounded-xl" />
        <div className="mt-8 space-y-2.5">
          <Bar className="h-2.5 w-14" />
          <Bar className="h-3.5 w-[92%]" />
          <Bar className="h-3.5 w-[78%]" />
          <Bar className="h-3.5 w-[85%]" />
        </div>
        <Bar className="mt-7 h-8 w-56 rounded-full" />
        <div className="mt-7 space-y-2.5">
          <Bar className="h-2.5 w-14" />
          <Bar className="h-3.5 w-[88%]" />
          <Bar className="h-3.5 w-[64%]" />
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

/** The sidebar/rail highlight glides between items rather than blinking from one to the next. */
const NAV_SPRING = { type: "spring", stiffness: 480, damping: 40, mass: 0.8 } as const;

function NavItem({
  active,
  flash,
  onClick,
  icon,
  label,
  badge,
  shortcut,
}: {
  active: boolean;
  /** Momentary highlight after the item's keyboard shortcut fired. */
  flash?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  shortcut?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-keyshortcuts={shortcut?.replace(" ", "+")}
      data-flash={flash ? "true" : undefined}
      className={cn(
        "group relative isolate flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-meta transition-colors duration-150 [&_svg]:size-4 [&_svg]:shrink-0",
        "data-[flash=true]:bg-muted",
        active ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted [&_svg]:text-faint hover:[&_svg]:text-muted-foreground"
      )}
    >
      {active && (
        <motion.span layoutId="nav-active" className="bg-accent absolute inset-0 -z-10 rounded-md" transition={reduce ? { duration: 0 } : NAV_SPRING} aria-hidden>
          <span className="bg-live absolute top-2 bottom-2 left-0 w-0.5 rounded-full" />
        </motion.span>
      )}
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {/* The shortcut surfaces on hover/focus, where the eye already is — no tooltip to wait for.
          Badge and chord share one slot and crossfade so nothing blinks in or out. */}
      {(badge != null || shortcut) && (
        <span className="relative inline-grid place-items-end [&>*]:col-start-1 [&>*]:row-start-1">
          {badge != null && (
            <span className={cn("text-muted-foreground tabular text-micro transition-opacity duration-150", shortcut && "group-hover:opacity-0 group-focus-visible:opacity-0")}>
              <NumberTicker value={badge} from={badge} />
            </span>
          )}
          {shortcut && <Kbd keys={shortcut.split(" ")} className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />}
        </span>
      )}
    </button>
  );
}

function RailIcon({
  active,
  flash,
  onClick,
  icon,
  label,
  shortcut,
  badge,
  dot,
  primary,
}: {
  active?: boolean;
  flash?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  badge?: number;
  dot?: boolean;
  primary?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={shortcut ? `${label} (${shortcut})` : label}
          aria-current={active ? "page" : undefined}
          data-flash={flash ? "true" : undefined}
          className={cn(
            "relative isolate grid size-10 cursor-pointer place-items-center rounded-md transition-[color,background-color,box-shadow,translate] duration-150 [&_svg]:size-4",
            "data-[flash=true]:bg-muted",
            primary
              ? "bg-primary text-primary-foreground shadow-e1 hover:bg-primary/80 hover:shadow-e2 hover:-translate-y-px active:translate-y-0"
              : active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          {active && !primary && <motion.span layoutId="rail-active" className="bg-accent absolute inset-0 -z-10 rounded-md" transition={reduce ? { duration: 0 } : NAV_SPRING} aria-hidden />}
          {icon}
          {dot && <span className="bg-attention ring-card absolute top-1.5 right-1.5 size-2 rounded-full ring-2" aria-hidden />}
          {badge != null && !dot && (
            <span className="bg-live ring-card absolute top-0.5 right-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[9px] leading-4 font-semibold text-white ring-2 tabular-nums">
              <NumberTicker value={badge} from={badge} />
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
        {shortcut && <TooltipKbd>{shortcut}</TooltipKbd>}
      </TooltipContent>
    </Tooltip>
  );
}

const PANE_EASE = [0.22, 1, 0.36, 1] as const;

function paneDepth(key: string) {
  return key === "hub" ? 0 : key === "launch" || key.startsWith("box") || key.startsWith("pr:") ? 2 : 1;
}

type PaneCustom = { dir: number; launch: boolean };

function paneVariants(reduce: boolean, narrow: boolean) {
  // Entering the launch shell (Send): exit instantly, fade in with no transform.
  const launchExit = { opacity: 0, transition: { duration: 0 } };
  if (reduce) {
    return {
      enter: { opacity: 0 },
      center: { opacity: 1, transition: { duration: 0.12 } },
      exit: ({ launch }: PaneCustom) => (launch ? launchExit : { opacity: 0, transition: { duration: 0.1 } }),
    };
  }
  return {
    enter: ({ dir, launch }: PaneCustom) => (launch ? { opacity: 0, x: 0, y: 0 } : narrow && dir ? { opacity: 0, x: dir * 16, y: 0 } : { opacity: 0, x: 0, y: 6 }),
    center: ({ launch }: PaneCustom) => ({ opacity: 1, x: 0, y: 0, transition: { duration: launch ? 0.14 : 0.2, ease: PANE_EASE } }),
    exit: ({ dir, launch }: PaneCustom) =>
      launch
        ? launchExit
        : narrow && dir
          ? { opacity: 0, x: dir * -12, transition: { duration: 0.16, ease: PANE_EASE } }
          : { opacity: 0, y: -6, transition: { duration: 0.16, ease: PANE_EASE } },
  };
}

function useNarrow() {
  const q = "(max-width: 767px)";
  const [narrow, setNarrow] = React.useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  React.useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}
