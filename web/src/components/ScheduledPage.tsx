import * as React from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Check, Repeat, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { api, type Automation, type ScheduleStatus } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { fmtAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fmtNext } from "@/components/thread/SchedulePill";
import { ArmButton } from "@/components/ui/arm-button";
import { Collapse } from "@/components/ui/collapse";
import { DataTable, StatusDot, type Column } from "@/components/ui/data-table";

/**
 * Scheduled: what you asked for in a chat — "merge the PR at 2pm", "check CI again in an hour".
 * Usually one-time; one plain table with every column and actions per row. Standing rules made
 * from the menu (or that you asked an agent to set up) live on the Automations tab instead.
 */

type Filter = "upcoming" | "done" | "all";

const STATUS: Record<ScheduleStatus, { label: string; tone: React.ComponentProps<typeof StatusDot>["tone"] }> = {
  "needs-ok": { label: "Pending approval", tone: "attention" },
  waiting: { label: "Waiting", tone: "muted" },
  running: { label: "Running", tone: "live" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Failed", tone: "destructive" },
  paused: { label: "Paused", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

const UPCOMING = new Set<ScheduleStatus>(["needs-ok", "waiting", "running", "paused"]);

function exact(at: number): string {
  return new Date(at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function ScheduledPage({ onOpenBox, onAutomations }: { onOpenBox: (box: string) => void; onAutomations: () => void }) {
  const { data, error, refresh } = useCached("triggers", (signal) => api.triggers(signal));
  const [filter, setFilter] = React.useState<Filter>("upcoming");
  const [busy, setBusy] = React.useState<string | null>(null);
  const all = (data?.triggers ?? []).filter((t) => t.scope === "scheduled").sort((a, b) => (a.nextFire ?? Infinity) - (b.nextFire ?? Infinity) || b.createdAt - a.createdAt);
  const rows = all.filter((t) => (filter === "all" ? true : filter === "upcoming" ? UPCOMING.has(t.status) : !UPCOMING.has(t.status)));
  const now = Date.now();
  const live = all.some((t) => t.status === "running" || (t.nextFire !== null && t.nextFire - now < 5 * 60_000));
  // Keep a run that is about to fire (or running) moving on screen without a reload.
  React.useEffect(() => {
    const id = window.setInterval(() => void refresh(), live ? 10_000 : 60_000);
    return () => window.clearInterval(id);
  }, [live, refresh]);

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(ok);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const showRepo = rows.some((t) => t.repos?.length);
  const counts = { upcoming: all.filter((t) => UPCOMING.has(t.status)).length, done: all.filter((t) => !UPCOMING.has(t.status)).length, all: all.length };
  const link = (box: string, label: string) => (
    <button type="button" onClick={() => onOpenBox(box)} className="text-foreground inline-flex max-w-full cursor-pointer items-center gap-0.5 underline-offset-2 hover:underline">
      <span className="truncate">{label}</span>
      <ArrowUpRight className="size-3 shrink-0" />
    </button>
  );
  const columns: Column<Automation>[] = [
    {
      id: "task",
      header: "Task",
      cell: (t) => (
        <>
          <p className="text-foreground truncate font-medium" title={t.name}>
            {t.name}
          </p>
          {t.taskTemplate !== t.name && (
            <p className="text-muted-foreground truncate text-micro" title={t.taskTemplate}>
              {t.taskTemplate.startsWith(t.name) ? t.taskTemplate.slice(t.name.length).replace(/^[.!?\s]+/, "") : t.taskTemplate}
            </p>
          )}
        </>
      ),
    },
    {
      id: "chat",
      header: "Chat",
      width: "w-[11rem]",
      cell: (t) => (t.sourceBox ? link(t.sourceBox, t.sourceTitle || t.sourceBox) : <span className="text-faint">—</span>),
    },
    ...(showRepo
      ? [
          {
            id: "repo",
            header: "Repo",
            width: "w-[9rem]",
            cell: (t: Automation) => <span className="block truncate font-mono text-micro">{t.repos?.join(", ") || <span className="text-faint font-sans">—</span>}</span>,
          },
        ]
      : []),
    {
      id: "when",
      header: "When",
      width: "w-[11rem]",
      className: "tabular-nums",
      cell: (t) => {
        const once = t.spec.at != null;
        return (
          <>
            <span className="text-foreground inline-flex items-center gap-1" title={`${once ? new Date(t.spec.at!).toUTCString() : "Repeats " + t.when} · created ${fmtAgo(t.createdAt / 1000)}`}>
              {!once && <Repeat className="size-3" aria-label="Repeats" />}
              {once ? exact(t.spec.at!) : t.when}
            </span>
            {t.nextFire !== null && t.status !== "needs-ok" && <span className="text-muted-foreground block text-micro">{fmtNext(t.nextFire, now)}</span>}
          </>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      width: "w-[9rem]",
      cell: (t) => {
        const st = STATUS[t.status];
        return (
          <StatusDot tone={st.tone} pulse={t.status === "running"}>
            {st.label}
          </StatusDot>
        );
      },
    },
    {
      id: "result",
      header: "Result",
      width: "w-[12rem]",
      cell: (t) => {
        const r = t.lastResult;
        return r ? (
          <div className="min-w-0">
            {r.box ? link(r.box, r.finished?.headline || "Open run") : <span className="text-muted-foreground block truncate">{r.reason || r.outcome}</span>}
            <span className="text-faint block text-micro tabular-nums">{fmtAgo(r.at / 1000)}</span>
          </div>
        ) : (
          <span className="text-faint">Not yet</span>
        );
      },
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "w-[7.5rem]",
      align: "end",
      cell: (t) => <Actions t={t} busy={busy === t.id} act={act} onAutomations={onAutomations} />,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Filter" className="bg-muted inline-flex rounded-full p-0.5">
          {(["upcoming", "done", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
              className={cn("relative cursor-pointer rounded-full px-3 py-1 text-micro font-medium capitalize transition-colors", filter === f ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {filter === f && (
                <motion.span
                  layoutId="sched-filter"
                  className="bg-background shadow-e1 absolute inset-0 rounded-full"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  aria-hidden
                />
              )}
              <span className="relative">
                {f} <span className="text-faint tabular-nums">{counts[f]}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="text-faint ml-auto text-micro">Ask in any chat: “merge this at 2pm”, “check CI again in an hour”.</p>
      </div>
      <Collapse open={!!error}>
        <p className="text-destructive mb-3 text-micro">{error}</p>
      </Collapse>
      <DataTable
        aria-label="Scheduled runs"
        rows={rows}
        columns={columns}
        rowKey={(t) => t.id}
        rowProps={(t) => ({ className: cn((t.status === "done" || t.status === "cancelled") && "opacity-70") })}
        loading={!data}
        empty={filter === "upcoming" ? "Nothing scheduled. Ask an agent in a chat to do something later." : "Nothing here yet."}
        minWidth="min-w-[680px]"
      />
    </div>
  );
}

function Actions({ t, busy, act, onAutomations }: { t: Automation; busy: boolean; act: (id: string, fn: () => Promise<unknown>, ok: string) => Promise<void>; onAutomations: () => void }) {
  const iconBtn = "text-muted-foreground hover:bg-muted hover:text-foreground grid size-7 cursor-pointer place-items-center rounded-md disabled:opacity-40";
  return (
    <div className="flex items-center justify-end gap-0.5">
      {t.status === "needs-ok" && (
        <button type="button" disabled={busy} title="Approve" aria-label="Approve" className={iconBtn} onClick={() => void act(t.id, () => api.setTriggerEnabled(t.id, true), "Approved")}>
          <Check className="size-4" />
        </button>
      )}
      {t.spec.at == null && (
        <button
          type="button"
          disabled={busy}
          title="Make it an automation"
          aria-label="Make it an automation"
          className={iconBtn}
          onClick={() => void act(t.id, () => api.promoteTrigger(t.id), "Moved to Automations").then(onAutomations)}
        >
          <Workflow className="size-4" />
        </button>
      )}
      <ArmButton
        variant="ghost"
        size="xs"
        busy={busy}
        icon={<Trash2 className="size-4" />}
        label={<span className="sr-only">{UPCOMING.has(t.status) ? "Cancel and delete" : "Delete"}</span>}
        armedLabel={UPCOMING.has(t.status) ? "Cancel it?" : "Delete?"}
        onConfirm={() => act(t.id, () => api.deleteTrigger(t.id), "Deleted")}
      />
    </div>
  );
}
