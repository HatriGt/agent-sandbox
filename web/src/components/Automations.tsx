import * as React from "react";
import { CalendarClock, Copy, FlaskConical, GitPullRequest, Link2, ListChecks, Play, Plus, RotateCw, ShieldCheck, Trash2, Webhook, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { api, type AlertPreset, type Automation, type AutomationDelivery, type AutomationDraft, type AutomationKind, type GithubEvent } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { useCached } from "@/lib/cache";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Swap } from "@/components/ui/swap";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";
import { PrFollowupsPanel } from "@/components/PrFollowupsPanel";

/**
 * Automations: runs that start themselves â€” on a schedule, on a webhook, on a GitHub event, or after
 * another automation finishes. A LIST, not a canvas: each row says what fires it in words, how the
 * last fire went, when the next one is, and a switch. Editing happens in a side sheet with a live
 * preview of the task, rendered against the last real payload this automation received.
 */

const GLYPH: Record<AutomationKind, LucideIcon> = { schedule: CalendarClock, webhook: Webhook, github: GitPullRequest, chain: Link2 };
const KIND_LABEL: Record<AutomationKind, string> = { schedule: "Schedule", webhook: "Webhook", github: "GitHub", chain: "After another" };
const EVENT_LABEL: Record<GithubEvent, string> = { issue_labeled: "Issue labelled", issue_comment: "Comment command", pr_opened: "PR opened" };

const field = "border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-meta outline-none focus-visible:ring-[3px]";

const DEFAULT_TEMPLATES: Record<AutomationKind, string> = {
  schedule: "Check the repo for failing tests and open a PR that fixes them.",
  webhook: "Handle this request: {{payload.text}}",
  github: "Fix issue #{{issue.number}}: {{issue.title}}\n\n{{issue.body}}",
  chain: "Review what the previous run did ({{parent.headline}}) and tighten it.",
};

/* â”€â”€â”€ watch presets: scheduled, quiet checks over gh / curl (no new dispatcher) â”€â”€â”€ */

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

/* â”€â”€â”€ alert sources (Sentry / Datadog / PagerDuty presets) â”€â”€â”€ */

const PRESET_LABEL: Record<AlertPreset, string> = { sentry: "Sentry", datadog: "Datadog", pagerduty: "PagerDuty" };
const INCIDENT_HARNESS_ID = "hrn_builtin-incident-responder";
const ALERT_TEMPLATE = "{{alert.source}} alert: {{alert.title}}\n\nSeverity: {{alert.severity}}\nService: {{alert.service}}\nLink: {{alert.url}}\n\n{{alert.message}}";
const PRESET_SECRET_HINT: Record<AlertPreset, string> = {
  sentry: "The integration's Client Secret (Sentry â†’ Settings â†’ Custom Integrations). We check Sentry-Hook-Signature with it.",
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
};

/** "fired â†’ box-1" / "skipped Â· cooldown" / "rejected Â· bad signature". */
export function deliveryLine(d: AutomationDelivery): string {
  const head = d.outcome === "fired" ? `fired${d.box ? ` â†’ ${d.box}` : ""}` : `${d.outcome === "failed" ? "could not start" : d.outcome}${d.reason ? ` Â· ${REASON_LABEL[d.reason]}` : ""}`;
  return d.test ? `test Â· ${head}` : head;
}
/** "checked 12Ã— Â· 1 report" â€” a quiet automation's runs that found nothing vs those that reported. */
export function countsLine(c: { checked: number; reports: number }): string {
  return `checked ${c.checked}Ã— Â· ${c.reports} report${c.reports === 1 ? "" : "s"}`;
}
function randomToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
const deliveryTone =(d: AutomationDelivery) => (d.outcome === "fired" ? "text-ok" : d.outcome === "skipped" ? "text-muted-foreground" : "text-destructive");

function blank(kind: AutomationKind = "schedule"): AutomationDraft {
  return {
    name: "",
    kind,
    spec: kind === "schedule" ? { cron: "0 2 * * 1-5", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" } : kind === "github" ? { event: "issue_labeled", label: "agent" } : kind === "chain" ? { on: "done", carry: "patch" } : {},
    taskTemplate: DEFAULT_TEMPLATES[kind],
    enabled: true,
    concurrency: 1,
    prComment: kind === "github",
  };
}

/** "in 3h" / "in 12 min" â€” epoch ms in the future. */
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

/** The Automations tab of Autopilot (AutopilotPage owns the page header and tabs). */
export function Automations({ onOpenBox, onOpenPlaybooks }: { onOpenBox: (box: string) => void; onOpenPlaybooks: () => void }) {
  const [rows, setRows] = React.useState<Automation[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [editing, setEditing] = React.useState<{ id: string | null; draft: AutomationDraft } | null>(null);

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
  const listed = [...(rows ?? [])].sort((a, b) => Number(b.proposed && !b.enabled) - Number(a.proposed && !a.enabled) || Number(b.enabled) - Number(a.enabled));

  // "Automate this playbook" on the Playbooks tab lands here with a draft.
  React.useEffect(() => {
    const s = takeAutomationSeed();
    if (s) setEditing({ id: null, draft: { ...blank(), ...s } });
  }, []);

  return (
    <div className="min-w-0">
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground min-w-0 flex-1 text-meta">
            <span className="text-foreground">When</span> work starts on its own â€” a schedule, a webhook, a GitHub event, or after another run. Each opens a PR at most and leaves a receipt.
          </p>
          {rows && rows.length > 0 && (
            <Button size="sm" onClick={() => setEditing({ id: null, draft: blank() })}>
              <Plus />
              New automation
            </Button>
          )}
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
                { icon: CalendarClock, text: "â€œWeekdays 02:00: fix whatever broke overnightâ€ â€” in your own timezone." },
                { icon: GitPullRequest, text: "Label an issue â€œagentâ€ and a run picks it up, then comments its receipt on the issue." },
                { icon: ShieldCheck, text: "One run at a time by default, PR-only, and a storm cap of 12 fires an hour." },
              ]}
            />
          ) : (
            <AutomationTable
              rows={listed}
              onEdit={(a) => setEditing({ id: a.id, draft: toDraft(a) })}
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
        {editing && (
          <SheetContent
            title={editing.id ? (rows?.find((r) => r.id === editing.id)?.proposed ? "Proposed by the agent" : "Edit automation") : "New automation"}
            description={editing.id ? rows?.find((r) => r.id === editing.id)?.when : "What starts it, and what the agent is asked to do."}
            className="w-[min(34rem,calc(100vw-1rem))]"
          >
            <Editor
              key={editing.id ?? "new"}
              id={editing.id}
              initial={editing.draft}
              others={(rows ?? []).filter((r) => r.id !== editing.id)}
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
              onOpenBox={onOpenBox}
              initialHasSecret={!!rows?.find((r) => r.id === editing.id)?.hasSigningSecret}
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
    ...(a.repo ? { repo: a.repo } : {}),
    taskTemplate: a.taskTemplate,
    enabled: a.enabled,
    concurrency: a.concurrency,
    prComment: a.prComment,
    quiet: !!a.quiet,
    ...(a.agent ? { agent: a.agent } : {}),
    ...(a.model ? { model: a.model } : {}),
    ...(a.harnessId ? { harnessId: a.harnessId } : {}),
    ...(a.workflowId ? { workflowId: a.workflowId } : {}),
  };
}

function LastResult({ a, onOpenBox }: { a: Automation; onOpenBox: (box: string) => void }) {
  const r = a.lastResult;
  if (a.active > 0) return <span className="text-live">running now</span>;
  if (!r) return <span className="text-faint">never fired</span>;
  const ago = fmtAgo(Math.round(r.at / 1000));
  if (r.outcome === "started" && r.finished) {
    const failed = r.finished.state === "failed";
    return (
      <span className={failed ? "text-destructive" : "text-ok"} title={r.finished.headline}>
        {failed ? "failed" : "done"} {ago}
      </span>
    );
  }
  if (r.outcome === "started")
    return (
      <button type="button" className="text-live relative cursor-pointer hover:underline" onClick={() => r.box && onOpenBox(r.box)}>
        started {ago}
      </button>
    );
  return (
    <span className={r.outcome === "failed" ? "text-destructive" : "text-muted-foreground"} title={r.reason}>
      {r.outcome === "failed" ? "could not start" : "skipped"} {ago}
    </span>
  );
}

function useWorkflowList() {
  return useCached("workflows", (signal) => api.workflows(signal)).data?.workflows ?? [];
}

function useWorkflowName(id: string | undefined): string | undefined {
  const list = useWorkflowList();
  return id ? (list.find((w) => w.id === id)?.name ?? "missing") : undefined;
}

/** Run the task as a saved workflow: steps and checks on the same machine (src/workflow.ts). */
function WorkflowPick({ value, onChange }: { value: string | undefined; onChange: (id: string | undefined) => void }) {
  const list = useWorkflowList();
  if (!list.length && !value) return null;
  const cur = list.find((w) => w.id === value);
  return (
    <label className="block">
      <Label hint="optional â€” how to do it; the task fills {{task}} in step one">Playbook</Label>
      <select className={field} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">None â€” one run, as written</option>
        {value && !cur && <option value={value}>Missing playbook â€” pick another</option>}
        {list.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} Â· {w.steps.length} step{w.steps.length === 1 ? "" : "s"}
          </option>
        ))}
      </select>
    </label>
  );
}

const TH = "text-faint px-3 py-2 text-micro font-medium tracking-wide uppercase first:pl-4 last:pr-4";
const TD = "px-3 py-2.5 align-middle first:pl-4 last:pr-4";

/** Every automation as one table: what, when, how (playbook), how it went, what's next, on/off. */
function AutomationTable({
  rows,
  onEdit,
  onToggle,
  onDismiss,
  onOpenBox,
  onOpenPlaybook,
}: {
  rows: Automation[];
  onEdit: (a: Automation) => void;
  onToggle: (a: Automation, on: boolean) => void;
  onDismiss: (a: Automation) => void;
  onOpenBox: (box: string) => void;
  onOpenPlaybook: () => void;
}) {
  const still = useReducedMotion();
  return (
    <div className="bg-card overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[40rem] table-fixed border-collapse text-left">
        <colgroup>
          <col />
          <col className="w-[11rem]" />
          <col className="hidden w-[9rem] lg:table-column" />
          <col className="w-[9.5rem]" />
          <col className="w-[6.5rem]" />
          <col className="w-[5.5rem]" />
        </colgroup>
        <thead className="border-b">
          <tr>
            <th className={TH}>Automation</th>
            <th className={TH}>Starts</th>
            <th className={cn(TH, "hidden lg:table-cell")}>Playbook</th>
            <th className={TH}>Last run</th>
            <th className={TH}>Next</th>
            <th className={cn(TH, "text-right")}>On</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a, i) => (
            <motion.tr
              key={a.id}
              initial={still ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: still ? 0.1 : 0.24, delay: Math.min(i, 12) * 0.024, ease: [0.22, 1, 0.36, 1] }}
              className={cn("hover:bg-muted/50 relative border-b transition-colors last:border-b-0", !a.enabled && !a.proposed && "opacity-70", a.proposed && !a.enabled && "bg-attention/[0.04]")}
            >
              <AutomationTr a={a} onEdit={() => onEdit(a)} onToggle={(on) => onToggle(a, on)} onDismiss={() => onDismiss(a)} onOpenBox={onOpenBox} onOpenPlaybook={onOpenPlaybook} />
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AutomationTr({ a, onEdit, onToggle, onDismiss, onOpenBox, onOpenPlaybook }: { a: Automation; onEdit: () => void; onToggle: (on: boolean) => void; onDismiss: () => void; onOpenBox: (box: string) => void; onOpenPlaybook: () => void }) {
  const Glyph = GLYPH[a.kind];
  const wf = useWorkflowName(a.workflowId);
  const pending = a.proposed && !a.enabled;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <>
      <td className={TD}>
        <span className="flex min-w-0 items-center gap-2.5">
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", a.enabled ? "bg-live/10 text-live" : "bg-muted text-muted-foreground")} aria-hidden>
            <Glyph className="size-3.5" strokeWidth={1.75} />
          </span>
          <span className="min-w-0">
            <button type="button" onClick={onEdit} className="text-foreground block max-w-full cursor-pointer truncate text-left text-meta font-medium after:absolute after:inset-0 focus-visible:outline-none" title={a.name}>
              {a.name}
            </button>
            <span className="text-muted-foreground block truncate text-micro" title={a.taskTemplate}>
              {a.proposed ? "Scheduled by the agent Â· " : ""}
              {a.taskTemplate.replace(/\s+/g, " ")}
            </span>
          </span>
        </span>
      </td>
      <td className={cn(TD, "text-micro")}>
        <span className="text-foreground block truncate">{KIND_LABEL[a.kind]}</span>
        <span className="text-muted-foreground block truncate" title={a.when}>
          {a.when}
        </span>
      </td>
      <td className={cn(TD, "hidden text-micro lg:table-cell")}>
        {wf ? (
          <button type="button" onClick={(e) => (stop(e), onOpenPlaybook())} className="bg-muted text-foreground relative z-10 inline-flex max-w-full cursor-pointer items-center gap-1 truncate rounded-md px-1.5 py-0.5 hover:underline">
            <ListChecks className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{wf}</span>
          </button>
        ) : (
          <span className="text-faint">â€”</span>
        )}
      </td>
      <td className={cn(TD, "text-micro")}>
        <span className="relative z-10 block truncate">
          <LastResult a={a} onOpenBox={onOpenBox} />
        </span>
        {a.quiet && a.counts ? (
          <span className={cn("block truncate", a.counts.reports > 0 ? "text-foreground" : "text-muted-foreground")} title="Quiet: only runs that found something notify">
            {countsLine(a.counts)}
          </span>
        ) : a.lastDelivery && (a.kind === "webhook" || a.kind === "github") ? (
          <span className={cn("block truncate", deliveryTone(a.lastDelivery))} title={a.lastDelivery.detail}>
            {deliveryLine(a.lastDelivery)}
          </span>
        ) : null}
      </td>
      <td className={cn(TD, "text-micro tabular-nums")}>
        {pending ? (
          <span className="bg-attention/15 text-attention-text inline-flex rounded-full px-2 py-0.5 font-medium">Needs OK</span>
        ) : a.enabled && a.nextFire ? (
          <span className="text-foreground" title={new Date(a.nextFire).toLocaleString()}>
            {fmtIn(a.nextFire)}
          </span>
        ) : (
          <span className="text-faint">{a.enabled ? "on event" : "paused"}</span>
        )}
      </td>
      <td className={cn(TD, "text-right")}>
        {pending ? (
          <span className="relative z-10 inline-flex items-center gap-1">
            <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={onDismiss} aria-label={`Dismiss ${a.name}`}>
              <Trash2 />
            </Button>
            <Button size="xs" onClick={() => onToggle(true)}>
              Approve
            </Button>
          </span>
        ) : (
          <Switch className="relative z-10" checked={a.enabled} onCheckedChange={onToggle} aria-label={a.enabled ? `Pause ${a.name}` : `Turn on ${a.name}`} />
        )}
      </td>
    </>
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

function Editor({
  id,
  initial,
  others,
  names,
  onSaved,
  onDeleted,
  onRan,
  onOpenBox,
  initialHasSecret,
}: {
  id: string | null;
  initial: AutomationDraft;
  others: Automation[];
  names: Record<string, string>;
  onSaved: (t: Automation) => void;
  onDeleted: (id: string) => void;
  onRan: () => void;
  onOpenBox: (box: string) => void;
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
      loadDeliveries();
    }
  };

  const [testing, setTesting] = React.useState(false);
  const [deliveries, setDeliveries] = React.useState<AutomationDelivery[] | null>(null);
  const loadDeliveries = React.useCallback(() => {
    if (!id) return;
    api
      .triggerDeliveries(id)
      .then((r) => setDeliveries(r.deliveries))
      .catch(() => setDeliveries([]));
  }, [id]);
  React.useEffect(() => loadDeliveries(), [loadDeliveries]);

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
      loadDeliveries();
    }
  };

  const rotate = async () => {
    if (!id) return;
    try {
      const r = await api.rotateTrigger(id);
      setHook({ url: r.hookUrl, secret: r.secret });
      toast.success("New secret issued â€” the old URL stops working now");
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
            onChange={(k) => setD((cur) => ({ ...blank(k), name: cur.name, repo: cur.repo }))}
            options={(Object.keys(KIND_LABEL) as AutomationKind[]).map((k) => {
              const G = GLYPH[k];
              return { value: k, label: KIND_LABEL[k], icon: <G className="size-3.5" />, disabled: k === "chain" && others.length === 0, title: k === "chain" && others.length === 0 ? "Create another automation first" : undefined };
            })}
          />
        )}
      </div>

      {d.kind === "schedule" && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <label className="block">
            <Label hint="min hour day month weekday">Cron</Label>
            <input className={cn(field, "font-mono")} value={d.spec.cron ?? ""} onChange={(e) => setSpec({ cron: e.target.value })} placeholder="0 2 * * 1-5" />
          </label>
          <label className="block">
            <Label>Timezone</Label>
            <input className={field} value={d.spec.timezone ?? ""} onChange={(e) => setSpec({ timezone: e.target.value })} placeholder="Europe/Berlin" />
          </label>
        </div>
      )}

      {d.kind === "schedule" && !id && (
        <div>
          <Label hint="a quiet check that only reports when something is wrong">Watch</Label>
          <div className="flex flex-wrap gap-1.5">
            {WATCH_PRESETS.map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant="outline"
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
          <p className="text-faint mt-1.5 text-micro">Fill in the &lt;placeholders&gt; in the task. A missing CLI is no blocker: the agent runs `need gh` (or any CLI) itself.</p>
        </div>
      )}

      {(d.kind === "github" || d.kind === "schedule" || d.kind === "webhook") && (
        <label className="block">
          <Label hint={d.kind === "github" ? "required" : "optional â€” the run clones it"}>Repository</Label>
          <input className={field} value={d.repo ?? ""} onChange={(e) => set({ repo: e.target.value || undefined })} placeholder="owner/name" />
        </label>
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
          {d.spec.event === "issue_labeled" && (
            <label className="block">
              <Label>Label</Label>
              <input className={field} value={d.spec.label ?? ""} onChange={(e) => setSpec({ label: e.target.value })} placeholder="agent" />
            </label>
          )}
          {d.spec.event === "issue_comment" && (
            <label className="block">
              <Label hint="only owners, members and collaborators">Command</Label>
              <input className={cn(field, "font-mono")} value={d.spec.command ?? ""} onChange={(e) => setSpec({ command: e.target.value })} placeholder="/agent" />
            </label>
          )}
          {d.spec.event === "pr_opened" && (
            <label className="flex items-center justify-between gap-3">
              <span className="text-meta">
                Also run on PRs from forks
                <span className="text-faint block text-micro">Off by default: a fork's code is untrusted.</span>
              </span>
              <Switch size="sm" checked={!!d.spec.allowForks} onCheckedChange={(v) => setSpec({ allowForks: v })} />
            </label>
          )}
        </div>
      )}

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
          {d.spec.preset && (
            <>
              <label className="block">
                <Label hint={initialHasSecret ? "set â€” leave blank to keep it" : "required"}>{d.spec.preset === "datadog" ? "Header token" : "Signing secret"}</Label>
                <div className="flex items-center gap-1.5">
                  <input
                    className={cn(field, "font-mono")}
                    type="password"
                    autoComplete="off"
                    value={d.signingSecret ?? ""}
                    placeholder={initialHasSecret ? "â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" : ""}
                    onChange={(e) => set({ signingSecret: e.target.value || undefined })}
                  />
                  {d.spec.preset === "datadog" && (
                    <Button size="sm" variant="ghost" onClick={() => set({ signingSecret: randomToken() })}>
                      Generate
                    </Button>
                  )}
                </div>
                <span className="text-faint mt-1 block text-micro">{PRESET_SECRET_HINT[d.spec.preset]}</span>
              </label>
              {d.spec.preset === "datadog" && d.signingSecret && (
                <p className="text-faint -mt-1 text-micro">
                  Copy the token now: <code className="font-mono">{d.signingSecret}</code>{" "}
                  <button type="button" className="hover:text-foreground cursor-pointer underline" onClick={() => copy(d.signingSecret!)}>
                    copy
                  </button>
                </p>
              )}
              {d.spec.preset === "datadog" && (
                <div>
                  <Label hint="Datadog â†’ Integrations â†’ Webhooks â†’ Payload">Payload</Label>
                  <div className="flex items-start gap-1.5">
                    <code className="bg-muted/40 min-w-0 flex-1 rounded border px-2 py-1 font-mono text-micro break-all">{DATADOG_PAYLOAD}</code>
                    <Button size="icon-sm" variant="ghost" aria-label="Copy payload" onClick={() => copy(DATADOG_PAYLOAD)}>
                      <Copy />
                    </Button>
                  </div>
                </div>
              )}
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
              {d.harnessId === INCIDENT_HARNESS_ID && <p className="text-faint -mt-1 text-micro">Runs with the Incident responder harness: find the breaking change, prepare a fix or a revert, ask before choosing.</p>}
            </>
          )}
        </div>
      )}

      {d.kind === "chain" && (
        <div className="flex flex-col gap-3">
          <label className="block">
            <Label>Runs after</Label>
            <select className={field} value={d.spec.afterTrigger ?? ""} onChange={(e) => setSpec({ afterTrigger: e.target.value })}>
              <option value="">Pick an automationâ€¦</option>
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

      <div>
        <Label hint={<span className="hidden font-mono sm:inline">{"{{issue.title}} {{payload.x}} {{parent.headline}}"}</span>}>Task</Label>
        <Textarea className="min-h-28 font-mono text-meta" value={d.taskTemplate} onChange={(e) => set({ taskTemplate: e.target.value })} />
        <div className="bg-muted/40 mt-2 rounded-lg border px-3 py-2.5">
          <p className="label text-faint mb-1">
            Preview {preview?.hasPayload ? "Â· against the last real payload" : id ? "Â· no payload received yet" : ""}
          </p>
          <p className="text-foreground text-meta whitespace-pre-wrap break-words">{preview ? preview.text || <span className="text-faint">empty</span> : "â€¦"}</p>
          {preview && preview.missing.length > 0 && (
            <p className="text-attention-text mt-1.5 text-micro">
              Empty until a payload has: {preview.missing.map((m) => `{{${m}}}`).join(", ")}
            </p>
          )}
        </div>
      </div>

      <WorkflowPick value={d.workflowId} onChange={(workflowId) => set({ workflowId })} />

      <div className="flex flex-col gap-3 rounded-lg border px-3 py-3">
        <p className="label text-muted-foreground">Guardrails</p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-meta">At most at once</span>
          <Segmented<string> ariaLabel="Concurrency" value={String(d.concurrency)} onChange={(v) => set({ concurrency: Number(v) })} options={["1", "2", "3", "5"].map((v) => ({ value: v, label: v }))} />
        </div>
        {(d.kind === "github" || d.repo) && (
          <label className="flex items-center justify-between gap-3">
            <span className="text-meta">
              Comment the receipt on the issue or PR
              <span className="text-faint block text-micro">Headline, files, verified, time â€” with a link back.</span>
            </span>
            <Switch size="sm" checked={d.prComment} onCheckedChange={(v) => set({ prComment: v })} />
          </label>
        )}
        <label className="flex items-center justify-between gap-3">
          <span className="text-meta">
            Quiet â€” only tell me when something needs me
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

      {hook && (
        <div className="border-live/30 bg-live/5 rounded-lg border px-3 py-3" role="status">
          <p className="text-foreground text-meta font-medium">Webhook URL â€” shown once</p>
          <p className="text-muted-foreground mt-0.5 text-micro">
            {d.kind === "github"
              ? "In the repo's Settings â†’ Webhooks: paste the URL, content type application/json, and use the secret below."
              : d.spec.preset
                ? `Paste this as the webhook URL in ${PRESET_LABEL[d.spec.preset]}, then use â€œSend test eventâ€ to check the whole path.`
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

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button size="sm" onClick={() => void save()} loading={saving} disabled={!d.name.trim() || !d.taskTemplate.trim()}>
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
        <span className="flex-1" />
        {id && <ArmButton size="sm" variant="ghost" icon={<Trash2 />} label="Delete" armedLabel="Delete?" onConfirm={remove} className="text-muted-foreground" />}
      </div>
      {id && d.kind === "chain" && d.spec.afterTrigger && <p className="text-faint -mt-3 text-micro">Runs after â€œ{names[d.spec.afterTrigger] ?? "?"}â€ â€” run that one to test the chain.</p>}

      {id && (
        <div>
          <Label hint={`last ${50}`}>Deliveries</Label>
          {deliveries === null ? (
            <p className="text-faint text-micro">â€¦</p>
          ) : deliveries.length === 0 ? (
            <p className="text-faint text-micro">Nothing has arrived yet. Every delivery lands here: fired, skipped (and why) or rejected.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {deliveries.map((x) => (
                <li key={x.id} className="flex items-baseline gap-3 px-3 py-1.5 text-micro">
                  <span className="stamp text-faint w-28 shrink-0 tabular" title={new Date(x.at).toLocaleString()}>
                    {new Date(x.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span className={cn("shrink-0", deliveryTone(x))}>
                    {x.outcome === "fired" && x.box ? (
                      <button type="button" className="cursor-pointer hover:underline" onClick={() => onOpenBox(x.box!)}>
                        {deliveryLine(x)}
                      </button>
                    ) : (
                      deliveryLine(x)
                    )}
                  </span>
                  {x.quiet && (
                    <span className="text-faint shrink-0" title="Nothing needed you â€” no notification was sent">
                      quiet
                    </span>
                  )}
                  {x.detail && <span className="text-faint min-w-0 truncate" title={x.detail}>{x.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
