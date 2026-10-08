import * as React from "react";
import { useLocation } from "react-router";
import { Activity as ActivityIcon } from "lucide-react";
import { api, type AuditEventRow, type BoxView, type LedgerRow } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { consolePath } from "@/lib/route";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Swap } from "@/components/ui/swap";
import { ListEmpty, ListSkeleton } from "@/components/ui/list-state";
import { Panel, SettingsPage, SettingsSection } from "@/components/ui/settings";
import { DataTable, StatusDot, stopRow, type Column } from "@/components/ui/data-table";
import { describeEvent, eventKind, type Kind } from "@/components/AuditLog";

const PAGE = 50;

/**
 * One line of the Activity page. Three sources, one shape:
 *  - `audit`: a stored audit row (what you did, as the server recorded it);
 *  - `run`:   a lifecycle edge read off the ledger (started / finished / failed, with the headline);
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
}

type Filter = "all" | Kind | "failed";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "machines", label: "Machines" },
  { value: "code", label: "Code" },
  { value: "account", label: "Account" },
  { value: "failed", label: "Failed" },
];

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
function dayLabel(ms: number) {
  const d = new Date(ms);
  const now = new Date();
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  return same(d, y) ? "Yesterday" : day.format(d);
}

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

/** A ledger run yields up to two rows: its start (when stamped) and its finish. */
function runRows(r: LedgerRow): Row[] {
  const out: Row[] = [];
  if (r.startedAt) out.push({ id: `rs${r.id}`, at: r.startedAt, kind: "machines", verb: "Run started on", box: r.box, detail: r.task ?? undefined, tone: "live", status: "started" });
  const endAt = r.endedAt ?? r.archivedAt;
  const failed = r.state === "failed";
  out.push({
    id: `re${r.id}`,
    at: endAt,
    kind: "machines",
    verb: failed ? "Run failed on" : "Run finished on",
    box: r.box,
    detail: r.headline ?? undefined,
    tone: failed ? "destructive" : "ok",
    status: failed ? "failed" : "finished",
  });
  return out;
}

/** Filter chips: pill row, the active one filled. Counts are of the rows loaded so far. */
function Chips({ value, onChange, counts }: { value: Filter; onChange: (f: Filter) => void; counts: Record<Filter, number> }) {
  return (
    <div role="tablist" aria-label="Filter activity" className="flex flex-wrap gap-1">
      {FILTERS.map((f) => {
        const active = f.value === value;
        return (
          <button
            key={f.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(f.value)}
            className={cn(
              "text-micro inline-flex h-6 items-center gap-1 rounded-full border px-2 transition-colors",
              active ? "bg-foreground text-background border-foreground" : "text-muted-foreground hover:text-foreground hover:border-foreground/40 border-border"
            )}
          >
            {f.label}
            <span className={cn("tabular-nums", active ? "text-background/70" : "text-faint")}>{counts[f.value]}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Activity: everything that happened as you, in one timeline - audit calls, run lifecycle from the
 * ledger, and the state changes this tab witnessed on live machines. Lane chips are the audit log's.
 */
export function Activity({ boxes, onBack }: { boxes: BoxView[]; onBack: () => void }) {
  const { search } = useLocation();
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
    const merged = [...live, ...(audit ?? []).flatMap((e) => auditRow(e) ?? []), ...(runs ?? []).flatMap(runRows)];
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
      <SettingsSection id="timeline" title="Timeline" meta="audit kept 90 days" actions={rows && rows.length > 0 ? <Chips value={filter} onChange={setFilter} counts={counts} /> : undefined}>
        <Panel>
          <Swap state={state}>
            {state === "loading" ? (
              <ListSkeleton rows={6} />
            ) : state === "empty" ? (
              <ListEmpty icon={ActivityIcon} title="Nothing yet" line="Starting a machine, answering it, a run finishing - each lands here with its time." />
            ) : state === "nomatch" ? (
              <ListEmpty icon={ActivityIcon} title={`No ${filter} rows loaded`} line={auditDone ? "There are none in the last 90 days." : "Load more to look further back."} action={!auditDone && oldest ? <Button size="sm" variant="outline" loading={busy} onClick={() => loadAudit({ at: oldest.at, id: oldest.id })}>Show more</Button> : undefined} />
            ) : (
              <DataTable aria-label="Activity" bordered={false} size="sm" rows={visible} columns={columns} rowKey={(r) => r.id} groupOf={(r) => dayLabel(r.at)} search={{ placeholder: "Search activity", text: (r) => `${r.verb} ${r.box ?? ""} ${r.detail ?? ""} ${r.status}` }} />
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
