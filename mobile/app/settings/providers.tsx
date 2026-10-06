import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { api, type ProviderKind, type ProvidersResponse, type ProviderView } from "@/lib/api";
import { useAuth } from "@/state/auth";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Segmented } from "@/components/settings/Segmented";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const BASE_HINT: Record<ProviderKind, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  "openai-compatible": "https://my-endpoint.example.com/v1",
  ollama: "http://my-gpu-box:11434",
  ccproxy: "https://ccproxy.example.com",
};
const DRIVER_LABEL: Record<string, string> = { claude: "Claude Code", omp: "oh-my-pi", codex: "Codex CLI", opencode: "OpenCode" };
const plural = (n: number) => `${n} model${n === 1 ? "" : "s"}`;

/** Model providers (web: Providers.tsx): your keys, any endpoint, local models. Keys come back masked. */
export default function Providers() {
  const { me } = useAuth();
  const saas = me?.mode === "saas";
  const [r, setR] = useState<ProvidersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api.providers().then(setR).catch((e) => setError(msg(e)));
  }, []);
  useEffect(load, [load]);

  return (
    <SettingsScreen title="Model providers">
      <T variant="micro" tone="faint">
        your keys · any endpoint · local models
      </T>
      {error ? (
        <T variant="meta" tone="destructive">
          {error}
        </T>
      ) : null}
      {note ? (
        <T variant="meta" tone="muted">
          {note}
        </T>
      ) : null}
      {r === null && !error ? <T tone="muted">Loading…</T> : null}
      {r && r.providers.length === 0 && !adding ? (
        <T variant="micro" tone="muted">
          No providers yet — runs use the deployment's default model access.
        </T>
      ) : null}
      {r?.providers.map((p) => (
        <ProviderRow
          key={p.id}
          p={p}
          onChanged={setR}
          onNote={(n, isErr) => {
            if (isErr) {
              setError(n);
              setNote(null);
            } else {
              setNote(n);
              setError(null);
            }
          }}
        />
      ))}
      {r && !adding ? (
        <View style={{ flexDirection: "row" }}>
          <Button small variant="ghost" title="+ Add provider" onPress={() => setAdding(true)} />
        </View>
      ) : null}
      {r && adding ? (
        <ProviderForm
          kinds={r.kinds}
          onDone={() => setAdding(false)}
          onSaved={(next) => {
            setR(next);
            setAdding(false);
            // Fetch the model list right away so the composer picker has it.
            void api
              .providerModels(next.saved)
              .then(() => api.providers().then(setR))
              .catch(() => {});
          }}
        />
      ) : null}
      {r && !saas ? (
        <T variant="micro" tone="faint">
          {r.cliLoginPolicy}
        </T>
      ) : null}
    </SettingsScreen>
  );
}

function ProviderRow({ p, onChanged, onNote }: { p: ProviderView; onChanged: (r: ProvidersResponse) => void; onNote: (m: string, isErr: boolean) => void }) {
  const [busy, setBusy] = useState<"models" | "del" | null>(null);
  const refresh = async () => {
    setBusy("models");
    try {
      const m = await api.providerModels(p.id, true);
      if (m.error) onNote(`Could not list models — ${m.error}`, true);
      else onNote(plural(m.models.length), false);
      onChanged(await api.providers());
    } catch (e) {
      onNote(msg(e), true);
    } finally {
      setBusy(null);
    }
  };
  const del = async () => {
    setBusy("del");
    try {
      onChanged(await api.deleteProvider(p.id));
    } catch (e) {
      onNote(`Could not remove — ${msg(e)}`, true);
      setBusy(null);
    }
  };
  return (
    <Card>
      <T variant="meta" weight="medium" numberOfLines={1}>
        {p.label}
      </T>
      <T variant="micro" mono tone="muted" numberOfLines={1}>
        {p.baseUrl}
      </T>
      <T variant="micro" tone="faint" style={{ marginTop: 4 }}>
        {p.apiKeyMasked ? p.apiKeyMasked : "no key"} · {p.models ? plural(p.models.length) : "models not fetched"} · runs{" "}
        {p.drivers.map((d) => DRIVER_LABEL[d] ?? d).join(", ") || "no driver"}
      </T>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <Button small variant="ghost" title="Refresh models" loading={busy === "models"} disabled={busy !== null} onPress={() => void refresh()} />
        <Button small variant="ghost" title="Remove provider" loading={busy === "del"} disabled={busy !== null} onPress={() => void del()} />
      </View>
    </Card>
  );
}

function ProviderForm({ kinds, onDone, onSaved }: { kinds: ProvidersResponse["kinds"]; onDone: () => void; onSaved: (r: ProvidersResponse & { saved: string }) => void }) {
  const [kind, setKind] = useState<ProviderKind>("anthropic");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const info = kinds.find((k) => k.id === kind);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      onSaved(await api.saveProvider({ kind, ...(label ? { label } : {}), ...(baseUrl ? { baseUrl } : {}), ...(apiKey ? { apiKey } : {}) }));
    } catch (e) {
      setErr(`Could not save — ${msg(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <View style={{ gap: 10 }}>
        <Segmented small value={kind} options={kinds.map((k) => ({ value: k.id, label: k.label }))} onChange={setKind} />
        <Field value={label} onChangeText={setLabel} placeholder={info?.label ?? "Label"} accessibilityLabel="Label" />
        <Field mono value={baseUrl} onChangeText={setBaseUrl} placeholder={BASE_HINT[kind]} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Base URL" />
        <Field mono value={apiKey} onChangeText={setApiKey} placeholder={kind === "ollama" ? "API key (optional)" : "API key"} secureTextEntry autoCapitalize="none" autoCorrect={false} accessibilityLabel="API key" />
        <T variant="micro" tone="faint">
          Runs on: {info?.drivers.map((d) => DRIVER_LABEL[d] ?? d).join(", ") || "—"}. The endpoint is added to the run's egress allowlist.
        </T>
        {err ? (
          <T variant="meta" tone="destructive">
            {err}
          </T>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          <Button small variant="ghost" title="Cancel" onPress={onDone} />
          <Button small title="Save" loading={saving} onPress={() => void save()} />
        </View>
      </View>
    </Card>
  );
}
