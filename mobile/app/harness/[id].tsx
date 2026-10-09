// Harness editor (web: components/harness/HarnessEditor.tsx). `id` is `new` for create.
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, type AgentChoice, type AgentId, type HarnessView, type ProviderView, type SkillView } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { PickerRow, PickerSheet } from "@/components/settings/PickerSheet";
import { Segmented } from "@/components/settings/Segmented";
import { animateLayout, FadeIn, FadeInUp, stagger } from "@/components/motion";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Draft {
  name: string;
  description: string;
  driver: AgentId | "";
  providerId: string;
  model: string;
  skills: string[];
  rules: HarnessView["rules"];
  rulesMd: string;
  verifyCommand: string;
  egress: string;
}

const EMPTY: Draft = {
  name: "",
  description: "",
  driver: "",
  providerId: "",
  model: "",
  skills: [],
  rules: { askBeforeGuess: true, planFirst: false, verifyOnDone: false },
  rulesMd: "",
  verifyCommand: "",
  egress: "",
};

const draftOf = (h: HarnessView): Draft => ({
  name: h.name,
  description: h.description ?? "",
  driver: h.driver ?? "",
  providerId: h.providerId ?? "",
  model: h.model ?? "",
  skills: h.skills ?? [],
  rules: { ...h.rules },
  rulesMd: h.rulesMd ?? "",
  verifyCommand: h.verifyCommand ?? "",
  egress: (h.egress ?? []).join("\n"),
});

/** Mirrors web harness/model.ts bodyOf: blank means "leave to the run / defaults". */
function bodyOf(d: Draft): Record<string, unknown> {
  const egress = d.egress
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    name: d.name.trim(),
    ...(d.description.trim() ? { description: d.description.trim() } : {}),
    ...(d.driver ? { driver: d.driver } : {}),
    ...(d.providerId ? { providerId: d.providerId } : {}),
    ...(d.model.trim() ? { model: d.model.trim() } : {}),
    ...(d.skills.length ? { skills: d.skills } : {}),
    rules: d.rules,
    ...(d.rulesMd.trim() ? { rulesMd: d.rulesMd } : {}),
    ...(d.verifyCommand.trim() ? { verifyCommand: d.verifyCommand.trim() } : {}),
    ...(egress.length ? { egress } : {}),
  };
}

const RULES: { key: "askBeforeGuess" | "planFirst" | "verifyOnDone"; label: string; line: string }[] = [
  { key: "askBeforeGuess", label: "Ask before guessing", line: "Ask and wait when a requirement is ambiguous." },
  { key: "planFirst", label: "Plan first", line: "Write a short numbered plan before changing anything." },
  { key: "verifyOnDone", label: "Verify on done", line: "Run the verify command (or a checker) when the run finishes." },
];

export default function HarnessEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === "new";
  const router = useRouter();
  const { palette } = useTheme();
  const [d, setD] = useState<Draft | null>(isNew ? EMPTY : null);
  const [drivers, setDrivers] = useState<AgentChoice[]>([]);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [sheet, setSheet] = useState<"driver" | "provider" | "model" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isNew)
      api
        .harnesses()
        .then((r) => {
          const h = r.harnesses.find((x) => x.id === id);
          if (h) setD(draftOf(h));
          else setError("That harness no longer exists.");
        })
        .catch((e) => setError(msg(e)));
    api.agentPrefs().then((p) => setDrivers(p.agents ?? [])).catch(() => {});
    api.providers().then((p) => setProviders(p.providers)).catch(() => {});
    api.skills().then((s) => setSkills(s.skills)).catch(() => {});
  }, [id, isNew]);

  if (!d)
    return (
      <SettingsScreen title="Harness">
        {error ? <T tone="destructive">{error}</T> : <T tone="muted">Loading…</T>}
      </SettingsScreen>
    );

  const set = (p: Partial<Draft>) => setD((x) => (x ? { ...x, ...p } : x));
  const provider = providers.find((p) => p.id === d.providerId);
  const retry = d.rules.autoRetry ?? 1;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.harnessMutate({ action: "upsert", ...(isNew ? {} : { id }), harness: bodyOf(d) });
      router.back();
    } catch (e) {
      setError(msg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsScreen title={isNew ? "New harness" : d.name || "Harness"}>
      <Field label="Name" value={d.name} onChangeText={(t) => set({ name: t })} placeholder="careful-reviewer" />
      <Field label="Description" value={d.description} onChangeText={(t) => set({ description: t })} placeholder="What it's for" />

      <Card>
        <PickerRow label="Driver" value={drivers.find((a) => a.id === d.driver)?.label ?? (d.driver || undefined)} placeholder="Run's default" onPress={() => setSheet("driver")} />
        <PickerRow label="Provider" value={provider?.label} placeholder="Built-in" onPress={() => setSheet("provider")} />
        {/* Provider changes swap the Model row between picker and free text; that swap glides. */}
        {provider?.models?.length ? (
          <PickerRow label="Model" value={d.model || undefined} placeholder="Provider default" onPress={() => setSheet("model")} />
        ) : (
          <Field mono label="Model" value={d.model} onChangeText={(t) => set({ model: t })} placeholder="Leave blank for the default" autoCapitalize="none" autoCorrect={false} />
        )}
      </Card>

      <T variant="meta" weight="medium" tone="muted">
        Rules
      </T>
      <Card>
        <View style={{ gap: 12 }}>
          {RULES.map((r) => (
            <View key={r.key} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <T variant="body">{r.label}</T>
                <T variant="micro" tone="muted">
                  {r.line}
                </T>
              </View>
              <Toggle value={d.rules[r.key]} onValueChange={(v) => set({ rules: { ...d.rules, [r.key]: v } })} accessibilityLabel={r.label} />
            </View>
          ))}
          <View style={{ gap: 6 }}>
            <T variant="meta" tone="muted">
              Retries when verification fails
            </T>
            <Segmented small value={String(retry)} options={["0", "1", "2"].map((v) => ({ value: v, label: v }))} onChange={(v) => set({ rules: { ...d.rules, autoRetry: Number(v) } })} />
          </View>
        </View>
      </Card>
      <Field mono label="Verify command" value={d.verifyCommand} onChangeText={(t) => set({ verifyCommand: t })} placeholder="npm test" autoCapitalize="none" autoCorrect={false} />
      <Field label="Extra instructions" value={d.rulesMd} onChangeText={(t) => set({ rulesMd: t })} placeholder="Markdown the agent reads before every run" multiline style={{ minHeight: 96, textAlignVertical: "top" }} />
      <Field mono label="Allowed hosts (egress)" value={d.egress} onChangeText={(t) => set({ egress: t })} placeholder={"registry.npmjs.org\napi.github.com"} multiline style={{ minHeight: 72, textAlignVertical: "top" }} autoCapitalize="none" autoCorrect={false} hint="One per line. Blank keeps the default network policy." />

      {skills.length ? (
        <FadeInUp delay={stagger(1)}>
          <T variant="meta" weight="medium" tone="muted">
            Skills
          </T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {skills.map((s) => {
              const on = d.skills.includes(s.name);
              return (
                <Button key={s.name} small variant={on ? "primary" : "secondary"} title={s.name} onPress={() => set({ skills: on ? d.skills.filter((x) => x !== s.name) : [...d.skills, s.name] })} />
              );
            })}
          </View>
        </FadeInUp>
      ) : null}

      {error ? (
        <FadeIn>
          <T variant="meta" tone="destructive">
            {error}
          </T>
        </FadeIn>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button title={isNew ? "Create" : "Save"} loading={saving} disabled={!d.name.trim()} onPress={() => void save()} />
        <Button variant="ghost" title="Cancel" onPress={() => router.back()} />
      </View>

      <PickerSheet visible={sheet === "driver"} title="Driver" options={drivers.map((a) => ({ value: a.id, label: a.label, hint: a.supervised === false ? "supervised: partial" : undefined }))} value={d.driver || undefined} allowNone noneLabel="Run's default" onPick={(v) => set({ driver: (v as AgentId) ?? "" })} onClose={() => setSheet(null)} />
      <PickerSheet visible={sheet === "provider"} title="Provider" options={providers.map((p) => ({ value: p.id, label: p.label, hint: p.kind }))} value={d.providerId || undefined} allowNone noneLabel="Built-in" onPick={(v) => (animateLayout(), set({ providerId: v ?? "", model: "" }))} onClose={() => setSheet(null)} emptyText="No providers — add one in Settings → Integrations." />
      <PickerSheet visible={sheet === "model"} title="Model" options={(provider?.models ?? []).map((m) => ({ value: m, label: m }))} value={d.model || undefined} allowNone noneLabel="Provider default" onPick={(v) => set({ model: v ?? "" })} onClose={() => setSheet(null)} />
    </SettingsScreen>
  );
}
