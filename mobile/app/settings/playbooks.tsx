// Playbooks (web: components/PlaybooksPage.tsx). Header: From a repo · New playbook. Saved
// playbooks (steps, automated by, last run, source; Run · Edit · Delete), Start from a template,
// the notes panel. The YAML editor is /playbook/[id].
import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { api, ledgerApi, type Automation, type BoxView, type LedgerRow, type WorkflowView } from "@/lib/api";
import { ago } from "@/lib/format";
import { EXAMPLE, STARTERS } from "@/lib/playbookStarters";
import { setPlaybookSeed } from "@/lib/playbookSeed";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The newest run of a playbook: a live box (BoxView.workflow) beats any archived record (LedgerRow.workflowId). */
type LastRun = { kind: "live"; box: BoxView } | { kind: "archived"; run: LedgerRow };

function lastRunLine(l: LastRun | null): { text: string; tone: "faint" | "ok" | "live" | "destructive" } {
  if (!l) return { text: "Last run: never", tone: "faint" };
  if (l.kind === "live") {
    const wf = l.box.workflow!;
    return { text: `Last run: ${wf.state === "running" ? `step ${wf.step}/${wf.total}` : wf.state}`, tone: wf.state === "failed" ? "destructive" : wf.state === "done" ? "ok" : "live" };
  }
  const at = l.run.endedAt ?? l.run.archivedAt;
  return { text: `Last run: ${at ? ago(at) : l.run.state}`, tone: l.run.state === "failed" ? "destructive" : "ok" };
}

export default function Playbooks() {
  const router = useRouter();
  const [list, setList] = useState<WorkflowView[] | null>(null);
  const [dir, setDir] = useState(".agent-sandbox/workflows");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [triggers, setTriggers] = useState<Automation[]>([]);
  const [boxes, setBoxes] = useState<BoxView[]>([]);
  // Newest archived run per playbook. The newest 100 rows are enough: the page only needs the
  // newest run per playbook, and a run older than the page is still "Never" at worst.
  const [archived, setArchived] = useState<Map<string, LedgerRow>>(new Map());

  const reload = useCallback(() => {
    api
      .workflows()
      .then((r) => {
        setList(r.workflows);
        setDir(r.dir);
        setError(null);
      })
      .catch((e) => setError(msg(e)));
    api.automations().then((r) => setTriggers(r.triggers)).catch(() => {});
    api.fleet().then((r) => setBoxes(r.boxes)).catch(() => {});
    ledgerApi({ limit: 100 })
      .then((r) => {
        const m = new Map<string, LedgerRow>();
        for (const row of r.rows) if (row.workflowId && !m.has(row.workflowId)) m.set(row.workflowId, row);
        setArchived(m);
      })
      .catch(() => {});
  }, []);
  useFocusEffect(reload);

  const startFrom = (yaml: string) => {
    setPlaybookSeed(yaml);
    router.push("/playbook/new");
  };
  const lastRun = (id: string): LastRun | null => {
    const live = boxes.filter((b) => b.workflow?.id === id).sort((a, b) => (b.lastOutputAt ?? 0) - (a.lastOutputAt ?? 0))[0];
    if (live) return { kind: "live", box: live };
    const run = archived.get(id);
    return run ? { kind: "archived", run } : null;
  };
  // Run: the composer with this playbook preselected; the task fills {{task}}.
  const runPlaybook = (w: WorkflowView) => router.push({ pathname: "/new", params: { workflow: w.id } });
  const items = list ?? [];

  return (
    <SettingsScreen title="Playbooks">
      <T variant="body" tone="muted">
        <T variant="body">How</T> a task gets done: agent turns and command checks, in order. Failed checks go back to the agent. Use one from the composer, or let an automation run it.
      </T>
      {info ? (
        <T variant="meta" tone="muted">
          {info}
        </T>
      ) : null}

      {importing ? (
        <ImportFromRepo
          dir={dir}
          onCancel={() => setImporting(false)}
          onDone={(r, note) => {
            setList(r.workflows);
            setInfo(note);
            setImporting(false);
          }}
        />
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button small variant="outline" title="From a repo" onPress={() => setImporting(true)} />
            <Button small title="New playbook" onPress={() => startFrom(EXAMPLE)} />
          </View>

          <Section title="Saved playbooks" meta={list ? String(items.length) : undefined} purpose="Pick one in the composer, or automate it; your task fills {{task}} in its first step.">
            {error ? (
              <Card style={{ gap: 8 }}>
                <T variant="body" weight="medium">
                  Couldn't load playbooks
                </T>
                <T variant="meta" tone="destructive">
                  {error}
                </T>
                <View style={{ flexDirection: "row" }}>
                  <Button small variant="outline" title="Retry" onPress={reload} />
                </View>
              </Card>
            ) : !list ? (
              <T tone="muted">Loading…</T>
            ) : !items.length ? (
              <Card style={{ gap: 8 }}>
                <T variant="body" weight="medium">
                  No playbooks yet
                </T>
                <T variant="meta" tone="muted">
                  Implement → test → review, with the test failure handed back to the agent. Write one here, start from a template below, or keep them in your repo.
                </T>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button small title="New playbook" onPress={() => startFrom(EXAMPLE)} />
                  <Button small variant="outline" title="From a repo" onPress={() => setImporting(true)} />
                </View>
              </Card>
            ) : (
              items.map((w) => {
                const used = triggers.filter((t) => t.workflowId === w.id);
                const checks = w.steps.filter((s) => s.kind === "check").length;
                const open = () => router.push(`/playbook/${encodeURIComponent(w.id)}`);
                const last = lastRunLine(lastRun(w.id));
                return (
                  <Card key={w.id} onPress={open}>
                    <T variant="body" weight="medium" numberOfLines={1}>
                      {w.name}
                    </T>
                    <T variant="micro" tone="muted" numberOfLines={1}>
                      {w.description || `updated ${ago(w.updatedAt)}`}
                    </T>
                    <T variant="micro" tone="muted" numberOfLines={1} style={{ marginTop: 4 }}>
                      {w.steps.map((s) => (s.kind === "check" ? `$ ${s.title}` : s.title)).join(" → ")}
                    </T>
                    <T variant="micro" tone="faint" numberOfLines={1}>
                      {`${w.steps.length} step${w.steps.length === 1 ? "" : "s"} · ${checks} check${checks === 1 ? "" : "s"}`}
                    </T>
                    <T variant="micro" tone={used.length ? "default" : "faint"} numberOfLines={1}>
                      {used.length ? `Automated by ${used.length === 1 ? used[0].name : `${used.length} automations`}` : "Manual only"}
                    </T>
                    <T variant="micro" tone={last.tone} numberOfLines={1}>
                      {last.text}
                    </T>
                    <T variant="micro" tone="muted" mono={w.origin?.kind === "repo"} numberOfLines={1}>
                      {w.origin?.kind === "repo" ? w.origin.repo : "Saved here"}
                    </T>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                      <Button small variant="ghost" title="Run" onPress={() => runPlaybook(w)} />
                      <Button small variant="ghost" title="Edit" onPress={open} />
                      <ArmButton
                        small
                        variant="ghost"
                        title="Delete"
                        armedTitle="Delete"
                        onConfirm={async () => {
                          try {
                            setList((await api.workflowMutate({ action: "delete", id: w.id })).workflows);
                            setInfo("Deleted");
                          } catch (e) {
                            setError(msg(e));
                          }
                        }}
                      />
                    </View>
                  </Card>
                );
              })
            )}
          </Section>

          <Section title="Start from a template" purpose="Opens in the editor — change anything before you save.">
            {STARTERS.map((s) => (
              <Card key={s.name} onPress={() => startFrom(s.yaml)}>
                <T variant="meta" weight="medium">
                  {s.name}
                </T>
                <T variant="micro" tone="muted">
                  {s.line}
                </T>
              </Card>
            ))}
          </Section>

          <Card>
            <T variant="micro" tone="muted">
              Every step runs in the <T variant="micro">same sandbox</T>: a prompt step is one more turn of the same agent (it keeps its context and can still stop to ask you), and a command step runs after the previous turn finishes — exit 0 moves on, anything else goes back to the agent with the output, up to <T variant="micro" mono>retry</T> times. A repository can keep its own in <T variant="micro" mono>{`${dir}/*.yaml`}</T>; a harness still sets the driver, model and rules.
            </T>
          </Card>
        </>
      )}
    </SettingsScreen>
  );
}

function Section({ title, meta, purpose, children }: { title: string; meta?: string; purpose: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <T variant="h3" weight="semibold">
          {title}
        </T>
        {meta ? (
          <T variant="micro" tone="faint">
            {meta}
          </T>
        ) : null}
      </View>
      <T variant="meta" tone="muted">
        {purpose}
      </T>
      {children}
    </View>
  );
}

/** Read every `*.yaml` under the repo's playbook folder (web: PlaybooksPage › ImportFromRepo). */
function ImportFromRepo({ dir, onCancel, onDone }: { dir: string; onCancel: () => void; onDone: (r: { workflows: WorkflowView[] }, note: string) => void }) {
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    const s = repo.trim().replace(/^https?:\/\/github\.com\//, "");
    const m = s.match(/^([\w.-]+\/[\w.-]+?)(?:\.git)?(?:@(.+))?$/);
    if (!m) return setError("Enter a repository as owner/repo (optionally @branch).");
    setBusy(true);
    setError(null);
    try {
      const r = await api.workflowMutate({ action: "import-repo", repo: m[1], ...(m[2] ? { ref: m[2] } : {}) });
      const n = r.imported?.length ?? 0;
      onDone(r, `${n ? `Imported ${n} playbook${n === 1 ? "" : "s"} from ${m[1]}` : `Nothing imported from ${m[1]}`}${r.skipped?.length ? ` — ${r.skipped.join(" · ")}` : ""}`);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: 12 }}>
      <Field
        label="Repository"
        hint={`Reads ${dir}/*.yaml on the default branch (or @branch). Private repos use your connected GitHub account.`}
        mono
        value={repo}
        onChangeText={setRepo}
        onSubmitEditing={() => void run()}
        placeholder="owner/repo or owner/repo@branch"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
      />
      {error ? (
        <T variant="micro" tone="destructive">
          {error}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Button small variant="ghost" title="Cancel" disabled={busy} onPress={onCancel} />
        <Button small title="Import" loading={busy} disabled={busy || !repo.trim()} onPress={() => void run()} />
      </View>
    </Card>
  );
}
