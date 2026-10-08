import * as React from "react";
import { ArrowLeft, Check, RotateCw, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { toast } from "sonner";
import { api, type Automation, type BoxView, type LedgerRow as HistoryRun, type LedgerQuery, type LedgerTotals, type RunDigest, type RunOutcome } from "@/lib/api";
import { ActivityHeatmap, type ActivityRun } from "@/components/ui/activity-heatmap";
import { NumberTicker } from "@/components/ui/number-ticker";
import { fmtAgo, friendlyName, shortName, threadTitle } from "@/lib/format";
import { displayState, fmtDuration } from "@/lib/lifecycle";
import { setPrefill } from "@/lib/draft";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Swap } from "@/components/ui/swap";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { DataTable, MetaLine, StatusDot, type Column } from "@/components/ui/data-table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FilterChip } from "@/components/ui/filter-chip";
import { DigestCard } from "@/components/thread/DigestCard";
import { OutcomeCard, fmtTokens, fmtUsd, outcomeFacts } from "@/components/thread/OutcomeCard";
import { ReviewAllPane } from "@/components/thread/ReviewAll";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/**
 * History: the record of what your agents did. Boxes still mid-run lead the table (from the fleet
 * poll the app already runs); everything below them is FINISHED and its machine may be long gone —
 * the archive is fetched once on mount (plus "Show more"), no polling of its own. A row opens the
 * run's receipt (the digest) in a side sheet, and offers exactly two actions: run the same brief
 * again on a new machine, or delete the record.
 */

const PAGE = 50;

type Filter = "all" | "done" | "failed";

/** "Today" / "Yesterday" / "Mon 1 Sep" — the archive's day headers. Takes epoch MILLISECONDS. */
function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

export function titleOf(r: HistoryRun): string {
  const t = (r.task ?? "").trim();
  if (t) {
    const firstLine = t.split("\n")[0];
    return firstLine.length > 90 ? `${firstLine.slice(0, 89)}…` : firstLine;
  }
  return (r.headline ?? "").trim() || "Untitled run";
}

/** Server-side ledger filters. State stays client-side so its chips can count from the totals. */
interface LedgerFilters {
  startedBy: string; // "" | manual | mcp | after | trigger | unknown | "t:<triggerId>"
  agent: string;
  verified: string; // "" | yes | no | unchecked
}
const NO_FILTERS: LedgerFilters = { startedBy: "", agent: "", verified: "" };

function toQuery(f: LedgerFilters): LedgerQuery {
  const q: LedgerQuery = {};
  if (f.startedBy.startsWith("t:")) (q.startedBy = "trigger"), (q.trigger = f.startedBy.slice(2));
  else if (f.startedBy) q.startedBy = f.startedBy;
  if (f.agent) q.agent = f.agent;
  if (f.verified) q.verified = f.verified;
  return q;
}

/** The ledger's headline numbers. Every figure is counted from real records; nothing is estimated. */
function LedgerTotalsStrip({ t }: { t: LedgerTotals | null }) {
  const cells: Array<{ label: string; value: React.ReactNode; note?: string }> = [];
  if (t) {
    cells.push({ label: "Runs", value: <NumberTicker value={t.runs} />, note: t.failed ? `${t.failed} failed` : undefined });
    cells.push(
      t.checked
        ? { label: "Verified", value: <NumberTicker value={Math.round((t.passed / t.checked) * 100)} format={(n) => `${Math.round(n)}%`} />, note: `${t.passed} of ${t.checked} checked` }
        : { label: "Verified", value: <span className="text-faint">—</span>, note: "no run had a check" }
    );
    cells.push(
      t.withUsage
        ? { label: "Tokens", value: <NumberTicker value={t.inputTokens + t.outputTokens} format={(n) => fmtTokens(Math.round(n))} />, note: t.withUsage < t.runs ? `from ${t.withUsage} of ${t.runs} runs` : undefined }
        : { label: "Tokens", value: <span className="text-faint">—</span>, note: "not reported" }
    );
    if (t.costUsd !== null) cells.push({ label: "Cost", value: <NumberTicker value={Math.round(t.costUsd * 100)} format={(c) => `$${(c / 100).toFixed(2)}`} />, note: t.withCost < t.runs ? `from ${t.withCost} priced runs` : undefined });
  }
  return (
    <div className={cn("mb-4 grid gap-px overflow-hidden rounded-xl border bg-border", t && t.costUsd !== null ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")} aria-label="Ledger totals">
      {(t ? cells : [0, 1, 2].map(() => null)).map((c, i) => (
        <div key={i} className="bg-card px-4 py-3">
          {c ? (
            <>
              <p className="label text-muted-foreground">{c.label}</p>
              <p className="text-foreground tabular mt-0.5 text-lead font-medium">{c.value}</p>
              {c.note && <p className="text-faint text-micro">{c.note}</p>}
            </>
          ) : (
            <>
              <Bar className="h-2.5 w-12" />
              <Bar className="mt-2 h-4 w-16" />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-meta", value ? "border-foreground/30 text-foreground" : "bg-card text-muted-foreground")}>
      <span className="text-faint">{label}</span>
      <select aria-label={label} className="cursor-pointer bg-transparent font-medium outline-none" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function History({ onBack, onAgain, boxes, onOpen }: { onBack: () => void; onAgain: () => void; boxes: BoxView[]; onOpen: (box: string) => void }) {
  const [rows, setRows] = React.useState<HistoryRun[] | null>(null);
  const [totals, setTotals] = React.useState<LedgerTotals | null>(null);
  const [lf, setLf] = React.useState<LedgerFilters>(NO_FILTERS);
  const [automations, setAutomations] = React.useState<Automation[]>([]);
  const [agents, setAgents] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [opened, setOpened] = React.useState<number | null>(null);
  const [more, setMore] = React.useState(false); // another page may exist
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    setTotals(null);
    api
      .ledger({ ...toQuery(lf), limit: PAGE }, ctrl.signal)
      .then((r) => {
        setRows(r.rows);
        setTotals(r.totals);
        setMore(r.rows.length === PAGE);
        // Agent options accumulate from what the ledger has actually shown — no hard-coded list.
        setAgents((prev) => Array.from(new Set([...prev, ...r.rows.map((x) => x.agent).filter((a): a is string => !!a)])).sort());
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, [attempt, lf]);

  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .triggers(ctrl.signal)
      .then((r) => setAutomations(r.triggers))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const showMore = async () => {
    if (!rows?.length) return;
    setLoadingMore(true);
    try {
      const r = await api.ledger({ ...toQuery(lf), limit: PAGE, before: rows[rows.length - 1].id });
      setRows((prev) => [...(prev ?? []), ...r.rows]);
      setMore(r.rows.length === PAGE);
    } catch (e) {
      toast.error("Could not load more history", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoadingMore(false);
    }
  };

  // Chip counts come from the ledger totals (the whole filtered set, not just the loaded page).
  const counts = { all: totals?.runs ?? (rows ?? []).length, done: totals ? totals.runs - totals.failed : 0, failed: totals?.failed ?? 0 };
  const filtered = lf.startedBy !== "" || lf.agent !== "" || lf.verified !== "";

  const visible = (rows ?? []).filter((r) => filter === "all" || (filter === "failed" ? r.state === "failed" : r.state !== "failed"));
  // Boxes mid-run lead the table (newest activity first) under their own group; they fall out as they archive.
  const liveRows: Row[] = filter === "failed" || filtered ? [] : boxes.filter((b) => b.runState === "running" && displayState(b) === "running").sort((a, b) => (b.lastOutputAt ?? 0) - (a.lastOutputAt ?? 0)).map((box) => ({ kind: "live", box }));
  const tableRows: Row[] = [...liveRows, ...visible.map((run): Row => ({ kind: "archived", run }))];
  const openRun = opened === null ? null : ((rows ?? []).find((x) => x.id === opened) ?? null);
  const removeRow = (id: number) => {
    setRows((prevRows) => (prevRows ?? []).filter((x) => x.id !== id));
    setOpened((cur) => (cur === id ? null : cur));
  };

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-[900px] px-5 py-7 md:px-8 md:py-9">
        <header className="mb-6">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
            <ArrowLeft className="size-4" />
            Machines
          </Button>
          <h1 className="text-foreground font-serif text-h1 font-normal tracking-[-0.01em]">History</h1>
          <p className="text-muted-foreground mt-1 text-meta">Finished runs, kept after their machines are gone.</p>
        </header>

        <ActivityPanel />

        {/* A failed load shows its error below; a shimmer that never resolves above it would be a lie. */}
        {!error && <LedgerTotalsStrip t={totals} />}

        <div className="mb-3 flex flex-wrap items-center gap-1">
          <FilterSelect
            label="Started by"
            value={lf.startedBy}
            onChange={(v) => setLf((f) => ({ ...f, startedBy: v }))}
            options={[
              { value: "", label: "anyone" },
              { value: "manual", label: "dashboard" },
              { value: "mcp", label: "MCP client" },
              { value: "trigger", label: "any automation" },
              ...automations.map((a) => ({ value: `t:${a.id}`, label: a.name })),
              { value: "after", label: "handoff" },
              { value: "unknown", label: "unrecorded" },
            ]}
          />
          <FilterSelect label="Agent" value={lf.agent} onChange={(v) => setLf((f) => ({ ...f, agent: v }))} options={[{ value: "", label: "any" }, ...Array.from(new Set([...agents, ...(lf.agent ? [lf.agent] : [])])).map((a) => ({ value: a, label: a }))]} />
          <FilterSelect
            label="Verified"
            value={lf.verified}
            onChange={(v) => setLf((f) => ({ ...f, verified: v }))}
            options={[
              { value: "", label: "any" },
              { value: "yes", label: "passed" },
              { value: "no", label: "failed check" },
              { value: "unchecked", label: "not checked" },
            ]}
          />
          {filtered && (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setLf(NO_FILTERS)}>
              Clear
            </Button>
          )}
        </div>

        <div role="radiogroup" aria-label="Filter runs" className="mb-3 flex flex-wrap items-center gap-1">
          <FilterChip group="history" active={filter === "all"} onClick={() => setFilter("all")} label="All" count={counts.all} />
          <FilterChip group="history" active={filter === "done"} onClick={() => setFilter("done")} label="Done" count={counts.done} tone="ok" />
          <FilterChip group="history" active={filter === "failed"} onClick={() => setFilter("failed")} label="Failed" count={counts.failed} tone="destructive" />
        </div>

        <Swap state={error ? "error" : rows === null ? "loading" : !rows.length && !liveRows.length ? "empty" : !tableRows.length ? `none-${filter}` : "list"}>
          {error ? (
            <div className="border-destructive/30 bg-destructive/5 rounded-xl border border-dashed py-12 text-center" role="alert">
              <p className="text-destructive text-lead font-medium">Could not load history</p>
              <p className="text-muted-foreground mt-1 text-meta">{error}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
                <RotateCw />
                Retry
              </Button>
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
          ) : !rows.length && filtered ? (
            <div className="rounded-xl border border-dashed py-12 text-center">
              <p className="text-foreground text-lead font-medium">Nothing matches</p>
              <p className="text-muted-foreground mt-1 text-meta">No finished run fits these filters.</p>
              <Button size="sm" variant="ghost" className="text-live mt-2" onClick={() => setLf(NO_FILTERS)}>
                Clear filters
              </Button>
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
              <DataTable
                aria-label="History"
                rows={tableRows}
                columns={HISTORY_COLUMNS}
                rowKey={rowKey}
                onRowClick={(x) => (x.kind === "live" ? onOpen(x.box.name) : setOpened(x.run.id))}
                rowLabel={(x) => (x.kind === "live" ? `${threadTitle(x.box)} — running, open the thread` : `${titleOf(x.run)} — ${x.run.state === "failed" ? "failed" : "done"}, show details`)}
                rowProps={(x) => ({ selected: x.kind === "archived" && opened === x.run.id })}
                groupOf={(x) => { if (x.kind === "live") return "Running now"; const t = x.run.archivedAt || x.run.endedAt; return t ? dayLabel(t) : null; }}
                minWidth="min-w-[40rem]"
                search={{ placeholder: "Search runs", text: (x) => (x.kind === "live" ? `${threadTitle(x.box)} ${x.box.name} ${friendlyName(x.box.name)} running` : `#${x.run.id} ${titleOf(x.run)} ${x.run.headline ?? ""} ${x.run.box} ${friendlyName(x.run.box)} ${x.run.agent ?? ""} ${x.run.outcome?.header.label ?? ""}`) }}
                actions={(x) => (x.kind === "archived" ? <HistoryActions run={x.run} onAgain={onAgain} onDeleted={() => removeRow(x.run.id)} /> : null)}
              />
              {more && (
                <div className="mt-3 flex justify-center">
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void showMore()} loading={loadingMore}>
                    Show more
                  </Button>
                </div>
              )}
            </>
          )}
        </Swap>
        <Sheet open={!!openRun} onOpenChange={(o) => !o && setOpened(null)}>
          {openRun && (
            <SheetContent title={titleOf(openRun)} description={`${openRun.state === "failed" ? "Failed" : "Done"} · ${friendlyName(openRun.box)}`} className="w-[min(44rem,calc(100vw-2rem))]">
              <div className="mb-3 flex justify-end">
                <HistoryActions run={openRun} onAgain={onAgain} onDeleted={() => removeRow(openRun.id)} />
              </div>
              <RunDetail id={openRun.id} outcome={openRun.outcome ?? null} />
            </SheetContent>
          )}
        </Sheet>
      </div>
    </div>
  );
}

export function runDuration(run: HistoryRun): number | null {
  // Archive stamps are epoch ms (see HistoryRun); fmtDuration and fmtAgo both speak seconds.
  return run.startedAt && run.endedAt && run.endedAt > run.startedAt ? Math.round((run.endedAt - run.startedAt) / 1000) : null;
}

export function tokensOf(r: HistoryRun): number | null {
  return r.inputTokens != null || r.outputTokens != null ? (r.inputTokens ?? 0) + (r.outputTokens ?? 0) : null;
}

/** A row is an archived record, or a box still running — the live rows lead so History reads as "every run". */
type Row = { kind: "live"; box: BoxView } | { kind: "archived"; run: HistoryRun };
const rowKey = (x: Row) => (x.kind === "live" ? `live:${x.box.name}` : String(x.run.id));

const HISTORY_COLUMNS: Column<Row>[] = [
  {
    id: "state",
    header: "Status",
    width: "w-24",
    sort: (x) => (x.kind === "live" ? "running" : x.run.state),
    cell: (x) =>
      x.kind === "live" ? (
        <StatusDot tone="live" pulse>running</StatusDot>
      ) : x.run.state === "failed" ? (
        <StatusDot tone="destructive">failed</StatusDot>
      ) : (
        <StatusDot tone="ok">done</StatusDot>
      ),
  },
  {
    id: "title",
    header: "Run",
    primary: true,
    sort: (x) => (x.kind === "live" ? threadTitle(x.box) : titleOf(x.run)),
    cell: (x) => {
      if (x.kind === "live") {
        const b = x.box;
        return (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{threadTitle(b)}</span>
            <MetaLine className="font-normal" parts={[b.workflow ? <span className="stamp" title={b.workflow.line}>{b.workflow.name} · step {b.workflow.step}/{b.workflow.total}</span> : null, b.lastOutputAt ? <span className={b.stalled ? "text-destructive" : "text-faint"}>last action {fmtAgo(b.lastOutputAt)}</span> : null]} />
          </span>
        );
      }
      const r = x.run;
      const verified = /\bverified\s*$/i.test(r.headline ?? "");
      const facts = r.outcome ? outcomeFacts(r.outcome) : [];
      return (
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="stamp text-faint shrink-0" title="Run number">#{r.id}</span>
            <span className="truncate">{titleOf(r)}</span>
            {verified && (
              <span className="bg-ok/10 text-ok inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-micro font-medium" title="The run's result was verified">
                <Check className="size-3" aria-hidden />
                verified
              </span>
            )}
          </span>
          <MetaLine
            className="font-normal"
            parts={[
              r.outcome?.header.label ? <span title="Why it started">{r.outcome.header.label}</span> : null,
              facts.length ? <span className="stamp" title={facts.join(" · ")}>{facts.join(" · ")}</span> : null,
              r.headline && r.task && r.headline.trim() !== titleOf(r) ? <span className="text-faint" title={r.headline}>{r.headline.replace(/\s*verified\s*$/i, "")}</span> : null,
            ]}
          />
        </span>
      );
    },
  },
  {
    id: "box",
    header: "Machine",
    width: "w-36",
    hideBelow: "md",
    sort: (x) => friendlyName(x.kind === "live" ? x.box.name : x.run.box),
    cell: (x) => {
      const name = x.kind === "live" ? x.box.name : x.run.box;
      return (
        <span className="stamp text-muted-foreground block truncate" title={shortName(name)}>
          {friendlyName(name)}
        </span>
      );
    },
  },
  {
    id: "duration",
    header: "Duration",
    width: "w-24",
    hideBelow: "sm",
    align: "end",
    sort: (x) => (x.kind === "live" ? null : runDuration(x.run)),
    cell: (x) => {
      if (x.kind === "live") return <span className="stamp text-live tabular-nums">{x.box.uptime ? `up ${x.box.uptime}` : "running"}</span>;
      const d = runDuration(x.run);
      return <span className="stamp text-muted-foreground tabular-nums">{d != null ? fmtDuration(d) : "—"}</span>;
    },
  },
  {
    id: "tokens",
    header: "Tokens",
    width: "w-24",
    hideBelow: "sm",
    align: "end",
    sort: (x) => (x.kind === "live" ? null : tokensOf(x.run)),
    cell: (x) => {
      if (x.kind === "live") return <span className="text-faint text-micro">—</span>;
      const t = tokensOf(x.run);
      const usd = x.run.costUsd;
      return (
        <span className="flex flex-col items-end">
          <span className={cn("tabular-nums text-micro", t != null ? "text-muted-foreground" : "text-faint")} title={t != null ? `${(x.run.inputTokens ?? 0).toLocaleString()} in · ${(x.run.outputTokens ?? 0).toLocaleString()} out` : "not reported"}>
            {t != null ? fmtTokens(t) : "—"}
          </span>
          {usd != null && <span className="text-faint stamp tabular-nums" title="Reported by the agent — never an estimate">{fmtUsd(usd)}</span>}
        </span>
      );
    },
  },
  {
    id: "archived",
    header: "Archived",
    width: "w-28",
    hideBelow: "sm",
    align: "end",
    sort: (x) => (x.kind === "live" ? null : x.run.archivedAt || x.run.endedAt || null),
    cell: (x) => <span className="text-muted-foreground text-micro tabular-nums">{x.kind === "live" ? "" : x.run.archivedAt > 0 ? fmtAgo(Math.round(x.run.archivedAt / 1000)) : "—"}</span>,
  },
];

/** Run again (prefill the Hub composer, then go there — same as the thread header) and delete. */
function HistoryActions({ run, onAgain, onDeleted }: { run: HistoryRun; onAgain: () => void; onDeleted: () => void }) {
  const remove = async () => {
    try {
      await api.deleteHistoryRun(run.id);
      toast.success("Record deleted");
      onDeleted();
    } catch (e) {
      toast.error("Could not delete the record", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <span className="inline-flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Run again — new machine, same brief"
            className="text-muted-foreground"
            onClick={() => {
              setPrefill({ task: run.task ?? "" });
              onAgain();
            }}
          >
            <RotateCw />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Run again — a new machine, the same brief (you can edit it first)</TooltipContent>
      </Tooltip>
      <ArmButton size="icon-sm" variant="ghost" icon={<Trash2 />} label="Delete this record" armedLabel="Delete?" onConfirm={remove} className="text-muted-foreground" />
    </span>
  );
}

/** The opened record: the full digest fetched once, rendered as the run receipt. */
function RunDetail({ id, outcome }: { id: number; outcome: RunOutcome | null }) {
  const [state, setState] = React.useState<{ digest: RunDigest | null; diffText?: string; error?: string } | "loading">("loading");
  const [review, setReview] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    setState("loading");
    setReview(false);
    const ctrl = new AbortController();
    api
      .historyRun(id, ctrl.signal)
      .then((r) => setState({ digest: r.run.digest, diffText: r.run.diffText }))
      .catch((e) => {
        if (!ctrl.signal.aborted) setState({ digest: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
  }, [id, attempt]);

  const still = useReducedMotion();
  return (
    <div>
      <Swap state={state === "loading" ? "loading" : state.error ? "error" : state.digest ? "digest" : "none"}>
        {state === "loading" ? (
          // Shaped like the DigestCard it becomes: a raised card with the status line, so the swap
          // is a crossfade in place rather than a two-line stub growing into a card.
          <div className="bg-card raised rounded-xl px-4 py-3" aria-busy="true">
            <div className="flex items-center gap-2.5">
              <Bar className="size-2 rounded-full" />
              <Bar className="h-2.5 w-8" />
              <Bar className="h-3 flex-1 max-w-[60%]" />
              <Bar className="h-2.5 w-10" />
            </div>
            <Bar className="mt-2.5 ml-[18px] h-2.5 w-[40%]" />
          </div>
        ) : state.error ? (
          <div className="border-destructive/30 bg-destructive/5 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2" role="alert">
            <p className="text-destructive text-meta">Could not load the record: {state.error}</p>
            <Button size="xs" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              <RotateCw />
              Retry
            </Button>
          </div>
        ) : state.digest ? (
          <>
            {outcome && <OutcomeCard outcome={outcome} className="mb-3" />}
            <DigestCard digest={state.digest} />
            {state.diffText && (
              <div className="mt-3">
                {review ? (
                  <motion.div initial={still ? { opacity: 0 } : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: still ? 0.1 : 0.2, ease: [0.22, 1, 0.36, 1] }}>
                    <ReviewAllPane archivedDiff={state.diffText} onClose={() => setReview(false)} />
                  </motion.div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setReview(true)}>
                    Review changes
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-muted-foreground text-meta">No receipt was kept for this run — only the facts in the row above.</p>
        )}
      </Swap>
    </div>
  );
}

/**
 * Activity over the archive's retention window (the controller prunes records past 90 days, so the
 * grid stops at 13 weeks rather than drawing empty weeks it cannot know about). Fetched once; its own
 * request so the heatmap is complete even when the list below is only one page deep.
 */
const ACTIVITY_WEEKS = 13;
function ActivityPanel() {
  const [runs, setRuns] = React.useState<ActivityRun[] | null>(null);
  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .historyActivity(Date.now() - ACTIVITY_WEEKS * 7 * 24 * 60 * 60 * 1000, ctrl.signal)
      .then((r) => setRuns(r.runs))
      .catch(() => {
        if (!ctrl.signal.aborted) setRuns([]);
      });
    return () => ctrl.abort();
  }, []);
  if (!runs?.length) return null; // nothing to draw yet — the empty state below says it better
  const failed = runs.filter((r) => r.failed).length;
  return (
    <section aria-label="Run activity" className="enter bg-card shadow-e1 mb-6 rounded-xl border px-4 py-3.5">
      <div className="mb-3 flex items-baseline gap-4">
        <span className="label text-muted-foreground">Activity</span>
        <span className="text-faint text-micro">
          <NumberTicker value={runs.length} className="text-foreground font-medium" /> {runs.length === 1 ? "run" : "runs"} ·{" "}
          <NumberTicker value={runs.length - failed} /> done · <NumberTicker value={failed} /> failed
        </span>
      </div>
      <ActivityHeatmap runs={runs} weeks={ACTIVITY_WEEKS} />
    </section>
  );
}
