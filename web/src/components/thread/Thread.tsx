import * as React from "react";
import { lazyRetry } from "@/lib/lazy-retry";
import { ArrowUpRight, Bug, Compass, GitPullRequest, Loader2, Plus, Sparkles, Undo2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import { api, type BoxView, type ChangedFile, type FleetLifecycle, type WatchSnapshot } from "@/lib/api";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
// The workspace (CodeMirror + merge view) is heavy and optional: loaded the first time it opens.
const WorkspacePane = React.lazy(lazyRetry(() => import("./WorkspacePane").then((m) => ({ default: m.WorkspacePane }))));
import { SleepingCard, WakingCard } from "./WakingCard";
import { SessionContext, SessionReposContext } from "@/lib/session-context";
import { CodeNavContext } from "@/components/ui/code-ref";
import type { CodeRef } from "@/lib/code-refs";
import type { OpenRequest } from "./WorkspacePane";
const BrowserPane = React.lazy(lazyRetry(() => import("./BrowserPane").then((m) => ({ default: m.BrowserPane }))));
import type { BrowserTag } from "./BrowserPane";
import { sandboxAddress } from "@/lib/browser-model";
import { friendlyName, isSleeping, POLL_MS, threadTitle } from "@/lib/format";
import { currentDiskTier, currentMemoryTier, deadlineLabel, deadlineOf, displayState, fmtDuration, offerableTiers, tierGib, usageLevel } from "@/lib/lifecycle";
import { MemoryBumpCard } from "./MemoryCard";
import { useMemoryToasts } from "./MemoryToast";
import { runStats, toMarkdown } from "@/lib/transcript";
import { contextHealthOf } from "@/lib/context-health";
import type { ContextStatus } from "./ContextRing";
import { useAutoCompactMode } from "@/hooks/useAutoCompactMode";
import { compactInstructions, isCompactCommand } from "@/lib/compact";
import { matchReplies, stampReply, type PendingReply } from "@/lib/replies";
import { parseMcpName } from "@/lib/mcp";
import { McpConnectItem } from "./McpItem";
import { setPrefill } from "@/lib/draft";
import { ProducedFiles } from "./ProducedFiles";
import { useRunDigest } from "./DigestCard";
import { useOutcome } from "./OutcomeCard";
import { nextSteps } from "@/lib/next-steps";
import { RunPill, WatchPill } from "./RunPill";
import { ThreadHeader } from "./ThreadHeader";
import { RunInspector } from "./RunInspector";
import { SideChat } from "./SideChat";
import { asQuote, useSideChat } from "@/lib/sidechat";
import { SelectionToolbar } from "./SelectionToolbar";
import { SchedulePill } from "./SchedulePill";
import { ScheduledCard } from "./ScheduledCard";
import { parseTrace, producedFiles } from "@/lib/trace";
import { reuseEvents, reuseGroups } from "@/lib/stable-trace";
import { deriveTaskBoard, type TaskBoard } from "@/lib/planTasks";
import { usePoll } from "@/hooks/usePoll";
import { peekWatchCache, seedWatchCache, useWatchStream } from "@/hooks/useWatchStream";
import "@/styles/thread.css";
import { Button } from "@/components/ui/button";
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from "@/components/ui/chat-container";
import type { TraceEvent } from "@/lib/trace";
import { LiveRegistryContext, SayKeyContext } from "@/components/viz/live-blocks";
import { VizFullscreenGate } from "@/components/viz/viz-fullscreen";
import { buildLiveRegistry, type SayInput } from "@/lib/viz-identity";
import { type CompactView, AnsweredQuestionItem, CompactItem, Density, ExpandAll, LifecycleItem, MemoryItem, QueuedItem, RepeatedPolls, SayItem, ToolGroup, WorkingIndicator, YouItem, repeatedPolls, type ThreadDensity } from "./TraceItems";
import { ReasoningTrail, type TrailItem } from "./ReasoningTrail";
import { PlanBoard, type PlanVariant } from "./PlanBoard";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ThreadMinimap, type Turn } from "./ThreadMinimap";
import { useStickToBottom } from "use-stick-to-bottom";
import { ChangesDock } from "./ChangesDock";
import { QuestionCard } from "./QuestionCard";
import { ArrowDown } from "lucide-react";
import { findPullRequests } from "@/lib/testReport";
import { ThreadSkeleton } from "./Skeletons";
import { Swap } from "@/components/ui/swap";
import { AttachedFromTask } from "./BootingThread";
import { SendBar } from "./SendBar";
import { cn } from "@/lib/utils";

/**
 * One machine's thread: a one-row header (state · title · name · lifecycle · vitals · destroy), the
 * trace, and the composer. The trace comes from the cached/resumable SSE stream, with a slow poll as
 * fallback; the first paint is either the cached log or a shaped skeleton — never a blank column.
 */
export function Thread({
  box,
  lifecycle,
  fleet = [],
  onOpenBox,
  inferredRepos,
  replies,
  onReplied,
  onRepliesSettled,
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
  /** Every visible machine, for the inspector's Fleet tab. */
  fleet?: BoxView[];
  onOpenBox?: (name: string) => void;
  /** Repos auto-attached because the task named them — shown inline under the task bubble. */
  inferredRepos?: string[];
  /** Messages sent from this tab whose durable log line has not been seen yet. */
  replies: PendingReply[];
  onReplied: (reply: PendingReply) => void;
  /** These echoes' log lines landed: the parent drops them for good. */
  onRepliesSettled?: (ids: string[]) => void;
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

  // Re-parsed on every streamed chunk; unchanged events and groups keep their previous objects
  // (lib/stable-trace.ts) so only the row that grew re-renders.
  const prevEvents = React.useRef<TraceEvent[]>([]);
  const events = React.useMemo(() => (prevEvents.current = reuseEvents(prevEvents.current, parseTrace(snap?.log ?? ""))), [snap?.log]);
  const prevGroups = React.useRef<TraceGroup[]>([]);
  const groups = React.useMemo(() => (prevGroups.current = reuseGroups(prevGroups.current, groupTrace(events))), [events]);
  const keys = React.useMemo(() => groupKeys(groups), [groups]);
  // The same set while membership is unchanged: a new set every tick re-rendered every tool row.
  const prevRepeats = React.useRef<{ set: WeakSet<object>; sig: string } | null>(null);
  const repeats = React.useMemo(() => {
    const set = repeatedPolls(events);
    const sig = events.flatMap((e, i) => (set.has(e) ? [i] : [])).join(",");
    if (prevRepeats.current?.sig === sig) return prevRepeats.current.set;
    prevRepeats.current = { set, sig };
    return set;
  }, [events]);
  // Visual fences the agent re-emits under one name within a run render as ONE block that updates
  // in place at its first position (lib/viz-identity.ts); later copies collapse to a row.
  const liveRegistry = React.useMemo(
    () =>
      buildLiveRegistry(
        groups.flatMap((g, i): SayInput[] =>
          g.kind === "say" ? [{ key: keys[i], text: g.text, at: g.at }] : g.kind === "you" || g.kind === "asked" ? [{ key: keys[i], text: "", boundary: true }] : []
        )
      ),
    [groups, keys]
  );
  // Derived once here so the docked board and the in-flow card are the same object.
  const planBoard = React.useMemo(() => deriveTaskBoard(events), [events]);
  const artifacts = React.useMemo(() => producedFiles(events), [events]);

  // What changed: fetched when the thread opens, whenever a Write/Edit lands or the run finishes, and
  // every 20s while running. Opening a file shows it in the side pane.
  const [changes, setChanges] = React.useState<ChangedFile[]>([]);
  const [changesLoading, setChangesLoading] = React.useState(false);
  // Each request is a new object so re-opening the same file (at another line) still navigates.
  const [openFile, setOpenFile] = React.useState<OpenRequest | null>(null);
  const openChange = React.useCallback((f: ChangedFile) => setOpenFile({ path: f.path }), []);
  // Code refs in the agent's messages (`web/src/x.ts:42`) open here, at the line.
  const openRef = React.useCallback((r: CodeRef) => setOpenFile({ path: r.path, line: r.line, endLine: r.endLine }), []);
  const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
  const [workspaceFull, setWorkspaceFull] = React.useState(false);
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const showWorkspace = workspaceOpen || openFile !== null;
  // The browser (BrowserPane): a fourth aside under the same one-at-a-time rule.
  const [browserOpen, setBrowserOpen] = React.useState(false);
  const [browserFull, setBrowserFull] = React.useState(false);
  const [browserGoTo, setBrowserGoTo] = React.useState<{ url: string; n: number } | null>(null);
  const [browserSent, setBrowserSent] = React.useState(0);
  const closeBrowser = React.useCallback(() => {
    setBrowserOpen(false);
    setBrowserFull(false);
    setBrowserGoTo(null);
  }, []);
  // The side chat is a third aside under the same one-at-a-time rule. Its open flag lives in the
  // per-box store (persisted), so each aside's opener closes the others itself.
  const side = useSideChat(box.name);
  const sideOpen = side.chat.open;
  // Opening a file (code ref, changed file, palette) wins over the inspector and the side chat.
  React.useEffect(() => {
    if (openFile !== null) {
      setInspectorOpen(false);
      side.close();
      closeBrowser();
    }
  }, [openFile, side, closeBrowser]);
  const closeWorkspace = () => {
    setWorkspaceOpen(false);
    setWorkspaceFull(false);
    setOpenFile(null);
  };
  // "Review all": the workspace pane on its Review view. A nonce, so a repeat lands there again.
  const [reviewNonce, setReviewNonce] = React.useState(0);
  const openReview = React.useCallback(() => {
    setInspectorOpen(false);
    side.close();
    closeBrowser();
    setWorkspaceOpen(true);
    setReviewNonce((n) => n + 1);
  }, [side, closeBrowser]);
  // THE plan placement, decided once: docked beside the conversation when the row is wide (xl)
  // and no other aside has the room; a card in the flow otherwise. Never both, never neither.
  const wide = useMediaQuery("(min-width: 80rem)");
  const planPlacement: PlanVariant = wide && !showWorkspace && !browserOpen && !inspectorOpen && !sideOpen ? "dock" : "card";

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

  // The run inspector (B1): a second aside, mutually exclusive with the workspace — opening one
  // closes the other, so the conversation never shrinks to a sliver between two panes.
  const toggleInspector = React.useCallback(() => {
    setInspectorOpen((v) => {
      if (!v) {
        setWorkspaceOpen(false);
        setWorkspaceFull(false);
        setOpenFile(null);
        closeBrowser();
        side.close();
      }
      return !v;
    });
  }, [side, closeBrowser]);
  const openSideChat = React.useCallback(() => {
    setInspectorOpen(false);
    setWorkspaceOpen(false);
    setWorkspaceFull(false);
    setOpenFile(null);
    closeBrowser();
    side.open();
  }, [side, closeBrowser]);
  const toggleBrowser = () => {
    if (browserOpen) return closeBrowser();
    setInspectorOpen(false);
    side.close();
    closeWorkspace();
    setBrowserOpen(true);
  };
  // `localhost:3000` in the agent's words is the sandbox's localhost, not the reader's: a click on
  // such a link (or on the address written as inline code) opens it in the Browser pane.
  const onThreadClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (sleeping || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const el = e.target as HTMLElement;
    if (el.closest("textarea, input, [contenteditable=true], pre")) return;
    const link = el.closest("a[href]");
    const code = link ? null : el.closest("code");
    const url = link ? sandboxAddress(link.getAttribute("href") ?? "") : code ? sandboxAddress(code.textContent ?? "") : null;
    if (!url || window.getSelection()?.toString()) return;
    e.preventDefault();
    e.stopPropagation();
    setInspectorOpen(false);
    side.close();
    closeWorkspace();
    setBrowserGoTo({ url, n: Date.now() });
    setBrowserOpen(true);
  };
  // A picked element (or a screenshot) joins the message being written: its words in the text, its
  // picture as an attachment. The composer has to be in view to show it arrived.
  const tagFromBrowser = React.useCallback((t: BrowserTag) => {
    setBrowserFull(false);
    if (window.matchMedia("(max-width: 767px)").matches) setBrowserOpen(false);
    setSeed({ text: t.text ?? "", n: Date.now(), append: true, image: t.image });
  }, []);
  // "Mention in chat" on a file or folder: its tag joins the sentence being written.
  const mentionFile = React.useCallback((path: string) => {
    setWorkspaceFull(false);
    setSeed({ text: `@${path}`, n: Date.now(), append: true, inline: true });
  }, []);
  const toggleSideChat = React.useCallback(() => (side.chat.open ? side.close() : openSideChat()), [side, openSideChat]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "i" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && !e.defaultPrevented) {
        e.preventDefault();
        toggleInspector();
      }
    };
    const onToggle = () => toggleInspector();
    const onToggleSide = () => toggleSideChat();
    // The palette's "This thread" commands reach the thread through window events.
    const onOpenWorkspace = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string } | undefined>).detail?.path;
      setInspectorOpen(false);
      side.close();
      if (path) setOpenFile({ path });
      else setWorkspaceOpen(true);
    };
    const onReview = openReview;
    const onStop = () => void stopTurnRef.current?.();
    window.addEventListener("keydown", onKey);
    window.addEventListener("asb:toggle-inspector", onToggle);
    window.addEventListener("asb:toggle-sidechat", onToggleSide);
    window.addEventListener("asb:open-workspace", onOpenWorkspace);
    window.addEventListener("asb:review-changes", onReview);
    window.addEventListener("asb:stop-turn", onStop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("asb:toggle-inspector", onToggle);
      window.removeEventListener("asb:toggle-sidechat", onToggleSide);
      window.removeEventListener("asb:open-workspace", onOpenWorkspace);
      window.removeEventListener("asb:review-changes", onReview);
      window.removeEventListener("asb:stop-turn", onStop);
    };
  }, [toggleInspector, toggleSideChat, openReview, side]);
  // stopTurn is defined later (it needs the box and state); the listener above reaches it by ref.
  const stopTurnRef = React.useRef<(() => Promise<void>) | null>(null);

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
  // Optimistic echoes vs the durable log (lib/replies.ts). An echo is stamped with the log's own
  // clock when it is sent and retired by the ⟦you⟧ line that lands after that — so the same words
  // sent twice are two messages, and an old line scrolling out of the bounded tail never brings a
  // message back. Retiring happens at the source (the parent drops the echo), once.
  const sentLines = React.useMemo(() => events.flatMap((e) => (e.kind === "you" ? [{ text: e.text, at: e.at }] : [])), [events]);
  const logClock = React.useMemo(() => {
    let newest: number | undefined;
    for (const e of events) {
      const at = "at" in e ? e.at : undefined;
      if (at !== undefined && (newest === undefined || at > newest)) newest = at;
    }
    return newest;
  }, [events]);
  const echoBasis = React.useRef({ sentLines, logClock });
  echoBasis.current = { sentLines, logClock };
  const onRepliedRef = React.useRef(onReplied);
  onRepliedRef.current = onReplied;
  // Sending is also "take me to my message": a reader who had scrolled up to check something would
  // otherwise send into a thread that shows no sign of it (the bubble landed screens below).
  const jumpToLatest = React.useRef<() => void>(() => {});
  const echo = React.useCallback((text: string) => {
    onRepliedRef.current(stampReply(text, echoBasis.current.sentLines, echoBasis.current.logClock));
    jumpToLatest.current();
    setBrowserSent((n) => n + 1);
  }, []);
  const replyMatch = React.useMemo(() => matchReplies(replies, sentLines), [replies, sentLines]);
  const pendingReplies = replyMatch.pending;
  // The log line that replaces an echo takes over the echo's place on screen: same bubble, same
  // spot. It must not rise in as if new while the echo folds away — that was a blink on every send.
  const swappedIn = React.useRef(new Set<number>());
  for (const s of replyMatch.settled) {
    const at = sentLines[s.line]?.at;
    if (at !== undefined) swappedIn.current.add(at);
  }
  const echoesLanded = replyMatch.settled.length > 0;
  const settledIds = replyMatch.settled.map((s) => s.id).join(" ");
  const onRepliesSettledRef = React.useRef(onRepliesSettled);
  onRepliesSettledRef.current = onRepliesSettled;
  React.useEffect(() => {
    if (settledIds) onRepliesSettledRef.current?.(settledIds.split(" "));
  }, [settledIds]);
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
  // What to ask for next, read off how the run ended; a follow-up already running needs no nudge.
  const steps = React.useMemo(() => (outcome?.result.followups?.some((f) => f.state === "running") ? [] : nextSteps(outcome, exitCode ?? null)), [outcome, exitCode]);
  const durationSec = digest?.startedAt && digest?.endedAt && digest.endedAt > digest.startedAt ? Math.round((digest.endedAt - digest.startedAt) / 1000) : undefined;

  const deadline = React.useMemo(() => deadlineOf(box, lifecycle), [box, lifecycle]);
  const deadlineText = deadlineLabel(deadline);

  const [removing, setRemoving] = React.useState(false);

  // Per-message revert: which operator messages have a restore point (message k restores the
  // in-box checkpoint taken when turn k-1 finished). Refetched whenever a turn settles.
  const [revertable, setRevertable] = React.useState<Set<number>>(new Set());
  const [revertAsk, setRevertAsk] = React.useState<{ message: number; discarded: number } | null>(null);
  const [seed, setSeed] = React.useState<{ text: string; n: number; append?: boolean; inline?: boolean; image?: { name: string; dataUrl: string; label?: string; note?: string } } | null>(null);
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
      swappedIn.current.clear();
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
  const compactMode = useAutoCompactMode();
  // `/compact` runs only on Claude Code; other drivers would get the words as a task.
  const canCompact = (box.agent ?? "claude") === "claude";
  const ctxHealth = React.useMemo(() => contextHealthOf(events, compactMode), [events, compactMode]);
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
  // The answer just picked, drawn at once as the recorded decision ("asked — answered") where the
  // question sat, instead of a plain echo bubble that the real card replaced seconds later when the
  // resumed run wrote the answer into the log.
  // Tied to the recorded question it answers, so a later question never borrows it.
  const [sent, setSent] = React.useState<{ ask: string; text: string } | null>(null);
  const openAskTextRef = React.useRef<string | null>(null);
  React.useEffect(() => setSent(null), [box.name]);
  const sentAnswer = sent?.text ?? null;
  const answer = React.useCallback(
    (text: string) => {
      echo(text);
      setAnswering(true);
      setAnswered(question ?? "");
      setSent(openAskTextRef.current !== null ? { ask: openAskTextRef.current, text } : null);
      api
        .resume(box.name, text, { force: true })
        .catch((e: unknown) => {
          setAnswered(null);
          setSent(null);
          onReplyFailed?.(text);
          toast.error("The agent did not get your answer", { description: e instanceof Error ? e.message : String(e) });
        })
        .finally(() => setAnswering(false));
    },
    [box.name, echo, onReplyFailed, question]
  );
  const showQuestion = !!question && runState === "waiting" && answered !== question;
  const resuming = !!question && runState === "waiting" && answered === question;
  // The newest recorded question still without an answer in the log: where an answer just sent is drawn.
  const openAsk = React.useMemo(() => {
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (g.kind === "asked") return g.answer === "" ? i : -1;
    }
    return -1;
  }, [groups]);
  const openAskGroup = openAsk >= 0 ? groups[openAsk] : null;
  openAskTextRef.current = openAskGroup?.kind === "asked" ? openAskGroup.question : null;
  const optimisticAsk = React.useMemo(
    () => (openAskGroup?.kind === "asked" && sent && sent.ask === openAskGroup.question && !showQuestion ? { ...openAskGroup, answer: sent.text } : null),
    [openAskGroup, sent, showQuestion]
  );

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
  // A compaction already on its way (sent, queued, or underway): the "compact" advice steps aside.
  const compactPending = React.useMemo(() => {
    const last = groups[groups.length - 1];
    return (
      (last?.kind === "compact" && (last.state === "pending" || last.state === "running") && runState === "running") ||
      pendingReplies.some((r) => isCompactCommand(r.text)) ||
      queuedItems.some((q) => isCompactCommand(q.text))
    );
  }, [groups, runState, pendingReplies, queuedItems]);
  const compactNow = async () => {
    const live = runState === "running";
    if (!live) echo("/compact");
    try {
      const res = await api.resume(box.name, "/compact");
      if ("queued" in res && res.queued) {
        refreshQueue();
        toast("Compaction queued", { description: "It runs as its own turn once the agent finishes this one." });
      }
    } catch (e) {
      if (!live) onReplyFailed?.("/compact");
      toast.error("Could not compact", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const compactions = React.useMemo(
    () => events.filter((e): e is Extract<TraceEvent, { kind: "compact" }> => e.kind === "compact" && e.state === "done"),
    [events]
  );
  const contextStatus: ContextStatus | null =
    ctxHealth && !loadingTrace
      ? { health: ctxHealth, compactions, canCompact, pending: compactPending, running: runState === "running", onCompact: () => void compactNow() }
      : null;
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
  // The run's clock for the header: first stamped event → now while running, → last stamp once done.
  const stamps = React.useMemo(() => {
    let first: number | undefined;
    let last: number | undefined;
    for (const e of events) {
      const at = "at" in e ? e.at : undefined;
      if (at === undefined) continue;
      if (first === undefined) first = at;
      const end = e.kind === "tool" && e.ms !== undefined ? at + e.ms : at;
      if (last === undefined || end > last) last = end;
    }
    return { first: digest?.startedAt ?? first, last: digest?.endedAt ?? last };
  }, [events, digest?.startedAt, digest?.endedAt]);
  const [stopping, setStopping] = React.useState(false);
  React.useEffect(() => setStopping(false), [box.name, runState]);
  const stopTurn = async () => {
    setStopping(true);
    try {
      await api.interrupt(box.name);
    } catch (e) {
      setStopping(false);
      toast.error("Could not stop the turn", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  // Only a running, awake turn can be stopped — the palette's event must respect that too.
  stopTurnRef.current = runState === "running" && !sleeping ? stopTurn : null;
  // Discuss (D1): reply in free text with the proposal quoted; the question or schedule stays open.
  const discuss = React.useCallback((proposal: string) => {
    setSeed({ text: `${asQuote(proposal)}\n\n`, n: Date.now() });
  }, []);
  // Selected conversation text: a quote attached to the side chat's next question, or quoted into
  // the main composer's draft (appended when something is already typed).
  const askSelection = React.useCallback(
    (text: string) => {
      openSideChat();
      side.quote(text);
    },
    [openSideChat, side]
  );
  const quoteSelection = React.useCallback((text: string) => setSeed({ text: `${asQuote(text)}\n\n`, n: Date.now(), append: true }), []);
  // The run's model, from the formatter's "session started (model X)" marker — observed, not assumed.
  const runModel = React.useMemo(() => {
    for (const e of events) {
      if (e.kind === "lifecycle" && e.detail) {
        const m = e.detail.match(/^model\s+(\S+)/);
        if (m) return m[1];
      }
    }
    const p = digest?.provenance;
    return p?.model ? (p.provider ? `${p.provider} / ${p.model}` : p.model) : outcome?.cost.model ?? null;
  }, [events, digest?.provenance, outcome?.cost.model]);
  // The header's Chat/Trace toggle is the one fold control: Trace sweeps every fold open, Chat
  // folds them. `v` bumps on each switch so a fold toggled by hand still follows the next switch;
  // v === 0 (not switched since mount) leaves each fold to its own default.
  const [expandAll, setExpandAll] = React.useState({ v: 0, open: density === "trace" });
  const densityRef = React.useRef(density);
  React.useEffect(() => {
    if (densityRef.current === density) return;
    densityRef.current = density;
    setExpandAll((s) => ({ v: s.v + 1, open: density === "trace" }));
  }, [density]);

  // Turns for the minimap: the task plus every message you sent, each with how the agent replied.
  // Following is smooth only while the agent is writing. Everything else lands at once: opening a
  // thread used to travel through the whole conversation for a second and a half (the transcript
  // replaced the skeleton, and the smooth follow animated from the top to the end), and code blocks
  // highlighting a beat later kept it drifting. A reader opens a thread to see where it stands.
  const [landed, setLanded] = React.useState(false);
  React.useEffect(() => {
    if (loadingTrace) return setLanded(false);
    const t = window.setTimeout(() => setLanded(true), 1200);
    return () => window.clearTimeout(t);
  }, [loadingTrace]);
  const stick = useStickToBottom({ resize: landed && runState === "running" && !sleeping ? "smooth" : "instant", initial: "instant" });

  // A long agent message must not drag the view to its end. Once the newest reply's first line
  // reaches the top while it is still the last thing in the thread, following stops there and the
  // reader scrolls on at their own pace; scrolling back to the bottom resumes following.
  jumpToLatest.current = () =>
    requestAnimationFrame(() => {
      const el = stick.scrollRef.current;
      if (!el) return;
      // A long way down is a jump, not a ride: a spring across ten screens is a blur.
      const far = el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight * 2;
      void stick.scrollToBottom({ animation: far ? "instant" : "smooth" });
    });
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
    // Something below the reply wants the reader first (the wake card, a question waiting): open
    // on that, at the end, and do not come back for this reply later.
    if (!landed && (sleeping || wake || showQuestion)) {
      heldSay.current = last;
      return;
    }
    heldSay.current = last;
    stick.stopScroll();
    // While the reply streams, the view only ever comes BACK to its first line. On open there is
    // nothing to come back from: the thread is still at the very top, and stopping the follow
    // there left a finished run showing its first screen instead of its answer. Go to the answer.
    if (scroller.scrollTop > top || !landed) scroller.scrollTop = Math.max(0, top);
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
  // A fullscreen viz pauses following too: closing it must land on the block the reader opened.
  // The library re-locks on any shrink near the bottom (a tool row settling), so the pause is held
  // for as long as a dialog is open, not set once.
  const [vizFullscreens, setVizFullscreens] = React.useState(0);
  const onVizFullscreen = React.useCallback((open: boolean) => setVizFullscreens((n) => n + (open ? 1 : -1)), []);
  const vizHeld = vizFullscreens > 0;
  React.useEffect(() => {
    if (vizHeld && !stick.escapedFromLock) stopScroll();
  }, [vizHeld, stick.escapedFromLock, stopScroll]);

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
  // More than one viewport above the end: the only distance at which a jump button beats scrolling.
  const [farUp, setFarUp] = React.useState(false);
  React.useEffect(() => {
    const el = stick.scrollRef.current;
    if (!el) return;
    const measure = () => setFarUp(el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight);
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    return () => el.removeEventListener("scroll", measure);
  }, [stick.scrollRef]);
  const turns = React.useMemo<Turn[]>(() => {
    const out: Turn[] = [];
    if (box.task) out.push({ id: "task", label: "Task", you: box.task, reply: groups.find((g) => g.kind === "say")?.text });
    groups.forEach((g, i) => {
      if (g.kind === "you" || g.kind === "asked") {
        const reply = groups.slice(i + 1).find((x) => x.kind === "say");
        out.push({
          id: keys[i],
          label: g.kind === "asked" ? "Question" : "Follow-up",
          you: g.kind === "asked" ? `${g.question.split("\n")[0]} → ${g.answer}` : g.text,
          reply: reply?.kind === "say" ? reply.text : undefined,
          ...(g.kind === "asked" ? { kind: "question" as const } : {}),
        });
      }
    });
    return out;
  }, [groups, keys, box.task]);

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
  const working: { label: string; detail?: string } | null = resuming
    ? { label: "Answer sent — the agent is resuming" }
    : sleeping
      ? null
      : starting
        ? {
            label: "Starting up",
            detail: box.agent === "omp" ? "installing oh-my-pi and getting your task ready — the first start takes about a minute" : "the sandbox is getting your task ready",
          }
        // A live reasoning trail or tool group names what the agent is doing and the header keeps
        // the clock; this pill only covers the beats before the trace starts speaking.
        : runState === "running" && !loadingTrace && !["say", "think", "work", "tools"].includes(lastKind)
          ? { label: events.length ? "Working" : "Starting up" }
          : pendingReplies.length > 0 && runState !== "running"
            ? { label: "Message sent", detail: "the agent is picking it up" }
            : null;
  const agentKinds = ["say", "tools", "think", "work", "plan"];
  // Operator-message index per group: the task is 1, each you/asked group after it increments.
  const messageIndex = React.useMemo(() => {
    let n = 1;
    return groups.map((g) => (g.kind === "you" || g.kind === "asked" || (g.kind === "compact" && g.fromYou) ? ++n : n));
  }, [groups]);
  const messageCount = messageIndex[messageIndex.length - 1] ?? 1;
  const editMessage = React.useCallback((text: string) => setSeed({ text, n: Date.now() }), []);
  const askRevert = React.useCallback((message: number) => setRevertAsk({ message, discarded: messageCount - (message - 1) }), [messageCount]);
  const still = useReducedMotion();

  return (
    <SessionContext.Provider value={box.name}>
    <SessionReposContext.Provider value={repos}>
    <CodeNavContext.Provider value={openRef}>
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
        startedAt={stamps.first}
        endedAt={stamps.last}
        onStop={runState === "running" && !sleeping ? stopTurn : undefined}
        stopping={stopping}
        showWorkspace={showWorkspace}
        showInspector={inspectorOpen && !showWorkspace}
        showBrowser={browserOpen && !sleeping}
        onToggleBrowser={toggleBrowser}
        onToggleInspector={toggleInspector}
        showSideChat={sideOpen}
        sideUnread={side.unread}
        onToggleSideChat={toggleSideChat}
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
        onToggleWorkspace={() => (showWorkspace ? closeWorkspace() : (setInspectorOpen(false), side.close(), closeBrowser(), setWorkspaceOpen(true)))}
        density={density}
        onToggleDensity={() => onDensity(density === "chat" ? "trace" : "chat")}
        onToggleKeep={toggleKeep}
        onRename={rename}
        onAttach={(full) => attach(full)}
        onDestroy={destroy}
        onCopyTranscript={async () => toMarkdown(events, { title, machine: friendlyName(box.name), url: window.location.href })}
        onNewFromThis={newFromThis}
        events={events}
      />

      <div className="relative flex min-h-0 flex-1">
      <div data-thread onClickCapture={onThreadClick} className={cn("flex min-h-0 min-w-0 flex-1 flex-col", ((showWorkspace && workspaceFull) || (browserOpen && browserFull && !sleeping)) && "hidden md:hidden")}>
      <div className="@container relative min-h-0 min-w-0 flex-1">
        <ThreadMinimap turns={turns} scrollerRef={stick.scrollRef} />
        <SchedulePill box={box.name} runState={String(runState ?? "")} />
        <ChatContainerRoot className="relative h-full [&>div]:overflow-x-hidden" instance={stick} aria-label="Conversation" aria-busy={runState === "running"}>
          <ChatContainerContent className="mx-auto w-full max-w-3xl gap-5 px-4 pt-7 pb-12 md:px-6">
            {planBoard && !sleeping && !loadingTrace && planPlacement === "card" && <PlanBoard board={planBoard} live={runState === "running"} variant="card" />}
            {box.task && (
              <div data-turn="task">
                <YouItem text={box.task} label="Task" noEnter onEdit={editMessage} />
              </div>
            )}
            {inferredRepos && inferredRepos.length > 0 && <AttachedFromTask repos={inferredRepos} />}


            {/* Skeleton → transcript is a crossfade, not a cut: the placeholder is shaped like the
                content, so the swap reads as the bones filling in. */}
            <ExpandAll.Provider value={expandAll}>
            <LiveRegistryContext.Provider value={liveContext}>
            <VizFullscreenGate.Provider value={onVizFullscreen}>
            <RepeatedPolls.Provider value={repeats}>
            <Density.Provider value={density}>
            <Swap state={loadingTrace} mode="popLayout" className="flex flex-col gap-5">
            {loadingTrace && <ThreadSkeleton withTask={!!box.task} />}
            {!loadingTrace && groups.map((g, i) => {
              const key = keys[i];
              // The ⟦ask⟧ block lands in the log the moment the agent asks. While that question is
              // still the one waiting (or its answer is in flight), the live card below IS the
              // question — rendering the transcript copy too showed it twice. Once answered (or
              // superseded) it stays as the recorded decision.
              if (g.kind === "asked" && i === openAsk && !optimisticAsk && (showQuestion || resuming)) return null;
              // think folds into a work trail; the plan renders once at the head (or in the dock).
              if (g.kind === "think" || g.kind === "plan") return null;
              const msgIndex = messageIndex[i];
              return (
                <GroupRow
                  key={key}
                  g={i === openAsk && optimisticAsk ? optimisticAsk : g}
                  rowKey={key}
                  live={runState === "running" && i === groups.length - 1}
                  // The agent's byline opens each of its runs, whatever it starts with (prose, tools, thinking).
                  opensAgent={agentKinds.includes(g.kind) && (i === 0 || !agentKinds.includes(groups[i - 1].kind))}
                  noEnter={g.kind === "you" && g.at !== undefined && swappedIn.current.has(g.at)}
                  revertIndex={g.kind === "you" && canRevertNow && revertable.has(msgIndex) ? msgIndex : 0}
                  onRevert={askRevert}
                  onEdit={editMessage}
                />
              );
            })}
            </Swap>
            </Density.Provider>
            </RepeatedPolls.Provider>
            </VizFullscreenGate.Provider>
            </LiveRegistryContext.Provider>
            </ExpandAll.Provider>

            {/* What this chat scheduled, right under the message that scheduled it. */}
            {!loadingTrace && <ScheduledCard box={box.name} runState={String(runState ?? "")} onRetry={(text) => setSeed({ text, n: Date.now() })} onDiscuss={discuss} />}

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

            <AnimatePresence initial={false}>
              {idle && (
                <Rise key="idle" still={still}>
                  <IdleEmpty box={box} onNew={onNew} onPick={(text) => setSeed({ text, n: Date.now() })} />
                </Rise>
              )}
              {showMemoryCard && (
                <Rise key="memory" still={still}>
                  <MemoryBumpCard kind={oomKilled ? "oom" : "pressure"} nextTier={nextMemoryTier!} memUsage={box.memUsage} phase={bumpPhase} onBump={() => void bumpAndContinue()} />
                </Rise>
              )}
            </AnimatePresence>
            {/* Outside the presence on purpose: once answered it leaves at once, because the answered
                card has already taken its place just above — a fading copy below it was a second,
                stale question and a layout jump when it finally collapsed. */}
            {showQuestion && <QuestionCard key="question" question={question!} onAnswer={answer} onDiscuss={discuss} busy={answering} />}

            {/* An echo whose log line just landed leaves at once (`custom`): the line is already drawn
                in its place. One that is withdrawn (delivery failed) folds away as before. */}
            <AnimatePresence initial={false} custom={{ still, instant: echoesLanded }}>
              {pendingReplies.filter((r) => !(optimisticAsk && r.text === sentAnswer)).map((r) => (
                <Rise key={r.id} still={still} className={isCompactCommand(r.text) ? "mt-3" : "mt-5"}>
                  {isCompactCommand(r.text) ? (
                    <CompactItem c={{ state: "pending", trigger: "manual", instructions: compactInstructions(r.text) || undefined }} live />
                  ) : (
                    <YouItem text={r.text} noEnter />
                  )}
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
              {/* detail here is a sentence about the phase, never a tool name — the trace says what runs. */}
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

            {!sleeping && !loadingTrace && artifacts.length > 0 && runState !== "running" && pendingReplies.length === 0 && <ProducedFiles session={box.name} files={artifacts} />}

            {/* MCP servers the install left out of this box: the agent is running without them. */}
            {!sleeping && !loadingTrace && !!snap?.mcpNotes?.length && (
              <p className="text-muted-foreground enter text-micro" role="status">
                {mcpNotesText(snap.mcpNotes)}
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
                      : exitCode === 250
                        ? "Disk full"
                        : exitCode === 254 || exitCode === 253
                          ? "Run interrupted"
                          : digest?.startFailure
                            ? "Failed to start"
                            : "Exited with an error"
                }
                failed={exitCode != null && exitCode !== 0}
                detail={
                  exitCode == null || exitCode === 0
                    ? deadlineText ?? undefined
                    : exitCode === 137
                      ? "the kernel killed the agent — add memory above to continue where it left off"
                      : exitCode === 250
                        ? "the sandbox disk is full, so the run was not started — grow the disk above, then send a message to continue"
                        : exitCode === 254
                          ? "the sandbox restarted mid-run — send a message to continue"
                          : exitCode === 253
                            ? "stopped by you to deliver a message immediately"
                            : digest?.startFailure
                              ? `the sandbox never ran the agent (code ${exitCode})${digest.startFailure.tail ? ` — ${lastLine(digest.startFailure.tail)}` : ""}`
                              : `code ${exitCode}`
                }
                stats={runStats(events)}
                durationSec={durationSec}
                context={ctxHealth}
                onAgain={newFromThis}
              />
            )}
            {finished && !sleeping && !loadingTrace && pendingReplies.length === 0 && steps.length > 0 && (
              <div className="enter -mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Suggested next steps">
                {steps.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    title={st.text}
                    onClick={() => setSeed({ text: st.text, n: Date.now() })}
                    className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring text-meta h-7 cursor-pointer rounded-full border px-3 transition-colors duration-150 outline-none focus-visible:ring-2 active:scale-[0.97]"
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            )}
            <ChatContainerScrollAnchor />
          </ChatContainerContent>
        </ChatContainerRoot>
        <SelectionToolbar scrollerRef={stick.scrollRef} onAsk={askSelection} onQuote={quoteSelection} />
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
        {/* Jump to the latest output: centred just above the composer, only once the reader is more
            than a viewport away from the end (a screen's worth of scrolling is a wheel flick, not a
            journey). When the agent produces something NEW while you are reading history, the
            button appears at once and grows a label — the chat-app affordance for "there is more
            below than when you left". */}
        <AnimatePresence initial={false}>
          {!stick.isAtBottom && (farUp || newBelow) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
            <motion.button
              type="button"
              layout={!still}
              initial={still ? false : { opacity: 0, scale: 0.25 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
              transition={still ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0 }}
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

      <SendBar
        top={!sleeping ? <ChangesDock files={changes} loading={changesLoading} onOpen={openChange} onRefresh={refreshChanges} onReviewAll={openReview} activePath={openFile?.path} /> : undefined}
        boxName={box.name}
        runState={runState}
        sleeping={sleeping}
        repos={repos}
        onOpenSideChat={openSideChat}
        onReplied={echo}
        onQueued={() => {
          refreshQueue();
          jumpToLatest.current();
        }}
        onFocusRequest={onFocusRequest}
        onReplyFailed={onReplyFailed}
        canCompact={canCompact}
        context={contextStatus}
        seed={seed}
        phase={starting ? "starting" : showQuestion ? "asked" : idle ? "fresh" : undefined}
      />
      </div>
      {/* Sibling of the whole column (conversation + dock + composer), so opening it narrows all
          three together and the composer stays aligned with the text. */}
      {planBoard && !sleeping && planPlacement === "dock" && <PlanBoard board={planBoard} live={runState === "running"} variant="dock" />}
      <AnimatePresence initial={false}>
        {inspectorOpen && !showWorkspace && (
          <RunInspector
            key="inspector"
            box={box}
            lifecycle={lifecycle}
            events={events}
            running={runState === "running" && !sleeping}
            startedAt={stamps.first}
            endedAt={stamps.last}
            model={runModel}
            repos={repos}
            queued={queuedItems}
            fleet={fleet}
            onOpenBox={onOpenBox}
            onClose={() => setInspectorOpen(false)}
          />
        )}
      </AnimatePresence>
      <SideChat side={side} sleeping={sleeping} onClose={side.close} />
      <AnimatePresence initial={false}>
        {showWorkspace && (
          <React.Suspense
            key="workspace"
            fallback={
              <aside className="bg-card hidden md:flex md:h-full md:w-[58%] md:min-w-[30rem] md:shrink-0 md:flex-col md:border-l" aria-busy="true" aria-label="Workspace loading">
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
            <WorkspacePane session={box.name} changes={changes} open={openFile} review={reviewNonce} onClose={closeWorkspace} onSaved={refreshChanges} repos={repos} full={workspaceFull} onToggleFull={() => setWorkspaceFull((v) => !v)} onMention={mentionFile} />
          </React.Suspense>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {browserOpen && !sleeping && !showWorkspace && (
          <React.Suspense key="browser" fallback={null}>
            <BrowserPane key={box.name} session={box.name} live={runState === "running"} onClose={closeBrowser} onTag={tagFromBrowser} goTo={browserGoTo} sent={browserSent} full={browserFull} onToggleFull={() => setBrowserFull((v) => !v)} />
          </React.Suspense>
        )}
      </AnimatePresence>
      </div>
    </div>
    </CodeNavContext.Provider>
    </SessionReposContext.Provider>
    </SessionContext.Provider>
  );
}

/** Starter prompts: an empty box should show what a good first instruction looks like, not a blank page. */
const STARTERS = [
  { icon: Compass, title: "Explore a repo", text: "Clone the repository I attach, map its structure, and summarise how it is built and tested." },
  { icon: Bug, title: "Fix a failing test", text: "Run the test suite, find the first failing test, fix the root cause, and show me the diff." },
  { icon: Sparkles, title: "Add a feature", text: "Add a small feature: describe it here — then write tests for it and open a pull request." },
  { icon: GitPullRequest, title: "Review a PR", text: "Review pull request #<number> for bugs and risky changes, and leave me a short verdict." },
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
      {/* One list, not four equal cards: the starters are a menu of first lines for the composer, so
          they read as rows (mark, name, what it sends) with one frame around the lot. The arrow
          says where a pick goes: up into the composer, to be edited before it is sent. */}
      <ul className="bg-card divide-border w-full max-w-[40rem] divide-y overflow-hidden rounded-xl border">
        {STARTERS.map((st, i) => (
          <li key={st.title} className="stagger-item" style={{ "--i": i } as React.CSSProperties}>
            <button
              type="button"
              onClick={() => onPick(st.text)}
              className="group hover:bg-muted/60 focus-visible:bg-muted/60 flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left transition-colors duration-150 outline-none"
            >
              <span className="bg-muted text-muted-foreground group-hover:text-foreground grid size-8 shrink-0 place-items-center rounded-lg transition-colors duration-150" aria-hidden>
                <st.icon className="size-4" strokeWidth={1.75} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-foreground text-meta font-medium">{st.title}</span>
                <span className="text-muted-foreground line-clamp-2 text-micro sm:line-clamp-1">{st.text}</span>
              </span>
              <ArrowUpRight className="text-faint group-hover:text-foreground size-4 shrink-0 -translate-x-1 opacity-0 transition-[opacity,translate,color] duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 [@media(hover:none)]:translate-x-0 [@media(hover:none)]:opacity-100" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onNew}>
          <Plus className="size-3.5" />
          New task
        </Button>
        {/* Keyboard facts: on a phone Enter is a new line, so the line is not shown there. */}
        <span className="text-faint text-micro [@media(hover:none)]:hidden">
          <kbd className="rounded border px-1 font-mono">Enter</kbd> sends · <kbd className="rounded border px-1 font-mono">@</kbd> files · <kbd className="rounded border px-1 font-mono">/</kbd> skills
        </span>
      </div>
    </div>
  );
}

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

/**
 * One row of the conversation. Memoized: with the groups structurally shared, a streamed chunk
 * re-renders the row that grew, not the whole run.
 */
const GroupRow = React.memo(function GroupRow({
  g,
  rowKey,
  live,
  opensAgent,
  noEnter,
  revertIndex,
  onRevert,
  onEdit,
}: {
  g: TraceGroup;
  rowKey: string;
  live: boolean;
  opensAgent: boolean;
  noEnter: boolean;
  revertIndex: number;
  onRevert: (message: number) => void;
  onEdit: (text: string) => void;
}) {
  switch (g.kind) {
    case "lifecycle":
      return <LifecycleItem label={g.label} detail={g.detail} />;
    case "tools":
      return (
        <div className="min-w-0">
          <ToolGroup events={g.events} live={live} />
        </div>
      );
    case "mcp-connect":
      return <McpConnectItem server={g.server} />;
    case "you":
      return (
        <div data-turn={rowKey} className="mt-5">
          <YouItem text={g.text} at={g.at} noEnter={noEnter} onEdit={onEdit} onRevert={revertIndex ? () => onRevert(revertIndex) : undefined} />
        </div>
      );
    case "asked":
      return (
        <div data-turn={rowKey} className="mt-5">
          <AnsweredQuestionItem question={g.question} answer={g.answer} />
        </div>
      );
    case "work":
      return (
        <div className="min-w-0">
          <ReasoningTrail items={g.items} live={live} />
        </div>
      );
    case "memory":
      return <MemoryItem notes={g.notes} />;
    case "compact":
      return (
        <div className="mt-3">
          <CompactItem c={g} live={live} />
        </div>
      );
    case "say":
      return (
        <div data-say className="min-w-0">
          <SayKeyContext.Provider value={rowKey}>
            <SayItem text={g.text} live={live} label={opensAgent} at={g.at} />
          </SayKeyContext.Provider>
        </div>
      );
    default:
      return null;
  }
});

type TraceGroup =
  | { kind: "say"; text: string; at?: number }
  | { kind: "you"; text: string; at?: number }
  | { kind: "asked"; question: string; answer: string }
  | { kind: "lifecycle"; label: string; detail?: string }
  | { kind: "tools"; events: ToolEvent[] }
  | { kind: "mcp-connect"; server: string }
  | { kind: "think"; text: string; ms?: number }
  | { kind: "work"; items: TrailItem[] }
  | { kind: "plan"; board: TaskBoard }
  | { kind: "memory"; notes: { note: string; text: string; area?: string; updated?: boolean }[] }
  /** A compaction; `fromYou` when a `/compact` the user sent opened it (it counts as their message). */
  | ({ kind: "compact"; fromYou?: boolean } & CompactView);

function groupTrace(events: TraceEvent[]): TraceGroup[] {
  const out: TraceGroup[] = [];
  // The board reads the WHOLE trace, not one snapshot: a step's evidence is the work that happened
  // between the snapshot that started it and the one that ended it.
  const board = deriveTaskBoard(events);
  // First contact with each MCP server gets a lifecycle hairline — so a server that SHOULD appear
  // but never does (silently dropped at handshake) is visible by absence.
  const seenServers = new Set<string>();
  for (let idx = 0; idx < events.length; idx++) {
    const e = events[idx];
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
    } else if (e.kind === "you" && isCompactCommand(e.text)) {
      // `/compact` is a seam, not a bubble: it opens the divider its ⟦compact⟧ lines then fill in.
      const instructions = compactInstructions(e.text);
      out.push({ kind: "compact", state: "pending", trigger: "manual", fromYou: true, at: e.at, ...(instructions ? { instructions } : {}) });
    } else if (e.kind === "compact") {
      // Folds into the `/compact` that asked for it (only a repeated "session started" may sit
      // between them); an automatic one, or one whose command is above the log tail, stands alone.
      let j = out.length - 1;
      while (j >= 0 && out[j].kind === "lifecycle") j--;
      const prev = out[j];
      const view = {
        state: e.state,
        ...(e.trigger ? { trigger: e.trigger } : {}),
        ...(e.preTokens !== undefined ? { preTokens: e.preTokens } : {}),
        ...(e.postTokens !== undefined ? { postTokens: e.postTokens } : {}),
        ...(e.ms !== undefined ? { ms: e.ms } : {}),
        ...(e.error ? { error: e.error } : {}),
        ...(e.summary ? { summary: e.summary } : {}),
      };
      if (prev?.kind === "compact" && (prev.state === "pending" || prev.state === "running")) out[j] = { ...prev, ...view };
      else out.push({ kind: "compact", ...view, at: e.at });
    } else if (e.kind === "you") {
      // An answer to a question the transcript recorded (⟦ask⟧ … ⟦/ask⟧ right before) folds into one
      // "asked — answered" item, so the decision stays readable when scrolling back.
      const prev = out[out.length - 1];
      if (prev?.kind === "asked" && prev.answer === "") prev.answer = e.text;
      else out.push({ kind: "you", text: e.text, at: e.at });
    } else if (e.kind === "ask") {
      out.push({ kind: "asked", question: e.text, answer: "" });
    } else if (e.kind === "think") {
      // Think events carry no stamp; the gap between the stamped events around it bounds it.
      let before: number | undefined = e.at;
      for (let j = idx - 1; j >= 0 && before === undefined; j--) {
        const p = events[j];
        if (p.kind === "tool" && p.at !== undefined) before = p.at + (p.ms ?? 0);
        else if ((p.kind === "say" || p.kind === "you" || p.kind === "plan" || p.kind === "memory") && p.at !== undefined) before = p.at;
      }
      let after: number | undefined;
      for (let j = idx + 1; j < events.length && after === undefined; j++) {
        const n = events[j];
        if ("at" in n && n.at !== undefined) after = n.at;
      }
      out.push({ kind: "think", text: e.text, ...(before !== undefined && after !== undefined && after > before ? { ms: after - before } : {}) });
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
  return foldWork(out);
}

/**
 * The agent's work between two things it says — thinking, tool calls, server connects — folds into
 * one reasoning trail, so the thread reads as prose with the work one line each between. A lone run
 * of tool calls stays a tool group (its fold already reads the same way and keeps its visual output).
 */
function foldWork(groups: TraceGroup[]): TraceGroup[] {
  const out: TraceGroup[] = [];
  let run: TrailItem[] = [];
  const flush = () => {
    if (!run.length) return;
    if (run.length === 1 && run[0].kind === "tools") out.push(run[0]);
    else out.push({ kind: "work", items: run });
    run = [];
  };
  for (const g of groups) {
    if (g.kind === "think" || g.kind === "tools" || g.kind === "mcp-connect") run.push(g);
    else {
      flush();
      out.push(g);
    }
  }
  flush();
  return out;
}

function groupKeys(groups: TraceGroup[]): string[] {
  const keys: string[] = [];
  const seen = new Map<string, number>();
  let anchor = "start";
  let sinceAnchor = 0;
  for (const g of groups) {
    const at = groupAt(g);
    let key: string;
    if (at === undefined) key = `${g.kind}~${anchor}+${sinceAnchor++}`;
    else {
      key = `${g.kind}@${at}`;
      anchor = key;
      sinceAnchor = 0;
    }
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    keys.push(n === 1 ? key : `${key}#${n}`);
  }
  return keys;
}

function groupAt(g: TraceGroup): number | undefined {
  if (g.kind === "say" || g.kind === "you") return g.at;
  if (g.kind === "tools") return g.events[0]?.at;
  if (g.kind === "work") {
    for (const item of g.items) if (item.kind === "tools" && item.events[0]?.at !== undefined) return item.events[0].at;
  }
  return undefined;
}

function sentence(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * A transient thread row (pending reply, queued message): rises into place on arrival and
 * folds away on exit so its neighbours glide rather than jump. Transform/opacity plus a height
 * collapse on exit only; reduced motion keeps a plain fade. The column's gap-5 is not ours to
 * animate, so the exit also pulls marginBottom to -gap: the row's slot AND its gap close together
 * instead of the gap snapping shut when the node finally unmounts.
 */
type RiseCustom = { still: boolean | null; instant?: boolean };
const RISE = {
  from: (c: RiseCustom) => (c.still ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }),
  shown: { opacity: 1, y: 0, scale: 1 },
  // `instant`: something already drawn in this row's place has taken over — leave without a fold.
  gone: (c: RiseCustom) =>
    c.instant ? { opacity: 0, transition: { duration: 0 } } : c.still ? { opacity: 0 } : { opacity: 0, scale: 0.98, height: 0, marginTop: 0, marginBottom: "-1.25rem" },
};
function Rise({ still, children, className }: { still: boolean | null; children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      layout={still ? false : "position"}
      custom={{ still } satisfies RiseCustom}
      variants={RISE}
      initial="from"
      animate="shown"
      exit="gone"
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      style={{ transformOrigin: "100% 100%" }}
      className={cn("min-w-0", className)}
    >
      {children}
    </motion.div>
  );
}

/** The last non-empty line of a log tail, for a one-line reason. */
function lastLine(tail: string): string {
  const lines = tail.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/**
 * `mcp-skip:'spec' free=…k` / `mcp-fail:'spec'` / `mcp-drop:a,b` → "Running without 2 MCP servers:
 * btp-mcp-server (no disk space), @cap-js/mcp-server (install failed)". The drop line repeats the
 * skipped and failed ones, so it only adds names the other lines did not explain.
 */
function mcpNotesText(notes: string[]): string {
  const why = new Map<string, string>();
  const nameOf = (spec: string) => {
    const at = spec.indexOf("@", 1);
    return at > 0 ? spec.slice(0, at) : spec;
  };
  for (const n of notes) {
    const m = n.match(/^mcp-(skip|fail):'([^']+)'/);
    if (m) why.set(nameOf(m[2]), m[1] === "skip" ? "no disk space" : "install failed");
  }
  for (const n of notes) {
    if (!n.startsWith("mcp-drop:")) continue;
    for (const name of n.slice("mcp-drop:".length).split(",").map((x) => x.trim()).filter(Boolean)) if (!why.has(name)) why.set(name, "not installed");
  }
  if (why.size === 0) return "";
  const list = [...why].map(([name, w]) => `${name} (${w})`).join(", ");
  return `Running without ${why.size === 1 ? "an MCP server" : `${why.size} MCP servers`}: ${list}`;
}
