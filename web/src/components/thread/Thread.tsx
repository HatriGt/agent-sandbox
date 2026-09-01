import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api, type BoxView, type ChangedFile, type FleetLifecycle, type WatchSnapshot } from "@/lib/api";
import { AnimatePresence, motion } from "motion/react";
// The workspace (CodeMirror + merge view) is heavy and optional: loaded the first time it opens.
const WorkspacePane = React.lazy(() => import("./WorkspacePane").then((m) => ({ default: m.WorkspacePane })));
import { WakingCard } from "./WakingCard";
import { SessionContext } from "@/lib/session-context";
import { friendlyName, isSleeping, POLL_MS, threadTitle } from "@/lib/format";
import { deadlineLabel, deadlineOf, displayState, fmtDuration } from "@/lib/lifecycle";
import { runStats, toMarkdown } from "@/lib/transcript";
import { setPrefill } from "@/lib/draft";
import { RunSummary } from "./RunSummary";
import { ThreadHeader } from "./ThreadHeader";
import { parseTrace, producedFiles } from "@/lib/trace";
import { deriveTaskBoard, type TaskBoard } from "@/lib/planTasks";
import { usePoll } from "@/hooks/usePoll";
import { seedWatchCache, useWatchStream } from "@/hooks/useWatchStream";
import { Button } from "@/components/ui/button";
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from "@/components/ui/chat-container";
import type { TraceEvent } from "@/lib/trace";
import { AnsweredQuestionItem, LifecycleItem, ObserverItem, PlanCard, QueuedItem, SayItem, ThinkingItem, ToolGroup, WorkingIndicator, YouItem } from "./TraceItems";
import { PlanDock } from "./PlanBoard";
import { ThreadMinimap, type Turn } from "./ThreadMinimap";
import { useStickToBottom } from "use-stick-to-bottom";
import { ChangesDock } from "./ChangesDock";
import { QuestionCard } from "./QuestionCard";
import { ArrowDown } from "lucide-react";
import { findPullRequests } from "@/lib/testReport";
import { ThreadSkeleton } from "./Skeletons";
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
  asides,
  replies,
  onAsk,
  onReplied,
  onBack,
  onNew,
  onTornDown,
  onFocusRequest,
  onReplyFailed,
}: {
  box: BoxView;
  lifecycle: FleetLifecycle;
  asides: Aside[];
  replies: string[];
  onAsk: (question: string) => void;
  onReplied: (text: string) => void;
  onBack: () => void;
  onNew: () => void;
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
  React.useEffect(() => {
    // Once the box reports running again, let the card show "awake" briefly, then leave.
    if (!sleeping && wake) {
      const t = window.setTimeout(() => setWake(null), 1400);
      return () => window.clearTimeout(t);
    }
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
  const { data: polled } = usePoll<WatchSnapshot>(
    (signal) => api.watch(box.name, signal),
    stream.ok || sleeping ? 0 : POLL_MS,
    [box.name, stream.ok, sleeping],
    { initialDelayMs: 2500 }
  );
  React.useEffect(() => {
    if (polled && polled.name === box.name) seedWatchCache(polled);
  }, [polled, box.name]);
  // The stream when it is live; otherwise whichever of the cached stream copy and the poll is newer,
  // so a thread opened without SSE (or after a short turn the stream missed) keeps moving.
  const polledSnap = polled?.name === box.name ? polled : null;
  const snap = stream.ok ? stream.snap ?? polledSnap : polledSnap && (!stream.snap || polledSnap.log.length >= stream.snap.log.length) ? polledSnap : stream.snap;

  const events = React.useMemo(() => parseTrace(snap?.log ?? ""), [snap?.log]);
  const groups = React.useMemo(() => groupTrace(events), [events]);
  // Derived once here so the docked board and the in-flow card are the same object.
  const planBoard = React.useMemo(() => deriveTaskBoard(events), [events]);
  const artifacts = React.useMemo(() => producedFiles(events), [events]);

  // What changed: fetched when the thread opens, whenever a Write/Edit lands or the run finishes, and
  // every 20s while running. Opening a file shows it in the side pane.
  const [changes, setChanges] = React.useState<ChangedFile[]>([]);
  const [changesLoading, setChangesLoading] = React.useState(false);
  const [openFile, setOpenFile] = React.useState<ChangedFile | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
  const [workspaceFull, setWorkspaceFull] = React.useState(false);
  const showWorkspace = workspaceOpen || openFile !== null;
  const closeWorkspace = () => {
    setWorkspaceOpen(false);
    setWorkspaceFull(false);
    setOpenFile(null);
  };

  const refreshChanges = React.useCallback(() => {
    if (sleeping) return;
    setChangesLoading(true);
    api
      .changes(box.name)
      .then((r) => setChanges(r.files))
      .catch(() => {})
      .finally(() => setChangesLoading(false));
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
  const pendingReplies = React.useMemo(() => {
    const persisted = new Set(events.filter((e) => e.kind === "you").map((e) => e.text.trim()));
    return replies.filter((r) => !persisted.has(r.trim()));
  }, [replies, events]);
  // The fleet poll is authoritative for a sleeping box (its stream cannot connect).
  const runState = sleeping ? box.runState : snap?.runState ?? box.runState;
  const question = sleeping ? box.question : snap?.question ?? box.question;
  const exitCode = snap?.exitCode ?? box.exitCode;
  const state = sleeping ? "sleeping" : displayState({ boxStatus: box.boxStatus, runState });
  const loadingTrace = !snap && !sleeping;

  const deadline = React.useMemo(() => deadlineOf(box, lifecycle), [box, lifecycle]);
  const deadlineText = deadlineLabel(deadline);

  const [removing, setRemoving] = React.useState(false);

  // Sleep on demand: `msb stop`, nothing removed. Marking wokeRef first keeps the "open a sleeping
  // thread wakes it" effect from bouncing the box straight back up.
  const [sleepBusy, setSleepBusy] = React.useState(false);
  const sleepNow = () => {
    setSleepBusy(true);
    wokeRef.current = box.name;
    api
      .sleep(box.name)
      .then(() => toast.success(`${friendlyName(box.name)} is asleep`, { description: "The workspace and session are kept. Opening the thread or replying wakes it." }))
      .catch((e: unknown) => toast.error("Could not put it to sleep", { description: e instanceof Error ? e.message : String(e) }))
      .finally(() => setSleepBusy(false));
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
    api.inbox(box.name).then((r) => setQueued(r.queued)).catch(() => {});
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

  const idle = runState === "idle" && events.length === 0 && !loadingTrace;

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
  const turns = React.useMemo<Turn[]>(() => {
    const out: Turn[] = [];
    if (box.task) out.push({ id: "task", label: "Task", you: box.task, reply: groups.find((g) => g.kind === "say")?.text });
    groups.forEach((g, i) => {
      if (g.kind === "you" || g.kind === "asked") {
        const reply = groups.slice(i + 1).find((x) => x.kind === "say");
        out.push({ id: `${g.kind}-${i}`, label: g.kind === "asked" ? "Question" : "Follow-up", you: g.kind === "asked" ? `${g.question.split("\n")[0]} → ${g.answer}` : g.text, reply: reply?.kind === "say" ? reply.text : undefined });
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

  return (
    <SessionContext.Provider value={box.name}>
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <ThreadHeader
        box={box}
        title={title}
        state={state}
        exitCode={exitCode}
        sleeping={sleeping}
        kept={kept}
        keeping={keeping}
        deadline={deadline}
        repos={repos}
        attaching={attaching}
        pull={pulls.length > 0 && !loadingTrace ? pulls[pulls.length - 1] : undefined}
        activity={activity}
        showWorkspace={showWorkspace}
        removing={removing}
        sleepNow={sleepNow}
        sleepBusy={sleepBusy}
        onBack={onBack}
        onNew={onNew}
        onToggleWorkspace={() => (showWorkspace ? closeWorkspace() : setWorkspaceOpen(true))}
        onToggleKeep={toggleKeep}
        onRename={rename}
        onAttach={(full) => attach(full)}
        onDestroy={destroy}
        onCopyTranscript={async () => toMarkdown(events, { title, machine: friendlyName(box.name), url: window.location.href })}
        onNewFromThis={newFromThis}
      />

      <div className="relative flex min-h-0 flex-1">
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", showWorkspace && workspaceFull && "hidden md:hidden")}>
      <div className="relative min-h-0 min-w-0 flex-1">
        <ThreadMinimap turns={turns} scrollerRef={stick.scrollRef} />
        <ChatContainerRoot className="relative h-full [&>div]:overflow-x-hidden" instance={stick}>
          <ChatContainerContent className="mx-auto w-full max-w-3xl gap-7 px-4 pt-7 pb-12 md:px-6">
            {box.task && (
              <div data-turn="task">
                <YouItem text={box.task} label="Task" />
              </div>
            )}

            {loadingTrace && <ThreadSkeleton withTask={!!box.task} />}

            <AnimatePresence>{(sleeping || wake) && <WakingCard key="waking" awake={!sleeping} startedAt={wake?.startedAt ?? Date.now()} error={wake?.error} />}</AnimatePresence>

            {groups.map((g, i) => {
              const isLast = i === groups.length - 1;
              const key = `${g.kind}-${i}`;
              return g.kind === "lifecycle" ? (
                <LifecycleItem key={key} label={g.label} detail={g.detail} />
              ) : g.kind === "tools" ? (
                <ToolGroup key={key} events={g.events} live={runState === "running" && isLast} />
              ) : g.kind === "you" ? (
                <div key={key} data-turn={key}>
                  <YouItem text={g.text} />
                </div>
              ) : g.kind === "asked" ? (
                <div key={key} data-turn={key}>
                  <AnsweredQuestionItem question={g.question} answer={g.answer} />
                </div>
              ) : g.kind === "think" ? (
                <ThinkingItem key={key} text={g.text} live={runState === "running" && isLast} />
              ) : g.kind === "plan" ? (
                // The dock owns the plan on wide screens; in flow it would be the same board twice.
                <div key={key} className="xl:hidden">
                  <PlanCard board={g.board} live={runState === "running"} />
                </div>
              ) : (
                <SayItem key={key} text={g.text} live={runState === "running" && isLast} label={i === 0 || !["say", "tools", "think", "plan"].includes(groups[i - 1].kind)} />
              );
            })}

            {!sleeping && runState === "running" && !["say", "think"].includes(groups[groups.length - 1]?.kind ?? "") && !loadingTrace && (
              <WorkingIndicator label={events.length ? "Working" : "Starting up"} />
            )}

            {idle && <IdleEmpty box={box} onNew={onNew} />}

            {showQuestion && <QuestionCard question={question!} onAnswer={answer} busy={answering} />}
            {resuming && <WorkingIndicator label="Answer sent — the agent is resuming" />}




            {pendingReplies.map((r, i) => (
              <YouItem key={`reply-${i}`} text={r} />
            ))}

            {queuedItems.map((q) => (
              <QueuedItem
                key={q.id}
                text={q.text}
                onCancel={() => cancelQueued(q.id)}
                onSendNow={runState === "running" && !sleeping ? () => sendQueuedNow(q.id) : undefined}
                sending={sendingNow === q.id}
              />
            ))}

            {asides.map((a, i) => (
              <ObserverItem key={`aside-${i}`} question={a.question} answer={a.error ?? a.answer} />
            ))}

            {!sleeping && !loadingTrace && runState === "done" && (
              <RunSummary
                label={
                  exitCode == null || exitCode === 0
                    ? "Completed"
                    : exitCode === 254 || exitCode === 253
                      ? "Run interrupted"
                      : "Exited with an error"
                }
                failed={exitCode != null && exitCode !== 0}
                detail={
                  exitCode == null || exitCode === 0
                    ? deadlineText ?? undefined
                    : exitCode === 254
                      ? "the sandbox restarted mid-run — send a message to continue"
                      : exitCode === 253
                        ? "stopped by you to deliver a message immediately"
                        : `code ${exitCode}`
                }
                stats={runStats(events)}
                onCopy={async () => toMarkdown(events, { title, machine: friendlyName(box.name), url: window.location.href })}
                onAgain={newFromThis}
              />
            )}
            <ChatContainerScrollAnchor />
          </ChatContainerContent>
        </ChatContainerRoot>
        {/* Jump to the latest output: centred over the column, only while scrolled up. */}
        <AnimatePresence>
          {!stick.isAtBottom && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 6, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.9 }}
              transition={{ duration: 0.16 }}
              onClick={() => void stick.scrollToBottom()}
              aria-label="Scroll to latest"
              className="bg-card hover:bg-muted text-foreground absolute right-5 bottom-4 z-10 grid size-8 cursor-pointer place-items-center rounded-full border shadow-e2"
            >
              <ArrowDown className="size-4" aria-hidden />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {!sleeping && <ChangesDock files={changes} loading={changesLoading} onOpen={setOpenFile} onRefresh={refreshChanges} activePath={openFile?.path} />}
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

function IdleEmpty({ box, onNew }: { box: BoxView; onNew: () => void }) {
  const warm = box.role === "pool-free";
  return (
    <div className="enter flex flex-col items-start gap-3 py-6">
      <p className="text-foreground text-lead font-medium">
        {friendlyName(box.name)} is {warm ? "warm and waiting" : "idle"}.
      </p>
      <p className="text-muted-foreground max-w-[52ch] text-body">
        {warm
          ? "This microVM is already booted with the agent installed. The next task you start claims it, so the run begins in seconds instead of waiting on a boot."
          : "Nothing has run here yet. Send an instruction below to start the agent, or start a new task."}
      </p>
      <Button variant="outline" size="sm" onClick={onNew}>
        <Plus className="size-3.5" />
        New task
      </Button>
    </div>
  );
}

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

type TraceGroup =
  | { kind: "say"; text: string }
  | { kind: "you"; text: string }
  | { kind: "asked"; question: string; answer: string }
  | { kind: "lifecycle"; label: string; detail?: string }
  | { kind: "tools"; events: ToolEvent[] }
  | { kind: "think"; text: string }
  | { kind: "plan"; board: TaskBoard };

function groupTrace(events: TraceEvent[]): TraceGroup[] {
  const out: TraceGroup[] = [];
  // The board reads the WHOLE trace, not one snapshot: a step's evidence is the work that happened
  // between the snapshot that started it and the one that ended it.
  const board = deriveTaskBoard(events);
  for (const e of events) {
    if (e.kind === "tool") {
      const last = out[out.length - 1];
      if (last?.kind === "tools") last.events.push(e);
      else out.push({ kind: "tools", events: [e] });
    } else if (e.kind === "lifecycle") {
      // Every follow-up turn re-logs "session started"; the first one is information, the rest are noise.
      if (/^session started/i.test(e.label) && out.some((g) => g.kind === "lifecycle" && /^session started/i.test(g.label))) continue;
      out.push({ kind: "lifecycle", label: sentence(e.label), detail: e.detail });
    } else if (e.kind === "you") {
      // An answer to a question the transcript recorded (⟦ask⟧ … ⟦/ask⟧ right before) folds into one
      // "asked — answered" item, so the decision stays readable when scrolling back.
      const prev = out[out.length - 1];
      if (prev?.kind === "asked" && prev.answer === "") prev.answer = e.text;
      else out.push({ kind: "you", text: e.text });
    } else if (e.kind === "ask") {
      out.push({ kind: "asked", question: e.text, answer: "" });
    } else if (e.kind === "think") {
      out.push({ kind: "think", text: e.text });
    } else if (e.kind === "plan") {
      // The plan is a living document: every TodoWrite re-emits the whole list. Show it ONCE, where
      // it first appeared, in its latest state — so the checklist ticks in place instead of stacking.
      if (board && !out.some((g) => g.kind === "plan")) out.push({ kind: "plan", board });
    } else {
      out.push({ kind: "say", text: e.text });
    }
  }
  return out;
}

function sentence(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

