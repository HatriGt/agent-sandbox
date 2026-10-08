// Automation editor (web: components/Automations.tsx → Editor). `id` is `new` for create. Secrets
// the server returns on create (webhook secret / hook URL) are shown once from component state and
// never persisted.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Switch, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  api,
  type AlertPreset,
  type Automation,
  type AutomationDelivery,
  type AutomationDraft,
  type AutomationKind,
  type AutomationSpec,
  type GithubEvent,
  type WatchEvent,
  type HarnessView,
  type RepoInfo,
  type WorkflowView,
  type AgentChoice,
} from "@/lib/api";
import { deliveryLine, deliveryTone } from "@/lib/automationRuns";
import { ago } from "@/lib/format";
import { PressScale } from "@/components/motion";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { OneTimeSecret } from "@/components/settings/OneTimeSecret";
import { PickerRow, PickerSheet, type PickerOption } from "@/components/settings/PickerSheet";
import { SchedulePicker, deviceTimezone } from "@/components/settings/SchedulePicker";
import { Segmented } from "@/components/settings/Segmented";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const KIND_LABEL: Record<AutomationKind, string> = { schedule: "Schedule", chain: "After another", webhook: "Webhook", github: "GitHub", watch: "Repo activity" };
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
const WATCH_GROUPS: { title: string; events: WatchEvent[] }[] = [
  { title: "Pull requests", events: ["pr_opened", "pr_pushed", "pr_ready", "pr_merged", "pr_closed", "pr_reopened"] },
  { title: "Issues", events: ["issue_opened", "issue_closed", "issue_reopened", "issue_labeled"] },
  { title: "Comments", events: ["comment_created"] },
  { title: "Branch & CI", events: ["push", "run_failed", "run_succeeded"] },
  { title: "Releases", events: ["release_published"] },
];
const TASK_HINT: Record<AutomationKind, string | undefined> = {
  schedule: undefined,
  webhook: "Placeholders like {{payload.x}} are filled from the request body.",
  github: "Placeholders like {{pr.title}}, {{issue.title}} or {{event}} are filled from the event.",
  watch: "Placeholders like {{pr.title}}, {{issue.title}} or {{event}} are filled from the event.",
  chain: "Placeholders like {{parent.headline}} are filled from the previous run.",
};
const PRESET_LABEL: Record<AlertPreset, string> = { sentry: "Sentry", datadog: "Datadog", pagerduty: "PagerDuty" };
const PRESET_SECRET_HINT: Record<AlertPreset, string> = {
  sentry: "The integration's Client Secret (Sentry → Settings → Custom Integrations). We check Sentry-Hook-Signature with it.",
  pagerduty: "The webhook subscription's signing secret (shown once when you create it). We check X-PagerDuty-Signature with it.",
  datadog: "Datadog doesn't sign webhooks. Pick a token, and add the custom header X-ASB-Token with it in the Datadog webhook.",
};
const DEFAULT_TEMPLATES: Record<AutomationKind, string> = {
  schedule: "Check the repo for failing tests and open a PR that fixes them.",
  webhook: "Handle this request: {{payload.text}}",
  github: "Fix issue #{{issue.number}}: {{issue.title}}\n\n{{issue.body}}",
  watch: 'Review PR #{{pr.number}} "{{pr.title}}" ({{pr.html_url}}).\nRead the diff and post one review comment on the PR with concrete findings (bugs, risks, missing tests). Do not push commits.',
  chain: "Review what the previous run did ({{parent.headline}}) and tighten it.",
};
const ALERT_TEMPLATE = "{{alert.source}} alert: {{alert.title}}\n\nSeverity: {{alert.severity}}\nService: {{alert.service}}\nLink: {{alert.url}}\n\n{{alert.message}}";

function blank(kind: AutomationKind = "schedule"): AutomationDraft {
  return {
    name: "",
    kind,
    spec:
      kind === "schedule"
        ? { cron: "0 9 * * 1-5", timezone: deviceTimezone() }
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

/** Strip server-only fields down to what the editor sends. */
function toDraft(a: Automation): AutomationDraft {
  return {
    name: a.name,
    kind: a.kind,
    spec: { ...a.spec },
    repos: a.repos,
    taskTemplate: a.taskTemplate,
    enabled: a.enabled,
    prComment: a.prComment,
    quiet: a.quiet,
    agent: a.agent,
    model: a.model,
    harnessId: a.harnessId,
    workflowId: a.workflowId,
  };
}

type Sheet = "repo" | "after" | "agent" | "model" | "harness" | "workflow" | null;

export default function AutomationEditorRoute() {
  const { signedIn } = useAuth();
  if (!signedIn) return <Redirect href="/welcome" />;
  return <Editor />;
}

function Editor() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = rawId === "new" ? null : rawId;
  const router = useRouter();
  const { palette } = useTheme();

  const [d, setD] = useState<AutomationDraft | null>(id ? null : blank());
  const [existing, setExisting] = useState<Automation | null>(null);
  const [all, setAll] = useState<Automation[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ secret?: string; hookUrl?: string } | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);

  // Pickers' data — fetched lazily the first time a sheet opens.
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [repoQ, setRepoQ] = useState("");
  const [repoBusy, setRepoBusy] = useState(false);
  const [agents, setAgents] = useState<AgentChoice[] | null>(null);
  const [models, setModels] = useState<{ id: string; label: string }[] | null>(null);
  const [harnesses, setHarnesses] = useState<HarnessView[] | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowView[] | null>(null);

  // Preview
  const [preview, setPreview] = useState<{ text: string; missing: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { triggers } = await api.automations();
      setAll(triggers);
      if (id) {
        const a = triggers.find((t) => t.id === id);
        if (!a) {
          setLoadErr("This automation no longer exists.");
          return;
        }
        setExisting(a);
        setD(toDraft(a));
      }
    } catch (e) {
      setLoadErr(msg(e));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  const set = (patch: Partial<AutomationDraft>) => setD((cur) => (cur ? { ...cur, ...patch } : cur));
  const setSpec = (patch: Partial<AutomationSpec>) => setD((cur) => (cur ? { ...cur, spec: { ...cur.spec, ...patch } } : cur));

  const changeKind = (kind: AutomationKind) =>
    setD((cur) => {
      if (!cur || cur.kind === kind) return cur;
      const b = blank(kind);
      const keepTask = cur.taskTemplate.trim() && cur.taskTemplate !== DEFAULT_TEMPLATES[cur.kind] && cur.taskTemplate !== ALERT_TEMPLATE;
      return { ...b, name: cur.name, repos: cur.repos, taskTemplate: keepTask ? cur.taskTemplate : b.taskTemplate, agent: cur.agent, model: cur.model, harnessId: cur.harnessId, workflowId: cur.workflowId, quiet: cur.quiet };
    });

  // Repo search (debounced) while the repo sheet is open.
  const repoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRepos = (q: string) => {
    setRepoQ(q);
    if (repoTimer.current) clearTimeout(repoTimer.current);
    repoTimer.current = setTimeout(async () => {
      setRepoBusy(true);
      try {
        setRepos((await api.repos(q)).repos);
      } catch {
        /* keep the previous list; the sheet shows "nothing" rather than an error strip */
      } finally {
        setRepoBusy(false);
      }
    }, 250);
  };
  const open = (s: Exclude<Sheet, null>) => {
    setSheet(s);
    if (s === "repo" && !repos.length) searchRepos(repoQ);
    if (s === "agent" && agents === null) api.agentPrefs().then((r) => setAgents(r.agents)).catch(() => setAgents([]));
    if (s === "model" && models === null) api.models().then((r) => setModels(r.models)).catch(() => setModels([]));
    if (s === "harness" && harnesses === null) api.harnesses().then((r) => setHarnesses(r.harnesses)).catch(() => setHarnesses([]));
    if (s === "workflow" && workflows === null) api.workflows().then((r) => setWorkflows(r.workflows)).catch(() => setWorkflows([]));
  };

  const runPreview = async () => {
    if (!d) return;
    setPreviewing(true);
    setErr(null);
    try {
      const r = await api.previewAutomation(d.taskTemplate, id ?? undefined, d.name);
      setPreview({ text: r.text, missing: r.missing });
    } catch (e) {
      setErr(msg(e));
    } finally {
      setPreviewing(false);
    }
  };

  const problems = useMemo(() => {
    if (!d) return [];
    const p: string[] = [];
    if (!d.name.trim()) p.push("Give it a name.");
    if (!d.taskTemplate.trim()) p.push("Write the task.");
    if (d.kind === "schedule" && !(d.spec.cron ?? "").trim()) p.push("Pick a schedule.");
    if (d.kind === "chain" && !d.spec.afterTrigger) p.push("Pick the automation this runs after.");
    if (d.kind === "github" && !d.repos?.length) p.push("GitHub automations need a repo.");
    if (d.kind === "github" && d.spec.event === "issue_labeled" && !(d.spec.label ?? "").trim()) p.push("Which label?");
    if (d.kind === "github" && d.spec.event === "issue_comment" && !(d.spec.command ?? "").trim()) p.push("Which comment command?");
    if (d.kind === "watch" && !d.repos?.length) p.push("Repo activity automations need a repo.");
    if (d.kind === "watch" && !d.spec.watch?.length) p.push("Pick at least one event.");
    return p;
  }, [d]);

  const save = async () => {
    if (!d || problems.length) return;
    setSaving(true);
    setErr(null);
    const body: AutomationDraft = {
      ...d,
      name: d.name.trim(),
      repos: d.repos?.length ? d.repos : undefined,
      signingSecret: d.signingSecret?.trim() || undefined,
      spec: d.kind === "schedule" ? { ...d.spec, timezone: d.spec.timezone?.trim() || deviceTimezone() } : d.spec,
    };
    try {
      if (id) {
        await api.updateAutomation(id, body);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.back();
      } else {
        const r = await api.createAutomation(body);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (r.secret || r.hookUrl) {
          setCreated({ secret: r.secret, hookUrl: r.hookUrl });
          setExisting(r.trigger);
        } else router.back();
      }
    } catch (e) {
      setErr(msg(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    try {
      await api.deleteAutomation(id);
      router.back();
    } catch (e) {
      setErr(msg(e));
    }
  };

  const title = id ? (existing?.proposed && !existing.enabled ? "Proposed by the agent" : "Edit automation") : "New automation";

  if (created) {
    return (
      <SettingsScreen title="Created">
        <T variant="body" tone="muted">
          {existing?.name ?? d?.name} is saved{d?.enabled ? " and on" : ""}.{" "}
          {d?.spec.preset ? `Paste the URL as the webhook in ${PRESET_LABEL[d.spec.preset]}, then use "Send test event" from the list.` : "POST to the URL to start a run."}
        </T>
        {created.hookUrl ? <OneTimeSecret label="Webhook URL" value={created.hookUrl} hint="Stays valid; shown here for convenience." /> : null}
        {created.secret ? <OneTimeSecret label="Secret" value={created.secret} /> : null}
        <Button title="Done" onPress={() => router.back()} />
      </SettingsScreen>
    );
  }

  if (!d) {
    return (
      <SettingsScreen title={title}>
        {loadErr ? (
          <T variant="meta" tone="destructive">
            {loadErr}
          </T>
        ) : (
          <T variant="meta" tone="faint">
            Loading…
          </T>
        )}
      </SettingsScreen>
    );
  }

  const chainOptions: PickerOption[] = all.filter((a) => a.id !== id && a.kind !== "chain").map((a) => ({ value: a.id, label: a.name, hint: `${KIND_LABEL[a.kind]} · ${a.when}` }));
  const afterName = all.find((a) => a.id === d.spec.afterTrigger)?.name;
  const pendingProposal = !!existing?.proposed && !existing.enabled;

  return (
    <SettingsScreen title={title}>
      {pendingProposal ? (
        <View style={{ padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.lineStrong, gap: 4 }}>
          <T variant="meta" weight="semibold">
            Waiting for your approval
          </T>
          <T variant="micro" tone="muted">
            {existing?.sourceTitle ? `Suggested at the end of "${existing.sourceTitle}". ` : ""}Turn it on below to approve, or delete to dismiss.
          </T>
        </View>
      ) : null}

      <Field label="Name" value={d.name} onChangeText={(t) => set({ name: t })} placeholder="Nightly test fixer" maxLength={80} />

      <View style={{ gap: 6 }}>
        <T variant="meta" weight="medium" tone="muted">
          Starts
        </T>
        <Segmented value={d.kind} onChange={changeKind} options={(Object.keys(KIND_LABEL) as AutomationKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
      </View>

      {d.kind === "schedule" && d.spec.at && !d.spec.cron ? (
        <Card style={{ gap: 6 }}>
          <T variant="body" weight="semibold">
            Runs once · {new Date(d.spec.at).toLocaleString()}
          </T>
          <T variant="micro" tone="muted">
            Made from a chat. To make it repeat, create a new automation.
          </T>
        </Card>
      ) : d.kind === "schedule" ? (
        <Card>
          <SchedulePicker cron={d.spec.cron ?? ""} timezone={d.spec.timezone ?? deviceTimezone()} onChange={(p) => setSpec(p)} />
        </Card>
      ) : null}

      {d.kind === "chain" ? (
        <Card style={{ gap: 12 }}>
          <PickerRow label="After" value={afterName} placeholder="Pick an automation" onPress={() => open("after")} />
          <View style={{ gap: 6 }}>
            <T variant="meta" weight="medium" tone="muted">
              When it
            </T>
            <Segmented
              small
              value={d.spec.on ?? "done"}
              onChange={(v) => setSpec({ on: v })}
              options={[
                { value: "done", label: "finishes well" },
                { value: "any", label: "finishes at all" },
              ]}
            />
          </View>
          <View style={{ gap: 6 }}>
            <T variant="meta" weight="medium" tone="muted">
              Carry over
            </T>
            <Segmented
              small
              value={d.spec.carry ?? "patch"}
              onChange={(v) => setSpec({ carry: v })}
              options={[
                { value: "patch", label: "its changes" },
                { value: "none", label: "nothing" },
              ]}
            />
          </View>
        </Card>
      ) : null}

      {d.kind === "webhook" ? (
        <Card style={{ gap: 12 }}>
          <View style={{ gap: 6 }}>
            <T variant="meta" weight="medium" tone="muted">
              Source
            </T>
            <Segmented
              small
              value={d.spec.preset ?? "generic"}
              onChange={(v) => {
                const preset = v === "generic" ? undefined : (v as AlertPreset);
                setD((cur) => {
                  if (!cur) return cur;
                  const genericTask = !cur.taskTemplate.trim() || cur.taskTemplate === DEFAULT_TEMPLATES.webhook || cur.taskTemplate === ALERT_TEMPLATE;
                  return { ...cur, spec: preset ? { preset, cooldownMin: cur.spec.cooldownMin ?? 30 } : {}, taskTemplate: genericTask ? (preset ? ALERT_TEMPLATE : DEFAULT_TEMPLATES.webhook) : cur.taskTemplate };
                });
              }}
              options={[{ value: "generic", label: "Any POST" }, ...(Object.keys(PRESET_LABEL) as AlertPreset[]).map((p) => ({ value: p, label: PRESET_LABEL[p] }))]}
            />
          </View>
          {d.spec.preset ? (
            <>
              <Field
                label="Signing secret"
                value={d.signingSecret ?? ""}
                onChangeText={(t) => set({ signingSecret: t })}
                placeholder={existing?.hasSigningSecret ? "•••••••• (saved; leave blank to keep)" : ""}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                hint={PRESET_SECRET_HINT[d.spec.preset]}
              />
              <Field
                label="Cooldown (minutes)"
                value={String(d.spec.cooldownMin ?? 30)}
                onChangeText={(t) => setSpec({ cooldownMin: Math.max(0, Number(t.replace(/\D/g, "")) || 0) })}
                keyboardType="number-pad"
                hint="Alerts for the same thing within this window don't start another run."
              />
            </>
          ) : (
            <T variant="micro" tone="faint">
              A secret is generated when you save; POST with it in the Authorization header. Shown once.
            </T>
          )}
        </Card>
      ) : null}

      {d.kind === "github" ? (
        <Card style={{ gap: 12 }}>
          <View style={{ gap: 6 }}>
            <T variant="meta" weight="medium" tone="muted">
              Event
            </T>
            <Segmented
              small
              value={d.spec.event ?? "issue_labeled"}
              onChange={(ev) => setSpec({ event: ev, ...(ev === "issue_labeled" ? { label: d.spec.label ?? "agent" } : {}), ...(ev === "issue_comment" ? { command: d.spec.command ?? "/agent" } : {}) })}
              options={(Object.keys(EVENT_LABEL) as GithubEvent[]).map((e) => ({ value: e, label: EVENT_LABEL[e] }))}
            />
          </View>
          {d.spec.event === "issue_labeled" ? <Field label="Label" value={d.spec.label ?? ""} onChangeText={(t) => setSpec({ label: t })} placeholder="agent" autoCapitalize="none" /> : null}
          {d.spec.event === "issue_comment" ? (
            <Field mono label="Comment starts with" value={d.spec.command ?? ""} onChangeText={(t) => setSpec({ command: t })} placeholder="/agent" autoCapitalize="none" autoCorrect={false} />
          ) : null}
          {d.spec.event === "pr_opened" ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <T variant="body">Include PRs from forks</T>
                <T variant="micro" tone="faint">
                  Off by default — fork PRs can carry untrusted code.
                </T>
              </View>
              <Switch value={!!d.spec.allowForks} onValueChange={(v) => setSpec({ allowForks: v })} trackColor={{ true: palette.live }} />
            </View>
          ) : null}
        </Card>
      ) : null}

      {d.kind === "watch" ? (
        <Card style={{ gap: 12 }}>
          <T variant="micro" tone="faint">
            Checked every 15 s with your GitHub account — no webhook needed. Existing items are not replayed; only changes after you save fire.
          </T>
          {WATCH_GROUPS.map((g) => (
            <View key={g.title} style={{ gap: 8 }}>
              <T variant="meta" weight="medium" tone="muted">
                {g.title}
              </T>
              {g.events.map((ev) => {
                const on = !!d.spec.watch?.includes(ev);
                return (
                  <ToggleRow
                    key={ev}
                    label={WATCH_LABEL[ev]}
                    value={on}
                    onChange={(v) => {
                      const cur = d.spec.watch ?? [];
                      setSpec({ watch: v ? [...cur.filter((e) => e !== ev), ev] : cur.filter((e) => e !== ev) });
                    }}
                  />
                );
              })}
            </View>
          ))}
          {(() => {
            const w = d.spec.watch ?? [];
            const push = w.includes("push");
            const runs = w.includes("run_failed") || w.includes("run_succeeded");
            const forks = w.some((e) => e.startsWith("pr_"));
            return (
              <>
                {push || runs ? (
                  <Field
                    mono
                    label="Branch"
                    value={d.spec.branch ?? ""}
                    onChangeText={(t) => setSpec({ branch: t || undefined })}
                    placeholder={push ? "default branch" : "any branch"}
                    autoCapitalize="none"
                    autoCorrect={false}
                    hint={push && runs ? "Push: blank = the repo's default branch. Workflow runs: blank = any branch." : push ? "Blank = the repo's default branch." : "Blank = any branch."}
                  />
                ) : null}
                {w.includes("issue_labeled") ? (
                  <Field label="Label" value={d.spec.label ?? ""} onChangeText={(t) => setSpec({ label: t || undefined })} placeholder="any label" autoCapitalize="none" />
                ) : null}
                {w.includes("comment_created") ? (
                  <Field
                    mono
                    label="Comment starts with"
                    value={d.spec.command ?? ""}
                    onChangeText={(t) => setSpec({ command: t || undefined })}
                    placeholder="any comment"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                ) : null}
                {forks ? (
                  <ToggleRow label="Include PRs from forks" hint="Off by default — fork PRs can carry untrusted code." value={!!d.spec.allowForks} onChange={(v) => setSpec({ allowForks: v })} />
                ) : null}
              </>
            );
          })()}
        </Card>
      ) : null}

      <PickerRow label={d.kind === "github" || d.kind === "watch" ? "Repos" : "Repos (optional)"} value={d.repos?.join(", ")} placeholder="owner/name" onPress={() => open("repo")} />

      <Field
        label="Task"
        value={d.taskTemplate}
        onChangeText={(t) => {
          set({ taskTemplate: t });
          setPreview(null);
        }}
        multiline
        style={{ minHeight: 110, textAlignVertical: "top" }}
        hint={TASK_HINT[d.kind]}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button small variant="secondary" title="Preview" loading={previewing} onPress={() => void runPreview()} />
      </View>
      {preview ? (
        <Card style={{ gap: 6 }}>
          <T variant="micro" weight="semibold" tone="muted">
            Preview
          </T>
          <T variant="meta">{preview.text || "(empty)"}</T>
          {preview.missing.length ? (
            <T variant="micro" tone="muted">
              Empty until a payload has: {preview.missing.map((m) => `{{${m}}}`).join(", ")}
            </T>
          ) : null}
        </Card>
      ) : null}

      <Card style={{ gap: 12 }}>
        <ToggleRow label="On" hint={pendingProposal ? "Turning on approves the proposal." : "Off = paused; nothing fires."} value={d.enabled} onChange={(v) => set({ enabled: v })} />
        <ToggleRow label="Comment on the PR" hint="Post the run's summary as a PR comment." value={d.prComment} onChange={(v) => set({ prComment: v })} />
        <ToggleRow label="Quiet" hint="Don't push-notify when a run from this automation finishes." value={!!d.quiet} onChange={(v) => set({ quiet: v || undefined })} />
        <View style={{ gap: 6 }}>
          <T variant="meta" weight="medium" tone="muted">
            Box after the run
          </T>
          <Segmented
            small
            value={d.spec.destroy ?? "keep"}
            onChange={(v) => setSpec({ destroy: v === "keep" ? undefined : (v as "done" | "always") })}
            options={[
              { value: "keep", label: "Keep" },
              { value: "done", label: "If done" },
              { value: "always", label: "Always" },
            ]}
          />
          <T variant="micro" tone="muted">
            Destroy the box when the run finishes. Keep = the global sleep rule; pinned boxes and runs waiting on a question stay.
          </T>
        </View>
      </Card>

      <Card style={{ gap: 12 }}>
        <T variant="micro" weight="semibold" tone="muted">
          Who runs it (optional)
        </T>
        <PickerRow label="Agent" value={agents?.find((a) => a.id === d.agent)?.label ?? d.agent} placeholder="Default agent" onPress={() => open("agent")} />
        <PickerRow label="Model" value={models?.find((m) => m.id === d.model)?.label ?? d.model} placeholder="Default model" onPress={() => open("model")} />
        <PickerRow label="Harness" value={harnesses?.find((h) => h.id === d.harnessId)?.name ?? (d.harnessId ? "…" : undefined)} placeholder="None" onPress={() => open("harness")} />
        <PickerRow label="Playbook" value={workflows?.find((w) => w.id === d.workflowId)?.name ?? (d.workflowId ? "…" : undefined)} placeholder="None" onPress={() => open("workflow")} />
      </Card>

      {problems.length ? (
        <T variant="micro" tone="muted">
          {problems.join(" ")}
        </T>
      ) : null}
      {err ? (
        <T variant="meta" tone="destructive">
          {err}
        </T>
      ) : null}
      <Button title={id ? "Save" : "Create"} loading={saving} disabled={problems.length > 0} onPress={() => void save()} />
      {id ? (
        <View style={{ alignItems: "flex-start", marginTop: 8 }}>
          <ArmButton title={pendingProposal ? "Dismiss proposal" : "Delete automation"} armedTitle="Tap again to delete" variant="ghost" onConfirm={remove} />
        </View>
      ) : null}

      {id ? <Runs id={id} /> : null}

      <PickerSheet
        visible={sheet === "repo"}
        title="Repos — tap to add or remove"
        options={repos.map((r) => ({ value: r.fullName, label: `${(d.repos ?? []).some((x) => x.toLowerCase() === r.fullName.toLowerCase()) ? "✓ " : ""}${r.fullName}`, hint: r.description }))}
        value={undefined}
        allowNone={d.kind !== "github" && d.kind !== "watch"}
        noneLabel="No repos"
        onPick={(v) => set({ repos: !v ? undefined : (d.repos ?? []).some((r) => r.toLowerCase() === v.toLowerCase()) ? (d.repos ?? []).filter((r) => r.toLowerCase() !== v.toLowerCase()) : [...(d.repos ?? []), v] })}
        onClose={() => setSheet(null)}
        onSearch={searchRepos}
        searching={repoBusy}
        emptyText={repoQ ? "No repo matches." : "Type to search your repos."}
      />
      <PickerSheet visible={sheet === "after"} title="Runs after" options={chainOptions} value={d.spec.afterTrigger} onPick={(v) => setSpec({ afterTrigger: v })} onClose={() => setSheet(null)} emptyText="No other automations to chain from yet." />
      <PickerSheet
        visible={sheet === "agent"}
        title="Agent"
        options={(agents ?? []).map((a) => ({ value: a.id, label: a.label, hint: a.supervised === false ? "supervised: partial" : undefined }))}
        value={d.agent}
        allowNone
        noneLabel="Default agent"
        onPick={(v) => set({ agent: v })}
        onClose={() => setSheet(null)}
        emptyText={agents === null ? "Loading…" : "No agents available."}
      />
      <PickerSheet
        visible={sheet === "model"}
        title="Model"
        options={(models ?? []).map((m) => ({ value: m.id, label: m.label, hint: m.id }))}
        value={d.model}
        allowNone
        noneLabel="Default model"
        onPick={(v) => set({ model: v })}
        onClose={() => setSheet(null)}
        emptyText={models === null ? "Loading…" : "No models listed."}
      />
      <PickerSheet
        visible={sheet === "harness"}
        title="Harness"
        options={(harnesses ?? []).map((h) => ({ value: h.id, label: h.name, hint: h.description }))}
        value={d.harnessId}
        allowNone
        onPick={(v) => set({ harnessId: v })}
        onClose={() => setSheet(null)}
        emptyText={harnesses === null ? "Loading…" : "No harnesses saved. Make one on the web."}
      />
      <PickerSheet
        visible={sheet === "workflow"}
        title="Playbook"
        options={(workflows ?? []).map((w) => ({ value: w.id, label: w.name, hint: w.description ?? `${w.steps.length} steps` }))}
        value={d.workflowId}
        allowNone
        onPick={(v) => set({ workflowId: v })}
        onClose={() => setSheet(null)}
        emptyText={workflows === null ? "Loading…" : "No playbooks saved. Make one on the web."}
      />
    </SettingsScreen>
  );
}

type RunFilter = "all" | "fired" | "skipped" | "rejected";

/** This automation's run history — the last 50 deliveries, newest first (web: AutomationRunsPage). */
function Runs({ id }: { id: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<AutomationDelivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RunFilter>("all");

  const load = useCallback(() => {
    setError(null);
    return api
      .automationDeliveries(id)
      .then((r) => setRows(r.deliveries))
      .catch((e) => setError(msg(e)));
  }, [id]);
  useEffect(() => void load(), [load]);

  const all = rows ?? [];
  const counts = { all: all.length, fired: all.filter((d) => d.outcome === "fired").length, skipped: all.filter((d) => d.outcome === "skipped").length, rejected: all.filter((d) => d.outcome === "rejected" || d.outcome === "failed").length };
  const shown = all.filter((d) => (filter === "all" ? true : filter === "rejected" ? d.outcome === "rejected" || d.outcome === "failed" : d.outcome === filter));
  const label = (name: string, n: number) => (n ? `${name} · ${n}` : name);

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <T variant="micro" weight="semibold" tone="muted">
          Runs
        </T>
        <T variant="micro" tone="faint">
          last 50 deliveries
        </T>
      </View>
      <Segmented<RunFilter>
        small
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: label("All", counts.all) },
          { value: "fired", label: label("Fired", counts.fired) },
          { value: "skipped", label: label("Skipped", counts.skipped) },
          { value: "rejected", label: label("Rejected", counts.rejected) },
        ]}
      />
      {error ? (
        <View style={{ gap: 8, alignItems: "flex-start" }}>
          <T variant="meta" tone="destructive">
            {error}
          </T>
          <Button title="Retry" variant="secondary" small onPress={() => void load()} />
        </View>
      ) : rows === null ? (
        <T variant="micro" tone="faint">
          Loading…
        </T>
      ) : shown.length === 0 ? (
        <T variant="meta" tone="muted">
          {counts.all === 0 ? "Nothing has arrived yet. Every delivery lands here: fired (with the box it opened), skipped and why, or rejected." : "Nothing matches this filter."}
        </T>
      ) : (
        <View style={{ gap: 6 }}>
          {shown.map((d) => (
            <PressScale key={d.id} disabled={!d.box} onPress={() => d.box && router.push(`/box/${encodeURIComponent(d.box)}`)} accessibilityRole={d.box ? "link" : undefined}>
              <T variant="meta" tone={deliveryTone(d)} numberOfLines={2}>
                {ago(d.at)} · {deliveryLine(d)}
                {d.detail && d.outcome !== "fired" ? ` — ${d.detail}` : ""}
              </T>
            </PressScale>
          ))}
        </View>
      )}
    </Card>
  );
}

function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="body">{label}</T>
        {hint ? (
          <T variant="micro" tone="faint">
            {hint}
          </T>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: palette.live }} />
    </View>
  );
}
