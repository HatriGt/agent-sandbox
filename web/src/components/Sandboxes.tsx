import * as React from "react";
import { ArrowLeft, Hourglass, MessageSquare, Pause, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type FleetLifecycle } from "@/lib/api";
import { friendlyName, roleLabel, shortName, threadSort, threadTitle } from "@/lib/format";
import { deadlineLabel, deadlineOf, displayState, fmtDuration } from "@/lib/lifecycle";
import type { StableBox } from "@/hooks/useStableBoxes";
import { prefetchWatch } from "@/hooks/useWatchStream";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StateStamp } from "@/components/ui/stamp";
import { Capacity } from "@/components/Capacity";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/**
 * The fleet: what is running on the VPS right now, does any of it need me, and how long does each
 * machine have left. Leads with the queue of halted machines, then a table of every machine with
 * state, task, machine facts, its lifecycle deadline, and actions. Capacity is the configured slot
 * count against live occupancy. No charts: nothing about a run survives its machine.
 */
export function Sandboxes({
  boxes,
  lifecycle,
  loading,
  onOpen,
  onDestroyed,
  onBack,
}: {
  boxes: StableBox[];
  lifecycle: FleetLifecycle;
  loading: boolean;
  onOpen: (name: string) => void;
  onDestroyed: (name: string) => void;
  onBack: () => void;
}) {
  const waiting = boxes.filter((b) => b.runState === "waiting" && !b.leaving);
  const working = boxes.filter((b) => displayState(b) === "running" && !b.leaving).length;
  const sleeping = boxes.filter((b) => displayState(b) === "sleeping" && !b.leaving).length;
  const pool = boxes.filter((b) => b.role === "pool-free" && displayState(b) === "idle" && !b.leaving).length;
  const sorted = [...boxes].sort(threadSort);

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-5 py-7 md:px-8 md:py-9">
        <header className="mb-6">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
            <ArrowLeft className="size-4" />
            Machines
          </Button>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em]">Fleet</h1>
            {loading ? (
              <Bar className="h-3 w-56" />
            ) : (
              <>
                <Capacity boxes={boxes} capacity={lifecycle.capacity} />
                <p className="text-muted-foreground text-meta">
                  <span className="text-foreground tabular font-medium">{working}</span> working
                  <span className="mx-1.5 opacity-40">·</span>
                  <span className={cn("tabular font-medium", waiting.length ? "text-attention-text" : "text-foreground")}>
                    {waiting.length}
                  </span>{" "}
                  {waiting.length === 1 ? "needs" : "need"} you
                  <span className="mx-1.5 opacity-40">·</span>
                  <span className="text-foreground tabular font-medium">{sleeping}</span> sleeping
                  <span className="mx-1.5 opacity-40">·</span>
                  <span className="text-foreground tabular font-medium">{pool}</span> warm
                </p>
              </>
            )}
          </div>
          <p className="text-muted-foreground mt-2 max-w-[68ch] text-body">
            Every microVM and what its agent is doing. A machine runs for at most{" "}
            {lifecycle.maxDurationSec ? fmtDuration(lifecycle.maxDurationSec) : "the configured cap"}; after{" "}
            {lifecycle.idleTimeoutSec ? fmtDuration(lifecycle.idleTimeoutSec) : "the idle limit"} without output it goes
            to sleep with its workspace intact, and a reply wakes it. Destroy discards the workspace for good.
          </p>
        </header>

        {waiting.length > 0 && (
          <section className="mb-8" aria-labelledby="queue">
            <h2 id="queue" className="text-attention-text mb-2.5 flex items-center gap-1.5 text-meta font-semibold">
              <Pause className="size-3.5" strokeWidth={2.5} aria-hidden />
              Waiting on you
            </h2>
            <ul className="flex flex-col gap-2">
              {waiting.map((b) => (
                <li key={b.name}>
                  <button
                    type="button"
                    onClick={() => onOpen(b.name)}
                    onMouseEnter={() => prefetchWatch(b.name)}
                    className="border-attention/50 bg-attention/12 hover:bg-attention/18 flex w-full cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition-colors"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="stamp text-muted-foreground block" title={shortName(b.name)}>
                        {friendlyName(b.name)}
                        {displayState(b) === "sleeping" && <span className="text-sleep ml-2">asleep — wakes on reply</span>}
                      </span>
                      <span className="text-foreground mt-1 block text-lead leading-snug">
                        {b.question ?? b.task ?? "Waiting for an answer"}
                      </span>
                    </span>
                    <span className="text-attention-text shrink-0 text-meta font-semibold">Answer →</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="all">
          <h2 id="all" className="text-foreground mb-2.5 text-meta font-semibold">
            All machines
          </h2>

          {loading ? (
            <div className="overflow-hidden rounded-xl border">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0">
                  <Bar className="h-2.5 w-20" />
                  <Bar className="h-3 flex-1" />
                  <Bar className="h-3 w-40" />
                  <Bar className="h-8 w-24 rounded-md" />
                </div>
              ))}
            </div>
          ) : !sorted.length ? (
            <div className="rounded-xl border border-dashed py-14 text-center">
              <p className="text-foreground text-lead font-medium">Nothing is up</p>
              <p className="text-muted-foreground mt-1 text-meta">A machine boots in a few seconds when you start a task.</p>
            </div>
          ) : (
            <MachineTable boxes={sorted} lifecycle={lifecycle} onOpen={onOpen} onDestroyed={onDestroyed} />
          )}
        </section>
      </div>
    </div>
  );
}

const COLS = "md:grid-cols-[8.5rem_minmax(0,1fr)_10rem_9rem_11rem]";

function MachineTable({
  boxes,
  lifecycle,
  onOpen,
  onDestroyed,
}: {
  boxes: StableBox[];
  lifecycle: FleetLifecycle;
  onOpen: (name: string) => void;
  onDestroyed: (name: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className={cn("label text-muted-foreground bg-muted/60 hidden items-center gap-3 border-b px-4 py-2 md:grid", COLS)}>
        <span>State</span>
        <span>Task</span>
        <span>Machine</span>
        <span>Time left</span>
        <span className="text-right">Actions</span>
      </div>
      <ul className="divide-y">
        {boxes.map((b) => (
          <MachineRow key={b.name} box={b} lifecycle={lifecycle} onOpen={onOpen} onDestroyed={onDestroyed} />
        ))}
      </ul>
    </div>
  );
}

function MachineRow({
  box,
  lifecycle,
  onOpen,
  onDestroyed,
}: {
  box: StableBox;
  lifecycle: FleetLifecycle;
  onOpen: (name: string) => void;
  onDestroyed: (name: string) => void;
}) {
  const [armed, setArmed] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const destroy = async () => {
    if (!armed) return setArmed(true);
    setRemoving(true);
    try {
      await api.teardown(box.name);
      toast.success(`${friendlyName(box.name)} destroyed`);
      onDestroyed(box.name);
    } catch (e) {
      toast.error("Could not destroy the machine", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRemoving(false);
      setArmed(false);
    }
  };

  const state = displayState(box);
  const waiting = box.runState === "waiting";
  const deadline = deadlineOf(box, lifecycle);
  const deadlineText = deadlineLabel(deadline);

  return (
    <li
      className={cn(
        "hover:bg-muted/50 grid grid-cols-1 gap-2 px-4 py-3 transition-colors md:items-center md:gap-3",
        COLS,
        box.leaving && "opacity-50"
      )}
    >
      <div className="flex items-center gap-2">
        <StateStamp state={state} exitCode={box.exitCode} />
        <span className="label text-muted-foreground md:hidden">{box.leaving ? "shutting down" : roleLabel(box.role)}</span>
      </div>

      <div className="min-w-0">
        <p className="text-foreground truncate text-meta">
          {box.task ? threadTitle(box) : <span className="text-muted-foreground">No task yet</span>}
        </p>
        {box.question && <p className="text-attention-text truncate text-micro">Asking: {box.question}</p>}
        <p className="stamp text-muted-foreground mt-0.5 md:hidden" title={shortName(box.name)}>
          {friendlyName(box.name)}
          {box.uptime && <span className="ml-2 opacity-70">up {box.uptime}</span>}
          {deadline.remainingSec != null && <span className="ml-2 opacity-70">· {fmtDuration(deadline.remainingSec)} left</span>}
        </p>
      </div>

      <div className="stamp text-muted-foreground hidden flex-col gap-0.5 md:flex">
        <span className="text-foreground" title={shortName(box.name)}>
          {friendlyName(box.name)}
        </span>
        <span>
          {box.leaving ? "shutting down" : state === "sleeping" ? "asleep · wakes on reply" : roleLabel(box.role)}
          {box.uptime && <> · {state === "sleeping" ? "ran" : "up"} {box.uptime}</>}
        </span>
        {(box.cpu || box.mem) && (
          <span>
            {box.cpu && <>cpu {box.cpu}</>}
            {box.mem && <> · {box.mem.split(" / ")[0]}</>}
          </span>
        )}
      </div>

      {/* Time left: the nearer of the run cap and the idle-stop estimate, with a slim track. */}
      <div className="hidden md:block">
        {deadline.remainingSec != null ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col gap-1.5">
                <span className={cn("stamp inline-flex items-center gap-1.5", deadline.remainingSec < 300 ? "text-attention-text" : "text-muted-foreground")}>
                  <Hourglass className="size-3" aria-hidden />
                  {fmtDuration(deadline.remainingSec)}
                  <span className="opacity-70">{deadline.kind === "idle" ? "if quiet" : "cap"}</span>
                </span>
                <span className="bg-border block h-1 w-28 overflow-hidden rounded-full">
                  <span
                    className={cn("block h-full rounded-full transition-[width] duration-700", deadline.kind === "idle" ? "bg-sleep" : "bg-live")}
                    style={{ width: `${Math.round((deadline.fraction ?? 0) * 100)}%` }}
                  />
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>{deadlineText}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="stamp text-muted-foreground/60">{state === "sleeping" ? "asleep" : "—"}</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 md:justify-end">
        <Button
          size="sm"
          variant={waiting ? "attention" : "outline"}
          onClick={() => onOpen(box.name)}
          onMouseEnter={() => prefetchWatch(box.name)}
          disabled={box.leaving}
        >
          {waiting ? <Pause strokeWidth={2.5} /> : <MessageSquare />}
          {waiting ? "Answer" : "Open"}
        </Button>
        {armed ? (
          <>
            <Button size="sm" variant="destructive" onClick={destroy} disabled={removing}>
              <Trash2 />
              {removing ? "Destroying…" : "Confirm"}
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setArmed(false)} aria-label="Cancel">
              <X />
            </Button>
          </>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={destroy}
                disabled={box.leaving}
                aria-label={`Destroy ${friendlyName(box.name)}`}
              >
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Destroy — stops the microVM and discards its workspace</TooltipContent>
          </Tooltip>
        )}
      </div>
    </li>
  );
}
