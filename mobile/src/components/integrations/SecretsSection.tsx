// Secrets vault (web: components/SecretsSettings.tsx). Names and grants only — a value never comes
// back from the server, so every write replaces, never reveals. A grant is where the name already
// lives: a harness's `secrets` list or a repo setup profile's `envVars`.
import React, { useEffect, useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import { api, autopilotApi, type RepoSetupsResponse, type SecretMeta, type SecretsResponse } from "@/lib/api";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { PickerRow, PickerSheet } from "@/components/settings/PickerSheet";
import { animateLayout, FadeIn, FadeInUp, PressScale, stagger } from "@/components/motion";

/** Matches src/secrets-store.ts SECRET_NAME_RE: an env-var name, as the agent will see it. */
const NAME_RE = /^[A-Z_][A-Z0-9_]{0,127}$/;
const MASK = "•••• •••• ••••";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The whole section minus the screen chrome, so Integrations can stack it with its siblings. */
export function SecretsSection() {
  const [data, setData] = useState<SecretsResponse | null>(null);
  const [setups, setSetups] = useState<RepoSetupsResponse["profiles"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [repo, setRepo] = useState("");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  // Which row is being replaced (its name) — an inline masked input swaps in for the actions.
  const [replacing, setReplacing] = useState<string | null>(null);

  useEffect(() => {
    autopilotApi.secrets().then(setData).catch((e) => setError(msg(e)));
    api
      .repoSetups()
      .then((r) => setSetups(r.profiles))
      .catch(() => setSetups([]));
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
      setData(await autopilotApi.saveSecret(trimmed, value, repo || undefined));
      setNote(`${exists ? "Replaced" : "Saved"} ${trimmed} — ${repo ? `granted to ${repo}; runs on that repo get it as an env var.` : "grant it to a harness or a repo so runs can use it."}`);
      setName("");
      setValue("");
      setRepo("");
    } catch (e) {
      setError(msg(e));
    } finally {
      setSaving(false);
    }
  };

  const replace = async (s: SecretMeta, next: string) => {
    setError(null);
    try {
      setData(await autopilotApi.saveSecret(s.name, next));
      animateLayout();
      setReplacing(null);
      setNote(`Replaced ${s.name} — runs that start from now on get the new value.`);
    } catch (e) {
      setError(msg(e));
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
  const q = query.trim().toLowerCase();
  const visible = q ? rows.filter((s) => `${s.name} ${s.grantedTo.map((g) => g.label).join(" ")}`.toLowerCase().includes(q)) : rows;
  const repoOptions = useMemo(() => (setups ?? []).map((p) => ({ value: p.repo, label: `grant to ${p.repo}` })), [setups]);

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <T variant="meta" tone="muted" style={{ flex: 1 }}>
          Tokens and keys a run may need as environment variables. Stored encrypted; a value is never shown again — only replaced. Grant a name to a harness or a repo and every run there gets it.
        </T>
      </View>
      {data ? (
        <T variant="micro" tone="muted">
          {rows.length} stored
        </T>
      ) : null}
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
      {rows.length > 8 ? <SearchBox value={query} onChange={setQuery} /> : null}
      {visible.map((s, i) => (
        <FadeInUp key={s.name} delay={stagger(i)}>
          <SecretRow
            s={s}
            replacing={replacing === s.name}
            onReplace={() => {
              animateLayout();
              setReplacing(s.name);
            }}
            onCancelReplace={() => {
              animateLayout();
              setReplacing(null);
            }}
            onSubmitReplace={(v) => replace(s, v)}
            onRemove={() => remove(s)}
          />
        </FadeInUp>
      ))}
      {data && q && visible.length === 0 ? (
        <T variant="meta" tone="muted">
          No secret matches “{query.trim()}”.
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
          accessibilityLabel="Secret name"
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
          accessibilityLabel="Secret value"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => void save()}
        />
        <PickerRow label="Grant to repo" value={repo ? `grant to ${repo}` : "No grant yet"} onPress={() => setPicking(true)} />
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Button small variant="outline" title={exists ? "Replace" : "Add"} loading={saving} disabled={!canSave} onPress={() => void save()} />
        </View>
      </Card>
      <PickerSheet
        visible={picking}
        title="Grant to repo"
        options={repoOptions}
        value={repo || undefined}
        allowNone
        noneLabel="No grant yet"
        emptyText="No repos learned yet — the first run on a repo detects how it installs and tests."
        onPick={(v) => {
          setRepo(v ?? "");
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 40, borderWidth: 1, borderColor: palette.input, borderRadius: radius.lg, backgroundColor: palette.card, paddingHorizontal: 12 }}>
      <Icon name="search" size={14} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search secrets"
        placeholderTextColor={palette.faint}
        accessibilityLabel="Search secrets"
        autoCapitalize="none"
        autoCorrect={false}
        style={{ flex: 1, color: palette.foreground, fontFamily: fonts.sans, fontSize: type.meta.fontSize, padding: 0 }}
      />
      {value ? (
        <PressScale scaleTo={0.9} onPress={() => onChange("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
          <Icon name="x" size={14} />
        </PressScale>
      ) : null}
    </View>
  );
}

/** One secret: name, mask, grant chips by kind, updated — Replace swaps in an inline value input. */
function SecretRow({
  s,
  replacing,
  onReplace,
  onCancelReplace,
  onSubmitReplace,
  onRemove,
}: {
  s: SecretMeta;
  replacing: boolean;
  onReplace: () => void;
  onCancelReplace: () => void;
  onSubmitReplace: (value: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const { palette } = useTheme();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  const swipeRemove = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    void onRemove();
  };
  return (
    <SwipeRow
      actions={[
        { label: "Replace", icon: "refresh-cw", onPress: onReplace },
        { label: armed ? "Remove?" : "Remove", icon: "trash-2", tone: "destructive", stayOpen: !armed, onPress: swipeRemove },
      ]}
    >
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Icon name="key" size={14} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="body" mono weight="medium" numberOfLines={1}>
              {s.name}
            </T>
            <T variant="micro" tone="faint" numberOfLines={1}>
              {MASK} · Updated {ago(s.updatedAt)}
            </T>
          </View>
        </View>
        {s.grantedTo.length === 0 ? (
          <T variant="micro" tone="faint">
            not granted — no run gets it yet
          </T>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <T variant="micro" tone="faint">
              Granted to
            </T>
            {s.grantedTo.map((g) => (
              <View
                key={`${g.kind}:${g.id}`}
                accessibilityLabel={`${g.kind === "repo" ? "Repo setup profile" : "Harness"} ${g.label}`}
                style={{ flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: palette.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, maxWidth: "100%" }}
              >
                <T variant="micro" tone="faint">
                  {g.kind === "repo" ? "repo" : "harness"}
                </T>
                <T variant="micro" mono={g.kind === "repo"} numberOfLines={1}>
                  {g.label}
                </T>
              </View>
            ))}
          </View>
        )}
        {replacing ? (
          <ReplaceInput name={s.name} onSubmit={onSubmitReplace} onCancel={onCancelReplace} />
        ) : (
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 4 }}>
            <Button small variant="ghost" title="Replace" onPress={onReplace} />
            <ArmButton small variant="ghost" title={`Remove ${s.name}`} armedTitle="Remove?" onConfirm={onRemove} />
          </View>
        )}
      </Card>
    </SwipeRow>
  );
}

/** The in-row Replace control: one masked input, Enter (submit) saves, Cancel backs out. */
function ReplaceInput({ name, onSubmit, onCancel }: { name: string; onSubmit: (value: string) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!v || busy) return;
    setBusy(true);
    try {
      await onSubmit(v);
    } finally {
      setBusy(false);
    }
  };
  return (
    <FadeIn style={{ gap: 8 }}>
      <Field
        mono
        autoFocus
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={`New value for ${name}`}
        placeholder="new value"
        value={v}
        onChangeText={setV}
        onSubmitEditing={() => void submit()}
        onKeyPress={(e) => {
          if (e.nativeEvent.key === "Escape") onCancel();
        }}
        returnKeyType="done"
      />
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 4 }}>
        <Button small variant="ghost" title="Cancel" onPress={onCancel} />
        <Button small variant="outline" title="Save" loading={busy} disabled={!v} onPress={() => void submit()} />
      </View>
    </FadeIn>
  );
}
