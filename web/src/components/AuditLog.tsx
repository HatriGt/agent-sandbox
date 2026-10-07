import * as React from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { api, type AuditEventRow } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { consolePath } from "@/lib/route";
import { useLocation } from "react-router";
import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Swap } from "@/components/ui/swap";
import { ListEmpty, ListSkeleton } from "@/components/ui/list-state";
import { Panel, SettingsSection } from "@/components/ui/settings";
import { DataTable, StatusDot, stopRow, type Column } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

const PAGE = 25;

/**
 * The raw audit row (method + path) turned into a human verb. Kept as a small pure mapper so the
 * server stays honest — it serves facts, the console narrates. `session` slots into the sentence
 * where it reads naturally; unknown paths fall back to "METHOD /path" verbatim.
 */
export function describeEvent(e: Pick<AuditEventRow, "method" | "path" | "session" | "action">): { verb: string; session: string | null } {
  const p = e.path.replace(/\/+$/, "");
  const s = e.session;
  // [verb, whether it reads as "<verb> <session>"]
  const table: Record<string, [string, boolean]> = {
    "POST /delegate.json": ["Started a machine", false],
    "POST /teardown.json": ["Destroyed", true],
    "POST /resume.json": ["Sent a message to", true],
    "POST /ask.json": ["Asked the co-pilot about", true],
    "POST /wake.json": ["Woke", true],
    "POST /sleep.json": ["Put to sleep:", true],
    "POST /keep.json": ["Pinned or released", true],
    "POST /rename.json": ["Renamed", true],
    "POST /revert.json": ["Reverted", true],
    "POST /memory.json": ["Resized memory of", true],
    "POST /disk.json": ["Grew the disk of", true],
    "PUT /file.json": ["Wrote a file in", true],
    "POST /pr/merge.json": ["Merged a PR", false],
    "POST /pr/approve.json": ["Approved a PR", false],
    "POST /pr/comment.json": ["Commented on a PR", false],
    "POST /pr/review.json": ["Reviewed a PR", false],
    "POST /pr/state.json": ["Changed a PR's state", false],
    "POST /repos/attach.json": ["Attached a repository to", true],
    "POST /api-keys.json": ["Created an API key", false],
    "DELETE /api-keys.json": ["Revoked an API key", false],
    "DELETE /sessions.json": ["Signed out a device", false],
    "POST /account.json": ["Updated the profile", false],
    "POST /notify.json": ["Changed notification settings", false],
    "POST /accounts.json": ["Connected a GitHub account", false],
    "DELETE /accounts.json": ["Disconnected a GitHub account", false],
    "POST /skills.json": ["Changed a skill", false],
    "POST /mcp-servers.json": ["Changed MCP servers", false],
    "POST /auth/logout": ["Signed out", false],
    "POST /auth/login": ["Signed in", false],
  };
  const key = `${e.method} ${p}`;
  if (key === "POST /git.json") return { verb: e.action ? `Git ${e.action} on` : "Git action on", session: s };
  const hit = table[key];
  if (!hit) return { verb: `${e.method} ${p}`, session: null };
  return { verb: hit[0], session: hit[1] ? s : null };
}

type Kind = "machines" | "code" | "account";
/** Which lane an event belongs to — drives the filter chips and the dot colour. */
export function eventKind(e: Pick<AuditEventRow, "path" | "session">): Kind {
  const p = e.path;
  if (/^\/(pr|git|repos)\b/.test(p)) return "code";
  if (e.session || /^\/(delegate|teardown|resume|ask|wake|sleep|keep|rename|revert|memory|disk|file)\.json/.test(p)) return "machines";
  return "account";
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
function dayKey(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(ms: number) {
  const today = dayKey(Date.now());
  const k = dayKey(ms);
  if (k === today) return "Today";
  if (k === dayKey(Date.now() - 86400_000)) return "Yesterday";
  return day.format(ms);
}

/** Filter chips: pill row, the active one filled. Counts are of the rows loaded so far. */
function Chips({ value, onChange, counts }: { value: Filter; onChange: (f: Filter) => void; counts: Record<Filter, number> }) {
  const still = useReducedMotion();
  const id = React.useId();
  return (
    <div role="radiogroup" aria-label="Show" className="flex flex-wrap items-center gap-1">
      {FILTERS.map((f) => {
        const on = f.value === value;
        const n = counts[f.value];
        if (f.value !== "all" && n === 0 && !on) return null;
        return (
          <button
            key={f.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(f.value)}
            className={cn(
              "relative isolate inline-flex h-6 cursor-pointer items-center gap-1 rounded-full px-2.5 text-micro font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {on && <motion.span layoutId={`${id}-chip`} className="bg-muted absolute inset-0 -z-10 rounded-full" transition={still ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42, mass: 0.7 }} aria-hidden />}
            {f.label}
            <span className={cn("tabular-nums", f.value === "failed" && n > 0 ? "text-destructive" : "text-faint")}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Recent stored audit events for this account — a dense timeline: `HH:MM` stamp · dot · verb. */
export function AuditLog() {
  const [rows, setRows] = React.useState<AuditEventRow[] | null>(null);
  const [done, setDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("all");
  const { search } = useLocation();

  // The cursor is (at, id): `at` is not unique across a burst of requests, so paging on it alone
  // would silently drop every row sharing the boundary timestamp.
  const load = React.useCallback(async (cursor?: { at: string; id: number }) => {
    setBusy(true);
    try {
      const r = await api.audit({ limit: PAGE, before: cursor?.at, beforeId: cursor?.id });
      setRows((prev) => [...(cursor ? (prev ?? []) : []), ...r.events]);
      if (r.events.length < PAGE) setDone(true);
    } catch {
      setRows((prev) => prev ?? []);
      setDone(true);
    } finally {
      setBusy(false);
    }
  }, []);
  React.useEffect(() => void load(), [load]);

  const counts = React.useMemo(() => {
    const c: Record<Filter, number> = { all: 0, machines: 0, code: 0, account: 0, failed: 0 };
    for (const e of rows ?? []) {
      c.all++;
      c[eventKind(e)]++;
      if (e.status >= 400) c.failed++;
    }
    return c;
  }, [rows]);
  const visible = React.useMemo(() => (rows ?? []).filter((e) => (filter === "all" ? true : filter === "failed" ? e.status >= 400 : eventKind(e) === filter)), [rows, filter]);
  const state = rows === null ? "loading" : rows.length === 0 ? "empty" : visible.length === 0 ? "nomatch" : "list";
  const columns: Column<AuditEventRow>[] = [
    {
      id: "at",
      header: "Time",
      width: "w-20",
      sort: (e) => Date.parse(e.at) || null,
      cell: (e) => {
        const at = Date.parse(e.at);
        return (
          <time dateTime={e.at} title={Number.isFinite(at) ? new Date(at).toLocaleString() : e.at} className="stamp text-faint tabular-nums">
            {Number.isFinite(at) ? clock.format(at) : "—"}
          </time>
        );
      },
    },
    {
      id: "event",
      header: "Event",
      primary: true,
      sort: (e) => describeEvent(e).verb,
      cell: (e) => {
        const d = describeEvent(e);
        return (
          <span className={cn("block truncate font-normal", e.status >= 400 && "text-muted-foreground")}>
            {d.verb}
            {d.session && (
              <>
                {" "}
                <a href={`${consolePath({ view: "box", name: d.session })}${search}`} onClick={stopRow} className="stamp text-foreground decoration-line-strong underline underline-offset-4 hover:decoration-current">
                  {d.session}
                </a>
              </>
            )}
          </span>
        );
      },
    },
    {
      id: "kind",
      header: "Status",
      width: "w-28",
      sort: (e) => (e.status >= 400 ? "failed" : eventKind(e)),
      cell: (e) => {
        const kind = eventKind(e);
        return e.status >= 400 ? <StatusDot tone="destructive">failed {e.status}</StatusDot> : <StatusDot tone={kind === "machines" ? "live" : kind === "code" ? "ok" : "muted"}>{kind}</StatusDot>;
      },
    },
    { id: "ago", header: "When", width: "w-24", hideBelow: "sm", align: "end", cell: (e) => <span className="text-faint text-micro tabular-nums">{Number.isFinite(Date.parse(e.at)) ? fmtAgo(Date.parse(e.at) / 1000) : ""}</span> },
  ];

  return (
    <SettingsSection id="audit" title="Recent activity" meta="kept 90 days" purpose="Every state-changing call made as you — from this console, an IDE or a script." actions={rows && rows.length > 0 ? <Chips value={filter} onChange={setFilter} counts={counts} /> : undefined}>
      <Panel>
        <Swap state={state}>
          {state === "loading" ? (
            <ListSkeleton rows={4} />
          ) : state === "empty" ? (
            <ListEmpty icon={ScrollText} title="Nothing yet" line="Starting, answering, destroying — each action lands here with its time." />
          ) : state === "nomatch" ? (
            <ListEmpty icon={ScrollText} title={`No ${filter} events loaded`} line={done ? "There are none in the last 90 days." : "Load more to look further back."} action={!done ? <Button size="sm" variant="outline" loading={busy} onClick={() => rows && load({ at: rows[rows.length - 1].at, id: rows[rows.length - 1].id })}>Show more</Button> : undefined} />
          ) : (
            <DataTable
              aria-label="Recent activity"
              bordered={false}
              size="sm"
              rows={visible}
              columns={columns}
              rowKey={(e) => String(e.id)}
              groupOf={(e) => (Number.isFinite(Date.parse(e.at)) ? dayLabel(Date.parse(e.at)) : null)}
              search={{
                placeholder: "Search activity",
                text: (e) => `${describeEvent(e).verb} ${e.session ?? ""} ${e.method} ${e.path} ${e.status}`,
              }}
            />
          )}
        </Swap>
        {rows !== null && rows.length > 0 && !done && state === "list" && (
          <div className="bg-muted/40 border-t px-3.5 py-2">
            <Button size="sm" variant="ghost" className="text-muted-foreground" loading={busy} onClick={() => load({ at: rows[rows.length - 1].at, id: rows[rows.length - 1].id })}>
              Show more
            </Button>
          </div>
        )}
      </Panel>
    </SettingsSection>
  );
}
