import * as React from "react";
import { ArrowUpRight, Check, Repeat, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { api, type Automation, type ScheduleStatus } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { fmtAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fmtNext } from "@/components/thread/SchedulePill";

/**
 * Scheduled: what you asked for in a chat — "merge the PR at 2pm", "check CI again in an hour".
 * Usually one-time; one plain table with every column and a delete per row. Standing rules made
 * from the menu (or that you asked an agent to set up) live on the Automations tab instead.
 */

type Filter = "upcoming" | "done" | "all";

const STATUS: Record<ScheduleStatus, { label: string; cls: string }> = {
  "needs-ok": { label: "Needs OK", cls: "bg-attention/15 text-attention-text" },
  waiting: { label: "Waiting", cls: "bg-muted text-foreground" },
  running: { label: "Running", cls: "bg-live/15 text-foreground" },
  done: { label: "Done", cls: "text-muted-foreground" },
  failed: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
  paused: { label: "Paused", cls: "text-muted-foreground" },
  cancelled: { label: "Cancelled", cls: "text-faint" },
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

  const counts = { upcoming: all.filter((t) => UPCOMING.has(t.status)).length, done: all.filter((t) => !UPCOMING.has(t.status)).length, all: all.length };
  const th = "text-faint px-3 py-2 text-left text-micro font-medium tracking-wide whitespace-nowrap uppercase";
  const td = "px-3 py-2.5 align-top text-micro";
  const iconBtn = "text-muted-foreground hover:bg-muted hover:text-foreground grid size-7 cursor-pointer place-items-center rounded-md disabled:opacity-40";

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
              className={cn("cursor-pointer rounded-full px-3 py-1 text-micro font-medium capitalize transition-colors", filter === f ? "bg-background text-foreground shadow-e1" : "text-muted-foreground hover:text-foreground")}
            >
              {f} <span className="text-faint tabular-nums">{counts[f]}</span>
            </button>
          ))}
        </div>
        <p className="text-faint ml-auto text-micro">Ask in any chat: “merge this at 2pm”, “check CI again in an hour”.</p>
      </div>
      {error && <p className="text-destructive mb-3 text-micro">{error}</p>}
      {rows.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed px-6 py-10 text-center text-meta">
          {data ? (filter === "upcoming" ? "Nothing scheduled. Ask an agent in a chat to do something later." : "Nothing here yet.") : "Loading…"}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[960px] border-collapse">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className={th}>Task</th>
                <th className={th}>Chat</th>
                <th className={th}>Repo</th>
                <th className={th}>When</th>
                <th className={th}>Repeats</th>
                <th className={th}>Status</th>
                <th className={th}>Created</th>
                <th className={th}>Result</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <Row key={t.id} t={t} now={now} busy={busy === t.id} td={td} iconBtn={iconBtn} onOpenBox={onOpenBox} act={act} onAutomations={onAutomations} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({
  t,
  now,
  busy,
  td,
  iconBtn,
  onOpenBox,
  act,
  onAutomations,
}: {
  t: Automation;
  now: number;
  busy: boolean;
  td: string;
  iconBtn: string;
  onOpenBox: (box: string) => void;
  act: (id: string, fn: () => Promise<unknown>, ok: string) => Promise<void>;
  onAutomations: () => void;
}) {
  const once = t.spec.at != null;
  const st = STATUS[t.status];
  const r = t.lastResult;
  const link = (box: string, label: string) => (
    <button type="button" onClick={() => onOpenBox(box)} className="text-foreground inline-flex max-w-full cursor-pointer items-center gap-0.5 underline-offset-2 hover:underline">
      <span className="truncate">{label}</span>
      <ArrowUpRight className="size-3 shrink-0" />
    </button>
  );
  return (
    <tr className={cn("hover:bg-muted/30 border-b last:border-b-0", (t.status === "done" || t.status === "cancelled") && "opacity-70")}>
      <td className={cn(td, "max-w-[18rem]")}>
        <p className="text-foreground line-clamp-2 font-medium" title={t.taskTemplate}>
          {t.taskTemplate}
        </p>
      </td>
      <td className={cn(td, "max-w-[11rem]")}>{t.sourceBox ? link(t.sourceBox, t.sourceTitle || t.sourceBox) : <span className="text-faint">—</span>}</td>
      <td className={cn(td, "font-mono text-[12px] whitespace-nowrap")}>{t.repo || <span className="text-faint font-sans">—</span>}</td>
      <td className={cn(td, "whitespace-nowrap tabular-nums")}>
        <span className="text-foreground">{once ? exact(t.spec.at!) : t.when}</span>
        {t.nextFire !== null && t.status !== "needs-ok" && <span className="text-muted-foreground block">{fmtNext(t.nextFire, now)}</span>}
      </td>
      <td className={cn(td, "whitespace-nowrap")}>{once ? <span className="text-muted-foreground">Once</span> : <span className="text-foreground inline-flex items-center gap-1"><Repeat className="size-3" />{t.when}</span>}</td>
      <td className={td}>
        <span className={cn("inline-flex rounded-full px-2 py-0.5 font-medium whitespace-nowrap", st.cls)}>{st.label}</span>
      </td>
      <td className={cn(td, "text-muted-foreground whitespace-nowrap tabular-nums")}>{fmtAgo(t.createdAt)}</td>
      <td className={cn(td, "max-w-[14rem]")}>
        {r ? (
          <div className="min-w-0">
            {r.box ? link(r.box, r.finished?.headline || "Open run") : <span className="text-muted-foreground">{r.reason || r.outcome}</span>}
            <span className="text-faint block tabular-nums">{fmtAgo(r.at)}</span>
          </div>
        ) : (
          <span className="text-faint">Not yet</span>
        )}
      </td>
      <td className={cn(td, "whitespace-nowrap")}>
        <div className="flex items-center justify-end gap-0.5">
          {t.status === "needs-ok" && (
            <button type="button" disabled={busy} title="Approve" aria-label="Approve" className={iconBtn} onClick={() => void act(t.id, () => api.setTriggerEnabled(t.id, true), "Approved")}>
              <Check className="size-4" />
            </button>
          )}
          {!once && (
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
          <button
            type="button"
            disabled={busy}
            title={UPCOMING.has(t.status) ? "Cancel and delete" : "Delete"}
            aria-label="Delete"
            className={cn(iconBtn, "hover:text-destructive")}
            onClick={() => void act(t.id, () => api.deleteTrigger(t.id), "Deleted")}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
