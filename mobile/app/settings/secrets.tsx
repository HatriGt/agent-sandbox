// Secrets vault (web: components/SecretsSettings.tsx). Names and grants only — a value never comes
// back from the server, so every write replaces, never reveals.
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { autopilotApi, type SecretMeta, type SecretsResponse } from "@/lib/api";
import { ago } from "@/lib/format";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { FadeIn, FadeInUp, stagger } from "@/components/motion";

/** Matches src/secrets-store.ts SECRET_NAME_RE: an env-var name, as the agent will see it. */
const NAME_RE = /^[A-Z_][A-Z0-9_]{0,127}$/;
const MASK = "•••• •••• ••••";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Secrets() {
  const [data, setData] = useState<SecretsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    autopilotApi.secrets().then(setData).catch((e) => setError(msg(e)));
  }, []);

  const trimmed = name.trim().toUpperCase();
  const nameOk = trimmed === "" || NAME_RE.test(trimmed);
  const exists = !!data?.secrets.some((s) => s.name === trimmed);
  const canSave = !saving && !!trimmed && NAME_RE.test(trimmed) && !!value;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      setData(await autopilotApi.saveSecret(trimmed, value));
      setNote(`${exists ? "Replaced" : "Saved"} ${trimmed} — grant it to a harness or a repo so runs can use it.`);
      setName("");
      setValue("");
    } catch (e) {
      setError(msg(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: SecretMeta) => {
    setError(null);
    try {
      setData(await autopilotApi.removeSecret(s.name));
      setNote(`Removed ${s.name}${s.grantedTo.length ? " — its grants were dropped too." : ""}`);
    } catch (e) {
      setError(msg(e));
    }
  };

  const rows = data?.secrets ?? [];

  return (
    <SettingsScreen title="Secrets">
      <T variant="meta" tone="muted">
        Tokens and keys a run may need as environment variables. Stored encrypted; a value is never shown again — only replaced. Grant a name to a harness or a repo and every run there gets it.
      </T>
      {error ? (
        <FadeIn style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <T variant="meta" tone="destructive" style={{ flex: 1 }}>
            {error}
          </T>
          <Button small variant="ghost" title="Dismiss" onPress={() => setError(null)} />
        </FadeIn>
      ) : null}
      {note ? (
        <T variant="meta" tone="muted">
          {note}
        </T>
      ) : null}
      {data === null && !error ? <T tone="muted">Loading…</T> : null}
      {data && rows.length === 0 ? (
        <Card style={{ gap: 4 }}>
          <T variant="meta" weight="medium">
            No secrets yet
          </T>
          <T variant="meta" tone="muted">
            When a run stops on a missing DEPLOY_TOKEN or NPM_TOKEN, you can provide it once from the thread — or add it here ahead of time.
          </T>
        </Card>
      ) : null}
      {rows.map((s, i) => (
        <FadeInUp key={s.name} delay={stagger(i)}>
        <Card style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="body" mono weight="medium" numberOfLines={1}>
                {s.name}
              </T>
              <T variant="micro" tone="faint" numberOfLines={1}>
                {MASK} · updated {ago(s.updatedAt)}
              </T>
            </View>
            <ArmButton small variant="ghost" title="Remove" armedTitle="Remove?" onConfirm={() => remove(s)} />
          </View>
          <T variant="micro" tone={s.grantedTo.length ? "muted" : "faint"} numberOfLines={2}>
            {s.grantedTo.length ? `Granted to ${s.grantedTo.map((g) => g.label).join(", ")}` : "No grant yet"}
          </T>
        </Card>
        </FadeInUp>
      ))}
      {data ? (
        <T variant="micro" tone="muted">
          {rows.length} stored
        </T>
      ) : null}

      <Card style={{ gap: 12 }}>
        <T variant="micro" weight="semibold" tone="muted">
          {exists ? "Replace a secret" : "Add a secret"}
        </T>
        <Field
          label="Name"
          mono
          value={name}
          onChangeText={setName}
          placeholder="NAME — e.g. DEPLOY_TOKEN"
          autoCapitalize="characters"
          autoCorrect={false}
          hint={nameOk ? undefined : "Letters, digits and _ only; must start with a letter or _."}
        />
        <Field
          label="Value"
          mono
          value={value}
          onChangeText={setValue}
          placeholder={exists ? "new value — replaces the stored one" : "value"}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => void save()}
        />
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Button small variant="outline" title={exists ? "Replace" : "Add"} loading={saving} disabled={!canSave} onPress={() => void save()} />
        </View>
      </Card>
    </SettingsScreen>
  );
}
