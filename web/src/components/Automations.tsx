import * as React from "react";
import { AlarmClock, ArrowUpRight, CalendarClock, ChevronRight, Copy, FlaskConical, GitPullRequest, History as HistoryIcon, Link2, ListChecks, PanelRight, Play, Plus, Radar, RotateCw, ShieldCheck, Trash2, Webhook, Workflow, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, type AlertPreset, type Automation, type AutomationDelivery, type AutomationDraft, type AutomationKind, type GithubEvent, type PrFollow, type WatchEvent } from "@/lib/api";
import { fmtAgo, friendlyName } from "@/lib/format";
import { useCached, writeCache } from "@/lib/cache";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Switch } from "@/components/ui/switch";
import { FilterChip } from "@/components/ui/filter-chip";
import { FilterSelect } from "@/components/ui/filter-select";
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
import { DataTable, StatusDot, stopRow, type Column } from "@/components/ui/data-table";
import { fmtCountdown } from "@/components/autopilot/UpNext";
import { useNow } from "@/hooks/useNow";
import { RecipeGallery, type Recipe } from "@/components/autopilot/Recipes";

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
  review_comment_created: "New review comment on a PR",
  push: "Push to branch",
  run_failed: "Workflow run failed",
  run_succeeded: "Workflow run succeeded",
  release_published: "Release published",
};
const WATCH_GROUPS: Array<{ label: string; events: WatchEvent[] }> = [
  { label: "Pull requests", events: ["pr_opened", "pr_pushed", "pr_ready", "pr_merged", "pr_closed", "pr_reopened"] },
  { label: "Issues", events: ["issue_opened", "issue_closed", "issue_reopened", "issue_labeled"] },
  { label: "Comments", events: ["comment_created", "review_comment_created"] },
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

/** "fired → box-1" / "skipped · cooldown" / "rejected · bad signature" / "waiting · limit reached". */
export function deliveryLine(d: AutomationDelivery): string {
  const word = d.outcome === "failed" ? "could not start" : d.outcome === "deferred" ? "waiting" : d.outcome;
  const head = d.outcome === "fired" ? `fired${d.box ? ` → ${d.box}` : ""}` : `${word}${d.reason ? ` · ${REASON_LABEL[d.reason]}` : ""}`;
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
export const deliveryTone = (d: AutomationDelivery) => (d.outcome === "fired" ? "text-ok" : d.outcome === "skipped" || d.outcome === "deferred" ? "text-muted-foreground" : "text-destructive");

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

/* ─── recipes: the common automations, each a filled-in draft for the editor ─── */

const RECIPES: Array<Recipe & { draft: () => AutomationDraft }> = [
  {
    id: "overnight",
    icon: CalendarClock,
    title: "Fix what broke overnight",
    line: "Every weekday before you start: run the tests, and open a PR that fixes whatever fails.",
    trigger: "Weekdays 02:00",
    draft: () => ({ ...blank("schedule"), name: "Fix what broke overnight" }),
  },
  {
    id: "issue-pr",
    icon: GitPullRequest,
    title: "Issue → pull request",
    line: "Label an issue “agent” and a run picks it up, opens a PR, and comments its receipt on the issue.",
    trigger: "Issue labelled agent",
    draft: () => ({ ...blank("github"), name: "Fix issues labelled agent" }),
  },
  {
    id: "review",
    icon: Radar,
    title: "Review every new PR",
    line: "When a pull request opens, read the diff and post one review comment with concrete findings.",
    trigger: "PR opened",
    draft: () => ({ ...blank("watch"), name: "Review new pull requests" }),
  },
  {
    id: "ci",
    icon: FlaskConical,
    title: "Watch CI on main",
    line: "Every 30 minutes, look for failed runs on the default branch; fix or explain only when one failed.",
    trigger: "Every 30 min",
    quiet: true,
    draft: () => {
      const p = WATCH_PRESETS.find((w) => w.id === "ci")!;
      return { ...blank("schedule"), name: p.name, spec: { ...blank("schedule").spec, cron: p.cron }, taskTemplate: p.task, quiet: true };
    },
  },
  {
    id: "deps",
    icon: RotateCw,
    title: "Weekly dependency refresh",
    line: "Monday morning: upgrade outdated dependencies, keep the ones that pass the tests, open one PR.",
    trigger: "Mondays 09:00",
    draft: () => ({
      ...blank("schedule"),
      name: "Weekly dependency refresh",
      spec: { ...blank("schedule").spec, cron: "0 9 * * 1" },
      taskTemplate:
        "Update outdated dependencies to their latest compatible versions. Run the build and the tests after each group of upgrades; drop any upgrade that breaks them. Open one PR listing what was upgraded and what was skipped and why.",
    }),
  },
  {
    id: "triage",
    icon: ListChecks,
    title: "Triage new issues",
    line: "Every 15 minutes, read new issues with a label nobody answered yet, reproduce, and summarise what each needs.",
    trigger: "Every 15 min",
    quiet: true,
    draft: () => {
      const p = WATCH_PRESETS.find((w) => w.id === "issues")!;
      return { ...blank("schedule"), name: p.name, spec: { ...blank("schedule").spec, cron: p.cron }, taskTemplate: p.task, quiet: true };
    },
  },
];

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

/**
 * Two kinds of thing run on their own, and the page keeps them apart: a ONE-TIME TASK (a schedule
 * with an instant — "merge it at 2pm", nearly always asked for in a chat) has a lifecycle and a
 * result; a STANDING RULE (a cron, a webhook, repo activity, a chain) keeps firing and has a switch.
 */
export const isOnce = (a: Pick<Automation, "kind" | "spec">) => a.kind === "schedule" && !!a.spec.at;
/** What a search matches: the name, the agent's one-liners, the trigger in words and the repos. */
const searchText = (a: Automation) => [a.name, a.summary ?? "", a.outcome ?? "", a.when, ...(a.repos ?? [])].join(" ").toLowerCase();

/** The Automations tab of Autopilot (AutopilotPage owns the page header and tabs). */
export function Automations({ onOpenBox, onOpenPlaybooks, onOpenRuns }: { onOpenBox: (box: string) => void; onOpenPlaybooks: () => void; onOpenRuns: (id: string) => void }) {
  const [rows, setRows] = React.useState<Automation[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  // `key` pins the editor instance across create → edit, so the shown-once webhook URL survives the save.
  const [editing, setEditing] = React.useState<{ id: string | null; draft: AutomationDraft; key?: string } | null>(null);
  // Keep the last draft while the sheet slides shut so its content doesn't vanish mid-exit.
  const lastEditing = React.useRef<typeof editing>(null);
  if (editing) lastEditing.current = editing;
  const shown = editing ?? lastEditing.current;

  const load = React.useCallback((signal?: AbortSignal) => {
    setError(null);
    return api
      .triggers(signal)
      .then((r) => setRows(r.triggers))
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
    if (rows) writeCache("triggers", { triggers: rows });
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

  const dismiss = async (a: Automation, word = "Proposal dismissed") => {
    try {
      await api.deleteTrigger(a.id);
      setRows((prev) => (prev ?? []).filter((x) => x.id !== a.id));
      toast.success(word);
    } catch (e) {
      toast.error("Could not dismiss", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const pickRecipe = (id: string) => {
    const r = RECIPES.find((x) => x.id === id);
    if (r) setEditing({ id: null, draft: r.draft() });
  };
  const names = Object.fromEntries((rows ?? []).map((r) => [r.id, r.name]));

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
      {/* On a wide page the list and the PR rules sit side by side: the rules are settings you
          glance at, not something to scroll past the whole list to reach. From 120rem, so the
          ten-column table keeps its full width beside the panel. */}
      <div className="@min-[120rem]:grid @min-[120rem]:grid-cols-[minmax(0,1fr)_24rem] @min-[120rem]:items-start @min-[120rem]:gap-x-10">
       <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground min-w-0 flex-[1_1_20rem] text-meta">
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

        <Swap state={error ? "error" : rows === null ? "loading" : rows.length ? "list" : "empty"}>
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
            <div className="surface overflow-hidden rounded-xl" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0">
                  <Bar className="size-8 rounded-lg" />
                  <Bar className="h-3 flex-1" />
                  <Bar className="h-4 w-8 rounded-full" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="space-y-6">
              <div className="bg-card enter flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border px-5 py-4">
                <span className="bg-muted text-foreground grid size-10 shrink-0 place-items-center rounded-xl" aria-hidden>
                  <Workflow className="size-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-[1_1_16rem]">
                  <p className="text-foreground text-body font-medium">No automations yet</p>
                  <p className="text-muted-foreground mt-0.5 text-meta">Pick a recipe below to get a filled-in draft, or start from a blank one.</p>
                </div>
                <Button size="sm" onClick={() => setEditing({ id: null, draft: blank() })}>
                  <Plus />
                  Blank automation
                </Button>
              </div>
              <RecipeGallery recipes={RECIPES} onPick={pickRecipe} />
              <p className="text-muted-foreground flex items-start gap-2 text-micro">
                <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
                PR-only, and a storm cap of 30 starts an hour: anything over it waits its turn. Schedules run in your own timezone.
              </p>
            </div>
          ) : (
            <AutomationTable
              rows={rows}
              onEdit={(a) => setEditing({ id: a.id, draft: toDraft(a) })}
              onRuns={(a) => onOpenRuns(a.id)}
              onToggle={(a, on) => void toggle(a, on)}
              onRemove={(a) => void dismiss(a, isPending(a) || a.status === "needs-ok" ? "Proposal dismissed" : "Removed")}
              onOpenBox={onOpenBox}
              onOpenPlaybook={onOpenPlaybooks}
            />
          )}
        </Swap>
        {rows && rows.length > 0 && rows.filter((a) => !isOnce(a)).length < 4 && <RecipeGallery recipes={RECIPES} onPick={pickRecipe} heading="Add another from a recipe" className="mt-8" />}
       </div>
        <div className="min-w-0 @min-[120rem]:sticky @min-[120rem]:top-6">
          <PrFollowupsPanel />
        </div>
      </div>

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {shown && (
          <SheetContent
            title={shown.id ? (rows?.find((r) => r.id === shown.id)?.proposed ? "Proposed by the agent" : "Edit automation") : "New automation"}
            description={shown.id ? rows?.find((r) => r.id === shown.id)?.when : "What starts it, and what the agent is asked to do."}
            className="w-[min(34rem,calc(100vw-1rem))]"
          >
            <Editor
              key={shown.key ?? shown.id ?? "new"}
              id={shown.id}
              initial={shown.draft}
              others={(rows ?? []).filter((r) => r.id !== shown.id)}
              names={names}
              onSaved={(t) => {
                setRows((prev) => {
                  const list = prev ?? [];
                  return list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? { ...t, active: x.active } : x)) : [{ ...t, active: 0 }, ...list];
                });
                setEditing((cur) => (cur ? { id: t.id, draft: toDraft(t), key: cur.key ?? cur.id ?? "new" } : cur));
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
    ...(a.summary ? { summary: a.summary } : {}),
    ...(a.outcome ? { outcome: a.outcome } : {}),
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
/**
 * A schedule made in a chat with no name of its own is stored under its machine's id
 * (`pool-1791864841224-omp-qyt2hi`). That id is plumbing: show the name the machine goes by
 * everywhere else in the console.
 */
export function automationLabel(name: string): string {
  return /^pool-\d+-/.test(name) ? friendlyName(name) : name;
}

/** The link back to the chat a schedule came from; "from chat" when it would only repeat the name. */
function sourceLabel(a: Automation): string {
  const title = a.sourceTitle?.trim();
  if (title && title !== a.name) return title;
  return "from chat";
}

/**
 * The second line under a name: the agent's one-liner (`does:`) when it gave one; else the task
 * past its first sentence when that sentence is the name (the old form: the name WAS the first
 * sentence, so repeating it says nothing); else the task itself. Clipped to a line.
 */
function blurb(a: Automation): string | undefined {
  if (a.summary) return a.summary;
  const t = a.taskTemplate.replace(/\s+/g, " ").trim();
  const first = t.split(/[.!?](?=\s|$)/)[0].trim();
  const rest = first && first === a.name.replace(/[.!?]$/, "").trim() ? t.slice(first.length).replace(/^[.!?]\s*/, "") : t;
  if (!rest) return undefined;
  return rest.length > 160 ? `${rest.slice(0, 159).trimEnd()}…` : rest;
}

const atFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** Epoch ms → the `datetime-local` value in the browser's zone ("2026-11-24T12:45"). */
function toLocalInput(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const atFmtFull = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "long" });

/** What a row is doing, in one word, for the Status filter and the default order. */
type State = "waiting on you" | "running" | "coming up" | "on" | "finished" | "paused";
const STATES: State[] = ["waiting on you", "running", "coming up", "on", "finished", "paused"];
function stateOf(a: Automation): State {
  if (isPending(a) || a.status === "needs-ok") return "waiting on you";
  if (a.active > 0 || a.status === "running") return "running";
  if (isOnce(a)) return a.status === "waiting" ? "coming up" : a.status === "cancelled" || a.status === "paused" ? "paused" : "finished";
  return a.enabled ? "on" : "paused";
}
const STATE_DOT: Record<State, string> = { "waiting on you": "bg-attention", running: "bg-live", "coming up": "bg-faint", on: "bg-ok", finished: "bg-faint", paused: "bg-faint" };
const STATE_RANK: Record<State, number> = { "waiting on you": 0, running: 1, "coming up": 2, on: 3, finished: 4, paused: 5 };
/** Default order: what needs you, what runs, what comes soonest, then rules by their next fire, finished newest first, paused last. */
function defaultOrder(a: Automation, b: Automation): number {
  const sa = stateOf(a);
  const sb = stateOf(b);
  if (sa !== sb) return STATE_RANK[sa] - STATE_RANK[sb];
  if (sa === "coming up") return (a.spec.at ?? 0) - (b.spec.at ?? 0);
  if (sa === "on") return (a.nextFire ?? Number.MAX_SAFE_INTEGER) - (b.nextFire ?? Number.MAX_SAFE_INTEGER);
  if (sa === "finished") return (b.lastFired ?? b.spec.at ?? 0) - (a.lastFired ?? a.spec.at ?? 0);
  return a.name.localeCompare(b.name);
}
const typeLabel = (a: Automation) => (isOnce(a) ? "One-time" : KIND_LABEL[a.kind]);
const typeGlyph = (a: Automation): LucideIcon => (isOnce(a) ? AlarmClock : GLYPH[a.kind]);

/** Status as a dot and a word, one line: what needs you, what runs, and how the last run went. */
function StatusCell({ a, now, onOpenBox }: { a: Automation; now: number; onOpenBox: (box: string) => void }) {
  const s = stateOf(a);
  if (s === "waiting on you") return <StatusDot tone="attention">waiting on you</StatusDot>;
  if (s === "running") {
    const box = a.lastResult?.box;
    const dot = (
      <StatusDot tone="live" pulse>
        running now
      </StatusDot>
    );
    return box ? (
      <button type="button" className="max-w-full cursor-pointer hover:underline" onClick={(e) => (stopRow(e), onOpenBox(box))}>
        {dot}
      </button>
    ) : (
      dot
    );
  }
  if (s === "coming up") return a.spec.at! < now - 60_000 ? <StatusDot tone="attention">due now</StatusDot> : <StatusDot tone="muted">coming up</StatusDot>;
  if (s === "paused") return <StatusDot tone="muted">{isOnce(a) ? "cancelled" : "paused"}</StatusDot>;
  return <LastResult a={a} onOpenBox={onOpenBox} />;
}

/** What came of it: the last run's headline; before any run, what the agent said it gives (one-time) or the quiet counter / last delivery (rules). */
function ResultCell({ a }: { a: Automation }) {
  const r = a.lastResult;
  if (r?.outcome === "started" && r.finished?.headline)
    return (
      <span className="text-muted-foreground block truncate text-meta" title={r.finished.headline}>
        {r.finished.headline}
      </span>
    );
  if (r && r.outcome !== "started" && r.reason)
    return (
      <span className="text-muted-foreground block truncate text-meta" title={r.reason}>
        {r.reason}
      </span>
    );
  if (isOnce(a))
    return a.outcome && a.status !== "cancelled" ? (
      <span className="text-muted-foreground block truncate text-meta" title={`What the agent said it gives: ${a.outcome}`}>
        <span className="text-faint">gives</span> {a.outcome}
      </span>
    ) : (
      <span className="text-faint text-meta">—</span>
    );
  const fires = a.lastDelivery && (a.kind === "webhook" || a.kind === "github" || a.kind === "watch");
  const line = a.quiet && a.counts ? countsLine(a.counts) : fires ? deliveryLine(a.lastDelivery!) : "";
  return line ? (
    <span className={cn("block truncate font-mono text-micro tabular", fires && !a.quiet ? deliveryTone(a.lastDelivery!) : "text-muted-foreground")} title={line}>
      {line}
    </span>
  ) : (
    <span className="text-faint text-meta">—</span>
  );
}

/** Where it came from, one line: the chat it was asked in (opens it) or the playbook it runs. */
function SourceCell({ a, workflows, onOpenBox, onOpenPlaybook }: { a: Automation; workflows: { id: string; name: string }[]; onOpenBox: (box: string) => void; onOpenPlaybook: () => void }) {
  if (a.sourceBox)
    return (
      <button
        type="button"
        onClick={(e) => (stopRow(e), onOpenBox(a.sourceBox!))}
        className="text-muted-foreground hover:text-foreground inline-flex max-w-full cursor-pointer items-center gap-0.5 text-meta underline-offset-2 hover:underline"
        title={`From chat: ${a.sourceTitle || a.sourceBox}`}
      >
        <span className="truncate">{sourceLabel(a)}</span>
        <ArrowUpRight className="size-3 shrink-0" aria-hidden />
      </button>
    );
  if (a.workflowId) {
    const wf = workflows.find((w) => w.id === a.workflowId)?.name ?? "missing playbook";
    return (
      <button type="button" onClick={(e) => (stopRow(e), onOpenPlaybook())} className="text-muted-foreground hover:text-foreground inline-flex max-w-full cursor-pointer items-center gap-1 text-meta" title={`Playbook: ${wf}`}>
        <ListChecks className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{wf}</span>
      </button>
    );
  }
  return <span className="text-faint text-meta">—</span>;
}

/**
 * Every automation as one single-line row: Name · Type · When · Status · Does · Repo · Result ·
 * Next · Source · the actions. Filters above the table (type chips, status and repo selects) and
 * the table's own search; a sort on any header replaces the default order (what needs you, what
 * runs, what comes soonest, rules by their next fire, finished newest, paused last).
 */
function AutomationTable({
  rows,
  onEdit,
  onRuns,
  onToggle,
  onRemove,
  onOpenBox,
  onOpenPlaybook,
}: {
  rows: Automation[];
  onEdit: (a: Automation) => void;
  onRuns: (a: Automation) => void;
  onToggle: (a: Automation, on: boolean) => void;
  onRemove: (a: Automation) => void;
  onOpenBox: (box: string) => void;
  onOpenPlaybook: () => void;
}) {
  const workflows = useWorkflowList();
  const now = useNow(rows.some((a) => stateOf(a) === "coming up" || (a.enabled && !!a.nextFire)), 30_000);
  const [type, setType] = React.useState<"all" | "once" | "rules">("all");
  const [state, setState] = React.useState("");
  const [repo, setRepo] = React.useState("");

  const byState = (a: Automation) => !state || stateOf(a) === state;
  const byRepo = (a: Automation) => !repo || (a.repos ?? []).includes(repo);
  const byType = (a: Automation) => type === "all" || (type === "once") === isOnce(a);
  const others = rows.filter((a) => byState(a) && byRepo(a));
  const typed = rows.filter((a) => byType(a) && byRepo(a));
  const shown = React.useMemo(() => rows.filter((a) => byType(a) && byState(a) && byRepo(a)).sort(defaultOrder), [rows, type, state, repo]); // eslint-disable-line react-hooks/exhaustive-deps
  const repos = Array.from(new Set(rows.flatMap((a) => a.repos ?? []))).sort();
  const stateCount = (s: State) => typed.filter((a) => stateOf(a) === s).length;

  const columns: Column<Automation>[] = [
    {
      id: "name",
      primary: true,
      header: "Name",
      width: "w-52",
      fitMax: 208,
      sort: (a) => a.name,
      cell: (a) => {
        const Glyph = typeGlyph(a);
        const s = stateOf(a);
        return (
          <span className="flex min-w-0 items-center gap-2">
            {/* On a phone the Status column is gone: its dot rides before the name. */}
            <span className={cn("size-1.5 shrink-0 rounded-full sm:hidden", STATE_DOT[s])} title={s} aria-hidden />
            <Glyph className="text-muted-foreground size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="text-foreground min-w-0 truncate font-medium" title={a.taskTemplate}>
              {automationLabel(a.name)}
            </span>
          </span>
        );
      },
    },
    { id: "type", header: "Type", width: "w-28", fitMax: 112, hideBelow: "md", sort: typeLabel, cell: (a) => <span className="text-muted-foreground block truncate text-meta">{typeLabel(a)}</span> },
    {
      id: "when",
      header: "When",
      width: "w-40",
      fitMax: 152,
      hideBelow: "md",
      sort: (a) => (isOnce(a) ? a.spec.at : a.when),
      cell: (a) =>
        isOnce(a) ? (
          <span className="text-foreground block truncate text-meta tabular-nums" title={`${atFmtFull.format(new Date(a.spec.at!))} · ${a.when}`}>
            {atFmt.format(new Date(a.spec.at!))}
          </span>
        ) : (
          <span className="text-foreground block truncate text-meta" title={a.when}>
            {a.when}
          </span>
        ),
    },
    { id: "status", header: "Status", width: "w-36", fitMax: 144, hideBelow: "sm", sort: (a) => STATE_RANK[stateOf(a)], cell: (a) => <StatusCell a={a} now={now} onOpenBox={onOpenBox} /> },
    {
      id: "does",
      header: "Does",
      hideBelow: "lg",
      minFlex: 160,
      cell: (a) => {
        const line = blurb(a);
        return line ? (
          <span className="text-muted-foreground block truncate text-meta" title={line}>
            {line}
          </span>
        ) : (
          <span className="text-faint text-meta">—</span>
        );
      },
    },
    {
      id: "repo",
      header: "Repo",
      width: "w-32",
      fitMax: 128,
      hideBelow: "lg",
      sort: (a) => a.repos?.[0],
      cell: (a) => {
        const rs = a.repos ?? [];
        return rs.length ? (
          <span className="text-muted-foreground block truncate font-mono text-micro" title={rs.join("\n")}>
            {rs[0]}
            {rs.length > 1 && <span className="text-faint"> +{rs.length - 1}</span>}
          </span>
        ) : (
          <span className="text-faint text-meta">—</span>
        );
      },
    },
    { id: "result", header: "Result", width: "w-36", fitMax: 144, hideBelow: "lg", cell: (a) => <ResultCell a={a} /> },
    {
      id: "next",
      header: "Next",
      width: "w-24",
      fitMax: 96,
      hideBelow: "sm",
      sort: (a) => (stateOf(a) === "coming up" ? a.spec.at : a.enabled && a.nextFire ? a.nextFire : null),
      cell: (a) => {
        const s = stateOf(a);
        const at = s === "coming up" ? a.spec.at! : s === "on" ? a.nextFire : null;
        return (
          <span className="text-muted-foreground block truncate font-mono text-micro tabular" title={at ? atFmtFull.format(new Date(at)) : undefined}>
            {at ? fmtCountdown(at, now) : s === "on" ? "on event" : "—"}
          </span>
        );
      },
    },
    { id: "source", header: "Source", width: "w-26", fitMax: 104, hideBelow: "lg", sort: (a) => a.sourceTitle ?? (a.workflowId ? "playbook" : null), cell: (a) => <SourceCell a={a} workflows={workflows} onOpenBox={onOpenBox} onOpenPlaybook={onOpenPlaybook} /> },
  ];
  return (
    <DataTable
      aria-label="Automations"
      rows={shown}
      columns={columns}
      rowKey={(a) => a.id}
      onRowClick={onRuns}
      rowLabel={(a) => `Open runs of ${a.name}`}
      search={{ placeholder: "Search automations", text: searchText }}
      toolbar={
        <>
          <div role="radiogroup" aria-label="Type" className="flex items-center gap-1">
            <FilterChip group="automations-type" active={type === "all"} onClick={() => setType("all")} label="All" count={others.length} />
            <FilterChip group="automations-type" active={type === "once"} onClick={() => setType("once")} label="One-time" count={others.filter(isOnce).length} />
            <FilterChip group="automations-type" active={type === "rules"} onClick={() => setType("rules")} label="Rules" count={others.filter((a) => !isOnce(a)).length} />
          </div>
          <FilterSelect label="Status" value={state} onChange={setState} options={[{ value: "", label: "any" }, ...STATES.filter((s) => stateCount(s) > 0 || s === state).map((s) => ({ value: s, label: `${s} · ${stateCount(s)}` }))]} />
          {repos.length > 1 && <FilterSelect label="Repo" value={repo} onChange={setRepo} options={[{ value: "", label: "any" }, ...repos.map((r) => ({ value: r, label: r.split("/").pop() ?? r }))]} />}
        </>
      }
      empty={
        <span className="flex flex-col items-center gap-2">
          <span>No automation matches these filters.</span>
          <Button size="xs" variant="outline" onClick={() => (setType("all"), setState(""), setRepo(""))}>
            Clear filters
          </Button>
        </span>
      }
      actions={(a) => {
        const s = stateOf(a);
        return (
          <span className="inline-flex items-center justify-end gap-1.5" onClick={stopRow} onKeyDown={stopRow}>
            <Button size="sm" variant="ghost" onClick={() => onEdit(a)} aria-label={`View ${a.name}`} title="View" className="h-8 px-2.5">
              <PanelRight className="size-3.5" />
            </Button>
            {s === "waiting on you" ? (
              <>
                <Button size="sm" variant="ghost" className="text-muted-foreground hidden md:inline-flex" onClick={() => onRemove(a)} aria-label={`Dismiss ${a.name}`}>
                  <Trash2 />
                </Button>
                <Button size="sm" onClick={() => onToggle(a, true)}>
                  Approve
                </Button>
              </>
            ) : !isOnce(a) ? (
              <Switch checked={a.enabled} onCheckedChange={(on) => onToggle(a, on)} aria-label={a.enabled ? `Pause ${a.name}` : `Turn on ${a.name}`} />
            ) : s === "coming up" ? (
              <ArmButton variant="ghost" size="sm" icon={<X className="size-3.5" />} label={<span className="hidden md:inline">Cancel</span>} armedLabel="Cancel it?" onConfirm={() => onToggle(a, false)} className="text-muted-foreground" />
            ) : s === "running" ? null : (
              <ArmButton variant="ghost" size="sm" icon={<Trash2 className="size-3.5" />} label={<span className="hidden md:inline">Remove</span>} armedLabel="Remove?" onConfirm={() => onRemove(a)} className="text-muted-foreground" />
            )}
          </span>
        );
      }}
      rowProps={(a) => {
        const s = stateOf(a);
        return { className: s === "waiting on you" ? "bg-attention/[0.04]" : s === "finished" || s === "paused" ? "opacity-60 hover:opacity-100 focus-visible:opacity-100" : undefined };
      }}
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
      <Collapse open={on.some((e) => e.startsWith("pr_"))}>
        <FollowFields follow={spec.follow} onChange={(follow) => setSpec({ follow })} />
      </Collapse>
    </div>
  );
}

const FOLLOW_DEFAULT: PrFollow = { onPush: true, onComment: true, resolve: true, rounds: 5 };
const FOLLOW_ROUNDS = [3, 5, 10] as const;

/** "See the PR through": after the first review, re-review the same PR on new pushes and comments until it merges. */
function FollowFields({ follow, onChange }: { follow: PrFollow | undefined; onChange: (f: PrFollow | undefined) => void }) {
  const on = !!follow;
  const f = follow ?? FOLLOW_DEFAULT;
  const patch = (p: Partial<PrFollow>) => {
    const next = { ...f, ...p };
    onChange(next.onPush || next.onComment ? next : undefined);
  };
  return (
    <div className="surface flex flex-col gap-3 px-3 py-3">
      <label className="flex items-center justify-between gap-3">
        <span className="text-meta">
          Follow each reviewed PR until it merges
          <span className="text-faint block text-micro">The first run reviews the PR; later changes on that PR bring the reviewer back until it merges or closes.</span>
        </span>
        <Switch size="sm" checked={on} onCheckedChange={(v) => onChange(v ? FOLLOW_DEFAULT : undefined)} />
      </label>
      <Collapse open={on}>
        <div className="flex flex-col gap-3 pt-1">
          <label className="flex items-center justify-between gap-3">
            <span className="text-meta">
              Re-review when new commits are pushed
              <span className="text-faint block text-micro">Reads the diff since the last review, not the whole PR again.</span>
            </span>
            <Switch size="sm" checked={f.onPush} onCheckedChange={(v) => patch({ onPush: v })} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-meta">
              Re-review when someone else comments
              <span className="text-faint block text-micro">Replies and review comments by people. The reviewer's own comments and bots never count.</span>
            </span>
            <Switch size="sm" checked={f.onComment} onCheckedChange={(v) => patch({ onComment: v })} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-meta">
              Resolve its own review threads once a push addresses them
              <span className="text-faint block text-micro">Off = it replies "addressed" and leaves resolving to people.</span>
            </span>
            <Switch size="sm" checked={f.resolve} onCheckedChange={(v) => patch({ resolve: v })} />
          </label>
          <div className="flex items-center justify-between gap-3">
            <span className="text-meta">
              Rounds per PR, at most
              <span className="text-faint block text-micro">Each round is one run. Changes that land during a round are reviewed together in the next.</span>
            </span>
            <Segmented<string>
              ariaLabel="Rounds per PR"
              value={String(FOLLOW_ROUNDS.includes(f.rounds as (typeof FOLLOW_ROUNDS)[number]) ? f.rounds : 5)}
              onChange={(v) => patch({ rounds: Number(v) })}
              options={FOLLOW_ROUNDS.map((n) => ({ value: String(n), label: String(n) }))}
            />
          </div>
          <p className="text-faint text-micro">It approves when nothing blocking remains and requests changes otherwise. It never merges, pushes to the branch or closes the PR.</p>
        </div>
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
    if (!confirm("The current URL stops working immediately. Issue a new one?")) return;
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

  const copy = (s: string) =>
    void navigator.clipboard?.writeText(s).then(
      () => toast.success("Copied"),
      () => toast.error("Could not copy — select and copy manually")
    );

  return (
    <div className="flex flex-col gap-5 pb-2">
      <label className="block">
        <Label>Name</Label>
        <input className={field} value={d.name} maxLength={80} placeholder="Nightly test fixer" onChange={(e) => set({ name: e.target.value })} />
      </label>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <label className="block">
          <Label hint="one line, under the name in the table">What it does</Label>
          <input className={field} value={d.summary ?? ""} maxLength={200} placeholder="Runs the tests and opens a PR that fixes what fails" onChange={(e) => set({ summary: e.target.value || undefined })} />
        </label>
        <label className="block">
          <Label hint="what you get">Gives</Label>
          <input className={field} value={d.outcome ?? ""} maxLength={80} placeholder="A PR" onChange={(e) => set({ outcome: e.target.value || undefined })} />
        </label>
      </div>

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

      {d.kind === "schedule" && d.spec.at ? (
        // A one-time task keeps its moment: the cron picker would read as a repeat and, once touched,
        // turn "at 12:45" into a rule. The input is the browser's clock; the stored value is UTC.
        <div>
          <Label hint={atFmtFull.format(new Date(d.spec.at))}>Runs once at</Label>
          <input
            type="datetime-local"
            className={cn(field, "font-mono")}
            value={toLocalInput(d.spec.at)}
            onChange={(e) => {
              const t = new Date(e.target.value).getTime();
              if (Number.isFinite(t)) setD((cur) => ({ ...cur, spec: { at: t } }));
            }}
          />
          <p className="text-faint mt-1.5 text-micro">A moment already past runs as soon as it is saved and on.</p>
        </div>
      ) : d.kind === "schedule" ? (
        <div>
          <Label hint={describeCron(d.spec.cron ?? "") || undefined}>Runs</Label>
          <SchedulePicker cron={d.spec.cron ?? ""} timezone={d.spec.timezone ?? ""} onChange={(p) => setSpec(p)} />
        </div>
      ) : null}

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
            {[d.spec.destroy === "done" ? "box destroyed when done" : d.spec.destroy === "keep" ? "box kept after the run" : "box destroyed on finish", d.quiet ? "quiet" : null, (d.spec.keepGreen ?? true) ? "keeps PRs green" : null, (d.spec.addressReviews ?? true) ? "answers reviews" : null, d.kind === "watch" && d.spec.follow ? "follows PRs to merge" : null].filter(Boolean).join(" · ")}
          </span>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-meta">
            Box after the run
            <span className="text-faint block text-micro">Destroyed on finish unless you say otherwise. Keep = the global sleep rule. A run paused on a question and a box you pinned are never destroyed.</span>
          </span>
          <Segmented<"keep" | "done" | "always">
            ariaLabel="Box after the run"
            value={d.spec.destroy ?? "always"}
            onChange={(v) => setSpec({ destroy: v === "always" ? undefined : v })}
            options={[
              { value: "always", label: "Always destroy" },
              { value: "done", label: "Destroy if done", title: "Destroy after a clean finish; keep a failed run's box to inspect" },
              { value: "keep", label: "Keep" },
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
            Quiet — only tell me when something needs action
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
