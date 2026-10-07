import * as React from "react";
import { ArrowLeft, ChevronRight, GitBranch, Hourglass, Pause, Plus, Search, Server, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, type FleetLifecycle } from "@/lib/api";
import { useGo } from "@/lib/route";
import { doneLabel, friendlyName, isFailedExit, shortName, roleLabel, threadSort, threadTitle } from "@/lib/format";
import { deadlineLabel, deadlineOf, displayState, fmtDuration } from "@/lib/lifecycle";
import { questionHeadline } from "@/lib/question";
import type { StableBox } from "@/hooks/useStableBoxes";
import { prefetchWatch } from "@/hooks/useWatchStream";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Swap } from "@/components/ui/swap";
import { Collapse } from "@/components/ui/collapse";
import { FilterChip } from "@/components/ui/filter-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UsageMeter } from "@/components/ui/usage-meter";
import { DataTable, MetaLine, StatusDot, stopRow, type Column } from "@/components/ui/data-table";
import { Capacity } from "@/components/Capacity";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/**
 * The fleet: what is running on the VPS right now, does any of it need me, and how long does each
 * machine have left. The state counts ARE the filter — click "2 sleeping" and the table shows the
 * sleeping machines; the search box narrows by task, machine name or repo. Rows are grouped under
 * quiet headers in triage order, animate to their new position when a state flips, and the whole
 * row opens the thread. Capacity is the configured slot count against live occupancy.
 */

type Filter = "all" | "attention" | "working" | "sleeping" | "done" | "warm";

const groupOf = (v: StableBox): Exclude<Filter, "all"> => {
  if (v.runState === "waiting") return "attention";
  const s = displayState(v);
  if (s === "running") return "working";
  if (s === "sleeping") return "sleeping";
  if (v.role === "pool-free") return "warm";
  return "done";
};

const GROUP_LABEL: Record<Exclude<Filter, "all">, string> = {
  attention: "Needs you",
  working: "Working",
  sleeping: "Sleeping",
  done: "Done",
  warm: "Warm — ready for a task",
};

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
  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery] = React.useState("");
  const go = useGo();

  const sorted = [...boxes].sort(threadSort);
  const counts = React.useMemo(() => {
    const c: Record<Exclude<Filter, "all">, number> = { attention: 0, working: 0, sleeping: 0, done: 0, warm: 0 };
    for (const b of boxes) if (!b.leaving) c[groupOf(b)]++;
    return c;
  }, [boxes]);

  const q = query.trim().toLowerCase();
  const visible = sorted.filter((b) => {
    if (filter !== "all" && groupOf(b) !== filter) return false;
    if (!q) return true;
    return [b.name, friendlyName(b.name), b.title, b.task, b.question, ...(b.repos ?? []).map((r) => r.name)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
  const grouped = filter === "all" && new Set(visible.map(groupOf)).size > 1;

  const waiting = boxes.filter((b) => b.runState === "waiting" && !b.leaving);

  const sleepable = boxes.filter((b) => displayState(b) === "sleeping" && !b.kept && !b.leaving);
  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-5 py-7 md:px-8 md:py-9">
        <header className="mb-5">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
            <ArrowLeft className="size-4" />
            Machines
          </Button>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <h1 className="text-foreground font-serif text-h1 font-normal tracking-[-0.01em]">Fleet</h1>
            <Swap state={loading ? "loading" : "capacity"}>{loading ? <Bar className="h-3 w-56" /> : <Capacity boxes={boxes} capacity={lifecycle.capacity} />}</Swap>
          </div>
          <p className="text-muted-foreground mt-1 text-meta">
            Runs up to {lifecycle.maxDurationSec ? fmtDuration(lifecycle.maxDurationSec) : "the cap"} · sleeps after{" "}
            {lifecycle.idleTimeoutSec ? fmtDuration(lifecycle.idleTimeoutSec) : "the idle limit"} quiet · a reply wakes it.
          </p>
        </header>

        <Collapse open={waiting.length > 0 && filter === "all" && !q}>
          <section className="mb-7" aria-labelledby="queue">
            <h2 id="queue" className="text-attention-text mb-2.5 flex items-center gap-1.5 text-meta font-semibold">
              <Pause className="size-3.5" strokeWidth={2.5} aria-hidden />
              Waiting on you
            </h2>
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {waiting.map((b) => (
                  <motion.li
                    key={b.name}
                    layout="position"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.8 }}
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(b.name)}
                      onMouseEnter={() => prefetchWatch(b.name)}
                      className="border-attention/40 bg-card hover:border-attention/70 hover-raise flex w-full cursor-pointer items-start gap-3 rounded-xl border p-4 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="stamp text-muted-foreground block" title={shortName(b.name)}>
                          {friendlyName(b.name)}
                          {displayState(b) === "sleeping" && <span className="text-sleep ml-2">asleep — wakes on reply</span>}
                        </span>
                        <span className="text-foreground mt-1 block text-lead leading-snug">
                          {b.question ? questionHeadline(b.question, 200) : b.task ?? "Waiting for an answer"}
                        </span>
                      </span>
                      <span className="text-attention-text shrink-0 text-meta font-semibold">Answer →</span>
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>
        </Collapse>

        <section aria-labelledby="all">
          {/* Toolbar: the counts are the filter; search narrows within it. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Filter machines" className="flex flex-wrap items-center gap-1">
              <FilterChip group="fleet" active={filter === "all"} onClick={() => setFilter("all")} label="All" count={boxes.filter((b) => !b.leaving).length} />
              <FilterChip group="fleet" active={filter === "attention"} onClick={() => setFilter("attention")} label="Needs you" count={counts.attention} tone="attention" />
              <FilterChip group="fleet" active={filter === "working"} onClick={() => setFilter("working")} label="Working" count={counts.working} tone="live" />
              <FilterChip group="fleet" active={filter === "sleeping"} onClick={() => setFilter("sleeping")} label="Sleeping" count={counts.sleeping} tone="sleep" />
              <FilterChip group="fleet" active={filter === "done"} onClick={() => setFilter("done")} label="Done" count={counts.done} />
              <FilterChip group="fleet" active={filter === "warm"} onClick={() => setFilter("warm")} label="Warm" count={counts.warm} />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <label className="bg-card focus-within:ring-ring flex h-8 items-center gap-1.5 rounded-md border px-2 transition-shadow focus-within:ring-2">
                <Search className="text-muted-foreground size-3.5" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Task, machine, repo…"
                  aria-label="Search machines"
                  className="text-foreground placeholder:text-muted-foreground w-32 bg-transparent text-meta outline-none transition-[width] focus:w-48"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground hover:bg-muted pop-in cursor-pointer rounded p-0.5">
                    <X className="size-3.5" />
                  </button>
                )}
              </label>
              <AnimatePresence initial={false}>
                {sleepable.length > 0 && (
                  <motion.span key="destroy-sleeping" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }} className="inline-flex">
                    <DestroySleeping boxes={sleepable} onDestroyed={onDestroyed} />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>

          <Swap state={loading ? "loading" : !sorted.length ? "empty" : !visible.length ? "none" : "list"}>
            {loading ? (
              <MachineTable boxes={[]} grouped={false} lifecycle={lifecycle} loading onOpen={onOpen} onDestroyed={onDestroyed} />
            ) : !sorted.length ? (
              <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
                <span className="bg-muted text-muted-foreground mb-4 grid size-12 place-items-center rounded-full" aria-hidden>
                  <Server className="size-5" />
                </span>
                <p className="text-foreground text-lead font-medium">Nothing is up</p>
                <p className="text-muted-foreground mt-1 max-w-[30em] text-meta">A machine boots in a few seconds when you start a task.</p>
                <Button size="sm" className="mt-4" onClick={() => go({ view: "hub" })}>
                  <Plus />
                  Start a task
                </Button>
              </div>
            ) : !visible.length ? (
              <div className="rounded-xl border border-dashed py-12 text-center">
                <p className="text-foreground text-lead font-medium">Nothing matches</p>
                <p className="text-muted-foreground mt-1 text-meta">
                  {q ? <>No machine matches “{query.trim()}”{filter !== "all" && <> in {GROUP_LABEL[filter as Exclude<Filter, "all">].toLowerCase()}</>}.</> : <>No machines are {GROUP_LABEL[filter as Exclude<Filter, "all">].toLowerCase()} right now.</>}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-live mt-2"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  Show everything
                </Button>
              </div>
            ) : (
              <MachineTable boxes={visible} grouped={grouped} lifecycle={lifecycle} onOpen={onOpen} onDestroyed={onDestroyed} />
            )}
          </Swap>
        </section>
      </div>
    </div>
  );
}

const stateDot = (box: StableBox) => {
  const state = displayState(box);
  if (box.stalled && state === "running") return <StatusDot tone="destructive">stalled</StatusDot>;
  switch (state) {
    case "running":
      return <StatusDot tone="live" pulse>working</StatusDot>;
    case "waiting":
      return <StatusDot tone="attention">needs you</StatusDot>;
    case "done":
      return <StatusDot tone={isFailedExit(box.exitCode) ? "destructive" : "ok"}>{doneLabel(box.exitCode)}</StatusDot>;
    case "sleeping":
      return <StatusDot tone="muted">sleeping</StatusDot>;
    default:
      return <StatusDot tone="muted">idle</StatusDot>;
  }
};

function MachineTable({
  boxes,
  grouped,
  lifecycle,
  loading,
  onOpen,
  onDestroyed,
}: {
  boxes: StableBox[];
  grouped: boolean;
  lifecycle: FleetLifecycle;
  loading?: boolean;
  onOpen: (name: string) => void;
  onDestroyed: (name: string) => void;
}) {
  const columns: Column<StableBox>[] = [
    {
      id: "state",
      header: "State",
      width: "w-[7.5rem]",
      cell: (b) => stateDot(b),
    },
    { id: "task", header: "Task", cell: (b) => <TaskCell box={b} lifecycle={lifecycle} /> },
    { id: "machine", header: "Machine", width: "w-52", hideBelow: "md", cell: (b) => <MachineCell box={b} lifecycle={lifecycle} /> },
    { id: "left", header: "Time left", width: "w-[8.5rem]", hideBelow: "md", cell: (b) => <TimeLeft box={b} lifecycle={lifecycle} /> },
    // The row is the action (click opens the thread); this cell holds destroy + the click cue.
    { id: "actions", header: <span className="sr-only">Actions</span>, width: "w-[5.5rem]", align: "end", cell: (b) => <RowActions box={b} onDestroyed={onDestroyed} /> },
  ];
  return (
    <DataTable
      aria-label="Machines"
      rows={boxes}
      columns={columns}
      rowKey={(b) => b.name}
      loading={loading}
      onRowClick={(b) => !b.leaving && onOpen(b.name)}
      rowLabel={(b) => `Open ${friendlyName(b.name)} — ${b.task ? threadTitle(b) : "no task yet"}`}
      rowProps={(b) => ({ className: cn("group", b.leaving && "pointer-events-none opacity-50"), onMouseEnter: () => prefetchWatch(b.name) })}
      groupOf={grouped ? (b) => GROUP_LABEL[groupOf(b)] : undefined}
    />
  );
}

function TaskCell({ box, lifecycle }: { box: StableBox; lifecycle: FleetLifecycle }) {
  const deadline = deadlineOf(box, lifecycle);
  const repos = box.repos ?? [];
  return (
    <div className="min-w-0">
      <p className="text-foreground truncate text-meta">
        {box.task ? threadTitle(box) : <span className="text-faint italic">No task yet — claim it with a new task</span>}
      </p>
      {box.question && <p className="text-attention-text truncate text-micro">Asking: {questionHeadline(box.question)}</p>}
      {repos.length > 0 && (
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {repos.slice(0, 3).map((r) => (
            <span key={r.name} className="bg-muted text-muted-foreground stamp inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px]" title={r.branch ? `${r.name} · ${r.branch}` : r.name}>
              <GitBranch className="size-2.5 shrink-0" aria-hidden />
              {r.name}
              {r.branch && <span className="text-faint hidden sm:inline">· {r.branch}</span>}
            </span>
          ))}
          {repos.length > 3 && <span className="text-faint text-[10px]">+{repos.length - 3}</span>}
        </span>
      )}
      {/* Mobile meta line: the machine and time columns are hidden below md. */}
      <MetaLine
        className="stamp mt-0.5 md:hidden"
        parts={[
          <span title={shortName(box.name)}>{friendlyName(box.name)}</span>,
          box.leaving ? "shutting down" : roleLabel(box.role),
          box.uptime && `up ${box.uptime}`,
          deadline.remainingSec != null && `${deadline.remainingSec <= 0 ? "soon" : fmtDuration(deadline.remainingSec)} left`,
        ]}
      />
    </div>
  );
}

function MachineCell({ box, lifecycle }: { box: StableBox; lifecycle: FleetLifecycle }) {
  const state = displayState(box);
  const deadline = deadlineOf(box, lifecycle);
  return (
    <div className="stamp text-muted-foreground flex min-w-0 flex-col gap-0.5">
      <span className="text-foreground truncate" title={shortName(box.name)}>
        {friendlyName(box.name)}
      </span>
      {/* Words in the sans face; only the duration is data. */}
      <span className="font-sans text-micro">
        {box.leaving ? "shutting down" : box.kept ? "kept · wakes on reply" : state === "sleeping" ? (deadline.kind === "sleep" && deadline.remainingSec != null ? `asleep · destroyed in ${deadline.remainingSec <= 0 ? "soon" : fmtDuration(deadline.remainingSec)}` : "asleep · wakes on reply") : box.role === "session" ? "" : roleLabel(box.role)}
      </span>
      {(box.uptime || box.cpu) && (
        <span className="truncate" title={[box.uptime && `${state === "sleeping" ? "ran" : "up"} ${box.uptime}`, box.cpu && `cpu ${box.cpu}`].filter(Boolean).join(" · ")}>
          {box.uptime && <>{state === "sleeping" ? "ran" : "up"} {box.uptime}</>}
          {box.cpu && <>{box.uptime ? " · " : ""}{box.cpu.split(" / ")[0]}c</>}
        </span>
      )}
      {/* Memory and disk as meters: the ratio is the point, "nearly full" visible at a glance. */}
      {(box.memUsage || box.disk) && (
        <span className="flex items-center gap-2">
          <UsageMeter kind="memory" usage={box.memUsage} width="w-10" />
          <UsageMeter kind="disk" usage={box.disk} width="w-10" />
        </span>
      )}
    </div>
  );
}

/** The nearer of the run cap and the idle-stop estimate, with a slim track. */
function TimeLeft({ box, lifecycle }: { box: StableBox; lifecycle: FleetLifecycle }) {
  const deadline = deadlineOf(box, lifecycle);
  if (deadline.remainingSec == null) {
    return <span className="stamp text-faint whitespace-nowrap">{box.kept ? "kept" : displayState(box) === "sleeping" ? "asleep" : "—"}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col gap-1.5">
          {/* Amber is reserved for "needs you"; a run about to sleep steps up to the foreground colour. */}
          <span className={cn("inline-flex items-center gap-1.5 text-micro", deadline.remainingSec < 300 ? "text-foreground" : "text-muted-foreground")}>
            <Hourglass className="size-3" aria-hidden />
            {deadline.remainingSec <= 0 ? (
              <span>{deadline.kind === "idle" ? "sleeps any moment" : deadline.kind === "sleep" ? "destroyed any moment" : "cap reached"}</span>
            ) : (
              <>
                <span className="stamp">{fmtDuration(deadline.remainingSec)}</span>
                <span className="opacity-80">{deadline.kind === "idle" ? "if quiet" : deadline.kind === "sleep" ? "then destroyed" : "of the cap"}</span>
              </>
            )}
          </span>
          <span className="bg-border block h-1 w-28 max-w-full overflow-hidden rounded-full">
            <span
              className={cn("block h-full w-full origin-left rounded-full transition-transform duration-700 ease-linear", deadline.kind === "idle" || deadline.kind === "sleep" ? "bg-sleep" : "bg-live")}
              style={{ transform: `scaleX(${Math.min(1, Math.max(0, deadline.fraction ?? 0))})` }}
            />
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{deadlineLabel(deadline)}</TooltipContent>
    </Tooltip>
  );
}

function RowActions({ box, onDestroyed }: { box: StableBox; onDestroyed: (name: string) => void }) {
  const destroy = async () => {
    try {
      await api.teardown(box.name);
      toast.success(`${friendlyName(box.name)} destroyed`);
      onDestroyed(box.name);
    } catch (e) {
      toast.error("Could not destroy the machine", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <div className="flex items-center justify-end gap-1.5" onClick={stopRow} onKeyDown={stopRow}>
      <ArmButton
        size="icon-sm"
        variant="ghost"
        icon={<Trash2 />}
        label={`Destroy ${friendlyName(box.name)}`}
        armedLabel="Destroy?"
        onConfirm={destroy}
        disabled={box.leaving}
        className="text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 data-[armed=true]:opacity-100 [@media(hover:none)]:opacity-60"
      />
      {box.runState === "waiting" ? (
        <span className="text-attention-text pointer-events-none text-meta font-semibold whitespace-nowrap">Answer →</span>
      ) : (
        <ChevronRight
          className="text-muted-foreground pointer-events-none size-4 -translate-x-0.5 opacity-0 transition-[opacity,transform] duration-150 group-focus-within:translate-x-0 group-focus-within:opacity-100 group-hover:translate-x-0 group-hover:opacity-100 group-focus:translate-x-0 group-focus:opacity-100"
          aria-hidden
        />
      )}
    </div>
  );
}

/** Bulk clean-up: destroy every sleeping, non-kept sandbox (two clicks). */
function DestroySleeping({ boxes, onDestroyed }: { boxes: StableBox[]; onDestroyed: (name: string) => void }) {
  const run = async () => {
    let ok = 0;
    for (const b of boxes) {
      try {
        await api.teardown(b.name);
        onDestroyed(b.name);
        ok++;
      } catch (e) {
        toast.error(`Could not destroy ${friendlyName(b.name)}`, { description: e instanceof Error ? e.message : String(e) });
      }
    }
    toast.success(`Destroyed ${ok} sleeping ${ok === 1 ? "sandbox" : "sandboxes"}`);
  };
  return (
    <ArmButton
      size="sm"
      variant="ghost"
      icon={<Trash2 />}
      label={`Destroy ${boxes.length} sleeping`}
      armedLabel={`Confirm: destroy ${boxes.length} sleeping`}
      autoDisarmMs={5000}
      onConfirm={run}
      className="text-muted-foreground"
    />
  );
}
