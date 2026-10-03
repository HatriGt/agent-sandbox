import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { api, type WorkflowView } from "@/lib/api";
import { STARTERS } from "@/lib/playbookStarters";
import { setPlaybookSeed } from "@/lib/playbookSeed";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Playbooks: a task as a short script of agent turns and command checks. Tap to edit the YAML. */
export default function Playbooks() {
  const router = useRouter();
  const [list, setList] = useState<WorkflowView[] | null>(null);
  const [dir, setDir] = useState(".agent-sandbox/workflows");
  const [error, setError] = useState<string | null>(null);
  const [repo, setRepo] = useState("");
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      api
        .workflows()
        .then((r) => {
          setList(r.workflows);
          setDir(r.dir);
        })
        .catch((e) => setError(msg(e)));
    }, []),
  );

  const importRepo = async () => {
    const m = repo.trim().match(/^(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?(?:@([\w./-]+))?\/?$/);
    if (!m) {
      setError("Use owner/name (optionally @branch).");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const r = await api.workflowMutate({ action: "import-repo", repo: m[1], ...(m[2] ? { ref: m[2] } : {}) });
      setList(r.workflows);
      setNote(`Imported ${r.imported?.length ?? 0}${r.skipped?.length ? `, skipped ${r.skipped.length}` : ""}.`);
      setRepo("");
    } catch (e) {
      setError(msg(e));
    } finally {
      setImporting(false);
    }
  };

  const startFrom = (yaml: string) => {
    setPlaybookSeed(yaml);
    router.push("/playbook/new");
  };

  return (
    <SettingsScreen title="Playbooks">
      <T variant="body" tone="muted">
        Agent turns and command checks run in order. Pick one in the composer's run settings.
      </T>
      <View style={{ flexDirection: "row" }}>
        <Button small variant="secondary" title="+ New playbook" onPress={() => startFrom(STARTERS[0].yaml)} />
      </View>
      {error ? (
        <T variant="meta" tone="destructive">
          {error}
        </T>
      ) : null}
      {list === null && !error ? <T tone="muted">Loading…</T> : null}
      {list?.map((w) => (
        <Card key={w.id} onPress={() => router.push(`/playbook/${encodeURIComponent(w.id)}`)}>
          <T variant="body" weight="semibold" numberOfLines={1}>
            {w.name}
          </T>
          {w.description ? (
            <T variant="meta" tone="muted" numberOfLines={2}>
              {w.description}
            </T>
          ) : null}
          <T variant="micro" tone="faint" numberOfLines={2} style={{ marginTop: 4 }}>
            {w.steps.map((s) => (s.kind === "check" ? `$ ${s.title}` : s.title)).join(" → ")}
          </T>
          {w.origin?.kind === "repo" ? (
            <T variant="micro" tone="faint" numberOfLines={1}>
              from {w.origin.repo}
            </T>
          ) : null}
          <View style={{ flexDirection: "row", marginTop: 8 }}>
            <ArmButton
              small
              variant="ghost"
              title="Delete"
              armedTitle="Tap to delete"
              onConfirm={async () => {
                try {
                  setList((await api.workflowMutate({ action: "delete", id: w.id })).workflows);
                } catch (e) {
                  setError(msg(e));
                }
              }}
            />
          </View>
        </Card>
      ))}

      <T variant="meta" weight="medium" tone="muted" style={{ marginTop: 8 }}>
        Start from a template
      </T>
      {STARTERS.map((s) => (
        <Card key={s.name} onPress={() => startFrom(s.yaml)}>
          <T variant="body" weight="medium">
            {s.name}
          </T>
          <T variant="micro" tone="muted">
            {s.line}
          </T>
        </Card>
      ))}

      <T variant="meta" weight="medium" tone="muted" style={{ marginTop: 8 }}>
        Import from a repo
      </T>
      <Field mono value={repo} onChangeText={setRepo} placeholder="owner/name" autoCapitalize="none" autoCorrect={false} hint={`Reads every file in ${dir}/`} />
      <View style={{ flexDirection: "row" }}>
        <Button small variant="secondary" title="Import" loading={importing} disabled={!repo.trim()} onPress={() => void importRepo()} />
      </View>
      {note ? (
        <T variant="micro" tone="muted">
          {note}
        </T>
      ) : null}
    </SettingsScreen>
  );
}
