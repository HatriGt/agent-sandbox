import * as React from "react";
import { Loader2, Plus, Undo2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import { api, type BoxView, type ChangedFile, type FleetLifecycle, type WatchSnapshot } from "@/lib/api";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
// The workspace (CodeMirror + merge view) is heavy and optional: loaded the first time it opens.
const WorkspacePane = React.lazy(() => import("./WorkspacePane").then((m) => ({ default: m.WorkspacePane })));
import { SleepingCard, WakingCard } from "./WakingCard";
import { SessionContext } from "@/lib/session-context";
import { friendlyName, isSleeping, POLL_MS, threadTitle } from "@/lib/format";
import { currentDiskTier, currentMemoryTier, deadlineLabel, deadlineOf, displayState, fmtDuration, offerableTiers, tierGib, usageLevel } from "@/lib/lifecycle";
import { MemoryBumpCard } from "./MemoryCard";
import { useMemoryToasts } from "./MemoryToast";
import { runStats, toMarkdown } from "@/lib/transcript";
import { contextHealth, lastUsage } from "@/lib/context-health";
import { splitReplies } from "@/lib/replies";
import { parseMcpName } from "@/lib/mcp";
import { McpConnectItem } from "./McpItem";
import { setPrefill } from "@/lib/draft";
import { ProducedFiles } from "./ProducedFiles";
import { useRunDigest } from "./DigestCard";
import { useOutcome } from "./OutcomeCard";
import { RunPill, WatchPill } from "./RunPill";
import { ThreadHeader } from "./ThreadHeader";
import { SchedulePill } from "./SchedulePill";
import { ScheduledCard } from "./ScheduledCard";
import { parseTrace, producedFiles } from "@/lib/trace";
import { deriveTaskBoard, type TaskBoard } from "@/lib/planTasks";
import { usePoll } from "@/hooks/usePoll";
import { peekWatchCache, seedWatchCache, useWatchStream } from "@/hooks/useWatchStream";
import "@/styles/thread.css";
import { Button } from "@/components/ui/button";
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from "@/components/ui/chat-container";
import type { TraceEvent } from "@/lib/trace";
import { LiveRegistryContext, SayKeyContext } from "@/components/viz/live-blocks";
import { buildLiveRegistry, type SayInput } from "@/lib/viz-identity";
import { AgentLabel, AnsweredQuestionItem, Density, LifecycleItem, MemoryItem, ObserverItem, PlanCard, QueuedItem, RepeatedPolls, SayItem, ThinkingItem, ToolGroup, WorkingIndicator, YouItem, repeatedPolls, type ThreadDensity } from "./TraceItems";
import { PlanDock } from "./PlanBoard";
import { ThreadMinimap, type Turn } from "./ThreadMinimap";
import { useStickToBottom } from "use-stick-to-bottom";
import { ChangesDock } from "./ChangesDock";
import { ReviewAllPane } from "./ReviewAll";
import { QuestionCard } from "./QuestionCard";
import { ArrowDown } from "lucide-react";
import { findPullRequests } from "@/lib/testReport";
import { ThreadSkeleton } from "./Skeletons";
import { Swap } from "@/components/ui/swap";
import { AttachedFromTask } from "./BootingThread";
import { SendBar } from "./SendBar";
import { cn } from "@/lib/utils";

/** A co-pilot exchange, owned by the parent so it survives switching threads. */
export interface Aside {
  question: string;
  answer?: string;
  error?: string;
}

/**
 * One machine's thread: a one-row header (state · title · name · lifecycle · vitals · destroy), the
 * trace, and the composer. The trace comes from the cached/resumable SSE stream, with a slow poll as
 * fallback; the first paint is either the cached log or a shaped skeleton — never a blank column.
 */
export function Thread({
  box,
  lifecycle,
  inferredRepos,
  asides,
  replies,
  onAsk,
  onReplied,
  onBack,
  onNew,
  onTornDown,
  onFocusRequest,
  onReplyFailed,
  onRepliesFlushed,
  density = "chat",
  onDensity = () => {},
}: {
  box: BoxView;
  lifecycle: FleetLifecycle;
  /** Repos auto-attached because the task named them — shown inline under the task bubble. */
  inferredRepos?: string[];
  asides: Aside[];
  replies: string[];
  onAsk: (question: string) => void;
  onReplied: (text: string) => void;
  /** Clear this box's optimistic echoes after a revert rewrites the durable log. */
  onRepliesFlushed?: () => void;
  onBack: () => void;
  onNew: () => void;
  /** Chat (prose first, work folded) or trace (every step). Persisted by App. */
  density?: ThreadDensity;
  onDensity?: (d: ThreadDensity) => void;
  onTornDown: (name: string) => void;
  onFocusRequest?: (focus: () => void) => void;
  /** A reply the server could not deliver: the parent drops its optimistic echo. */
  onReplyFailed?: (text: string) => void;
}) {
  // Opening a sleeping sandbox wakes it at once — nobody should have to type to see their run.
  const [wake, setWake] = React.useState<{ startedAt: number; error: string | null } | null>(null);
  const wokeRef = React.useRef<string | null>(null);

  const sleeping = isSleeping(box);
  // Name the run once it has a task and is awake; the fleet poll carries the title back.
  const titledRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!box.task || box.title || sleeping || box.role === "pool-free" || titledRef.current === box.name) return;
    titledRef.current = box.name;
    api.title(box.name).catch(() => {});
  }, [box.name, box.task, box.title, box.role, sleeping]);
  React.useEffect(() => {
    if (!sleeping || wokeRef.current === box.name) return;
    wokeRef.current = box.name;
    setWake({ startedAt: Date.now(), error: null });
    api.wake(box.name).catch((e: unknown) => setWake((w) => (w ? { ...w, error: e instanceof Error ? e.message : String(e) } : w)));
  }, [sleeping, box.name]);
  const wasSleeping = React.useRef(false);
  React.useEffect(() => {
    // Once the box reports running again, let the card show "awake" briefly, then leave. On the
    // sleeping→awake transition, re-arm the auto-wake guard so the NEXT time this box sleeps,
    // opening the thread wakes it again. (Only on the transition: sleepNow/setMemory/setDisk mark
    // wokeRef while the box is still awake, and clearing it then would bounce the box back up.)
    if (!sleeping) {
      if (wasSleeping.current) wokeRef.current = null;
      if (wake) {
        const t = window.setTimeout(() => setWake(null), 1400);
        return () => window.clearTimeout(t);
      }
    }
    wasSleeping.current = sleeping;
  }, [sleeping, wake]);
  // Reopen the stream when the fleet poll sees the box come back to life (a follow-up woke a
  // finished run, or a sleeping microVM restarted): the server closed the stream at the terminal
  // `done`, so a new generation is the only way to get live appends again.
  const alive = !sleeping && (box.runState === "running" || box.runState === "waiting");
  const [generation, setGeneration] = React.useState(0);
  const wasAlive = React.useRef(alive);
  React.useEffect(() => {
    if (alive && !wasAlive.current) setGeneration((g) => g + 1);
    wasAlive.current = alive;
  }, [alive]);

  const stream = useWatchStream(box.name, !sleeping, generation);
  // Fallback poll: held back so it never races the stream for the first byte, then only while the
  // stream is down. Through the server hub it is a cache hit, not an SSH round trip.
  // A finished run's stream closed on purpose at the terminal `done` — do not poll it forever;
  // once we have any snapshot of a not-alive box, the fleet poll covers state changes.
  const [polledOnce, setPolledOnce] = React.useState(false);
  React.useEffect(() => setPolledOnce(false), [box.name, generation]);
  const { data: polled } = usePoll<WatchSnapshot>(
    (signal) => api.watch(box.name, signal),
    stream.ok || sleeping || (!alive && polledOnce) ? 0 : POLL_MS,
    [box.name, stream.ok, sleeping, alive, polledOnce],
    { initialDelayMs: 2500 }
  );
  React.useEffect(() => {
    if (polled?.name === box.name) setPolledOnce(true);
  }, [polled, box.name]);
  React.useEffect(() => {
    if (polled && polled.name === box.name) seedWatchCache(polled);
  }, [polled, box.name]);
  // The stream when it is live; otherwise whichever of the cached stream copy and the poll is newer,
  // so a thread opened without SSE (or after a short turn the stream missed) keeps moving.
  const polledSnap = polled?.name === box.name ? polled : null;
  const liveSnap = stream.ok ? stream.snap ?? polledSnap : polledSnap && (!stream.snap || polledSnap.log.length >= stream.snap.log.length) ? polledSnap : stream.snap;
  // Asleep, the stream cannot connect — but the LAST transcript this tab saw is still the run. Show
  // it under the waking card instead of a blank column: a sleeping thread is a paused one, not gone.
  const [asleepSnap, setAsleepSnap] = React.useState<WatchSnapshot | null>(null);
  React.useEffect(() => {
    // Nothing cached for a sleeping box (fresh tab): ask once. The controller may still hold the
    // last log it read; if it cannot, the card alone is what we always showed.
    setAsleepSnap(null);
    if (!sleeping || peekWatchCache(box.name)) return;
    const ctrl = new AbortController();
    api
      .watch(box.name, ctrl.signal)
      .then((s) => {
        if (s.name === box.name && s.log) {
          seedWatchCache(s);
          setAsleepSnap(s);
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [sleeping, box.name]);
  const snap = liveSnap ?? (sleeping ? peekWatchCache(box.name) ?? asleepSnap : null);
  // Memory proposals (lesson/playbook) and auto-saved preferences this box just produced → toasts.
  useMemoryToasts(snap?.memoryNew);

  const events = React.useMemo(() => parseTrace(snap?.log ?? ""), [snap?.log]);
  const groups = React.useMemo(() => groupTrace(events), [events]);
  const repeats = React.useMemo(() => repeatedPolls(events), [events]);
  // Visual fences the agent re-emits under one name within a run render as ONE block that updates
  // in place at its first position (lib/viz-identity.ts); later copies collapse to a row.
  const liveRegistry = React.useMemo(
    () =>
      buildLiveRegistry(
        groups.flatMap((g, i): SayInput[] =>
          g.kind === "say" ? [{ key: `say-${i}`, text: g.text, at: g.at }] : g.kind === "you" || g.kind === "asked" ? [{ key: `b-${i}`, text: "", boundary: true }] : []
        )
      ),
    [groups]
  );
  // Derived once here so the docked board and the in-flow card are the same object.
  const planBoard = React.useMemo(() => deriveTaskBoard(events), [events]);
  const artifacts = React.useMemo(() => producedFiles(events), [events]);

  // What changed: fetched when the thread opens, whenever a Write/Edit lands or the run finishes, and
  // every 20s while running. Opening a file shows it in the side pane.
  const [changes, setChanges] = React.useState<ChangedFile[]>([]);
  const [changesLoading, setChangesLoading] = React.useState(false);
  const [openFile, setOpenFile] = React.useState<ChangedFile | null>(null);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
  const [workspaceFull, setWorkspaceFull] = React.useState(false);
  const showWorkspace = workspaceOpen || openFile !== null;
  const closeWorkspace = () => {
    setWorkspaceOpen(false);
    setWorkspaceFull(false);
    setOpenFile(null);
  };

  // Esc closes the workspace pane — but never steals the key from a dialog, menu or focused input
  // (those own Escape themselves and either prevent default or match the focus guard below).
  React.useEffect(() => {
    if (!showWorkspace) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.closest("[role='dialog'],[role='menu'],[role='listbox'],dialog"))) return;
      closeWorkspace();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showWorkspace]);

  // Guard against a late response after a box switch: without the name check, box A's in-flight
  // changes resolve into box B's dock (and clicking a file would fetch A's paths against B).
  const currentBoxRef = React.useRef(box.name);
  currentBoxRef.current = box.name;
  const refreshChanges = React.useCallback(() => {
    if (sleeping) return;
    const name = box.name;
    setChangesLoading(true);
    api
      .changes(name)
      .then((r) => {
        if (currentBoxRef.current === name) setChanges(r.files);
      })
      .catch(() => {})
      .finally(() => {
        if (currentBoxRef.current === name) setChangesLoading(false);
      });
  }, [box.name, sleeping]);
  React.useEffect(() => {
    setChanges([]);
    setOpenFile(null);
    refreshChanges();
  }, [box.name, refreshChanges]);
  React.useEffect(() => {
    if (!sleeping && (artifacts.length > 0 || box.runState === "done")) refreshChanges();
  }, [artifacts.length, box.runState, sleeping, refreshChanges]);
  React.useEffect(() => {
    if (sleeping || box.runState !== "running") return;
    const t = window.setInterval(refreshChanges, 20_000);
    return () => window.clearInterval(t);
  }, [box.runState, sleeping, refreshChanges]);
  // Optimistic echoes vs the durable log. The log is a bounded TAIL: an old ⟦you⟧ line eventually
  // scrolls out of the window, so an echo must be retired the FIRST time its persisted copy is seen
  // — never resurrected later when the tail no longer contains it (the "ghost message" bug: a
  // message sent hours ago reappearing at the bottom of the thread as if just sent).
  const settledRef = React.useRef(new Map<string, Set<string>>());
  const pendingReplies = React.useMemo(() => {
    const settled = settledRef.current.get(box.name) ?? new Set<string>();
    settledRef.current.set(box.name, settled);
    const persisted = new Set(events.filter((e) => e.kind === "you").map((e) => e.text.trim()));
    const { pending, nowSettled } = splitReplies(replies, persisted, settled);
    for (const r of nowSettled) settled.add(r.trim());
    return pending;
  }, [replies, events, box.name]);
  // The fleet poll is authoritative for a sleeping box (its stream cannot connect).
  const runState = sleeping ? box.runState : snap?.runState ?? box.runState;
  const question = sleeping ? box.question : snap?.question ?? box.question;
  const exitCode = snap?.exitCode ?? box.exitCode;
  const state = sleeping ? "sleeping" : displayState({ boxStatus: box.boxStatus, runState });
  // A launch's first snapshot is often EMPTY (the run sentinel is not written yet). Keep the
  // skeleton through it: a blank column or an "empty thread" card there is the flicker. Real
  // output (or the run ending) is what replaces it.
  const emptyLaunch = !!snap && !snap.log.trim() && !!box.task && runState !== "done" && exitCode == null;
  const loadingTrace = (!snap || emptyLaunch) && !sleeping;

  // The run receipt: fetched once when a run ends (keyed by exit code + trace length so a box that
  // resumes and finishes again gets a fresh digest). Silent on failure — the thread stands alone.
  const finished = !sleeping && !loadingTrace && (runState === "done" || (runState === "idle" && exitCode != null));
  const digest = useRunDigest(box.name, finished, `${exitCode ?? ""}-${events.length}`);
  const outcome = useOutcome(finished ? { box: box.name } : null, `${exitCode ?? ""}-${events.length}`);
  const durationSec = digest?.startedAt && digest?.endedAt && digest.endedAt > digest.startedAt ? Math.round((digest.endedAt - digest.startedAt) / 1000) : undefined;

  const deadline = React.useMemo(() => deadlineOf(box, lifecycle), [box, lifecycle]);
  const deadlineText = deadlineLabel(deadline);

  const [removing, setRemoving] = React.useState(false);

  // Per-message revert: which operator messages have a restore point (message k restores the
  // in-box checkpoint taken when turn k-1 finished). Refetched whenever a turn settles.
  const [revertable, setRevertable] = React.useState<Set<number>>(new Set());
  const [revertAsk, setRevertAsk] = React.useState<{ message: number; discarded: number } | null>(null);
  const [seed, setSeed] = React.useState<{ text: string; n: number } | null>(null);
  const [reverting, setReverting] = React.useState(false);
  const canRevertNow = !sleeping && runState !== "running";
  React.useEffect(() => {
    if (runState === "running") return;
    const ctrl = new AbortController();
    api
      .revertPoints(box.name, ctrl.signal)
      .then((r) => setRevertable(new Set(r.messages)))
      .catch(() => {});
    return () => ctrl.abort();
  }, [box.name, runState]);
  const doRevert = async () => {
    if (!revertAsk) return;
    setReverting(true);
    try {
      await api.revert(box.name, revertAsk.message);
      // The restored box carries the shorter log; flush everything the browser layered on top and
      // force a fresh stream generation — the open watch stream still holds the pre-revert snapshot.
      settledRef.current.delete(box.name);
      onRepliesFlushed?.();
      setGeneration((g) => g + 1);
      setRevertAsk(null);
      toast.success("Reverted", { description: "The sandbox and the agent's memory are back to this point." });
    } catch (e) {
      toast.error("Could not revert", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setReverting(false);
    }
  };

  // Sleep on demand: `msb stop`, nothing removed. Marking wokeRef first keeps the "open a sleeping
  // thread wakes it" effect from bouncing the box straight back up; with no wake in flight the
  // thread shows the resting "Asleep · Wake" card instead of the waking pill.
  const [sleepBusy, setSleepBusy] = React.useState(false);
  const sleepNow = () => {
    setSleepBusy(true);
    wokeRef.current = box.name;
    api
      .sleep(box.name)
      .then(() => toast.success(`${friendlyName(box.name)} is asleep`, { description: "The workspace and session are kept. Waking is one click away." }))
      .catch((e: unknown) => toast.error("Could not put it to sleep", { description: e instanceof Error ? e.message : String(e) }))
      .finally(() => setSleepBusy(false));
  };
  const wakeNow = React.useCallback(() => {
    setWake({ startedAt: Date.now(), error: null });
    api.wake(box.name).catch((e: unknown) => setWake((w) => (w ? { ...w, error: e instanceof Error ? e.message : String(e) } : w)));
  }, [box.name]);

  // Resize memory. Same shape as sleepNow — including marking wokeRef first, since `msb modify
  // --restart` takes the box down and the auto-wake effect must not race the reboot.
  const [memoryBusy, setMemoryBusy] = React.useState(false);
  const memoryTier = React.useMemo(() => currentMemoryTier(box.mem, lifecycle.memoryDefault), [box.mem, lifecycle.memoryDefault]);
  const setMemory = async (tier: string) => {
    setMemoryBusy(true);
    wokeRef.current = box.name;
    try {
      await api.setMemory(box.name, tier);
      toast.success(`${friendlyName(box.name)} now has ${tier}`, { description: "The machine is restarting — the workspace and session are kept. Send a message once it is back." });
    } catch (e) {
      toast.error("Could not change the memory", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setMemoryBusy(false);
    }
  };

  // Out-of-memory rescue: when the agent is OOM-killed (exit 137) or memory is critically full
  // mid-run, offer one action that raises the tier AND continues the task. The resize call returns
  // once `msb modify --restart` has the box back up, so the forced resume can follow immediately.
  const nextMemoryTier = React.useMemo(() => {
    const cur = tierGib(memoryTier);
    if (cur == null) return null;
    const bigger = (lifecycle.memoryTiers ?? [])
      .map((t) => ({ t, g: tierGib(t) ?? Infinity }))
      .filter((x) => x.g > cur)
      .sort((a, b) => a.g - b.g);
    return bigger[0]?.t ?? null;
  }, [memoryTier, lifecycle.memoryTiers]);
  const [bumpPhase, setBumpPhase] = React.useState<"resizing" | "resuming" | null>(null);
  // Remember which box+tier was already rescued so the card does not re-offer while the fleet poll
  // still carries the pre-resize metrics.
  const bumpedRef = React.useRef<string | null>(null);
  const bumpAndContinue = async () => {
    if (!nextMemoryTier || bumpPhase) return;
    setBumpPhase("resizing");
    wokeRef.current = box.name;
    try {
      await api.setMemory(box.name, nextMemoryTier);
      setBumpPhase("resuming");
      await api.resume(box.name, "The machine ran low on memory and was given more. Continue the task from where you left off.", { force: true });
      bumpedRef.current = `${box.name}:${nextMemoryTier}`;
      setGeneration((g) => g + 1);
      toast.success(`${friendlyName(box.name)} now has ${nextMemoryTier}`, { description: "The agent is continuing the task." });
    } catch (e) {
      toast.error("Could not add memory", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBumpPhase(null);
    }
  };
  // Context-window health from the trace's ⟦usage⟧ events: shown on the run summary, and as a
  // warning while running when the window is nearly full (the "start a fresh task" moment).
  const ctxHealth = React.useMemo(() => {
    const u = lastUsage(events);
    return u ? contextHealth(u.contextTokens) : null;
  }, [events]);
  const memPressure = !sleeping && runState === "running" && usageLevel(box.memUsage) === "critical";
  const oomKilled = !sleeping && runState !== "running" && exitCode === 137;
  const showMemoryCard = !!nextMemoryTier && (oomKilled || memPressure) && bumpedRef.current !== `${box.name}:${nextMemoryTier}`;

  // Grow the root disk. Identical flow, but the offered tiers are filtered to >= the current size:
  // `msb modify --root-disk` cannot shrink a managed disk, so a smaller pick could only ever fail.
  const [diskBusy, setDiskBusy] = React.useState(false);
  const diskTier = React.useMemo(() => currentDiskTier(box.disk, lifecycle.diskTiers), [box.disk, lifecycle.diskTiers]);
  const diskTiers = React.useMemo(() => offerableTiers(lifecycle.diskTiers, diskTier, true), [lifecycle.diskTiers, diskTier]);
  const setDisk = async (tier: string) => {
    setDiskBusy(true);
    wokeRef.current = box.name;
    try {
      await api.setDisk(box.name, tier);
      toast.success(`${friendlyName(box.name)} now has ${tier} of storage`, { description: "The machine is restarting — the workspace and session are kept. Send a message once it is back." });
    } catch (e) {
      toast.error("Could not change the storage", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setDiskBusy(false);
    }
  };

  const destroy = async () => {
    setRemoving(true);
    try {
      await api.teardown(box.name);
      toast.success(`${friendlyName(box.name)} destroyed`);
      onTornDown(box.name);
    } catch (e) {
      toast.error("Could not destroy the machine", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRemoving(false);
    }
  };

  // Answering the paused question: echo, then a FORCED resume (never queued — the run is waiting).
  // `answered` remembers WHICH question was answered so the card disappears at once and a "resuming"
  // beat shows until the box actually flips — resume takes a few seconds, and a card that lingers
  // through them reads as "stuck". A genuinely NEW question (different text) shows a fresh card.
  const [answering, setAnswering] = React.useState(false);
  const [answered, setAnswered] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (runState !== "waiting") setAnswered(null);
  }, [runState, box.name]);
  const answer = React.useCallback(
    (text: string) => {
      onReplied(text);
      setAnswering(true);
      setAnswered(question ?? "");
      api
        .resume(box.name, text, { force: true })
        .catch((e: unknown) => {
          setAnswered(null);
          onReplyFailed?.(text);
          toast.error("The agent did not get your answer", { description: e instanceof Error ? e.message : String(e) });
        })
        .finally(() => setAnswering(false));
    },
    [box.name, onReplied, question]
  );
  const showQuestion = !!question && runState === "waiting" && answered !== question;
  const resuming = !!question && runState === "waiting" && answered === question;

  // Pull requests the agent opened, from its prose and tool output.
  const pulls = React.useMemo(() => findPullRequests(events.map((e) => (e.kind === "say" ? e.text : e.kind === "tool" ? e.result ?? "" : "")).join("\n")), [events]);

  // Attach a repository to this running sandbox.
  const [attaching, setAttaching] = React.useState<string | null>(null);
  const [optimisticRepos, setOptimisticRepos] = React.useState<{ name: string; branch?: string }[]>([]);
  React.useEffect(() => setOptimisticRepos([]), [box.name, box.repos?.length]);
  // Keyed by content: the fleet poll hands over a new array every 3 s, and downstream effects
  // (the workspace's git status, header chips) must not refire for an identical list.
  const reposKey = JSON.stringify(box.repos ?? []);
  const repos = React.useMemo(() => {
    const base = JSON.parse(reposKey) as { name: string; branch?: string }[];
    const seen = new Set(base.map((r) => r.name));
    return [...base, ...optimisticRepos.filter((r) => !seen.has(r.name))];
  }, [reposKey, optimisticRepos]);
  const attach = (fullName: string, ref?: string) => {
    setAttaching(fullName);
    api
      .attachRepo(box.name, fullName, ref)
      .then((r) => {
        setOptimisticRepos((prev) => [...prev, { name: r.name, branch: ref }]);
        toast.success(`Attached ${fullName}`, { description: `Checked out at /workspace/${r.name}. The agent is told at its next turn.` });
      })
      .catch((e: unknown) => toast.error("Could not attach", { description: e instanceof Error ? e.message : String(e) }))
      .finally(() => setAttaching(null));
  };

  // Follow-ups queued while the agent was mid-turn (server-held; the fleet poll carries them).
  const [queued, setQueued] = React.useState<{ id: string; text: string }[] | null>(null);
  const refreshQueue = React.useCallback(() => {
    // Same stale-response guard as refreshChanges: box A's late inbox reply must not populate box
    // B's queue (cancel would then DELETE against B with A's message id).
    const name = box.name;
    api.inbox(name).then((r) => {
      if (currentBoxRef.current === name) setQueued(r.queued);
    }).catch(() => {});
  }, [box.name]);
  React.useEffect(() => {
    setQueued(null);
    if ((box.queued?.length ?? 0) > 0) refreshQueue();
  }, [box.name, box.queued?.length, refreshQueue]);
  const queuedItems = queued ?? (box.queued ?? []).map((text, i) => ({ id: `fleet-${i}`, text }));
  const cancelQueued = (id: string) => {
    api
      .dequeue(box.name, id.startsWith("fleet-") ? undefined : id)
      .then((r) => setQueued(r.queued))
      .catch((e: unknown) => toast.error("Could not cancel", { description: e instanceof Error ? e.message : String(e) }));
  };
  // Deliver a queued message NOW: the controller interrupts the running turn and resumes with it.
  // For turns stuck on something that will never finish (e.g. polling a CI check with no runner).
  const [sendingNow, setSendingNow] = React.useState<string | null>(null);
  const sendQueuedNow = (id: string) => {
    if (id.startsWith("fleet-")) {
      // Fleet fallback rows have no server id yet; fetch the real queue first.
      refreshQueue();
      return;
    }
    setSendingNow(id);
    api
      .sendNow(box.name, id)
      .then((r) => {
        setQueued(r.queued);
        toast.success("Turn interrupted", { description: "Your message was delivered; the agent is resuming with it." });
      })
      .catch((e: unknown) => {
        refreshQueue();
        toast.error("Could not send now", { description: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => setSendingNow(null));
  };

  // A just-delegated box reports `idle` until the run sentinel is written (a few seconds after
  // boot/claim) — that is "starting", not "idle": showing "Nothing has run here yet · send an
  // instruction" there invites a duplicate task. A claimed box or one that already has a task is a
  // run being set up, so the empty-idle card is reserved for genuinely unused boxes.
  const starting = runState === "idle" && events.length === 0 && !sleeping && (box.role === "pool-claimed" || !!box.task) && exitCode == null;
  const idle = runState === "idle" && events.length === 0 && !loadingTrace && !starting;

  // The title: the operator's rename wins immediately; the fleet catches up on its next read.
  const [renamed, setRenamed] = React.useState<{ box: string; title: string } | null>(null);
  const title = renamed?.box === box.name ? renamed.title : box.task ? threadTitle(box) : friendlyName(box.name);
  const rename = async (t: string) => {
    const r = await api.rename(box.name, t);
    setRenamed({ box: box.name, title: r.title });
  };
  const newFromThis = () => {
    setPrefill({ task: box.task ?? "", repos });
    onNew();
  };
  // What the agent is doing right now: the latest tool call, or thinking between calls.
  const activity = React.useMemo(() => {
    if (runState !== "running" || sleeping) return null;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.kind === "say") return "writing";
      if (e.kind === "tool") {
        const a = e.arg?.split("\n")[0].trim();
        const short = a ? (/^[\w./-]+$/.test(a) ? a.split("/").pop() : a.slice(0, 48)) : "";
        return short ? `${e.name} ${short}` : e.name;
      }
      if (e.kind === "think") return "thinking";
    }
    return events.length ? "working" : "starting";
  }, [events, runState, sleeping]);

  // Turns for the minimap: the task plus every message you sent, each with how the agent replied.
  const stick = useStickToBottom({ resize: "smooth", initial: "instant" });

  // A long agent message must not drag the view to its end. Once the newest reply's first line
  // reaches the top while it is still the last thing in the thread, following stops there and the
  // reader scrolls on at their own pace; scrolling back to the bottom resumes following.
  const heldSay = React.useRef<Element | null>(null);
  React.useLayoutEffect(() => {
    const scroller = stick.scrollRef.current;
    const content = stick.contentRef.current;
    if (!scroller || !content || stick.escapedFromLock) return;
    const says = content.querySelectorAll("[data-say]");
    const last = says[says.length - 1];
    if (!last || last === heldSay.current) return;
    const r = last.getBoundingClientRect();
    if (content.getBoundingClientRect().bottom - r.bottom > 160) return;
    const top = r.top - scroller.getBoundingClientRect().top + scroller.scrollTop - 24;
    if (top + scroller.clientHeight >= scroller.scrollHeight) return;
    heldSay.current = last;
    stick.stopScroll();
    if (scroller.scrollTop > top) scroller.scrollTop = Math.max(0, top);
  });

  // Scrolling UP while the agent streams must win against the auto-scroll. The library's own wheel
  // escape only fires when the scroller's computed `overflow` is exactly `auto`/`scroll`; ours is
  // `hidden auto` (x is clipped so wide code never side-scrolls the page), so that guard never
  // matched and a touchpad flick up was swallowed by the next smooth-scroll frame — the reader was
  // pinned to the bottom until the reply ended. `stopScroll` is the library's escape hatch.
  const { scrollRef: stickScrollRef, stopScroll } = stick;
  React.useEffect(() => {
    const el = stickScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && el.scrollHeight > el.clientHeight) stopScroll();
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stickScrollRef, stopScroll, box.name]);

  // "New activity" on the jump-to-latest button: set when the trace grows while the reader is
  // scrolled up in history, cleared the moment they reach the bottom again.
  const [newBelow, setNewBelow] = React.useState(false);
  // Keyed on the log's length, not the event count: a paragraph still streaming grows the same
  // event, and that is exactly the "more below" a reader scrolled up wants to know about.
  const logLen = snap?.log.length ?? 0;
  const prevLenRef = React.useRef(logLen);
  React.useEffect(() => {
    if (logLen > prevLenRef.current && !stick.isAtBottom) setNewBelow(true);
    prevLenRef.current = logLen;
  }, [logLen, stick.isAtBottom]);
  React.useEffect(() => {
    if (stick.isAtBottom) setNewBelow(false);
  }, [stick.isAtBottom]);
  const turns = React.useMemo<Turn[]>(() => {
    const out: Turn[] = [];
    if (box.task) out.push({ id: "task", label: "Task", you: box.task, reply: groups.find((g) => g.kind === "say")?.text });
    groups.forEach((g, i) => {
      if (g.kind === "you" || g.kind === "asked") {
        const reply = groups.slice(i + 1).find((x) => x.kind === "say");
        out.push({
          id: `${g.kind}-${i}`,
          label: g.kind === "asked" ? "Question" : "Follow-up",
          you: g.kind === "asked" ? `${g.question.split("\n")[0]} → ${g.answer}` : g.text,
          reply: reply?.kind === "say" ? reply.text : undefined,
          ...(g.kind === "asked" ? { kind: "question" as const } : {}),
        });
      }
    });
    return out;
  }, [groups, box.task]);

  // Keep (pin): the sandbox still sleeps on schedule, but is never reaped — only Destroy removes it.
  const [keptLocal, setKeptLocal] = React.useState<boolean | null>(null);
  React.useEffect(() => setKeptLocal(null), [box.name, box.kept]);
  const kept = keptLocal ?? !!box.kept;
  const [keeping, setKeeping] = React.useState(false);
  const toggleKeep = () => {
    const next = !kept;
    setKeeping(true);
    setKeptLocal(next);
    api
      .keep(box.name, next)
      .then(() =>
        toast.success(next ? `${friendlyName(box.name)} is kept` : `${friendlyName(box.name)} released`, {
          description: next
            ? "It will still sleep when quiet, but it stays until you destroy it. Wake it any day with a follow-up."
            : `Back to the normal lifecycle: destroyed after ${lifecycle.sleepTtlSec ? fmtDuration(lifecycle.sleepTtlSec) : "the sleep limit"} asleep.`,
        })
      )
      .catch((e: unknown) => {
        setKeptLocal(!next);
        toast.error("Could not update", { description: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => setKeeping(false));
  };

  // ONE live status for the whole thread. Several moments (starting, working, resuming, delivering)
  // used to render their own pill, so two could stack and each restarted its timer. Now a single
  // pill morphs between stages, in priority order.
  const lastKind = groups[groups.length - 1]?.kind ?? "";
  const liveContext = React.useMemo(() => ({ registry: liveRegistry, working: runState === "running" }), [liveRegistry, runState]);
  const working: { label: string; detail?: string | null } | null = resuming
    ? { label: "Answer sent — the agent is resuming" }
    : sleeping
      ? null
      : starting
        ? {
            label: "Starting up",
            detail: box.agent === "omp" ? "installing oh-my-pi and getting your task ready — the first start takes about a minute" : "the sandbox is getting your task ready",
          }
        : runState === "running" && !loadingTrace && !["say", "think"].includes(lastKind)
          ? { label: events.length ? "Working" : "Starting up", detail: activity }
          : pendingReplies.length > 0 && runState !== "running"
            ? { label: "Message sent", detail: "the agent is picking it up" }
            : null;
  const agentKinds = ["say", "tools", "think", "plan"];
  const still = useReducedMotion();

  return (
    <SessionContext.Provider value={box.name}>
    {/* No mount animation: BootingThread (same layout, swapped by App inside one pane key) hands
        off to this pixel for pixel; a fade here was the second blink. Thread switches fade via
        App's pane crossfade. */}
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <ThreadHeader
        box={box}
        title={title}
        // A run being set up is not "idle": the pill says working, matching the status below.
        state={starting ? "running" : state}
        exitCode={exitCode}
        sleeping={sleeping}
        kept={kept}
        keeping={keeping}
        deadline={deadline}
        repos={repos}
        attaching={attaching}
        pulls={pulls.length > 0 && !loadingTrace ? pulls : undefined}
        activity={activity}
        showWorkspace={showWorkspace}
        removing={removing}
        sleepNow={sleepNow}
        sleepBusy={sleepBusy}
        memoryTiers={lifecycle.memoryTiers}
        memoryTier={memoryTier}
        memoryBusy={memoryBusy}
        onSetMemory={setMemory}
        diskTiers={diskTiers}
        diskTier={diskTier}
        diskBusy={diskBusy}
        onSetDisk={setDisk}
        onBack={onBack}
        onNew={onNew}
        onToggleWorkspace={() => (showWorkspace ? closeWorkspace() : setWorkspaceOpen(true))}
        density={density}
        onToggleDensity={() => onDensity(density === "chat" ? "trace" : "chat")}
        onToggleKeep={toggleKeep}
        onRename={rename}
        onAttach={(full) => attach(full)}
        onDestroy={destroy}
        onCopyTranscript={async () => toMarkdown(events, { title, machine: friendlyName(box.name), url: window.location.href })}
        onNewFromThis={newFromThis}
      />

      <div className="relative flex min-h-0 flex-1">
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", showWorkspace && workspaceFull && "hidden md:hidden")}>
      <div className="@container relative min-h-0 min-w-0 flex-1">
        <ThreadMinimap turns={turns} scrollerRef={stick.scrollRef} />
        <SchedulePill box={box.name} runState={String(runState ?? "")} />
        {/* Ambient depth: a faint brand glow at the head of the conversation, and soft fades at the
            top and bottom edges so messages dissolve under the header and into the composer rather
            than being sliced by them. Pure decoration; pointer-events off. */}
        <div aria-hidden className="thread-glow pointer-events-none absolute inset-0" />
        <div aria-hidden className="from-background pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b to-transparent" />
        <div aria-hidden className="to-background pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-b from-transparent" />
        <ChatContainerRoot className="relative h-full [&>div]:overflow-x-hidden" instance={stick} aria-label="Conversation" aria-busy={runState === "running"}>
          <ChatContainerContent className="mx-auto w-full max-w-3xl gap-5 px-4 pt-7 pb-12 md:px-6">
            {box.task && (
              <div data-turn="task">
                <YouItem text={box.task} label="Task" noEnter />
              </div>
            )}
            {inferredRepos && inferredRepos.length > 0 && <AttachedFromTask repos={inferredRepos} />}


            {/* Skeleton → transcript is a crossfade, not a cut: the placeholder is shaped like the
                content, so the swap reads as the bones filling in. */}
            <LiveRegistryContext.Provider value={liveContext}>
            <RepeatedPolls.Provider value={repeats}>
            <Density.Provider value={density}>
            <Swap state={loadingTrace} className="flex flex-col gap-5">
            {loadingTrace && <ThreadSkeleton withTask={!!box.task} />}
            {!loadingTrace && groups.map((g, i) => {
              const isLast = i === groups.length - 1;
              const key = `${g.kind}-${i}`;
              // Operator-message index: the task is 1, each you/asked group after it increments.
              const msgIndex = 1 + groups.slice(0, i + 1).filter((x) => x.kind === "you" || x.kind === "asked").length;
              // The agent's byline opens each of its runs, whatever it starts with (prose, tools, thinking).
              const opensAgent = agentKinds.includes(g.kind) && (i === 0 || !agentKinds.includes(groups[i - 1].kind));
              const liveHere = runState === "running" && isLast;
              return g.kind === "lifecycle" ? (
                <LifecycleItem key={key} label={g.label} detail={g.detail} />
              ) : g.kind === "tools" ? (
                <div key={key} className="min-w-0">
                  {opensAgent && <AgentLabel live={liveHere} />}
                  <ToolGroup events={g.events} live={liveHere} />
                </div>
              ) : g.kind === "mcp-connect" ? (
                <McpConnectItem key={key} server={g.server} />
              ) : g.kind === "you" ? (
                <div key={key} data-turn={key} className="mt-5">
                  <YouItem
                    text={g.text}
                    at={g.at}
                    onRevert={
                      canRevertNow && revertable.has(msgIndex)
                        ? () => setRevertAsk({ message: msgIndex, discarded: groups.filter((x) => x.kind === "you" || x.kind === "asked").length + 1 - (msgIndex - 1) })
                        : undefined
                    }
                  />
                </div>
              ) : g.kind === "asked" ? (
                // The ⟦ask⟧ block lands in the log the moment the agent asks. While that question
                // is still the one waiting (or its answer is in flight), the live card below IS the
                // question — rendering the transcript copy too showed it twice, once with an empty
                // "Your answer". Once answered (or superseded) it stays as the recorded decision.
                g.answer === "" && (showQuestion || resuming) && !groups.slice(i + 1).some((x) => x.kind === "asked") ? null : (
                <div key={key} data-turn={key} className="mt-5">
                  <AnsweredQuestionItem question={g.question} answer={g.answer} />
                </div>
                )
              ) : g.kind === "think" ? (
                <div key={key} className="min-w-0">
                  {opensAgent && <AgentLabel live={liveHere} />}
                  {(density === "trace" || liveHere) && <ThinkingItem text={g.text} live={liveHere} />}
                </div>
              ) : g.kind === "memory" ? (
                <MemoryItem key={key} notes={g.notes} />
              ) : g.kind === "plan" ? (
                // The dock owns the plan on wide screens; in flow it would be the same board twice.
                <div key={key} className="xl:hidden">
                  <PlanCard board={g.board} live={runState === "running"} />
                </div>
              ) : (
                <div key={key} data-say className="min-w-0">
                  <SayKeyContext.Provider value={`say-${i}`}>
                    <SayItem text={g.text} live={liveHere} label={opensAgent} at={g.at} />
                  </SayKeyContext.Provider>
                </div>
              );
            })}
            </Swap>
            </Density.Provider>
            </RepeatedPolls.Provider>
            </LiveRegistryContext.Provider>

            {/* What this chat scheduled, right under the message that scheduled it. */}
            {!loadingTrace && <ScheduledCard box={box.name} runState={String(runState ?? "")} />}

            {/* The sleep/wake card sits where the run left off — under the transcript when we still
                have it, right under the task otherwise — so waking reads as "continuing", not as a
                fresh page with the history gone. */}
            <AnimatePresence mode="wait" initial={false}>
              {sleeping && !wake ? (
                <SleepingCard key="sleeping" onWake={wakeNow} />
              ) : (
                wake && <WakingCard key="waking" awake={!sleeping} startedAt={wake.startedAt} error={wake.error} onRetry={wakeNow} />
              )}
            </AnimatePresence>

            {idle && <IdleEmpty box={box} onNew={onNew} onPick={(text) => setSeed({ text, n: Date.now() })} />}

            {showMemoryCard && (
              <MemoryBumpCard kind={oomKilled ? "oom" : "pressure"} nextTier={nextMemoryTier!} memUsage={box.memUsage} phase={bumpPhase} onBump={() => void bumpAndContinue()} />
            )}

            {showQuestion && <QuestionCard question={question!} onAnswer={answer} busy={answering} />}

            <AnimatePresence initial={false}>
              {pendingReplies.map((r, i) => (
                <Rise key={`reply-${i}`} still={still}>
                  <YouItem text={r} noEnter />
                </Rise>
              ))}
            </AnimatePresence>
            {/* A follow-up on a finished run: the box still reports `done` for a few seconds until
                the server resumes the session. That gap must read as "delivering", never as the old
                "Completed" receipt sitting under the message you just sent. */}
            {/* While watching, the watch pill and the working line share one row: one status, not two stacked. */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 empty:hidden">
              {runState === "running" && !sleeping && <WatchPill session={box.name} events={events} />}
              {working && !(loadingTrace && starting) && <WorkingIndicator label={working.label} detail={working.detail} />}
            </div>

            <AnimatePresence initial={false}>
              {queuedItems.map((q) => (
                <Rise key={q.id} still={still}>
                  <QueuedItem
                    text={q.text}
                    onCancel={() => cancelQueued(q.id)}
                    onSendNow={runState === "running" && !sleeping ? () => sendQueuedNow(q.id) : undefined}
                    sending={sendingNow === q.id}
                  />
                </Rise>
              ))}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {asides.map((a, i) => (
                <Rise key={`aside-${i}`} still={still}>
                  <ObserverItem question={a.question} answer={a.error ?? a.answer} />
                </Rise>
              ))}
            </AnimatePresence>

            {!sleeping && !loadingTrace && artifacts.length > 0 && runState !== "running" && pendingReplies.length === 0 && <ProducedFiles session={box.name} files={artifacts} />}

            {/* Context nearly full: warn before quality degrades — the advice is the point. */}
            {!sleeping && !loadingTrace && ctxHealth?.level === "critical" && (
              <p className="text-attention-text enter text-micro" role="status">
                {ctxHealth.label} — {ctxHealth.advice}
              </p>
            )}


            {((!sleeping && !loadingTrace && runState === "done") || (finished && (outcome || digest))) && pendingReplies.length === 0 && (
              <RunPill
                events={events}
                outcome={outcome}
                digest={digest}
                label={
                  exitCode == null || exitCode === 0
                    ? "Completed"
                    : exitCode === 137
                      ? "Out of memory"
                      : exitCode === 254 || exitCode === 253
                        ? "Run interrupted"
                        : "Exited with an error"
                }
                failed={exitCode != null && exitCode !== 0}
                detail={
                  exitCode == null || exitCode === 0
                    ? deadlineText ?? undefined
                    : exitCode === 137
                      ? "the kernel killed the agent — add memory above to continue where it left off"
                      : exitCode === 254
                        ? "the sandbox restarted mid-run — send a message to continue"
                        : exitCode === 253
                          ? "stopped by you to deliver a message immediately"
                          : `code ${exitCode}`
                }
                stats={runStats(events)}
                durationSec={durationSec}
                context={ctxHealth}
                onCopy={async () => toMarkdown(events, { title, machine: friendlyName(box.name), url: window.location.href })}
                onAgain={newFromThis}
              />
            )}
            <ChatContainerScrollAnchor />
          </ChatContainerContent>
        </ChatContainerRoot>
        {/* Revert confirmation: destructive to the LATER turns, and honest about what does not
            rewind — pushed commits, opened PRs, external API writes stay. */}
        <Dialog open={!!revertAsk} onOpenChange={(o) => !o && !reverting && setRevertAsk(null)}>
          <DialogContent
            title="Revert to before this message?"
            description={
              revertAsk
                ? `The sandbox and the agent's memory return to the state before message ${revertAsk.message} was delivered — the later work in this thread is discarded. Anything already pushed to GitHub or sent to external systems stays.`
                : ""
            }
          >
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setRevertAsk(null)} disabled={reverting}>
                Keep everything
              </Button>
              <Button variant="destructive" size="sm" onClick={() => void doRevert()} disabled={reverting}>
                {reverting ? <Loader2 className="animate-spin" /> : <Undo2 />}
                {reverting ? "Reverting…" : "Revert"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {/* Jump to the latest output: centred over the column, only while scrolled up. When the agent
            produces something NEW while you are reading history, the button grows a label — the
            chat-app affordance for "there is more below than when you left". */}
        <AnimatePresence>
          {!stick.isAtBottom && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
            <motion.button
              type="button"
              layout={!still}
              initial={still ? false : { opacity: 0, y: 6, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={still ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.9 }}
              transition={{ duration: still ? 0 : 0.16 }}
              onClick={() => void stick.scrollToBottom()}
              aria-label="Scroll to latest"
              className={cn(
                "text-foreground pointer-events-auto flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full border shadow-e2",
                newBelow ? "border-live/40 bg-card px-3" : "bg-card hover:bg-muted w-8"
              )}
            >
              {newBelow && (
                <motion.span initial={{ opacity: 0, x: 4 }} animate={{ opacity: 1, x: 0 }} className="text-live text-micro font-medium whitespace-nowrap">
                  New activity
                </motion.span>
              )}
              <ArrowDown className={cn("size-4", newBelow && "text-live")} aria-hidden />
            </motion.button>
            </div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {reviewOpen && !sleeping && (
          // The review pane slides in from the right and leaves the same way — it is a drawer over
          // the run, not part of the transcript.
          <motion.div
            key="review"
            initial={still ? { opacity: 0 } : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={still ? { opacity: 0 } : { opacity: 0, x: 24 }}
            transition={{ duration: still ? 0.12 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto w-full max-w-3xl border-t px-3 pt-2 pb-2 shadow-[0_-8px_16px_-12px_oklch(0_0_0/0.18)] md:px-6"
          >
            <ReviewAllPane session={box.name} onClose={() => setReviewOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
      {!sleeping && <ChangesDock files={changes} loading={changesLoading} onOpen={setOpenFile} onRefresh={refreshChanges} onReviewAll={() => setReviewOpen((v) => !v)} activePath={openFile?.path} />}
      <SendBar
        boxName={box.name}
        runState={runState}
        sleeping={sleeping}
        repos={repos}
        onAsk={onAsk}
        onReplied={onReplied}
        onQueued={refreshQueue}
        onFocusRequest={onFocusRequest}
        onReplyFailed={onReplyFailed}
        seed={seed}
        phase={starting ? "starting" : showQuestion ? "asked" : idle ? "fresh" : undefined}
      />
      </div>
      {/* Sibling of the whole column (conversation + dock + composer), so opening it narrows all
          three together and the composer stays aligned with the text. Hidden while the workspace
          pane is open — two asides would leave the conversation a sliver. */}
      {planBoard && !sleeping && !showWorkspace && <PlanDock board={planBoard} live={runState === "running"} />}
      <AnimatePresence>
        {showWorkspace && (
          <React.Suspense
            key="workspace"
            fallback={
              <aside className="bg-card hidden md:flex md:h-full md:w-[58%] md:min-w-[34rem] md:flex-col md:border-l" aria-busy="true" aria-label="Workspace loading">
                <div className="h-10 border-b" />
                <div className="flex flex-1">
                  <div className="flex-1 space-y-2 p-4">
                    {[80, 60, 70, 40, 55].map((w, i) => (
                      <div key={i} className="bg-muted h-3 animate-pulse rounded" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                  <div className="w-64 space-y-2 border-l p-3">
                    {[70, 50, 60, 45, 65, 40].map((w, i) => (
                      <div key={i} className="bg-muted h-3 animate-pulse rounded" style={{ width: `${w}%`, marginLeft: `${(i % 3) * 10}px` }} />
                    ))}
                  </div>
                </div>
              </aside>
            }
          >
            <WorkspacePane session={box.name} changes={changes} open={openFile} onClose={closeWorkspace} onSaved={refreshChanges} repos={repos} full={workspaceFull} onToggleFull={() => setWorkspaceFull((v) => !v)} />
          </React.Suspense>
        )}
      </AnimatePresence>
      </div>
    </div>
    </SessionContext.Provider>
  );
}

/** Starter prompts: an empty box should show what a good first instruction looks like, not a blank page. */
const STARTERS = [
  { title: "Explore a repo", text: "Clone the repository I attach, map its structure, and summarise how it is built and tested." },
  { title: "Fix a failing test", text: "Run the test suite, find the first failing test, fix the root cause, and show me the diff." },
  { title: "Add a feature", text: "Add a small feature: describe it here — then write tests for it and open a pull request." },
  { title: "Review a PR", text: "Review pull request #<number> for bugs and risky changes, and leave me a short verdict." },
];

function IdleEmpty({ box, onNew, onPick }: { box: BoxView; onNew: () => void; onPick: (text: string) => void }) {
  const warm = box.role === "pool-free";
  return (
    <div className="enter flex flex-col items-start gap-4 py-6">
      <div className="flex flex-col gap-1.5">
        <p className="text-foreground text-lead font-medium">
          {friendlyName(box.name)} is {warm ? "warm and waiting" : "idle"}.
        </p>
        <p className="text-muted-foreground max-w-[52ch] text-body">
          {warm
            ? "This sandbox is already booted with the agent installed. The next task you start claims it, so the run begins in seconds instead of waiting on a boot."
            : "Nothing has run here yet. Pick a starting point, or write your own instruction below."}
        </p>
      </div>
      <ul className="grid w-full gap-2 sm:grid-cols-2">
        {STARTERS.map((st, i) => (
          <li key={st.title} className="stagger-item" style={{ "--i": i } as React.CSSProperties}>
            <button
              type="button"
              onClick={() => onPick(st.text)}
              className="bg-card hover:border-line-strong hover:shadow-e2 group flex h-full w-full cursor-pointer flex-col gap-1 rounded-xl border p-3.5 text-left shadow-e1 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px"
            >
              <span className="text-foreground text-meta font-medium">{st.title}</span>
              <span className="text-muted-foreground line-clamp-2 text-micro">{st.text}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onNew}>
          <Plus className="size-3.5" />
          New task
        </Button>
        <span className="text-faint text-micro">
          <kbd className="rounded border px-1 font-mono">Enter</kbd> sends · <kbd className="rounded border px-1 font-mono">@</kbd> files · <kbd className="rounded border px-1 font-mono">/</kbd> skills
        </span>
      </div>
    </div>
  );
}

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

type TraceGroup =
  | { kind: "say"; text: string; at?: number }
  | { kind: "you"; text: string; at?: number }
  | { kind: "asked"; question: string; answer: string }
  | { kind: "lifecycle"; label: string; detail?: string }
  | { kind: "tools"; events: ToolEvent[] }
  | { kind: "mcp-connect"; server: string }
  | { kind: "think"; text: string }
  | { kind: "plan"; board: TaskBoard }
  | { kind: "memory"; notes: { note: string; text: string; area?: string; updated?: boolean }[] };

function groupTrace(events: TraceEvent[]): TraceGroup[] {
  const out: TraceGroup[] = [];
  // The board reads the WHOLE trace, not one snapshot: a step's evidence is the work that happened
  // between the snapshot that started it and the one that ended it.
  const board = deriveTaskBoard(events);
  // First contact with each MCP server gets a lifecycle hairline — so a server that SHOULD appear
  // but never does (silently dropped at handshake) is visible by absence.
  const seenServers = new Set<string>();
  for (const e of events) {
    if (e.kind === "tool") {
      const mcp = parseMcpName(e.name);
      if (mcp && !seenServers.has(mcp.server)) {
        seenServers.add(mcp.server);
        out.push({ kind: "mcp-connect", server: mcp.server });
      }
      const last = out[out.length - 1];
      if (last?.kind === "tools") last.events.push(e);
      else out.push({ kind: "tools", events: [e] });
    } else if (e.kind === "lifecycle") {
      // Every follow-up turn re-logs "session started"; the first one is information, the rest are
      // noise — UNLESS the model changed (the per-message model switch's receipt is exactly this
      // line, so a new model must stay visible).
      if (/^session started/i.test(e.label)) {
        const prior = [...out].reverse().find((g) => g.kind === "lifecycle" && /^session started/i.test(g.label));
        const modelOf = (s: string) => s.match(/model ([\w.-]+)/i)?.[1] ?? "";
        if (prior && prior.kind === "lifecycle" && modelOf(prior.label) === modelOf(e.label)) continue;
      }
      out.push({ kind: "lifecycle", label: sentence(e.label), detail: e.detail });
    } else if (e.kind === "you") {
      // An answer to a question the transcript recorded (⟦ask⟧ … ⟦/ask⟧ right before) folds into one
      // "asked — answered" item, so the decision stays readable when scrolling back.
      const prev = out[out.length - 1];
      if (prev?.kind === "asked" && prev.answer === "") prev.answer = e.text;
      else out.push({ kind: "you", text: e.text, at: e.at });
    } else if (e.kind === "ask") {
      out.push({ kind: "asked", question: e.text, answer: "" });
    } else if (e.kind === "think") {
      out.push({ kind: "think", text: e.text });
    } else if (e.kind === "plan") {
      // The plan is a living document: every TodoWrite re-emits the whole list. Show it ONCE, where
      // it first appeared, in its latest state — so the checklist ticks in place instead of stacking.
      if (board && !out.some((g) => g.kind === "plan")) out.push({ kind: "plan", board });
    } else if (e.kind === "memory") {
      // Saved-for-later notes sit apart from the work fold; back-to-back saves share one row.
      const last = out[out.length - 1];
      const row = { note: e.note, text: e.text, ...(e.area ? { area: e.area } : {}), ...(e.updated ? { updated: true } : {}) };
      if (last?.kind === "memory") last.notes.push(row);
      else out.push({ kind: "memory", notes: [row] });
    } else if (e.kind === "usage") {
      // Bookkeeping, not conversation: the context meter reads it; the thread never renders it.
    } else {
      out.push({ kind: "say", text: e.text, at: e.at });
    }
  }
  return out;
}

function sentence(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * A transient thread row (pending reply, queued message, aside): rises into place on arrival and
 * folds away on exit so its neighbours glide rather than jump. Transform/opacity plus a height
 * collapse on exit only; reduced motion keeps a plain fade. The column's gap-5 is not ours to
 * animate, so the exit also pulls marginBottom to -gap: the row's slot AND its gap close together
 * instead of the gap snapping shut when the node finally unmounts.
 */
function Rise({ still, children }: { still: boolean | null; children: React.ReactNode }) {
  return (
    <motion.div
      layout={still ? false : "position"}
      initial={still ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.98, height: 0, marginTop: 0, marginBottom: "-1.25rem" }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      style={{ transformOrigin: "100% 100%" }}
      className="min-w-0"
    >
      {children}
    </motion.div>
  );
}
