import * as React from "react";
import { ArrowLeft, Clock, Cpu, GitBranch, Hourglass, Loader2, MemoryStick, MoonStar, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type BoxView, type FleetLifecycle, type WatchSnapshot } from "@/lib/api";
import { friendlyName, isSleeping, POLL_MS, roleLabel, shortName, threadTitle } from "@/lib/format";
import { deadlineLabel, deadlineOf, displayState, fmtDuration } from "@/lib/lifecycle";
import { parseTrace, producedFiles } from "@/lib/trace";
import { usePoll } from "@/hooks/usePoll";
import { seedWatchCache, useWatchStream } from "@/hooks/useWatchStream";
import { Button } from "@/components/ui/button";
import { StatePill } from "@/components/ui/stamp";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from "@/components/ui/chat-container";
import { ScrollButton } from "@/components/ui/scroll-button";
import type { TraceEvent } from "@/lib/trace";
import { LifecycleItem, ObserverItem, PlanCard, QueuedItem, SayItem, ThinkingItem, ToolGroup, WorkingIndicator, YouItem } from "./TraceItems";
import { QuestionCard } from "./QuestionCard";
import { PullRequestCard } from "./TestResultsCard";
import { RepoPicker } from "@/components/RepoPicker";
import { findPullRequests } from "@/lib/testReport";
import { ProducedFiles } from "./ProducedFiles";
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
  const sleeping = isSleeping(box);
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

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b px-3 md:px-5">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to machines" className="md:hidden">
          <ArrowLeft />
        </Button>

        <StatePill state={state} exitCode={exitCode} />

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

        {/* Lifecycle + vitals: quiet mono facts, desktop only — the fleet view carries them on phones. */}
        <div className="stamp text-muted-foreground hidden items-center gap-3 lg:flex">
          {deadlineText && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn("inline-flex items-center gap-1.5", deadline.remainingSec != null && deadline.remainingSec < 300 && "text-attention-text")}>
                  <Hourglass className="size-3" aria-hidden />
                  <span className="tabular">{deadline.remainingSec != null ? fmtDuration(deadline.remainingSec) : ""}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{deadlineText}</TooltipContent>
            </Tooltip>
          )}
          {box.uptime && <Vital icon={<Clock className="size-3" />} label={sleeping ? "ran for" : "uptime"} value={box.uptime} />}
          {box.cpu && <Vital icon={<Cpu className="size-3" />} label="cpu" value={box.cpu} />}
          {box.mem && <Vital icon={<MemoryStick className="size-3" />} label="memory" value={box.mem.split(" / ")[0]} />}
          <span className="bg-muted text-muted-foreground label rounded-md px-1.5 py-0.5">{roleLabel(box.role)}</span>
        </div>

        <Button variant="ghost" size="icon-sm" onClick={onNew} aria-label="New task" className="md:hidden">
          <Plus />
        </Button>

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
      {!sleeping && (
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

      <div className="relative min-h-0 flex-1">
        <ChatContainerRoot className="relative h-full">
          <ChatContainerContent className="mx-auto w-full max-w-3xl gap-7 px-4 pt-7 pb-12 md:px-6">
            {box.task && <YouItem text={box.task} label="Task" />}

            {loadingTrace && <ThreadSkeleton withTask={!!box.task} />}

            {sleeping && (
              <div className="enter border-sleep/30 bg-sleep/8 flex items-start gap-3 rounded-xl border px-4 py-3">
                <MoonStar className="text-sleep mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0 text-meta">
                  <p className="text-foreground font-medium">This machine is asleep.</p>
                  <p className="text-muted-foreground mt-0.5">
                    It went quiet for longer than the idle limit
                    {lifecycle.idleTimeoutSec ? ` (${fmtDuration(lifecycle.idleTimeoutSec)})` : ""} and msb stopped
                    the microVM — but its workspace and Claude session are intact. A reply below restarts it and
                    continues the same run. The transcript reappears once it is awake.
                  </p>
                </div>
              </div>
            )}

            {groups.map((g, i) => {
              const isLast = i === groups.length - 1;
              const key = `${g.kind}-${i}`;
              return g.kind === "lifecycle" ? (
                <LifecycleItem key={key} label={g.label} detail={g.detail} />
              ) : g.kind === "tools" ? (
                <ToolGroup key={key} events={g.events} live={runState === "running" && isLast} />
              ) : g.kind === "you" ? (
                <YouItem key={key} text={g.text} />
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

            {pulls.length > 0 && !loadingTrace && (
              <div className="flex flex-wrap gap-2">
                {pulls.map((p) => (
                  <PullRequestCard key={p.url} {...p} />
                ))}
              </div>
            )}

            {!sleeping && <ProducedFiles session={box.name} files={artifacts} />}

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

          <div className="pointer-events-none sticky inset-x-0 bottom-3 z-10 flex justify-center">
            <div className="pointer-events-auto">
              <ScrollButton />
            </div>
          </div>
        </ChatContainerRoot>
      </div>

      <SendBar
        boxName={box.name}
        runState={runState}
        sleeping={sleeping}
        repos={repos}
        onAsk={onAsk}
        onReplied={onReplied}
        onQueued={refreshQueue}
        onFocusRequest={onFocusRequest}
      />
    </div>
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
      out.push({ kind: "lifecycle", label: sentence(e.label), detail: e.detail });
    } else if (e.kind === "you") {
      out.push({ kind: "you", text: e.text });
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

function Vital({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden>{icon}</span>
          <span className="tabular">{value}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
