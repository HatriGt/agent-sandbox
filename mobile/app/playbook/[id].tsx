// Playbook editor (web: PlaybooksPage → editor). The YAML is the document; the controller validates
// it as you type and the parsed steps are shown below so a prompt is never mistaken for a command.
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, type WorkflowView } from "@/lib/api";
import { EXAMPLE } from "@/lib/playbookStarters";
import { takePlaybookSeed } from "@/lib/playbookSeed";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function PlaybookEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === "new";
  const router = useRouter();
  const { palette } = useTheme();
  const [yaml, setYaml] = useState<string | null>(() => (isNew ? takePlaybookSeed() ?? EXAMPLE : null));
  const [parsed, setParsed] = useState<WorkflowView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!isNew) api.workflowYaml(id).then((r) => setYaml(r.yaml)).catch((e) => setError(msg(e)));
  }, [id, isNew]);

  useEffect(() => {
    if (yaml === null) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      api
        .workflowPreview(yaml)
        .then((r) => {
          if (n !== seq.current) return;
          setParsed(r.workflow);
          setProblem(null);
        })
        .catch((e) => {
          if (n !== seq.current) return;
          setParsed(null);
          setProblem(msg(e));
        });
    }, 500);
    return () => clearTimeout(t);
  }, [yaml]);

  const save = async () => {
    if (yaml === null) return;
    setSaving(true);
    setError(null);
    try {
      await api.workflowMutate({ action: "upsert", ...(isNew ? {} : { id }), yaml });
      router.back();
    } catch (e) {
      setError(msg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsScreen title={isNew ? "New playbook" : parsed?.name ?? "Playbook"}>
      {yaml === null ? (
        error ? <T tone="destructive">{error}</T> : <T tone="muted">Loading…</T>
      ) : (
        <>
          <Field mono value={yaml} onChangeText={setYaml} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} style={{ minHeight: 260, textAlignVertical: "top" }} hint="{{task}} is replaced by the task you give the run." />
          {problem ? (
            <T variant="meta" tone="destructive">
              {problem}
            </T>
          ) : null}
          {parsed ? (
            <Card>
              <T variant="meta" weight="semibold">
                {parsed.name} · {parsed.steps.length} {parsed.steps.length === 1 ? "step" : "steps"}
              </T>
              <View style={{ gap: 6, marginTop: 8 }}>
                {parsed.steps.map((s) => (
                  <View key={s.n} style={{ flexDirection: "row", gap: 8 }}>
                    <T variant="micro" mono tone="faint" style={{ width: 18 }}>
                      {s.n}
                    </T>
                    <T variant="micro" mono={s.kind === "check"} style={{ flex: 1, color: s.kind === "check" ? palette.mutedForeground : palette.foreground }} numberOfLines={2}>
                      {s.kind === "check" ? `$ ${s.title}` : s.title}
                    </T>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}
          {error ? (
            <T variant="meta" tone="destructive">
              {error}
            </T>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title={isNew ? "Create" : "Save"} loading={saving} disabled={!parsed} onPress={() => void save()} />
            <Button variant="ghost" title="Cancel" onPress={() => router.back()} />
          </View>
        </>
      )}
    </SettingsScreen>
  );
}
