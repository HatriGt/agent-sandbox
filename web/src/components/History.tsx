import * as React from "react";
import { ArrowLeft, Check, ChevronDown, RotateCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type HistoryRun, type RunDigest } from "@/lib/api";
import { fmtAgo, friendlyName, shortName } from "@/lib/format";
import { fmtDuration } from "@/lib/lifecycle";
import { setPrefill } from "@/lib/draft";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DigestCard } from "@/components/thread/DigestCard";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/**
 * History: the record of what your agents did. Every run here is FINISHED and its machine may be
 * long gone — the page is an archive, deliberately still: fetched once on mount (plus "Show more"),
 * no polling, no breathing dots. A row expands in place into the run's receipt (the digest), and
 * offers exactly two actions: run the same brief again on a new machine, or delete the record.
 */

const PAGE = 50;

type Filter = "all" | "done" | "failed";

/** "Today" / "Yesterday" / "Mon 1 Sep" — the archive's day headers. */
function dayLabel(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

function titleOf(r: HistoryRun): string {
  const t = (r.task ?? "").trim();
  if (t) {
    const firstLine = t.split("\n")[0];
    return firstLine.length > 90 ? `${firstLine.slice(0, 89)}…` : firstLine;
  }
  return (r.headline ?? "").trim() || "Untitled run";
}

export function History({ onBack, onAgain }: { onBack: () => void; onAgain: () => void }) {
  const [rows, setRows] = React.useState<HistoryRun[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [expanded, setExpanded] = React.useState<number | null>(null);
  const [more, setMore] = React.useState(false); // another page may exist
  const [loadingMore, setLoadingMore] = React.useState(false);

  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .history({ limit: PAGE }, ctrl.signal)
      .then((r) => {
        setRows(r.runs);
        setMore(r.runs.length === PAGE);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, []);

  const showMore = async () => {
    if (!rows?.length) return;
    setLoadingMore(true);
    try {
      const r = await api.history({ limit: PAGE, before: rows[rows.length - 1].id });
      setRows((prev) => [...(prev ?? []), ...r.runs]);
      setMore(r.runs.length === PAGE);
    } catch (e) {
      toast.error("Could not load more history", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoadingMore(false);
    }
  };

  const counts = React.useMemo(() => {
    const c = { done: 0, failed: 0 };
    for (const r of rows ?? []) c[r.state === "failed" ? "failed" : "done"]++;
    return c;
  }, [rows]);

  const visible = (rows ?? []).filter((r) => filter === "all" || (filter === "failed" ? r.state === "failed" : r.state !== "failed"));

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-[900px] px-5 py-7 md:px-8 md:py-9">
        <header className="mb-6">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
            <ArrowLeft className="size-4" />
            Machines
          </Button>
          <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em]">History</h1>
          <p className="text-muted-foreground mt-1 text-meta">Finished runs, kept after their machines are gone.</p>
        </header>

        <div role="radiogroup" aria-label="Filter runs" className="mb-3 flex flex-wrap items-center gap-1">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" count={(rows ?? []).length} />
          <FilterChip active={filter === "done"} onClick={() => setFilter("done")} label="Done" count={counts.done} tone="ok" />
          <FilterChip active={filter === "failed"} onClick={() => setFilter("failed")} label="Failed" count={counts.failed} tone="destructive" />
        </div>

        {error ? (
          <div className="rounded-xl border border-dashed py-12 text-center">
            <p className="text-destructive text-lead font-medium">Could not load history</p>
            <p className="text-muted-foreground mt-1 text-meta">{error}</p>
          </div>
        ) : rows === null ? (
          <div className="overflow-hidden rounded-xl border" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0">
                <Bar className="h-2.5 w-14" />
                <Bar className="h-3 flex-1" />
                <Bar className="h-3 w-28" />
              </div>
            ))}
          </div>
        ) : !rows.length ? (
          <div className="rounded-xl border border-dashed py-14 text-center">
            <p className="text-foreground text-lead font-medium">Nothing here yet</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-meta">
              When a run finishes, its receipt is kept even after the machine is reaped.
            </p>
          </div>
        ) : !visible.length ? (
          <div className="rounded-xl border border-dashed py-12 text-center">
            <p className="text-foreground text-lead font-medium">Nothing matches</p>
            <p className="text-muted-foreground mt-1 text-meta">No {filter} runs among the loaded records.</p>
            <Button size="sm" variant="ghost" className="text-live mt-2" onClick={() => setFilter("all")}>
              Show everything
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border">
              <ul>
                {visible.map((r, i) => {
                  const at = r.archivedAt || r.endedAt || 0;
                  const prev = i > 0 ? visible[i - 1].archivedAt || visible[i - 1].endedAt || 0 : null;
                  const head = at && (prev === null || dayLabel(prev) !== dayLabel(at)) ? dayLabel(at) : null;
                  return (
                    <HistoryRow
                      key={r.id}
                      run={r}
                      head={head}
                      open={expanded === r.id}
                      onToggle={() => setExpanded((cur) => (cur === r.id ? null : r.id))}
                      onAgain={onAgain}
                      onDeleted={() => setRows((prevRows) => (prevRows ?? []).filter((x) => x.id !== r.id))}
                    />
                  );
                })}
              </ul>
            </div>
            {more && (
              <div className="mt-3 flex justify-center">
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void showMore()} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Show more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count: number; tone?: "ok" | "destructive" }) {
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
        active ? "border-foreground/20 bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground hover:border-line-strong active:scale-[0.97]"
      )}
    >
      {label}
      <span
        className={cn(
          "tabular rounded-full px-1.5 py-px text-micro font-semibold",
          active
            ? "bg-background/20 text-background"
            : tone === "destructive" && count > 0
              ? "bg-destructive/10 text-destructive"
              : tone === "ok" && count > 0
                ? "bg-ok/10 text-ok"
                : "bg-muted text-muted-foreground"
        )}
      >
        {count}
      </span>
    </button>
  );
}

function HistoryRow({
  run,
  head,
  open,
  onToggle,
  onAgain,
  onDeleted,
}: {
  run: HistoryRun;
  head: string | null;
  open: boolean;
  onToggle: () => void;
  onAgain: () => void;
  onDeleted: () => void;
}) {
  const failed = run.state === "failed";
  const duration = run.startedAt && run.endedAt && run.endedAt > run.startedAt ? fmtDuration(run.endedAt - run.startedAt) : null;
  const verified = /\bverified\s*$/i.test(run.headline ?? "");

  const [armed, setArmed] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setArmed(false);
    document.addEventListener("keydown", onEsc);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onEsc);
    };
  }, [armed]);

  const remove = async () => {
    if (!armed) return setArmed(true);
    setRemoving(true);
    try {
      await api.deleteHistoryRun(run.id);
      toast.success("Record deleted");
      onDeleted();
    } catch (e) {
      toast.error("Could not delete the record", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRemoving(false);
      setArmed(false);
    }
  };

  /** Same shape as the thread header's Run again: prefill the Hub composer, then go there. */
  const again = () => {
    setPrefill({ task: run.task ?? "" });
    onAgain();
  };

  return (
    <li className="border-b last:border-b-0">
      {head && (
        <p className="label text-faint bg-muted/30 border-b px-4 py-1.5" aria-hidden>
          {head}
        </p>
      )}
      <div className={cn("group relative transition-colors", !open && "hover:bg-muted/50")}>
        <div className="grid grid-cols-1 items-center gap-2 px-4 py-3 md:grid-cols-[5.5rem_minmax(0,1fr)_auto] md:gap-3">
          {/* The row IS the expand action: a stretched button under the content. */}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`${titleOf(run)} — ${failed ? "failed" : "done"}, show details`}
            className="focus-visible:ring-ring absolute inset-0 cursor-pointer rounded-none focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
          />

          <span className="flex items-center gap-1.5">
            <span className={cn("size-2 shrink-0 rounded-full", failed ? "bg-destructive" : "bg-ok")} aria-hidden />
            <span className={cn("label", failed ? "text-destructive" : "text-ok")}>{failed ? "failed" : "done"}</span>
          </span>

          <span className="min-w-0">
            <span className="text-foreground block truncate text-meta">
              {titleOf(run)}
              {verified && (
                <span className="text-ok ml-2 inline-flex items-center gap-0.5 text-micro" title="The run's result was verified">
                  <Check className="size-3" aria-hidden />
                  verified
                </span>
              )}
            </span>
            <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-micro">
              <span className="stamp" title={shortName(run.box)}>
                {friendlyName(run.box)}
              </span>
              {duration && <span className="stamp">{duration}</span>}
              {run.archivedAt > 0 && <span>archived {fmtAgo(run.archivedAt)}</span>}
            </span>
          </span>

          {/* Actions sit above the stretched button. */}
          <span className="relative flex items-center gap-1.5 md:justify-end">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Run again — new machine, same brief"
                  className="text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100"
                  onClick={again}
                >
                  <RotateCw />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Run again — a new machine, the same brief (you can edit it first)</TooltipContent>
            </Tooltip>
            {armed ? (
              <>
                <Button size="sm" variant="destructive" onClick={() => void remove()} disabled={removing}>
                  <Trash2 />
                  {removing ? "Deleting…" : "Confirm"}
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
                    onClick={() => void remove()}
                    aria-label="Delete this record"
                    className="text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete the record — the run itself already ended</TooltipContent>
              </Tooltip>
            )}
            <ChevronDown className={cn("text-muted-foreground pointer-events-none size-4 transition-transform", open && "rotate-180")} aria-hidden />
          </span>
        </div>

        {open && <RunDetail id={run.id} />}
      </div>
    </li>
  );
}

/** The expanded record: the full digest fetched once, rendered as the run receipt. */
function RunDetail({ id }: { id: number }) {
  const [state, setState] = React.useState<{ digest: RunDigest | null; error?: string } | "loading">("loading");
  React.useEffect(() => {
    setState("loading");
    const ctrl = new AbortController();
    api
      .historyRun(id, ctrl.signal)
      .then((r) => setState({ digest: r.run.digest }))
      .catch((e) => {
        if (!ctrl.signal.aborted) setState({ digest: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
  }, [id]);

  return (
    <div className="border-t px-4 py-3">
      {state === "loading" ? (
        <div className="space-y-2" aria-busy="true">
          <Bar className="h-3 w-[60%]" />
          <Bar className="h-3 w-[40%]" />
        </div>
      ) : state.error ? (
        <p className="text-muted-foreground text-meta">Could not load the record: {state.error}</p>
      ) : state.digest ? (
        <DigestCard digest={state.digest} />
      ) : (
        <p className="text-muted-foreground text-meta">No receipt was kept for this run — only the facts in the row above.</p>
      )}
    </div>
  );
}
