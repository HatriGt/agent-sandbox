import * as React from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, GitBranch, Hourglass, Pause, Plus, Search, Server, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, type FleetLifecycle } from "@/lib/api";
import { useGo } from "@/lib/route";
import { doneLabel, friendlyName, isFailedExit, shortName, roleLabel, threadSort, threadTitle } from "@/lib/format";
import { deadlineLabel, deadlineOf, displayState, fmtCountdown, fmtDuration, parseUptimeSec } from "@/lib/lifecycle";
import { questionHeadline } from "@/lib/question";
import type { StableBox } from "@/hooks/useStableBoxes";
import { prefetchWatch } from "@/hooks/useWatchStream";
import { useNow } from "@/hooks/useNow";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Swap } from "@/components/ui/swap";
import { Collapse } from "@/components/ui/collapse";
import { FilterChip } from "@/components/ui/filter-chip";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UsageMeter } from "@/components/ui/usage-meter";
import { compareBy, DataTable, MetaLine, StatusDot, stopRow, type Column, type Sort } from "@/components/ui/data-table";
import { Capacity } from "@/components/Capacity";
import { ServiceHealth } from "@/components/ServiceHealth";
import { HostsPanel } from "@/components/Hosts";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/**
 * The fleet: what is running right now, does any of it need me, and how long does each machine have
 * left. The state counts ARE the filter — click "2 sleeping" and the table shows the sleeping
 * machines; the search box narrows by task, machine name or repo. One flat table (no group heads):
 * triage order by default, any column sorts the whole set, the header stays put while the rows
 * scroll, and the set is paged (10 / 25 / 50 rows). The whole row opens the thread. Capacity is the
 * configured slot count against live occupancy.
 */

type Filter = "all" | "attention" | "working" | "sleeping" | "done";

const filterOf = (v: StableBox): Exclude<Filter, "all"> => {
  if (v.runState === "waiting") return "attention";
  const s = displayState(v);
  if (s === "running") return "working";
  // Away (the machine is gone, the thread is kept) is not a machine asleep: it costs nothing and
  // there is nothing to destroy, so it counts with the finished runs.
  if (s === "sleeping") return v.absent ? "done" : "sleeping";
  return "done";
};

const FILTER_LABEL: Record<Exclude<Filter, "all">, string> = {
  attention: "Action needed",
  working: "Working",
  sleeping: "Sleeping",
  done: "Done",
};

/** Triage rank, the same order threadSort gives: the State column sorts by it. */
const stateRank = (v: StableBox): number => {
  if (v.runState === "waiting") return 0;
  const s = displayState(v);
  return s === "running" ? 1 : s === "done" ? 2 : s === "sleeping" ? 3 : 4;
};

const PAGE_SIZES = [10, 25, 50] as const;
type PageSize = (typeof PAGE_SIZES)[number];
type PageSizeStr = `${PageSize}`;
const PAGE_SIZE_KEY = "asb-fleet-page-size";

function readPageSize(): PageSize {
  try {
    const n = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : 25;
  } catch {
    return 25;
  }
}

export function Sandboxes({
  boxes: everyBox,
  lifecycle,
  loading,
  onOpen,
  onDestroyed,
  onBack,
  snapshotAt,
}: {
  boxes: StableBox[];
  lifecycle: FleetLifecycle;
  loading: boolean;
  onOpen: (name: string) => void;
  onDestroyed: (name: string) => void;
  onBack: () => void;
  /** When the fleet reading was taken (ms): the countdowns tick from it between polls. */
  snapshotAt?: number | null;
}) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<Sort>(null);
  const [pageSize, setPageSizeState] = React.useState<PageSize>(readPageSize);
  const [page, setPage] = React.useState(0);
  const go = useGo();

  // A machine destroyed from this page leaves at once; the poll that no longer lists it takes
  // over from there (the name is forgotten once it is gone from the reading).
  const [gone, setGone] = React.useState<ReadonlySet<string>>(() => new Set());
  React.useEffect(() => {
    if (!gone.size) return;
    const names = new Set(everyBox.map((b) => b.name));
    const still = [...gone].filter((n) => names.has(n));
    if (still.length !== gone.size) setGone(new Set(still));
  }, [everyBox, gone]);
  const destroyed = React.useCallback(
    (name: string) => {
      setGone((g) => new Set([...g, name]));
      onDestroyed(name);
    },
    [onDestroyed]
  );

  // This page lists runs. A machine kept ready for the next task is not one: nobody started it
  // and there is nothing to open, answer or destroy. It is handed to a task when one starts.
  // Nor is a thread whose machine is already gone and that nobody kept (Away): it lives in
  // Threads and History. A temporary box asleep IS listed, with the time left before it is
  // destroyed: it can be revived until then (asked for 2026-11-19).
  const boxes = React.useMemo(() => everyBox.filter((b) => b.role !== "pool-free" && !(b.absent && !b.kept) && !gone.has(b.name)), [everyBox, gone]);

  const counts = React.useMemo(() => {
    const c: Record<Exclude<Filter, "all">, number> = { attention: 0, working: 0, sleeping: 0, done: 0 };
    for (const b of boxes) if (!b.leaving) c[filterOf(b)]++;
    return c;
  }, [boxes]);

  // More than one box host in play: say which machine runs where.
  const multiHost = React.useMemo(() => new Set(boxes.map((b) => b.host).filter(Boolean)).size > 1, [boxes]);
  const columns = React.useMemo(() => fleetColumns({ lifecycle, multiHost, snapshotAt, onDestroyed: destroyed }), [lifecycle, multiHost, snapshotAt, destroyed]);

  const q = query.trim().toLowerCase();
  const visible = React.useMemo(() => {
    const list = boxes.filter((b) => {
      if (filter !== "all" && filterOf(b) !== filter) return false;
      if (!q) return true;
      return [b.name, friendlyName(b.name), b.title, b.task, b.question, b.host, b.agent, ...(b.repos ?? []).map((r) => r.name)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    // Triage order unless a column is sorted; the whole set is ordered, then paged.
    return sort ? list.sort(compareBy(columns.find((c) => c.id === sort.id), sort.dir)) : list.sort(threadSort);
  }, [boxes, filter, q, sort, columns]);

  // The page resets when the set is narrowed or reordered, and never points past the end.
  React.useEffect(() => setPage(0), [filter, q, sort, pageSize]);
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const current = Math.min(page, pages - 1);
  const pageRows = React.useMemo(() => visible.slice(current * pageSize, current * pageSize + pageSize), [visible, current, pageSize]);
  const setPageSize = (n: PageSize) => {
    setPageSizeState(n);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(n));
    } catch {
      /* private mode: the choice lasts for the session */
    }
  };

  const waiting = boxes.filter((b) => b.runState === "waiting" && !b.leaving);
  const sleepable = boxes.filter((b) => displayState(b) === "sleeping" && !b.absent && !b.kept && !b.leaving);

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="page-frame py-6 md:py-8">
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
            {lifecycle.idleTimeoutSec ? fmtDuration(lifecycle.idleTimeoutSec) : "the idle limit"} quiet · a reply wakes it
            {lifecycle.sleepTtlSec ? <> · a temporary machine is destroyed after {fmtDuration(lifecycle.sleepTtlSec)} asleep, a kept one never.</> : "."}
          </p>
          <ServiceHealth />
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
              <FilterChip group="fleet" active={filter === "attention"} onClick={() => setFilter("attention")} label="Action needed" count={counts.attention} tone="attention" />
              <FilterChip group="fleet" active={filter === "working"} onClick={() => setFilter("working")} label="Working" count={counts.working} tone="live" />
              <FilterChip group="fleet" active={filter === "sleeping"} onClick={() => setFilter("sleeping")} label="Sleeping" count={counts.sleeping} tone="sleep" />
              <FilterChip group="fleet" active={filter === "done"} onClick={() => setFilter("done")} label="Done" count={counts.done} />
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
                    <DestroySleeping boxes={sleepable} onDestroyed={destroyed} />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>

          <Swap state={loading ? "loading" : !boxes.length ? "empty" : !visible.length ? "none" : "list"}>
            {loading ? (
              <MachineTable rows={[]} columns={columns} loading onOpen={onOpen} sort={sort} onSortChange={setSort} />
            ) : !boxes.length ? (
              <div className="surface flex flex-col items-center px-6 py-14 text-center">
                <span className="tile text-muted-foreground mb-4 grid size-12 place-items-center rounded-full shadow-e1" aria-hidden>
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
              <div className="surface py-12 text-center">
                <p className="text-foreground text-lead font-medium">Nothing matches</p>
                <p className="text-muted-foreground mt-1 text-meta">
                  {q ? <>No machine matches “{query.trim()}”{filter !== "all" && <> in {FILTER_LABEL[filter as Exclude<Filter, "all">].toLowerCase()}</>}.</> : <>No machines are {FILTER_LABEL[filter as Exclude<Filter, "all">].toLowerCase()} right now.</>}
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
              <div className="flex flex-col gap-2.5">
                <MachineTable rows={pageRows} columns={columns} onOpen={onOpen} sort={sort} onSortChange={setSort} />
                <Pager total={visible.length} page={current} pages={pages} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
              </div>
            )}
          </Swap>
        </section>

        <HostsPanel />
      </div>
    </div>
  );
}

/* ───────────────────────────── the table ───────────────────────────── */

function fleetColumns({ lifecycle, multiHost, snapshotAt, onDestroyed }: { lifecycle: FleetLifecycle; multiHost: boolean; snapshotAt?: number | null; onDestroyed: (name: string) => void }): Column<StableBox>[] {
  const quietOf = (b: StableBox) => (displayState(b) === "sleeping" ? undefined : deadlineOf(b, lifecycle).quietForSec);
  const leftOf = (b: StableBox) => deadlineOf(b, lifecycle, Date.now(), snapshotAt ?? undefined).remainingSec;
  const cols: Column<StableBox>[] = [
    { id: "state", header: "State", width: "w-[7.5rem]", sort: stateRank, cell: (b) => <StateCell box={b} /> },
    { id: "task", header: "Task", primary: true, sort: (b) => threadTitle(b), cell: (b) => <TaskCell box={b} lifecycle={lifecycle} multiHost={multiHost} /> },
    { id: "machine", header: "Machine", width: "w-44", fitMax: 320, hideBelow: "md", sort: (b) => friendlyName(b.name), cell: (b) => <MachineCell box={b} /> },
  ];
  if (multiHost) cols.push({ id: "host", header: "Host", width: "w-24", hideBelow: "lg", sort: (b) => b.host, cell: (b) => <HostChip host={b.host} /> });
  cols.push(
    { id: "agent", header: "Agent", width: "w-16", hideBelow: "lg", sort: (b) => b.agent, cell: (b) => <span className="stamp">{b.agent ?? "—"}</span> },
    { id: "up", header: "Up", width: "w-16", hideBelow: "lg", sort: (b) => parseUptimeSec(b.uptime), cell: (b) => <UpCell box={b} /> },
    { id: "quiet", header: "Quiet", width: "w-16", hideBelow: "lg", sort: quietOf, cell: (b) => <QuietCell box={b} lifecycle={lifecycle} /> },
    { id: "left", header: "Time left", width: "w-[9.5rem]", hideBelow: "md", sort: leftOf, cell: (b) => <TimeLeft box={b} lifecycle={lifecycle} snapshotAt={snapshotAt} /> },
    // The row is the action (click opens the thread); this cell holds destroy + the click cue.
    { id: "actions", header: <span className="sr-only">Actions</span>, width: "w-[5.5rem]", align: "end", cell: (b) => <RowActions box={b} onDestroyed={onDestroyed} /> }
  );
  return cols;
}

function MachineTable({
  rows,
  columns,
  loading,
  onOpen,
  sort,
  onSortChange,
}: {
  rows: StableBox[];
  columns: Column<StableBox>[];
  loading?: boolean;
  onOpen: (name: string) => void;
  sort: Sort;
  onSortChange: (s: Sort) => void;
}) {
  return (
    <DataTable
      aria-label="Machines"
      rows={rows}
      columns={columns}
      rowKey={(b) => b.name}
      loading={loading}
      sort={sort}
      onSortChange={onSortChange}
      // The header stays put while the rows scroll under it; the page keeps the toolbar and the pager in view.
      stickyHeader
      containerClassName="max-h-[min(62vh,48rem)]"
      onRowClick={(b) => !b.leaving && onOpen(b.name)}
      rowLabel={(b) => `Open ${friendlyName(b.name)} — ${b.task ? threadTitle(b) : "no task yet"}`}
      rowProps={(b) => ({ className: cn("group", b.leaving && "pointer-events-none opacity-50"), onMouseEnter: () => prefetchWatch(b.name) })}
    />
  );
}

/** "1–25 of 84", the page size and the page turn; one quiet line under the table. */
function Pager({ total, page, pages, pageSize, onPage, onPageSize }: { total: number; page: number; pages: number; pageSize: PageSize; onPage: (p: number) => void; onPageSize: (n: PageSize) => void }) {
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-micro">
      <span className="tabular" aria-live="polite">
        {from}–{to} of {total}
      </span>
      <div className="ml-auto flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span>Rows</span>
          <Segmented<PageSizeStr> size="xs" ariaLabel="Rows per page" value={`${pageSize}`} onChange={(v) => onPageSize(Number(v) as PageSize)} options={PAGE_SIZES.map((n) => ({ value: `${n}` as PageSizeStr, label: String(n) }))} />
        </span>
        <span className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-xs" className="rounded-full" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}>
            <ChevronLeft />
          </Button>
          <span className="tabular min-w-[5.5em] text-center">
            Page {page + 1} of {pages}
          </span>
          <Button variant="ghost" size="icon-xs" className="rounded-full" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
            <ChevronRight />
          </Button>
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────────── the cells ───────────────────────────── */

const stateDot = (box: StableBox) => {
  const state = displayState(box);
  if (box.stalled && state === "running") return <StatusDot tone="destructive">stalled</StatusDot>;
  switch (state) {
    case "running":
      return <StatusDot tone="live" pulse>working</StatusDot>;
    case "waiting":
      return <StatusDot tone="attention">action needed</StatusDot>;
    case "done":
      return <StatusDot tone={isFailedExit(box.exitCode) ? "destructive" : "ok"}>{doneLabel(box.exitCode)}</StatusDot>;
    case "sleeping":
      return <StatusDot tone="sleep">{box.absent ? "away" : "sleeping"}</StatusDot>;
    default:
      return <StatusDot tone="muted">idle</StatusDot>;
  }
};

/** A wash chip (never outlined) for a fact beside the state: kept, the host. */
function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span className="bg-foreground/6 text-muted-foreground rounded px-1.5 py-px font-sans text-[10px] leading-4 whitespace-nowrap" title={title}>
      {children}
    </span>
  );
}

function HostChip({ host }: { host?: string }) {
  return host ? <Chip title={`Runs on the ${host} host`}>{host}</Chip> : <span className="text-faint">—</span>;
}

function StateCell({ box }: { box: StableBox }) {
  return (
    <span className="flex flex-col items-start gap-1">
      {stateDot(box)}
      {box.kept && <Chip title="Kept: never destroyed on its own; only Destroy removes it">kept</Chip>}
    </span>
  );
}

function TaskCell({ box, lifecycle, multiHost }: { box: StableBox; lifecycle: FleetLifecycle; multiHost: boolean }) {
  const deadline = deadlineOf(box, lifecycle);
  const repos = box.repos ?? [];
  const left = deadline.remainingSec != null && `${deadline.remainingSec <= 0 ? "0s" : fmtDuration(deadline.remainingSec)} left`;
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
      {/* Meta lines for the columns hidden at this width: a phone's column has room for two parts. */}
      <MetaLine className="stamp mt-0.5 sm:hidden" parts={[<span title={shortName(box.name)}>{friendlyName(box.name)}</span>, left]} />
      <MetaLine
        className="stamp mt-0.5 hidden sm:flex md:hidden"
        parts={[<span title={shortName(box.name)}>{friendlyName(box.name)}</span>, multiHost && box.host, box.leaving ? "shutting down" : box.kept ? "kept" : roleLabel(box.role), box.uptime && `up ${box.uptime}`, left]}
      />
      <MetaLine className="stamp mt-0.5 hidden md:flex lg:hidden" parts={[multiHost && box.host, box.agent, box.uptime && `up ${box.uptime}`]} />
    </div>
  );
}

function MachineCell({ box }: { box: StableBox }) {
  const state = displayState(box);
  const words = box.leaving ? "shutting down" : box.absent ? "away · machine gone, thread kept" : box.kept ? "kept · wakes on reply" : state === "sleeping" ? "temporary · wakes on reply" : box.role === "session" ? "" : roleLabel(box.role);
  return (
    <div className="stamp text-muted-foreground flex min-w-0 flex-col gap-0.5">
      <span className="text-foreground truncate" title={shortName(box.name)}>
        {friendlyName(box.name)}
      </span>
      {/* Words in the sans face; only data is mono. */}
      {words && <span className="font-sans text-micro">{words}</span>}
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

function UpCell({ box }: { box: StableBox }) {
  const sec = parseUptimeSec(box.uptime);
  if (sec == null) return <span className="text-faint">—</span>;
  const sleeping = displayState(box) === "sleeping";
  return (
    <span className="stamp" title={sleeping ? `ran for ${fmtDuration(sec)}` : `up for ${fmtDuration(sec)}${box.cpu ? ` · cpu ${box.cpu}` : ""}`}>
      {fmtDuration(sec)}
    </span>
  );
}

function QuietCell({ box, lifecycle }: { box: StableBox; lifecycle: FleetLifecycle }) {
  if (displayState(box) === "sleeping") return <span className="text-faint">—</span>;
  const quiet = deadlineOf(box, lifecycle).quietForSec;
  if (quiet == null) return <span className="text-faint">—</span>;
  // Live work that has gone quiet for a while is the stall signal; the figure steps up to ink then.
  return (
    <span className={cn("stamp", box.stalled && "text-destructive")} title={`no output for ${fmtDuration(quiet)}`}>
      {quiet < 5 ? "now" : fmtDuration(quiet)}
    </span>
  );
}

/**
 * The exact clock on the machine: the controller stops a finished run itself once it has been
 * quiet for the idle limit, destroys a temporary sleeper at the end of its sleep TTL and ends a run
 * at the cap — all from the same readings this cell counts down from, ticking every second.
 */
function TimeLeft({ box, lifecycle, snapshotAt }: { box: StableBox; lifecycle: FleetLifecycle; snapshotAt?: number | null }) {
  const has = deadlineOf(box, lifecycle).remainingSec != null;
  const now = useNow(has, 1000);
  const deadline = deadlineOf(box, lifecycle, now, snapshotAt ?? undefined);
  if (deadline.remainingSec == null) {
    return <span className="stamp text-faint whitespace-nowrap">{box.kept ? "kept" : displayState(box) === "sleeping" ? "temporary" : "—"}</span>;
  }
  const over = deadline.remainingSec <= 0;
  const word = deadline.kind === "idle" ? "to sleep" : deadline.kind === "sleep" ? "to destroy" : "of cap";
  const nowWord = deadline.kind === "idle" ? "sleeping now…" : deadline.kind === "sleep" ? "destroying now…" : "at the cap";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col gap-1.5">
          {/* Amber is reserved for "action needed"; the last five minutes step up to the foreground colour. */}
          <span className={cn("inline-flex items-center gap-1.5 text-micro whitespace-nowrap", deadline.remainingSec < 300 ? "text-foreground" : "text-muted-foreground")}>
            <Hourglass className="size-3 shrink-0" aria-hidden />
            {over ? (
              <span>{nowWord}</span>
            ) : (
              <>
                <span className="stamp">{fmtCountdown(deadline.remainingSec)}</span>
                <span className="opacity-80">{word}</span>
              </>
            )}
          </span>
          <span className="bg-border block h-1 w-28 max-w-full overflow-hidden rounded-full">
            <span
              className={cn("block h-full w-full origin-left rounded-full transition-transform duration-1000 ease-linear", deadline.kind === "idle" || deadline.kind === "sleep" ? "bg-sleep" : "bg-live")}
              style={{ transform: `scaleX(${over ? 1 : Math.min(1, Math.max(0, deadline.fraction ?? 0))})` }}
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
      // A kept machine goes only when the click says so in words ("Kept · destroy anyway?"): that is
      // the one lane that sends `force`; the bulk clean-up never does.
      await api.teardown(box.name, box.kept ? { force: true } : {});
      toast.success(`${friendlyName(box.name)} destroyed`);
      onDestroyed(box.name);
    } catch (e) {
      toast.error(`Could not destroy ${friendlyName(box.name)}`, { description: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <div className="flex items-center justify-end gap-1.5" onClick={stopRow} onKeyDown={stopRow}>
      <ArmButton
        size="icon-sm"
        variant="ghost"
        icon={<Trash2 />}
        label={`Destroy ${friendlyName(box.name)}`}
        armedLabel={box.kept ? "Kept · destroy anyway?" : "Destroy?"}
        autoDisarmMs={box.kept ? 5000 : 3000}
        onConfirm={destroy}
        disabled={box.leaving}
        className="text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[armed=true]:opacity-100 [@media(hover:none)]:opacity-60"
      />
      {box.runState === "waiting" ? (
        <span className="text-attention-text pointer-events-none text-meta font-semibold whitespace-nowrap">Answer →</span>
      ) : (
        <ChevronRight
          className="text-muted-foreground pointer-events-none size-4 -translate-x-1 opacity-0 transition-[opacity,translate] duration-200 ease-(--ease-out-quint) group-focus-within/row:translate-x-0 group-focus-within/row:opacity-100 group-hover/row:translate-x-0 group-hover/row:opacity-100 group-focus/row:translate-x-0 group-focus/row:opacity-100"
          aria-hidden
        />
      )}
    </div>
  );
}

/** Bulk clean-up: destroy every sleeping, non-kept sandbox (two clicks). Never sends `force`. */
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
    if (ok) toast.success(`Destroyed ${ok} sleeping ${ok === 1 ? "sandbox" : "sandboxes"}`);
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
