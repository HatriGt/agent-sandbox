import * as React from "react";
import { ArrowLeft, Cpu, FolderTree, GitBranch, Hourglass, Loader2, Pin, PinOff, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type BoxView, type ChangedFile, type FleetLifecycle, type WatchSnapshot } from "@/lib/api";
import { AnimatePresence, motion } from "motion/react";
// The workspace (CodeMirror + merge view) is heavy and optional: loaded the first time it opens.
const WorkspacePane = React.lazy(() => import("./WorkspacePane").then((m) => ({ default: m.WorkspacePane })));
import { WakingCard } from "./WakingCard";
import { SessionContext } from "@/lib/session-context";
import { friendlyName, isSleeping, POLL_MS, roleLabel, shortName, threadTitle } from "@/lib/format";
import { deadlineLabel, deadlineOf, displayState, fmtDuration } from "@/lib/lifecycle";
import { parseTrace, producedFiles } from "@/lib/trace";
import { usePoll } from "@/hooks/usePoll";
import { seedWatchCache, useWatchStream } from "@/hooks/useWatchStream";
import { Button } from "@/components/ui/button";
import { StatePill } from "@/components/ui/stamp";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from "@/components/ui/chat-container";
import type { TraceEvent } from "@/lib/trace";
import { AnsweredQuestionItem, LifecycleItem, ObserverItem, PlanCard, QueuedItem, SayItem, ThinkingItem, ToolGroup, WorkingIndicator, YouItem } from "./TraceItems";
import { ThreadMinimap, type Turn } from "./ThreadMinimap";
import { useStickToBottom } from "use-stick-to-bottom";
import { ChangesDock } from "./ChangesDock";
import { QuestionCard } from "./QuestionCard";
import { PullRequestFloat } from "./PullRequestFloat";
import { ArrowDown } from "lucide-react";
import { RepoPicker } from "@/components/RepoPicker";
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
  const snap = stream.snap ?? (polled?.name === box.name ? polled : null);

  const events = React.useMemo(() => parseTrace(snap?.log ?? ""), [snap?.log]);
  const groups = React.useMemo(() => groupTrace(events), [events]);
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

  const [armed, setArmed] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  React.useEffect(() => setArmed(false), [box.name]);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setArmed(false);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [armed]);

  const destroy = async () => {
    if (!armed) return setArmed(true);
    setRemoving(true);
    try {
      await api.teardown(box.name);
      toast.success(`${friendlyName(box.name)} destroyed`);
      onTornDown(box.name);
    } catch (e) {
      toast.error("Could not destroy the machine", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRemoving(false);
      setArmed(false);
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
  const [addRepo, setAddRepo] = React.useState(false);
  const [attaching, setAttaching] = React.useState<string | null>(null);
  const [optimisticRepos, setOptimisticRepos] = React.useState<{ name: string; branch?: string }[]>([]);
  React.useEffect(() => setOptimisticRepos([]), [box.name, box.repos?.length]);
  const repos = React.useMemo(() => {
    const seen = new Set((box.repos ?? []).map((r) => r.name));
    return [...(box.repos ?? []), ...optimisticRepos.filter((r) => !seen.has(r.name))];
  }, [box.repos, optimisticRepos]);
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

  const idle = runState === "idle" && events.length === 0 && !loadingTrace;

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
            : `Back to the normal lifecycle: destroyed after ${lifecycle.idleTimeoutSec ? fmtDuration((lifecycle.idleTimeoutSec ?? 0) * 96) : "the sleep limit"} asleep.`,
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
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b px-3 md:px-5">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to machines" className="md:hidden">
          <ArrowLeft />
        </Button>

        <StatePill state={state} exitCode={exitCode} />
        {kept && (
          <span className="bg-live/10 text-live hidden h-6 shrink-0 items-center gap-1 rounded-full px-2 text-micro font-semibold sm:inline-flex" title="Kept until you destroy it">
            <Pin className="size-3 fill-current" aria-hidden />
            kept
          </span>
        )}

        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="text-foreground min-w-0 truncate text-body font-medium">
            {box.task ? threadTitle(box) : friendlyName(box.name)}
          </h1>
          {box.task && (
            <span className="stamp text-muted-foreground hidden shrink-0 sm:inline" title={shortName(box.name)}>
              {friendlyName(box.name)}
            </span>
          )}
        </div>

        {pulls.length > 0 && !loadingTrace && <PullRequestFloat key={pulls[pulls.length - 1].url} session={box.name} {...pulls[pulls.length - 1]} />}

        {/* Lifecycle + vitals: quiet mono facts, desktop only — the fleet view carries them on phones. */}
        <div className="stamp text-muted-foreground hidden items-center gap-3 lg:flex">
          {deadlineText && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn("inline-flex items-center gap-1.5", deadline.remainingSec != null && deadline.remainingSec < 300 && "text-attention-text")}>
                  <Hourglass className="size-3" aria-hidden />
                  <span className="tabular">{deadline.remainingSec != null ? (deadline.remainingSec <= 0 ? "soon" : fmtDuration(deadline.remainingSec)) : ""}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{deadlineText}</TooltipContent>
            </Tooltip>
          )}
          {/* One quiet group: uptime · cpu · memory. The role is implied by the state pill. */}
          {(box.uptime || box.cpu || box.mem) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1.5">
                  <Cpu className="size-3" aria-hidden />
                  <span className="tabular">
                    {[box.uptime, box.cpu ? box.cpu.split(" / ")[0] + "c" : null, box.mem ? box.mem.split(" / ")[0] : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {sleeping ? "ran for" : "up"} {box.uptime ?? "—"} · cpu {box.cpu ?? "—"} · memory {box.mem ?? "—"} · {roleLabel(box.role)}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <Button variant="ghost" size="icon-sm" onClick={onNew} aria-label="New task" className="md:hidden">
          <Plus />
        </Button>

        {!sleeping && repos.length === 0 && !addRepo && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => setAddRepo(true)} aria-label="Attach a repository">
                <GitBranch />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Attach a repository — the agent clones it into this sandbox</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={() => (showWorkspace ? closeWorkspace() : setWorkspaceOpen(true))} aria-pressed={showWorkspace} aria-label="Workspace files" className={cn(showWorkspace && "bg-accent text-foreground")} disabled={sleeping}>
              <FolderTree />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{sleeping ? "Files — available once the sandbox is awake" : "Files — browse, diff and edit the workspace"}</TooltipContent>
        </Tooltip>

        {box.role !== "pool-free" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleKeep}
                disabled={keeping}
                aria-pressed={kept}
                aria-label={kept ? "Release this sandbox" : "Keep this sandbox"}
                className={cn(kept && "text-live bg-live/10")}
              >
                {kept ? <Pin className="fill-current" /> : <PinOff />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {kept
                ? "Kept — sleeps when quiet, never destroyed until you say so. Click to release."
                : "Keep — hold this sandbox (asleep, workspace intact) until you destroy it. Come back any day with a follow-up."}
            </TooltipContent>
          </Tooltip>
        )}

        {armed ? (
          <div className="enter flex items-center gap-1">
            <Button variant="destructive" size="sm" onClick={destroy} disabled={removing}>
              <Trash2 className="size-3.5" />
              {removing ? "Destroying…" : "Confirm destroy"}
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setArmed(false)} aria-label="Cancel">
              <X />
            </Button>
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={destroy} aria-label="Destroy this machine">
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Destroy — stops the microVM and discards its workspace</TooltipContent>
          </Tooltip>
        )}
      </header>

      {/* Connected repositories: what the agent can see, and the way to give it more mid-run. */}
      {!sleeping && (repos.length > 0 || addRepo) && (
        <div className="relative flex h-9 shrink-0 items-center gap-1.5 border-b px-3 md:px-5">
          <GitBranch className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          <span className="label text-muted-foreground shrink-0">{repos.length ? "Connected" : "No repository attached"}</span>
          <div className="scrollbar-none flex min-w-0 items-center gap-1.5 overflow-x-auto">
          {repos.map((r) => (
            <Tooltip key={r.name}>
              <TooltipTrigger asChild>
                <span className="bg-muted text-foreground stamp inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5">
                  {r.name}
                  {r.branch && <span className="text-muted-foreground">@{r.branch}</span>}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">/workspace/{r.name} — @ mentions search here</TooltipContent>
            </Tooltip>
          ))}
          </div>
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setAddRepo((v) => !v)}
              disabled={!!attaching}
              aria-expanded={addRepo}
              className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-micro font-medium transition-colors disabled:opacity-60"
            >
              {attaching ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Plus className="size-3" aria-hidden />}
              {attaching ? `Cloning ${attaching.split("/")[1]}…` : "Add repo"}
            </button>
            {addRepo && (
              <RepoPicker
                className="absolute top-full left-0 z-20 mt-1"
                multi={false}
                selected={repos.map((r) => ({ repo: r.name }))}
                onToggle={(r) => attach(r.fullName)}
                onClose={() => setAddRepo(false)}
              />
            )}
          </div>
        </div>
      )}

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
                <PlanCard key={key} items={g.items} live={runState === "running"} />
              ) : (
                <SayItem key={key} text={g.text} live={runState === "running" && isLast} />
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
              <QueuedItem key={q.id} text={q.text} onCancel={() => cancelQueued(q.id)} />
            ))}

            {asides.map((a, i) => (
              <ObserverItem key={`aside-${i}`} question={a.question} answer={a.error ?? a.answer} />
            ))}

            {!sleeping &&
              runState === "done" &&
              (exitCode == null || exitCode === 0 ? (
                <LifecycleItem label="Completed" detail={deadlineText ?? undefined} />
              ) : (
                <LifecycleItem label="Exited with an error" detail={`code ${exitCode}`} />
              ))}
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
              className="bg-card hover:bg-muted text-foreground absolute right-5 bottom-4 z-10 grid size-8 cursor-pointer place-items-center rounded-full border shadow-[0_1px_2px_oklch(0_0_0/0.06),0_8px_20px_-10px_oklch(0_0_0/0.4)]"
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
  | { kind: "plan"; items: import("@/lib/trace").PlanItem[] };

function groupTrace(events: TraceEvent[]): TraceGroup[] {
  const out: TraceGroup[] = [];
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
      const first = out.findIndex((g) => g.kind === "plan");
      if (first >= 0) out[first] = { kind: "plan", items: e.items };
      else out.push({ kind: "plan", items: e.items });
    } else {
      out.push({ kind: "say", text: e.text });
    }
  }
  return out;
}

function sentence(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

