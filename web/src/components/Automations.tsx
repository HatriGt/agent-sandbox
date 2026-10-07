import * as React from "react";
import { CalendarClock, ChevronRight, Copy, FlaskConical, GitPullRequest, History as HistoryIcon, Link2, ListChecks, PanelRight, Play, Plus, Radar, RotateCw, ShieldCheck, Trash2, Webhook, Workflow, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, type AlertPreset, type Automation, type AutomationDelivery, type AutomationDraft, type AutomationKind, type GithubEvent, type WatchEvent } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { RunFactsLine } from "@/components/RunFactsLine";
import { readCache, useCached, writeCache } from "@/lib/cache";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Swap } from "@/components/ui/swap";
import { Collapse } from "@/components/ui/collapse";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";
import { PrFollowupsPanel } from "@/components/PrFollowupsPanel";
import { SchedulePicker, describeCron } from "@/components/SchedulePicker";
import { RepoPicker } from "@/components/RepoPicker";
import { DataTable, MetaLine, StatusDot, stopRow, type Column } from "@/components/ui/data-table";

/**
 * Automations: runs that start themselves — on a schedule, on a webhook, on a GitHub event, or after
 * another automation finishes. A LIST, not a canvas: each row says what fires it in words, how the
 * last fire went, when the next one is, and a switch. Editing happens in a side sheet with a live
 * preview of the task, rendered against the last real payload this automation received.
 */

export const GLYPH: Record<AutomationKind, LucideIcon> = { schedule: CalendarClock, webhook: Webhook, github: GitPullRequest, watch: Radar, chain: Link2 };
export const KIND_LABEL: Record<AutomationKind, string> = { schedule: "Schedule", webhook: "Webhook", github: "GitHub", watch: "Repo activity", chain: "After another" };
const EVENT_LABEL: Record<GithubEvent, string> = { issue_labeled: "Issue labelled", issue_comment: "Comment command", pr_opened: "PR opened" };
const WATCH_LABEL: Record<WatchEvent, string> = {
  pr_opened: "PR opened",
  pr_pushed: "PR pushed to",
  pr_ready: "PR ready for review",
  pr_merged: "PR merged",
  pr_closed: "PR closed (unmerged)",
  pr_reopened: "PR reopened",
  issue_opened: "Issue opened",
  issue_closed: "Issue closed",
  issue_reopened: "Issue reopened",
  issue_labeled: "Issue labelled",
  comment_created: "New comment (issue or PR)",
  push: "Push to branch",
  run_failed: "Workflow run failed",
  run_succeeded: "Workflow run succeeded",
  release_published: "Release published",
};
const WATCH_GROUPS: Array<{ label: string; events: WatchEvent[] }> = [
  { label: "Pull requests", events: ["pr_opened", "pr_pushed", "pr_ready", "pr_merged", "pr_closed", "pr_reopened"] },
  { label: "Issues", events: ["issue_opened", "issue_closed", "issue_reopened", "issue_labeled"] },
  { label: "Comments", events: ["comment_created"] },
  { label: "Branch & CI", events: ["push", "run_failed", "run_succeeded"] },
  { label: "Releases", events: ["release_published"] },
];
/** Template variables worth hinting per kind; schedule has no payload. */
const TASK_HINT: Record<AutomationKind, string | null> = {
  schedule: null,
  webhook: "{{payload.x}}",
  github: "{{issue.title}} {{pr.title}} {{comment.body}}",
  watch: "{{pr.title}} {{issue.title}} {{event}}",
  chain: "{{parent.headline}}",
};

const field = "border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-meta outline-none focus-visible:ring-[3px]";

const DEFAULT_TEMPLATES: Record<AutomationKind, string> = {
  schedule: "Check the repo for failing tests and open a PR that fixes them.",
  webhook: "Handle this request: {{payload.text}}",
  github: "Fix issue #{{issue.number}}: {{issue.title}}\n\n{{issue.body}}",
  watch: 'Review PR #{{pr.number}} "{{pr.title}}" ({{pr.html_url}}).\nRead the diff and post one review comment on the PR with concrete findings (bugs, risks, missing tests). Do not push commits.',
  chain: "Review what the previous run did ({{parent.headline}}) and tighten it.",
};

/* ─── watch presets: scheduled, quiet checks over gh / curl (no new dispatcher) ─── */

const WATCH_PRESETS: Array<{ id: string; label: string; name: string; cron: string; task: string }> = [
  {
    id: "ci",
    label: "Failing CI on main",
    name: "Failing CI on main",
    cron: "*/30 * * * *",
    task:
      "Check CI on the default branch: run `gh run list --branch main --status failure --limit 5`. If a run failed, open its logs (`gh run view <id> --log-failed`), find the cause, and either fix it on a branch and open a PR or report what broke and why. If `gh` is missing, run `need gh`.",
  },
  {
    id: "issues",
    label: "New issues with label",
    name: "New issues labelled <label>",
    cron: "*/15 * * * *",
    task:
      "Triage new issues: run `gh issue list --label <label> --state open --limit 20`. For each issue nobody has replied to yet, read it, reproduce if you can, and summarise what it needs (a fix, more information, a decision). If `gh` is missing, run `need gh`.",
  },
  {
    id: "endpoint",
    label: "Endpoint returning errors",
    name: "Endpoint <url> health",
    cron: "*/10 * * * *",
    task:
      "Check the endpoint: run `curl -s -o /dev/null -w '%{http_code}' <url>`. Anything other than a 2xx or 3xx is a problem: fetch the body, check the service logs if you have access, find the likely cause and report it. If a CLI you need is missing, run `need <cli>`.",
  },
];

/* ─── alert sources (Sentry / Datadog / PagerDuty presets) ─── */

const PRESET_LABEL: Record<AlertPreset, string> = { sentry: "Sentry", datadog: "Datadog", pagerduty: "PagerDuty" };
const INCIDENT_HARNESS_ID = "hrn_builtin-incident-responder";
const ALERT_TEMPLATE = "{{alert.source}} alert: {{alert.title}}\n\nSeverity: {{alert.severity}}\nService: {{alert.service}}\nLink: {{alert.url}}\n\n{{alert.message}}";
const PRESET_SECRET_HINT: Record<AlertPreset, string> = {
  sentry: "The integration's Client Secret (Sentry → Settings → Custom Integrations). We check Sentry-Hook-Signature with it.",
  pagerduty: "The webhook subscription's signing secret (shown once when you create it). We check X-PagerDuty-Signature with it.",
  datadog: "Datadog doesn't sign webhooks. Pick a token, and add the custom header X-ASB-Token with it in the Datadog webhook.",
};
const DATADOG_PAYLOAD =
  '{"id":"$ID","alert_id":"$ALERT_ID","aggreg_key":"$AGGREG_KEY","title":"$EVENT_TITLE","body":"$EVENT_MSG","transition":"$ALERT_TRANSITION","priority":"$PRIORITY","link":"$LINK","hostname":"$HOSTNAME","tags":"$TAGS"}';

const REASON_LABEL: Record<NonNullable<AutomationDelivery["reason"]>, string> = {
  cooldown: "cooldown",
  disabled: "paused",
  limit: "limit reached",
  dedupe: "duplicate",
  ignored: "not a match",
  signature: "bad signature",
  payload: "bad payload",
  error: "error",
  sender: "sender not allowed",
  asked: "needs an answer",
};

/** "fired → box-1" / "skipped · cooldown" / "rejected · bad signature". */
export function deliveryLine(d: AutomationDelivery): string {
  const head = d.outcome === "fired" ? `fired${d.box ? ` → ${d.box}` : ""}` : `${d.outcome === "failed" ? "could not start" : d.outcome}${d.reason ? ` · ${REASON_LABEL[d.reason]}` : ""}`;
  return d.test ? `test · ${head}` : head;
}
/** "checked 12× · 1 report" — a quiet automation's runs that found nothing vs those that reported. */
export function countsLine(c: { checked: number; reports: number }): string {
  return `checked ${c.checked}× · ${c.reports} report${c.reports === 1 ? "" : "s"}`;
}
function randomToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
export const deliveryTone = (d: AutomationDelivery) => (d.outcome === "fired" ? "text-ok" : d.outcome === "skipped" ? "text-muted-foreground" : "text-destructive");

function blank(kind: AutomationKind = "schedule"): AutomationDraft {
  return {
    name: "",
    kind,
    spec:
      kind === "schedule"
        ? { cron: "0 2 * * 1-5", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }
        : kind === "github"
          ? { event: "issue_labeled", label: "agent" }
          : kind === "watch"
            ? { watch: ["pr_opened"] }
            : kind === "chain"
              ? { on: "done", carry: "patch" }
              : {},
    taskTemplate: DEFAULT_TEMPLATES[kind],
    enabled: true,
    prComment: kind === "github" || kind === "watch",
  };
}

/** "in 3h" / "in 12 min" — epoch ms in the future. */
function fmtIn(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((ms - now) / 1000));
  if (s < 60) return "in under a minute";
  if (s < 3600) return `in ${Math.round(s / 60)} min`;
  if (s < 86_400) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86_400)}d`;
}

let automationSeed: Partial<AutomationDraft> | null = null;
/** Open the new-automation sheet pre-filled the next time the Automations tab mounts. */
export function seedAutomation(d: Partial<AutomationDraft>): void {
  automationSeed = d;
}
function takeAutomationSeed(): Partial<AutomationDraft> | null {
  const s = automationSeed;
  automationSeed = null;
  return s;
}

let editSeed: string | null = null;
/** Open an existing automation's editor sheet the next time the Automations tab mounts (the runs page's View). */
export function editAutomation(id: string): void {
  editSeed = id;
}

/** The Automations tab of Autopilot (AutopilotPage owns the page header and tabs). */
export function Automations({ onOpenBox, onOpenPlaybooks, onOpenRuns }: { onOpenBox: (box: string) => void; onOpenPlaybooks: () => void; onOpenRuns: (id: string) => void }) {
  const [rows, setRows] = React.useState<Automation[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [editing, setEditing] = React.useState<{ id: string | null; draft: AutomationDraft } | null>(null);
  // Keep the last draft while the sheet slides shut so its content doesn't vanish mid-exit.
  const lastEditing = React.useRef<typeof editing>(null);
  if (editing) lastEditing.current = editing;
  const shown = editing ?? lastEditing.current;

  const load = React.useCallback((signal?: AbortSignal) => {
    setError(null);
    return api
      .triggers(signal)
      // Chat schedules live on the Scheduled tab; this list is standing rules only.
      .then((r) => setRows(r.triggers.filter((t) => t.scope !== "scheduled")))
      .catch((e) => {
        if (!signal?.aborted) setError(e instanceof Error ? e.message : String(e));
      });
  }, []);
  React.useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [attempt, load]);

  // Every local edit (toggle, create, delete) flows back into the shared cache the tab counts read.
  React.useEffect(() => {
    if (!rows) return;
    const cached = readCache<{ triggers: Automation[] }>("triggers")?.v.triggers ?? [];
    writeCache("triggers", { triggers: [...cached.filter((t) => t.scope === "scheduled"), ...rows] });
  }, [rows]);

  const toggle = async (a: Automation, on: boolean) => {
    setRows((prev) => (prev ?? []).map((x) => (x.id === a.id ? { ...x, enabled: on } : x)));
    try {
      const r = await api.setTriggerEnabled(a.id, on);
      setRows((prev) => (prev ?? []).map((x) => (x.id === a.id ? { ...r.trigger, active: x.active } : x)));
    } catch (e) {
      setRows((prev) => (prev ?? []).map((x) => (x.id === a.id ? { ...x, enabled: !on } : x)));
      toast.error("Could not change the automation", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const dismiss = async (a: Automation) => {
    try {
      await api.deleteTrigger(a.id);
      setRows((prev) => (prev ?? []).filter((x) => x.id !== a.id));
      toast.success("Proposal dismissed");
    } catch (e) {
      toast.error("Could not dismiss", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const names = Object.fromEntries((rows ?? []).map((r) => [r.id, r.name]));
  // Waiting on you first, then live ones, then paused.
  const listed = [...(rows ?? [])].sort((a, b) => Number(isPending(b)) - Number(isPending(a)) || Number(b.enabled) - Number(a.enabled));

  // "Automate this playbook" on the Playbooks tab lands here with a draft.
  React.useEffect(() => {
    const s = takeAutomationSeed();
    if (s) setEditing({ id: null, draft: { ...blank(), ...s } });
  }, []);
  // The runs page's View lands here: open that automation's editor once the list has it.
  React.useEffect(() => {
    if (!editSeed || !rows) return;
    const a = rows.find((r) => r.id === editSeed);
    editSeed = null;
    if (a) setEditing({ id: a.id, draft: toDraft(a) });
  }, [rows]);

  return (
    <div className="min-w-0">
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground min-w-0 flex-1 text-meta">
            <span className="text-foreground">When</span> work starts on its own — a schedule, a webhook, a GitHub event, or after another run. Each opens a PR at most and leaves a receipt.
          </p>
          <AnimatePresence initial={false}>
            {rows && rows.length > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}>
                <Button size="sm" onClick={() => setEditing({ id: null, draft: blank() })}>
                  <Plus />
                  New automation
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <Swap state={error ? "error" : rows === null ? "loading" : listed.length ? "list" : "empty"}>
          {error ? (
            <EmptyState
              icon={Workflow}
              tone="destructive"
              title="Could not load automations"
              line={error}
              action={
                <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                  <RotateCw />
                  Retry
                </Button>
              }
            />
          ) : rows === null ? (
            <div className="overflow-hidden rounded-xl border" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0">
                  <Bar className="size-8 rounded-lg" />
                  <Bar className="h-3 flex-1" />
                  <Bar className="h-4 w-8 rounded-full" />
                </div>
              ))}
            </div>
          ) : !listed.length ? (
            <EmptyState
              icon={Workflow}
              title="No automations yet"
              line="Start a run on a schedule, when a GitHub issue gets a label, when a webhook is called, or when another run finishes."
              action={
                <Button size="sm" onClick={() => setEditing({ id: null, draft: blank() })}>
                  <Plus />
                  New automation
                </Button>
              }
              facts={[
                { icon: CalendarClock, text: "“Weekdays 02:00: fix whatever broke overnight” — in your own timezone." },
                { icon: GitPullRequest, text: "Label an issue “agent” and a run picks it up, then comments its receipt on the issue." },
                { icon: ShieldCheck, text: "One run at a time by default, PR-only, and a storm cap of 12 fires an hour." },
              ]}
            />
          ) : (
            <AutomationList
              rows={listed}
              onEdit={(a) => setEditing({ id: a.id, draft: toDraft(a) })}
              onRuns={(a) => onOpenRuns(a.id)}
              onToggle={(a, on) => void toggle(a, on)}
              onDismiss={(a) => void dismiss(a)}
              onOpenBox={onOpenBox}
              onOpenPlaybook={onOpenPlaybooks}
            />
          )}
        </Swap>
        <PrFollowupsPanel />
      </div>

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {shown && (
          <SheetContent
            title={shown.id ? (rows?.find((r) => r.id === shown.id)?.proposed ? "Proposed by the agent" : "Edit automation") : "New automation"}
            description={shown.id ? rows?.find((r) => r.id === shown.id)?.when : "What starts it, and what the agent is asked to do."}
            className="w-[min(34rem,calc(100vw-1rem))]"
          >
            <Editor
              key={shown.id ?? "new"}
              id={shown.id}
              initial={shown.draft}
              others={(rows ?? []).filter((r) => r.id !== shown.id)}
              names={names}
              onSaved={(t) => {
                setRows((prev) => {
                  const list = prev ?? [];
                  return list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? { ...t, active: x.active } : x)) : [{ ...t, active: 0 }, ...list];
                });
                setEditing((cur) => (cur ? { id: t.id, draft: toDraft(t) } : cur));
              }}
              onDeleted={(id) => {
                setRows((prev) => (prev ?? []).filter((x) => x.id !== id));
                setEditing(null);
              }}
              onRan={() => void load()}
              onOpenRuns={onOpenRuns}
              initialHasSecret={!!rows?.find((r) => r.id === shown.id)?.hasSigningSecret}
            />
          </SheetContent>
        )}
      </Sheet>
    </div>
  );
}

function toDraft(a: Automation): AutomationDraft {
  return {
    name: a.name,
    kind: a.kind,
    spec: a.spec,
    ...(a.repos?.length ? { repos: a.repos } : {}),
    taskTemplate: a.taskTemplate,
    enabled: a.enabled,
    prComment: a.prComment,
    quiet: !!a.quiet,
    ...(a.agent ? { agent: a.agent } : {}),
    ...(a.model ? { model: a.model } : {}),
    ...(a.harnessId ? { harnessId: a.harnessId } : {}),
    ...(a.workflowId ? { workflowId: a.workflowId } : {}),
  };
}

/** How the last fire went, as a dot + word; "started" without a finish opens its box. */
function LastResult({ a, onOpenBox }: { a: Automation; onOpenBox: (box: string) => void }) {
  const r = a.lastResult;
  if (a.active > 0)
    return (
      <StatusDot tone="live" pulse>
        running now
      </StatusDot>
    );
  if (!r) return <StatusDot tone="muted">never fired</StatusDot>;
  const ago = <span className="font-mono tabular font-normal">{fmtAgo(Math.round(r.at / 1000))}</span>;
  if (r.outcome === "started" && r.finished) {
    const failed = r.finished.state === "failed";
    return (
      <StatusDot tone={failed ? "destructive" : "ok"} className="max-w-full">
        <span className="truncate" title={r.finished.headline}>
          {failed ? "failed" : "done"} {ago}
        </span>
      </StatusDot>
    );
  }
  if (r.outcome === "started")
    return (
      <button type="button" className="cursor-pointer hover:underline" onClick={(e) => (stopRow(e), r.box && onOpenBox(r.box))}>
        <StatusDot tone="live">started {ago}</StatusDot>
      </button>
    );
  return (
    <StatusDot tone={r.outcome === "failed" ? "destructive" : "muted"} className="max-w-full">
      <span className="truncate" title={r.reason}>
        {r.outcome === "failed" ? "could not start" : "skipped"} {ago}
      </span>
    </StatusDot>
  );
}

function useWorkflowList() {
  return useCached("workflows", (signal) => api.workflows(signal)).data?.workflows ?? [];
}

/** Run the task as a saved workflow: steps and checks on the same machine (src/workflow.ts). */
function WorkflowPick({ value, onChange }: { value: string | undefined; onChange: (id: string | undefined) => void }) {
  const list = useWorkflowList();
  if (!list.length && !value) return null;
  const cur = list.find((w) => w.id === value);
  return (
    <label className="block">
      <Label hint="optional — how to do it; the task fills {{task}} in step one">Playbook</Label>
      <select className={field} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">None — one run, as written</option>
        {value && !cur && <option value={value}>Missing playbook — pick another</option>}
        {list.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} · {w.steps.length} step{w.steps.length === 1 ? "" : "s"}
          </option>
        ))}
      </select>
    </label>
  );
}

const isPending = (a: Automation) => !!a.proposed && !a.enabled;

/** Every automation as one table row: name + what fires it, when, how the last run went. The row opens its runs; the actions cell holds View (the editor sheet) and the switch (or Approve/Dismiss for a proposal). */
function AutomationList({
  rows,
  onEdit,
  onRuns,
  onToggle,
  onDismiss,
  onOpenBox,
  onOpenPlaybook,
}: {
  rows: Automation[];
  onEdit: (a: Automation) => void;
  onRuns: (a: Automation) => void;
  onToggle: (a: Automation, on: boolean) => void;
  onDismiss: (a: Automation) => void;
  onOpenBox: (box: string) => void;
  onOpenPlaybook: () => void;
}) {
  const workflows = useWorkflowList();
  const anyPending = rows.some(isPending);
  const columns: Column<Automation>[] = [
    {
      id: "name",
      primary: true,
      header: "Name",
      sort: (a) => a.name,
      cell: (a) => {
        const Glyph = GLYPH[a.kind];
        const wf = a.workflowId ? (workflows.find((w) => w.id === a.workflowId)?.name ?? "missing") : undefined;
        const playbook = wf && (
          <button type="button" onClick={(e) => (stopRow(e), onOpenPlaybook())} className="hover:text-foreground inline-flex max-w-full cursor-pointer items-center gap-1" title={`Playbook: ${wf}`}>
            <ListChecks className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{wf}</span>
          </button>
        );
        return (
          <span className="flex min-w-0 items-center gap-3">
            <Glyph className={cn("size-4 shrink-0", a.enabled ? "text-live" : "text-muted-foreground")} strokeWidth={1.75} aria-hidden />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-foreground truncate font-medium" title={a.name}>
                {a.name}
              </span>
              <MetaLine className="md:hidden" parts={[KIND_LABEL[a.kind], <span title={a.when}>{a.when}</span>, playbook]} />
              <MetaLine className="hidden md:flex" parts={[KIND_LABEL[a.kind], playbook]} />
              {a.lastDelivery?.facts && <RunFactsLine f={a.lastDelivery.facts} className="flex-nowrap overflow-hidden" />}
            </span>
          </span>
        );
      },
    },
    {
      id: "when",
      header: "When",
      width: "w-[28%]",
      hideBelow: "md",
      cell: (a) => (
        <span className="text-muted-foreground block truncate text-meta" title={a.when}>
          {a.when}
        </span>
      ),
    },
    {
      id: "last",
      header: "Last run",
      width: "w-44",
      hideBelow: "sm",
      sort: (a) => (a.active > 0 ? Number.MAX_SAFE_INTEGER : a.lastResult?.at),
      cell: (a) => {
        const fires = a.lastDelivery && (a.kind === "webhook" || a.kind === "github" || a.kind === "watch");
        return (
          <span className="flex min-w-0 flex-col gap-0.5">
            <LastResult a={a} onOpenBox={onOpenBox} />
            <span className="text-faint truncate font-mono text-micro tabular">
              {a.quiet && a.counts ? countsLine(a.counts) : fires ? deliveryLine(a.lastDelivery!) : isPending(a) ? "waiting on you" : a.enabled && a.nextFire ? `next ${fmtIn(a.nextFire)}` : a.enabled ? "on event" : "paused"}
            </span>
          </span>
        );
      },
    },
  ];
  return (
    <DataTable
      aria-label="Automations"
      rows={rows}
      columns={columns}
      rowKey={(a) => a.id}
      onRowClick={onRuns}
      rowLabel={(a) => `Open runs of ${a.name}`}
      search={{ placeholder: "Search automations", text: (a) => [a.name, a.when, ...(a.repos ?? [])].join(" ") }}
      actions={(a) => (
        <span className="inline-flex items-center justify-end gap-1.5" onClick={stopRow} onKeyDown={stopRow}>
          <Button size="sm" variant="ghost" onClick={() => onEdit(a)} aria-label={`View ${a.name}`} className="h-8 px-2.5">
            <PanelRight className="size-3.5" />
            <span className="hidden md:inline">View</span>
          </Button>
          {isPending(a) ? (
            <>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onDismiss(a)} aria-label={`Dismiss ${a.name}`}>
                <Trash2 />
              </Button>
              <Button size="sm" onClick={() => onToggle(a, true)}>
                Approve
              </Button>
            </>
          ) : (
            <Switch checked={a.enabled} onCheckedChange={(on) => onToggle(a, on)} aria-label={a.enabled ? `Pause ${a.name}` : `Turn on ${a.name}`} />
          )}
        </span>
      )}
      groupOf={anyPending ? (a) => (isPending(a) ? "Proposed — waiting on you" : "Automations") : undefined}
      rowProps={(a) => ({ className: isPending(a) ? "bg-attention/[0.04]" : !a.enabled ? "opacity-60 hover:opacity-100 focus-visible:opacity-100" : undefined })}
    />
  );
}

function Label({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <span className="mb-1.5 flex items-baseline gap-2">
      <span className="label text-muted-foreground">{children}</span>
      {hint && <span className="text-faint text-micro">{hint}</span>}
    </span>
  );
}

/** Repo activity: grouped event toggles plus the filters only the chosen events use. */
function WatchFields({ spec, setSpec }: { spec: AutomationDraft["spec"]; setSpec: (patch: Partial<AutomationDraft["spec"]>) => void }) {
  const on = spec.watch ?? [];
  // Keep the canonical group order so the saved spec reads the way the UI does.
  const toggle = (ev: WatchEvent) => setSpec({ watch: WATCH_GROUPS.flatMap((g) => g.events).filter((e) => (e === ev ? !on.includes(e) : on.includes(e))) });
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label hint={on.length === 0 ? "pick at least one" : undefined}>Fires on</Label>
        <div className="flex flex-col gap-2.5">
          {WATCH_GROUPS.map((g) => (
            <div key={g.label} role="group" aria-label={g.label}>
              <p className="text-faint mb-1 text-micro">{g.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.events.map((ev) => (
                  <Button key={ev} size="sm" variant={on.includes(ev) ? "secondary" : "outline"} aria-pressed={on.includes(ev)} onClick={() => toggle(ev)}>
                    {WATCH_LABEL[ev]}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-faint mt-2 text-micro">Checked every 15 s with your GitHub account — no webhook needed. Existing items are not replayed; only changes after you save fire.</p>
      </div>
      <Collapse open={on.includes("push") || on.includes("run_failed") || on.includes("run_succeeded")}>
        <label className="block">
          <Label hint={on.includes("push") ? "push: default branch if empty · runs: any branch if empty" : "empty = any branch"}>Branch</Label>
          <input className={cn(field, "font-mono")} value={spec.branch ?? ""} onChange={(e) => setSpec({ branch: e.target.value || undefined })} placeholder="main" />
        </label>
      </Collapse>
      <Collapse open={on.includes("issue_labeled")}>
        <label className="block">
          <Label hint="empty = any label">Label</Label>
          <input className={field} value={spec.label ?? ""} onChange={(e) => setSpec({ label: e.target.value || undefined })} placeholder="agent" />
        </label>
      </Collapse>
      <Collapse open={on.includes("comment_created")}>
        <label className="block">
          <Label hint="empty = any comment">Comment starts with</Label>
          <input className={cn(field, "font-mono")} value={spec.command ?? ""} onChange={(e) => setSpec({ command: e.target.value || undefined })} placeholder="/agent" />
        </label>
      </Collapse>
      <Collapse open={on.some((e) => e.startsWith("pr_"))}>
        <label className="flex items-center justify-between gap-3">
          <span className="text-meta">
            Also run on PRs from forks
            <span className="text-faint block text-micro">Off by default: a fork's code is untrusted.</span>
          </span>
          <Switch size="sm" checked={!!spec.allowForks} onCheckedChange={(v) => setSpec({ allowForks: v })} />
        </label>
      </Collapse>
    </div>
  );
}

function Editor({
  id,
  initial,
  others,
  names,
  onSaved,
  onDeleted,
  onRan,
  onOpenRuns,
  initialHasSecret,
}: {
  id: string | null;
  initial: AutomationDraft;
  others: Automation[];
  names: Record<string, string>;
  onSaved: (t: Automation) => void;
  onDeleted: (id: string) => void;
  onRan: () => void;
  onOpenRuns: (id: string) => void;
  initialHasSecret: boolean;
}) {
  const [d, setD] = React.useState<AutomationDraft>(initial);
  const [saving, setSaving] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [hook, setHook] = React.useState<{ url: string; secret: string } | null>(null);
  const [preview, setPreview] = React.useState<{ text: string; missing: string[]; hasPayload: boolean } | null>(null);
  const set = (patch: Partial<AutomationDraft>) => setD((cur) => ({ ...cur, ...patch }));
  const setSpec = (patch: Partial<AutomationDraft["spec"]>) => setD((cur) => ({ ...cur, spec: { ...cur.spec, ...patch } }));

  // Live preview, debounced: the controller renders the template against the last real payload.
  React.useEffect(() => {
    const t = setTimeout(() => {
      api
        .previewTrigger(d.taskTemplate, id ?? undefined, d.name)
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [d.taskTemplate, d.name, id]);

  const save = async () => {
    setSaving(true);
    try {
      if (id) {
        const r = await api.updateTrigger(id, d);
        onSaved(r.trigger);
        toast.success("Saved");
      } else {
        const r = await api.createTrigger(d);
        onSaved(r.trigger);
        if (r.hookUrl && r.secret) setHook({ url: r.hookUrl, secret: r.secret });
        toast.success("Automation created");
      }
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    if (!id) return;
    setRunning(true);
    try {
      const r = await api.runTrigger(id);
      if (r.result.outcome === "started") toast.success("Started", { description: r.result.box });
      else toast.error(r.result.outcome === "skipped" ? "Skipped" : "Could not start", { description: r.result.reason });
      onRan();
    } catch (e) {
      toast.error("Could not start", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  };

  const [testing, setTesting] = React.useState(false);

  const sendTest = async () => {
    if (!id) return;
    setTesting(true);
    try {
      const r = await api.testTrigger(id);
      if (r.result?.outcome === "started") toast.success("Test event fired a run", { description: r.result.box });
      else toast.error("Test event did not fire", { description: r.result?.reason ?? r.skipped ?? r.ignored });
      onRan();
    } catch (e) {
      toast.error("Could not send the test event", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const rotate = async () => {
    if (!id) return;
    try {
      const r = await api.rotateTrigger(id);
      setHook({ url: r.hookUrl, secret: r.secret });
      toast.success("New secret issued — the old URL stops working now");
    } catch (e) {
      toast.error("Could not rotate", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const remove = async () => {
    if (!id) return;
    try {
      await api.deleteTrigger(id);
      onDeleted(id);
      toast.success("Automation deleted");
    } catch (e) {
      toast.error("Could not delete", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const copy = (s: string) => void navigator.clipboard?.writeText(s).then(() => toast.success("Copied"));

  return (
    <div className="flex flex-col gap-5 pb-2">
      <label className="block">
        <Label>Name</Label>
        <input className={field} value={d.name} maxLength={80} placeholder="Nightly test fixer" onChange={(e) => set({ name: e.target.value })} />
      </label>

      <div>
        <Label>Starts on</Label>
        {id ? (
          <p className="text-foreground text-meta">{KIND_LABEL[d.kind]}</p>
        ) : (
          <Segmented<AutomationKind>
            ariaLabel="What starts it"
            value={d.kind}
            onChange={(k) => setD((cur) => ({ ...blank(k), name: cur.name, repos: cur.repos }))}
            options={(Object.keys(KIND_LABEL) as AutomationKind[]).map((k) => {
              const G = GLYPH[k];
              return { value: k, label: KIND_LABEL[k], icon: <G className="size-3.5" />, disabled: k === "chain" && others.length === 0, title: k === "chain" && others.length === 0 ? "Create another automation first" : undefined };
            })}
          />
        )}
      </div>

      <Swap state={d.kind} className="flex flex-col gap-5">
      {d.kind === "schedule" && !id && (
        <div>
          <Label hint="quiet checks that only speak up when something is wrong">Start from</Label>
          <div className="flex flex-wrap gap-1.5">
            {WATCH_PRESETS.map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant={d.taskTemplate === p.task ? "secondary" : "outline"}
                onClick={() =>
                  setD((cur) => ({
                    ...cur,
                    name: cur.name.trim() && cur.name !== WATCH_PRESETS.find((w) => w.name === cur.name)?.name ? cur.name : p.name,
                    spec: { ...cur.spec, cron: p.cron },
                    taskTemplate: p.task,
                    quiet: true,
                  }))
                }
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {d.kind === "schedule" && (
        <div>
          <Label hint={describeCron(d.spec.cron ?? "") || undefined}>Runs</Label>
          <SchedulePicker cron={d.spec.cron ?? ""} timezone={d.spec.timezone ?? ""} onChange={(p) => setSpec(p)} />
        </div>
      )}

      {(d.kind === "github" || d.kind === "watch" || d.kind === "schedule" || d.kind === "webhook") && (
        <div>
          <Label hint={d.kind === "github" || d.kind === "watch" ? "required — each one fires on its own events" : "optional — the run clones them"}>Repositories</Label>
          <RepoField value={d.repos ?? []} onChange={(repos) => set({ repos: repos.length ? repos : undefined })} />
        </div>
      )}

      {d.kind === "github" && (
        <div className="flex flex-col gap-3">
          <div>
            <Label>Event</Label>
            <Segmented<GithubEvent>
              ariaLabel="GitHub event"
              value={d.spec.event ?? "issue_labeled"}
              onChange={(ev) => setSpec({ event: ev, ...(ev === "issue_labeled" ? { label: d.spec.label ?? "agent" } : {}), ...(ev === "issue_comment" ? { command: d.spec.command ?? "/agent" } : {}) })}
              options={(Object.keys(EVENT_LABEL) as GithubEvent[]).map((ev) => ({ value: ev, label: EVENT_LABEL[ev] }))}
            />
          </div>
          <Collapse open={d.spec.event === "issue_labeled"}>
            <label className="block">
              <Label>Label</Label>
              <input className={field} value={d.spec.label ?? ""} onChange={(e) => setSpec({ label: e.target.value })} placeholder="agent" />
            </label>
          </Collapse>
          <Collapse open={d.spec.event === "issue_comment"}>
            <label className="block">
              <Label hint="only owners, members and collaborators">Command</Label>
              <input className={cn(field, "font-mono")} value={d.spec.command ?? ""} onChange={(e) => setSpec({ command: e.target.value })} placeholder="/agent" />
            </label>
          </Collapse>
          <Collapse open={d.spec.event === "pr_opened"}>
            <label className="flex items-center justify-between gap-3">
              <span className="text-meta">
                Also run on PRs from forks
                <span className="text-faint block text-micro">Off by default: a fork's code is untrusted.</span>
              </span>
              <Switch size="sm" checked={!!d.spec.allowForks} onCheckedChange={(v) => setSpec({ allowForks: v })} />
            </label>
          </Collapse>
        </div>
      )}

      {d.kind === "watch" && <WatchFields spec={d.spec} setSpec={setSpec} />}

      {d.kind === "webhook" && (
        <div className="flex flex-col gap-3">
          <div>
            <Label>Source</Label>
            <Segmented<string>
              ariaLabel="Alert source"
              value={d.spec.preset ?? "generic"}
              onChange={(v) => {
                const preset = v === "generic" ? undefined : (v as AlertPreset);
                setD((cur) => ({
                  ...cur,
                  spec: preset ? { preset, cooldownMin: cur.spec.cooldownMin ?? 30 } : {},
                  // Swap the template only while it is still a default, never over the owner's words.
                  taskTemplate: cur.taskTemplate === DEFAULT_TEMPLATES.webhook || cur.taskTemplate === ALERT_TEMPLATE ? (preset ? ALERT_TEMPLATE : DEFAULT_TEMPLATES.webhook) : cur.taskTemplate,
                  ...(preset && !cur.harnessId ? { harnessId: INCIDENT_HARNESS_ID } : {}),
                  ...(!preset && cur.harnessId === INCIDENT_HARNESS_ID ? { harnessId: undefined } : {}),
                }));
              }}
              options={[{ value: "generic", label: "Any POST" }, ...(Object.keys(PRESET_LABEL) as AlertPreset[]).map((p) => ({ value: p, label: PRESET_LABEL[p] }))]}
            />
          </div>
          <Collapse open={!!d.spec.preset}>
            <div className="flex flex-col gap-3">
              <label className="block">
                <Label hint={initialHasSecret ? "set — leave blank to keep it" : "required"}>{d.spec.preset === "datadog" ? "Header token" : "Signing secret"}</Label>
                <div className="flex items-center gap-1.5">
                  <input
                    className={cn(field, "font-mono")}
                    type="password"
                    autoComplete="off"
                    value={d.signingSecret ?? ""}
                    placeholder={initialHasSecret ? "••••••••" : ""}
                    onChange={(e) => set({ signingSecret: e.target.value || undefined })}
                  />
                  {d.spec.preset === "datadog" && (
                    <Button size="sm" variant="ghost" onClick={() => set({ signingSecret: randomToken() })}>
                      Generate
                    </Button>
                  )}
                </div>
                <span className="text-faint mt-1 block text-micro">{d.spec.preset ? PRESET_SECRET_HINT[d.spec.preset] : null}</span>
              </label>
              <Collapse open={d.spec.preset === "datadog" && !!d.signingSecret}>
                <p className="text-faint -mt-1 text-micro">
                  Copy the token now: <code className="font-mono">{d.signingSecret}</code>{" "}
                  <button type="button" className="hover:text-foreground cursor-pointer underline" onClick={() => copy(d.signingSecret!)}>
                    copy
                  </button>
                </p>
              </Collapse>
              <Collapse open={d.spec.preset === "datadog"}>
                <div>
                  <Label hint="Datadog → Integrations → Webhooks → Payload">Payload</Label>
                  <div className="flex items-start gap-1.5">
                    <code className="bg-muted/40 min-w-0 flex-1 rounded border px-2 py-1 font-mono text-micro break-all">{DATADOG_PAYLOAD}</code>
                    <Button size="icon-sm" variant="ghost" aria-label="Copy payload" onClick={() => copy(DATADOG_PAYLOAD)}>
                      <Copy />
                    </Button>
                  </div>
                </div>
              </Collapse>
              <label className="flex items-center justify-between gap-3">
                <span className="text-meta">
                  Cooldown per alert, minutes
                  <span className="text-faint block text-micro">The same alert firing again inside this window is skipped: a storm is one run.</span>
                </span>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  className={cn(field, "w-24 text-right tabular")}
                  value={d.spec.cooldownMin ?? 30}
                  onChange={(e) => setSpec({ cooldownMin: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
              <Collapse open={d.harnessId === INCIDENT_HARNESS_ID}>
                <p className="text-faint -mt-1 text-micro">Runs with the Incident responder harness: find the breaking change, prepare a fix or a revert, ask before choosing.</p>
              </Collapse>
            </div>
          </Collapse>
        </div>
      )}

      {d.kind === "chain" && (
        <div className="flex flex-col gap-3">
          <label className="block">
            <Label>Runs after</Label>
            <select className={field} value={d.spec.afterTrigger ?? ""} onChange={(e) => setSpec({ afterTrigger: e.target.value })}>
              <option value="">Pick an automation…</option>
              {others
                .filter((o) => o.kind !== "chain" || o.spec.afterTrigger !== id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-4">
            <div>
              <Label>When it</Label>
              <Segmented<"done" | "any"> ariaLabel="When the parent" value={d.spec.on ?? "done"} onChange={(v) => setSpec({ on: v })} options={[{ value: "done", label: "succeeds" }, { value: "any", label: "finishes" }]} />
            </div>
            <div>
              <Label>Carry</Label>
              <Segmented<"patch" | "none"> ariaLabel="Carry the parent's changes" value={d.spec.carry ?? "patch"} onChange={(v) => setSpec({ carry: v })} options={[{ value: "patch", label: "its changes" }, { value: "none", label: "clean clone" }]} />
            </div>
          </div>
        </div>
      )}
      </Swap>

      <div>
        <Label hint={TASK_HINT[d.kind] ? <span className="hidden font-mono sm:inline">{TASK_HINT[d.kind]}</span> : undefined}>Task</Label>
        <Textarea className="min-h-28 font-mono text-meta" value={d.taskTemplate} onChange={(e) => set({ taskTemplate: e.target.value })} />
        <div className="bg-muted/40 mt-2 rounded-lg border px-3 py-2.5">
          <p className="label text-faint mb-1">
            Preview {preview?.hasPayload ? "· against the last real payload" : id ? "· no payload received yet" : ""}
          </p>
          <p className="text-foreground text-meta whitespace-pre-wrap break-words">{preview ? preview.text || <span className="text-faint">empty</span> : "…"}</p>
          {preview && preview.missing.length > 0 && (
            <p className="text-attention-text mt-1.5 text-micro">
              Empty until a payload has: {preview.missing.map((m) => `{{${m}}}`).join(", ")}
            </p>
          )}
        </div>
      </div>

      <WorkflowPick value={d.workflowId} onChange={(workflowId) => set({ workflowId })} />

      <details className="group rounded-lg border px-3 py-3 open:pb-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="text-muted-foreground size-3.5 transition-transform group-open:rotate-90" aria-hidden />
          <span className="label text-muted-foreground">Guardrails</span>
          <span className="text-faint ml-auto truncate text-micro group-open:hidden">
            {[d.spec.destroy === "always" ? "box destroyed on finish" : d.spec.destroy === "done" ? "box destroyed when done" : null, d.quiet ? "quiet" : null, (d.spec.keepGreen ?? true) ? "keeps PRs green" : null, (d.spec.addressReviews ?? true) ? "answers reviews" : null].filter(Boolean).join(" · ") || "every event gets its own box"}
          </span>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-meta">
            Box after the run
            <span className="text-faint block text-micro">Keep = the global sleep rule. Destroying skips runs paused on a question and boxes you pinned.</span>
          </span>
          <Segmented<"keep" | "done" | "always">
            ariaLabel="Box after the run"
            value={d.spec.destroy ?? "keep"}
            onChange={(v) => setSpec({ destroy: v === "keep" ? undefined : v })}
            options={[
              { value: "keep", label: "Keep" },
              { value: "done", label: "Destroy if done", title: "Destroy after a clean finish; keep a failed run's box to inspect" },
              { value: "always", label: "Always destroy" },
            ]}
          />
        </div>
        {(d.kind === "github" || d.kind === "watch" || !!d.repos?.length) && (
          <label className="flex items-center justify-between gap-3">
            <span className="text-meta">
              Comment the receipt on the issue or PR
              <span className="text-faint block text-micro">Headline, files, verified, time — with a link back.</span>
            </span>
            <Switch size="sm" checked={d.prComment} onCheckedChange={(v) => set({ prComment: v })} />
          </label>
        )}
        <label className="flex items-center justify-between gap-3">
          <span className="text-meta">
            Quiet — only tell me when something needs me
            <span className="text-faint block text-micro">A run that finds nothing ends silently and counts as a check. Questions, failures and PRs still notify.</span>
          </span>
          <Switch size="sm" checked={!!d.quiet} onCheckedChange={(v) => set({ quiet: v })} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-meta">
            Keep its PRs green
            <span className="text-faint block text-micro">When CI fails on a PR this opened, fix it on the same branch (up to 3 tries).</span>
          </span>
          <Switch size="sm" checked={d.spec.keepGreen ?? true} onCheckedChange={(v) => setSpec({ keepGreen: v })} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-meta">
            Address review comments
            <span className="text-faint block text-micro">Push fixes for review comments, then reply to and resolve the threads.</span>
          </span>
          <Switch size="sm" checked={d.spec.addressReviews ?? true} onCheckedChange={(v) => setSpec({ addressReviews: v })} />
        </label>
        <p className="text-faint text-micro">PR-only: pushes to the default branch are refused inside the machine, so changes land on a branch and a PR.</p>
        </div>
      </details>

      <Collapse open={!!hook && d.kind !== "watch"}>
        {hook && (
        <div className="border-live/30 bg-live/5 card-spring rounded-lg border px-3 py-3" role="status">
          <p className="text-foreground text-meta font-medium">Webhook URL — shown once</p>
          <p className="text-muted-foreground mt-0.5 text-micro">
            {d.kind === "github"
              ? "In the repo's Settings → Webhooks: paste the URL, content type application/json, and use the secret below."
              : d.spec.preset
                ? `Paste this as the webhook URL in ${PRESET_LABEL[d.spec.preset]}, then use “Send test event” to check the whole path.`
                : "POST to this URL. Anyone with it can start a run, so keep it private."}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <code className="bg-card min-w-0 flex-1 truncate rounded border px-2 py-1 text-micro">{hook.url}</code>
            <Button size="icon-sm" variant="ghost" aria-label="Copy URL" onClick={() => copy(hook.url)}>
              <Copy />
            </Button>
          </div>
          {d.kind === "github" && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <code className="bg-card min-w-0 flex-1 truncate rounded border px-2 py-1 text-micro">{hook.secret}</code>
              <Button size="icon-sm" variant="ghost" aria-label="Copy secret" onClick={() => copy(hook.secret)}>
                <Copy />
              </Button>
            </div>
          )}
        </div>
        )}
      </Collapse>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button size="sm" onClick={() => void save()} loading={saving} disabled={!d.name.trim() || !d.taskTemplate.trim() || ((d.kind === "watch" || d.kind === "github") && !d.repos?.length) || (d.kind === "watch" && !d.spec.watch?.length)}>
          {id ? "Save" : "Create"}
        </Button>
        {id && d.kind !== "chain" && (
          <Button size="sm" variant="outline" onClick={() => void runNow()} loading={running}>
            <Play />
            Run now
          </Button>
        )}
        {id && d.kind === "webhook" && initial.spec.preset && (
          <Button size="sm" variant="outline" onClick={() => void sendTest()} loading={testing}>
            <FlaskConical />
            Send test event
          </Button>
        )}
        {id && (d.kind === "webhook" || d.kind === "github") && (
          <Button size="sm" variant="ghost" onClick={() => void rotate()}>
            <RotateCw />
            New URL
          </Button>
        )}
        {id && (
          <Button size="sm" variant="ghost" onClick={() => onOpenRuns(id)}>
            <HistoryIcon />
            Runs
          </Button>
        )}
        <span className="flex-1" />
        {id && <ArmButton size="sm" variant="ghost" icon={<Trash2 />} label="Delete" armedLabel="Delete?" onConfirm={remove} className="text-muted-foreground" />}
      </div>
      {id && d.kind === "chain" && d.spec.afterTrigger && <p className="text-faint -mt-3 text-micro">Runs after “{names[d.spec.afterTrigger] ?? "?"}” — run that one to test the chain.</p>}
    </div>
  );
}

/** Repos an automation listens to / clones: chips, a picker over the connected accounts, and typed owner/name. */
function RepoField({ value, onChange }: { value: string[]; onChange: (repos: string[]) => void }) {
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const has = (r: string) => value.some((v) => v.toLowerCase() === r.toLowerCase());
  const toggle = (r: string) => onChange(has(r) ? value.filter((v) => v.toLowerCase() !== r.toLowerCase()) : [...value, r]);
  const addTyped = () => {
    const r = typed.trim().replace(/\.git$/i, "");
    if (/^[\w.-]+\/[\w.-]+$/.test(r) && !has(r)) onChange([...value, r]);
    setTyped("");
  };
  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5">
        {value.map((r) => (
          <span key={r} className="bg-muted text-meta inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono">
            {r}
            <button type="button" aria-label={`Remove ${r}`} className="text-faint hover:text-foreground" onClick={() => toggle(r)}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          className="text-meta min-w-32 flex-1 bg-transparent font-mono outline-none"
          value={typed}
          placeholder={value.length ? "add owner/name" : "owner/name — or pick"}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTyped();
            } else if (e.key === "Backspace" && !typed && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={addTyped}
        />
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          Pick
        </Button>
      </div>
      {open && (
        <div className="absolute top-full left-0 z-20 mt-1">
          <RepoPicker selected={value.map((repo) => ({ repo }))} onToggle={(r) => toggle(r.fullName)} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
