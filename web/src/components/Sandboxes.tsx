import * as React from "react";
import { ArrowLeft, ChevronRight, GitBranch, Hourglass, Pause, Search, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, type FleetLifecycle } from "@/lib/api";
import { friendlyName, shortName, roleLabel, threadSort, threadTitle } from "@/lib/format";
import { deadlineLabel, deadlineOf, displayState, fmtDuration } from "@/lib/lifecycle";
import { questionHeadline } from "@/lib/question";
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

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-5 py-7 md:px-8 md:py-9">
        <header className="mb-5">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
            <ArrowLeft className="size-4" />
            Machines
          </Button>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em]">Fleet</h1>
            {loading ? <Bar className="h-3 w-56" /> : <Capacity boxes={boxes} capacity={lifecycle.capacity} />}
          </div>
          <p className="text-muted-foreground mt-1 text-meta">
            Runs up to {lifecycle.maxDurationSec ? fmtDuration(lifecycle.maxDurationSec) : "the cap"} · sleeps after{" "}
            {lifecycle.idleTimeoutSec ? fmtDuration(lifecycle.idleTimeoutSec) : "the idle limit"} quiet · a reply wakes it.
          </p>
        </header>

        {waiting.length > 0 && filter === "all" && !q && (
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
                      className="border-attention/50 bg-attention/10 hover:bg-attention/20 flex w-full cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition-colors"
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
        )}

        <section aria-labelledby="all">
          {/* Toolbar: the counts are the filter; search narrows within it. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Filter machines" className="flex flex-wrap items-center gap-1">
              <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" count={boxes.filter((b) => !b.leaving).length} />
              <FilterChip active={filter === "attention"} onClick={() => setFilter("attention")} label="Needs you" count={counts.attention} tone="attention" />
              <FilterChip active={filter === "working"} onClick={() => setFilter("working")} label="Working" count={counts.working} tone="live" />
              <FilterChip active={filter === "sleeping"} onClick={() => setFilter("sleeping")} label="Sleeping" count={counts.sleeping} tone="sleep" />
              <FilterChip active={filter === "done"} onClick={() => setFilter("done")} label="Done" count={counts.done} />
              <FilterChip active={filter === "warm"} onClick={() => setFilter("warm")} label="Warm" count={counts.warm} />
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
                  <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground cursor-pointer">
                    <X className="size-3.5" />
                  </button>
                )}
              </label>
              {counts.sleeping > 0 && (
                <DestroySleeping boxes={boxes.filter((b) => displayState(b) === "sleeping" && !b.kept && !b.leaving)} onDestroyed={onDestroyed} />
              )}
            </div>
          </div>

          {loading ? (
            <div className="overflow-hidden rounded-xl border">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0">
                  <Bar className="h-2.5 w-20" />
                  <Bar className="h-3 flex-1" />
                  <Bar className="h-3 w-40" />
                  <Bar className="h-8 w-16 rounded-md" />
                </div>
              ))}
            </div>
          ) : !sorted.length ? (
            <div className="rounded-xl border border-dashed py-14 text-center">
              <p className="text-foreground text-lead font-medium">Nothing is up</p>
              <p className="text-muted-foreground mt-1 text-meta">A machine boots in a few seconds when you start a task.</p>
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
        </section>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: "attention" | "live" | "sleep";
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={count === 0 && !active}
      className={cn(
        "flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-meta font-medium transition-[background-color,border-color,color,transform] duration-150",
        "disabled:cursor-default disabled:opacity-45",
        active
          ? "border-foreground/20 bg-foreground text-background"
          : "bg-card text-muted-foreground hover:text-foreground hover:border-line-strong active:scale-[0.97]"
      )}
    >
      {label}
      <span
        className={cn(
          "tabular rounded-full px-1.5 py-px text-micro font-semibold",
          active
            ? "bg-background/20 text-background"
            : tone === "attention" && count > 0
              ? "bg-attention/20 text-attention-text"
              : tone === "live" && count > 0
                ? "bg-live/10 text-live"
                : tone === "sleep" && count > 0
                  ? "bg-sleep/10 text-sleep"
                  : "bg-muted text-muted-foreground"
        )}
      >
        {count}
      </span>
    </button>
  );
}

const COLS = "md:grid-cols-[7.5rem_minmax(0,1fr)_13rem_8.5rem_5.5rem]";

function MachineTable({
  boxes,
  grouped,
  lifecycle,
  onOpen,
  onDestroyed,
}: {
  boxes: StableBox[];
  grouped: boolean;
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
        <span aria-hidden />{/* row is the action: click opens the thread */}
      </div>
      <ul>
        <AnimatePresence initial={false}>
          {boxes.map((b, i) => (
            <MachineRow
              key={b.name}
              box={b}
              head={grouped && (i === 0 || groupOf(boxes[i - 1]) !== groupOf(b)) ? GROUP_LABEL[groupOf(b)] : null}
              lifecycle={lifecycle}
              onOpen={onOpen}
              onDestroyed={onDestroyed}
            />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function MachineRow({
  box,
  head,
  lifecycle,
  onOpen,
  onDestroyed,
}: {
  box: StableBox;
  head: string | null;
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
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: box.leaving ? 0.5 : 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.8 }}
      className="border-b last:border-b-0"
    >
      {head && (
        <p className="label text-faint bg-muted/30 border-b px-4 py-1.5" aria-hidden>
          {head}
        </p>
      )}
      <div className={cn("group hover:bg-muted/50 relative grid grid-cols-1 gap-2 px-4 py-3 transition-colors md:items-center md:gap-3", COLS)}>
        {/* The row IS the open action: a stretched button under the content (first child, so every
            later positioned sibling — destroy, the time-left tooltip — paints and clicks above it).
            Real button, so it stays keyboard-tabbable and screen-reader announced. */}
        <button
          type="button"
          onClick={() => onOpen(box.name)}
          onMouseEnter={() => prefetchWatch(box.name)}
          onFocus={() => prefetchWatch(box.name)}
          disabled={box.leaving}
          aria-label={`Open ${friendlyName(box.name)} — ${box.task ? threadTitle(box) : "no task yet"}`}
          className="focus-visible:ring-ring absolute inset-0 cursor-pointer rounded-none focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        />

        <div className="flex items-center gap-2">
          <StateStamp state={state} exitCode={box.exitCode} />
          <span className="label text-muted-foreground md:hidden">{box.leaving ? "shutting down" : roleLabel(box.role)}</span>
        </div>

        <div className="min-w-0">
          <p className="text-foreground truncate text-meta">
            {box.task ? threadTitle(box) : <span className="text-muted-foreground">No task yet — claim it with a new task</span>}
          </p>
          {box.question && <p className="text-attention-text truncate text-micro">Asking: {questionHeadline(box.question)}</p>}
          {(box.repos ?? []).length > 0 && (
            <span className="mt-1 flex flex-wrap items-center gap-1">
              {(box.repos ?? []).slice(0, 3).map((r) => (
                <span key={r.name} className="bg-muted text-muted-foreground stamp inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px]" title={r.branch ? `${r.name} · ${r.branch}` : r.name}>
                  <GitBranch className="size-2.5 shrink-0" aria-hidden />
                  {r.name}
                  {r.branch && <span className="text-faint hidden sm:inline">· {r.branch}</span>}
                </span>
              ))}
              {(box.repos ?? []).length > 3 && <span className="text-faint text-[10px]">+{(box.repos ?? []).length - 3}</span>}
            </span>
          )}
          <p className="stamp text-muted-foreground mt-0.5 md:hidden" title={shortName(box.name)}>
            {friendlyName(box.name)}
            {box.uptime && <span className="ml-2 opacity-70">up {box.uptime}</span>}
            {deadline.remainingSec != null && <span className="ml-2 opacity-70">· {(deadline.remainingSec <= 0 ? "soon" : fmtDuration(deadline.remainingSec))} left</span>}
          </p>
        </div>

        <div className="stamp text-muted-foreground hidden min-w-0 flex-col gap-0.5 md:flex">
          <span className="text-foreground" title={shortName(box.name)}>
            {friendlyName(box.name)}
          </span>
          {/* Words in the sans face; only the duration is data. */}
          <span className="font-sans text-micro">
            {box.leaving ? "shutting down" : box.kept ? "kept · wakes on reply" : state === "sleeping" ? (deadline.kind === "sleep" && deadline.remainingSec != null ? `asleep · destroyed in ${deadline.remainingSec <= 0 ? "soon" : fmtDuration(deadline.remainingSec)}` : "asleep · wakes on reply") : roleLabel(box.role)}
          </span>
          {/* Data line: uptime · cpu · memory — one row, never wrapping the words above. */}
          {(box.uptime || box.cpu || box.mem) && (
            <span className="truncate" title={[box.uptime && `${state === "sleeping" ? "ran" : "up"} ${box.uptime}`, box.cpu && `cpu ${box.cpu}`, box.mem && `memory ${box.mem}`].filter(Boolean).join(" · ")}>
              {box.uptime && <>{state === "sleeping" ? "ran" : "up"} {box.uptime}</>}
              {box.cpu && <>{box.uptime ? " · " : ""}{box.cpu.split(" / ")[0]}c</>}
              {box.mem && <> · {box.mem.split(" / ")[0].replace(/\.\d+ /, " ")}</>}
            </span>
          )}
        </div>

        {/* Time left: the nearer of the run cap and the idle-stop estimate, with a slim track.
            `relative` lifts it above the stretched row button so its tooltip still hovers. */}
        <div className="relative hidden md:block">
          {deadline.remainingSec != null ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex flex-col gap-1.5">
                  <span className={cn("inline-flex items-center gap-1.5 text-micro", deadline.remainingSec < 300 ? "text-attention-text" : "text-muted-foreground")}>
                    <Hourglass className="size-3" aria-hidden />
                    <span className="stamp">{deadline.remainingSec <= 0 ? "soon" : fmtDuration(deadline.remainingSec)}</span>
                    <span className="opacity-80">{deadline.remainingSec != null && deadline.remainingSec <= 0 ? "" : deadline.kind === "idle" ? "if quiet" : deadline.kind === "sleep" ? "then destroyed" : "of the cap"}</span>
                  </span>
                  <span className="bg-border block h-1 w-28 overflow-hidden rounded-full">
                    <span
                      className={cn("block h-full rounded-full transition-[width] duration-700", deadline.kind === "idle" || deadline.kind === "sleep" ? "bg-sleep" : "bg-live")}
                      style={{ width: `${Math.round((deadline.fraction ?? 0) * 100)}%` }}
                    />
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent>{deadlineText}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="stamp text-faint">{box.kept ? "kept · until destroyed" : state === "sleeping" ? "asleep" : "—"}</span>
          )}
        </div>

        {/* Trailing cell: destroy (lifted above the row button) + a cue for what a click does. */}
        <div className="relative flex items-center gap-1.5 md:justify-end">
          {waiting ? (
            <span className="text-attention-text pointer-events-none mr-auto text-meta font-semibold md:order-last md:mr-0">
              Answer →
            </span>
          ) : (
            <ChevronRight
              className="text-muted-foreground pointer-events-none mr-auto size-4 -translate-x-0.5 opacity-0 transition-[opacity,transform] duration-150 group-focus-within:translate-x-0 group-focus-within:opacity-100 group-hover:translate-x-0 group-hover:opacity-100 md:order-last md:mr-0"
              aria-hidden
            />
          )}
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
                  className="text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Destroy — stops the microVM and discards its workspace</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </motion.li>
  );
}

/** Bulk clean-up: destroy every sleeping, non-kept sandbox (two clicks). */
function DestroySleeping({ boxes, onDestroyed }: { boxes: StableBox[]; onDestroyed: (name: string) => void }) {
  const [armed, setArmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(t);
  }, [armed]);
  if (!boxes.length) return null;
  const run = async () => {
    if (!armed) return setArmed(true);
    setBusy(true);
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
    setBusy(false);
    setArmed(false);
  };
  return (
    <Button size="sm" variant={armed ? "destructive" : "ghost"} onClick={run} disabled={busy} className={cn(!armed && "text-muted-foreground")}>
      <Trash2 />
      {busy ? "Destroying…" : armed ? `Confirm: destroy ${boxes.length} sleeping` : `Destroy ${boxes.length} sleeping`}
    </Button>
  );
}
