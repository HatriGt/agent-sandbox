import * as React from "react";
import { useLocation } from "react-router";
import { Activity as ActivityIcon } from "lucide-react";
import { api, type AuditEventRow, type BoxView, type LedgerRow } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { consolePath, useGo } from "@/lib/route";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Swap } from "@/components/ui/swap";
import { ListEmpty, ListSkeleton } from "@/components/ui/list-state";
import { Panel, SettingsPage, SettingsSection } from "@/components/ui/settings";
import { DataTable, StatusDot, stopRow, type Column } from "@/components/ui/data-table";
import { ACTIVITY_FILTERS, dayLabel, describeEvent, eventKind, type ActivityFilter as Filter, type Kind } from "@/lib/activity";
import { FilterChip } from "@/components/ui/filter-chip";

const PAGE = 50;

/**
 * One line of the Activity page. Three sources, one shape:
 *  - `audit`: a stored audit row (what you did, as the server recorded it);
 *  - `run`:   a finished ledger run (finished / failed, with the headline) — links to History;
 *  - `live`:  a fleet transition this tab saw while open (asked a question, finished, stalled).
 * Every stamp is a real server stamp - a live row carries the moment the poll showed the change.
 */
interface Row {
  id: string;
  at: number;
  kind: Kind;
  verb: string;
  box: string | null;
  detail?: string;
  tone: "live" | "ok" | "muted" | "destructive" | "attention";
  status: string;
  /** Ledger id: the row links to that run in History instead of repeating its receipt. */
  run?: number;
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

function auditRow(e: AuditEventRow): Row | null {
  const at = Date.parse(e.at);
  if (!Number.isFinite(at)) return null;
  const d = describeEvent(e);
  const kind = eventKind(e);
  const failed = e.status >= 400;
  return {
    id: `a${e.id}`,
    at,
    kind,
    verb: d.verb,
    box: d.session,
    tone: failed ? "destructive" : kind === "machines" ? "live" : kind === "code" ? "ok" : "muted",
    status: failed ? `failed ${e.status}` : kind,
  };
}

/** A finished ledger run, as one row. Its start is already the audit's "Started a machine". */
function runRow(r: LedgerRow): Row {
  const failed = r.state === "failed";
  return {
    id: `re${r.id}`,
    at: r.endedAt ?? r.archivedAt,
    kind: "machines",
    verb: failed ? "Run failed on" : "Run finished on",
    box: r.box,
    detail: r.headline ?? undefined,
    tone: failed ? "destructive" : "ok",
    status: failed ? "failed" : "finished",
    run: r.id,
  };
}

/**
 * Activity: THE timeline — everything that happened as you, in one place: audit calls, each run's
 * finish from the ledger (the row opens that run in History, which owns the receipt), and the state
 * changes this tab witnessed on live machines. The Hub shows a four-line teaser that links here.
 */
export function Activity({ boxes, onBack }: { boxes: BoxView[]; onBack: () => void }) {
  const { search } = useLocation();
  const go = useGo();
  const [audit, setAudit] = React.useState<AuditEventRow[] | null>(null);
  const [runs, setRuns] = React.useState<LedgerRow[] | null>(null);
  const [auditDone, setAuditDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [live, setLive] = React.useState<Row[]>([]);

  const loadAudit = React.useCallback(async (cursor?: { at: string; id: number }) => {
    setBusy(true);
    try {
      const r = await api.audit({ limit: PAGE, before: cursor?.at, beforeId: cursor?.id });
      setAudit((prev) => [...(cursor ? (prev ?? []) : []), ...r.events]);
      if (r.events.length < PAGE) setAuditDone(true);
    } catch {
      setAudit((prev) => prev ?? []);
      setAuditDone(true);
    } finally {
      setBusy(false);
    }
  }, []);
  React.useEffect(() => {
    void loadAudit();
    const ctl = new AbortController();
    api
      .ledger({ limit: PAGE }, ctl.signal)
      .then((r) => setRuns(r.rows))
      .catch(() => setRuns((prev) => prev ?? []));
    return () => ctl.abort();
  }, [loadAudit]);

  // Live edges: compare each poll with the last one. A transition seen is a fact with a stamp (now);
  // a box's first appearance is not a transition, so nothing is invented for it.
  const prevRef = React.useRef<Map<string, BoxView> | null>(null);
  React.useEffect(() => {
    const prev = prevRef.current;
    const next = new Map(boxes.map((b) => [b.name, b]));
    prevRef.current = next;
    if (!prev) return;
    const now = Date.now();
    const added: Row[] = [];
    for (const b of boxes) {
      const p = prev.get(b.name);
      if (!p) continue;
      if (b.runState === "waiting" && p.runState !== "waiting") {
        added.push({ id: `l${now}-${b.name}-ask`, at: now, kind: "machines", verb: "Asked a question on", box: b.name, detail: b.question, tone: "attention", status: "waiting" });
      } else if (b.runState === "done" && p.runState === "running") {
        const failed = (b.exitCode ?? 0) !== 0;
        added.push({ id: `l${now}-${b.name}-fin`, at: now, kind: "machines", verb: failed ? "Run failed on" : "Run finished on", box: b.name, detail: b.title ?? b.task, tone: failed ? "destructive" : "ok", status: failed ? "failed" : "finished" });
      } else if (b.runState === "running" && p.runState !== "running") {
        added.push({ id: `l${now}-${b.name}-run`, at: now, kind: "machines", verb: "Run started on", box: b.name, detail: b.title ?? b.task, tone: "live", status: "started" });
      }
      if (b.stalled && !p.stalled) {
        added.push({ id: `l${now}-${b.name}-stall`, at: now, kind: "machines", verb: "No output for a while on", box: b.name, tone: "attention", status: "stalled" });
      }
    }
    if (added.length) setLive((rows) => [...added, ...rows]);
  }, [boxes]);

  const rows = React.useMemo<Row[] | null>(() => {
    if (audit === null && runs === null) return null;
    const merged = [...live, ...(audit ?? []).flatMap((e) => auditRow(e) ?? []), ...(runs ?? []).map(runRow)];
    merged.sort((a, b) => b.at - a.at);
    return merged;
  }, [audit, runs, live]);

  const counts = React.useMemo(() => {
    const c: Record<Filter, number> = { all: 0, machines: 0, code: 0, account: 0, failed: 0 };
    for (const r of rows ?? []) {
      c.all++;
      c[r.kind]++;
      if (r.tone === "destructive") c.failed++;
    }
    return c;
  }, [rows]);
  const visible = React.useMemo(() => (rows ?? []).filter((r) => (filter === "all" ? true : filter === "failed" ? r.tone === "destructive" : r.kind === filter)), [rows, filter]);
  const state = rows === null ? "loading" : rows.length === 0 ? "empty" : visible.length === 0 ? "nomatch" : "list";

  const columns: Column<Row>[] = [
    {
      id: "at",
      header: "Time",
      width: "w-20",
      sort: (r) => r.at,
      cell: (r) => (
        <time dateTime={new Date(r.at).toISOString()} title={new Date(r.at).toLocaleString()} className="stamp text-faint tabular-nums">
          {clock.format(r.at)}
        </time>
      ),
    },
    {
      id: "event",
      header: "Event",
      primary: true,
      sort: (r) => r.verb,
      cell: (r) => (
        <span className="block min-w-0">
          <span className={cn("block truncate font-normal", r.tone === "destructive" && "text-muted-foreground")}>
            {r.verb}
            {r.box && (
              <>
                {" "}
                <a href={`${consolePath({ view: "box", name: r.box })}${search}`} onClick={stopRow} className="stamp text-foreground decoration-line-strong underline underline-offset-4 hover:decoration-current">
                  {r.box}
                </a>
              </>
            )}
          </span>
          {r.detail && <span className="text-muted-foreground text-micro block truncate">{r.detail}</span>}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      width: "w-28",
      sort: (r) => r.status,
      cell: (r) => <StatusDot tone={r.tone}>{r.status}</StatusDot>,
    },
    { id: "ago", header: "When", width: "w-24", hideBelow: "sm", align: "end", cell: (r) => <span className="text-faint text-micro tabular-nums">{fmtAgo(r.at / 1000)}</span> },
  ];

  const oldest = audit && audit.length > 0 ? audit[audit.length - 1] : null;
  return (
    <SettingsPage title="Activity" purpose="What happened as you: your actions, each run's start and finish, and what live machines did while this tab was open." back={{ label: "Back", onClick: onBack, mobileOnly: true }}>
      <SettingsSection id="timeline" title="Timeline" meta="audit kept 90 days" actions={rows && rows.length > 0 ? <div role="radiogroup" aria-label="Filter activity" className="flex flex-wrap gap-1">
              {ACTIVITY_FILTERS.map((f) => (
                <FilterChip key={f.value} group="activity" active={filter === f.value} onClick={() => setFilter(f.value)} label={f.label} count={counts[f.value]} tone={f.value === "failed" ? "destructive" : undefined} />
              ))}
            </div> : undefined}>
        <Panel>
          <Swap state={state}>
            {state === "loading" ? (
              <ListSkeleton rows={6} />
            ) : state === "empty" ? (
              <ListEmpty icon={ActivityIcon} title="Nothing yet" line="Starting a machine, answering it, a run finishing - each lands here with its time." />
            ) : state === "nomatch" ? (
              <ListEmpty icon={ActivityIcon} title={`No ${filter} rows loaded`} line={auditDone ? "There are none in the last 90 days." : "Load more to look further back."} action={!auditDone && oldest ? <Button size="sm" variant="outline" loading={busy} onClick={() => loadAudit({ at: oldest.at, id: oldest.id })}>Show more</Button> : undefined} />
            ) : (
              <DataTable aria-label="Activity" bordered={false} size="sm" rows={visible} onRowClick={(r) => r.run != null && go({ view: "history" })} rowLabel={(r) => (r.run != null ? `${r.verb} ${r.box ?? ""} — open in History` : `${r.verb} ${r.box ?? ""}`)} columns={columns} rowKey={(r) => r.id} groupOf={(r) => dayLabel(r.at)} search={{ placeholder: "Search activity", text: (r) => `${r.verb} ${r.box ?? ""} ${r.detail ?? ""} ${r.status}` }} />
            )}
          </Swap>
          {state === "list" && !auditDone && oldest && (
            <div className="bg-muted/40 border-t px-3.5 py-2">
              <Button size="sm" variant="ghost" className="text-muted-foreground" loading={busy} onClick={() => loadAudit({ at: oldest.at, id: oldest.id })}>
                Show more
              </Button>
            </div>
          )}
        </Panel>
      </SettingsSection>
    </SettingsPage>
  );
}
