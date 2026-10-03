import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { api, type ProviderKind, type ProvidersResponse } from "@/lib/api";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
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

/** Model providers: your own keys/endpoints. Keys are write-only — they come back masked. */
export default function Providers() {
  const [r, setR] = useState<ProvidersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.providers().then(setR).catch((e) => setError(msg(e)));
  }, []);
  useEffect(load, [load]);

  const refresh = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const m = await api.providerModels(id, true);
      if (m.error) setError(m.error);
      load();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsScreen title="Providers">
      <T variant="body" tone="muted">
        Your own model keys and endpoints. Pick one per run from the composer's run settings.
      </T>
      {error ? (
        <T variant="meta" tone="destructive">
          {error}
        </T>
      ) : null}
      {r === null && !error ? <T tone="muted">Loading…</T> : null}
      {r?.providers.length === 0 ? <T tone="muted">No providers yet.</T> : null}
      {r?.providers.map((p) => (
        <Card key={p.id}>
          <T variant="body" weight="semibold" numberOfLines={1}>
            {p.label}
          </T>
          <T variant="micro" mono tone="faint" numberOfLines={1}>
            {p.kind} · {p.baseUrl}
          </T>
          <T variant="micro" tone="muted" style={{ marginTop: 4 }}>
            {p.hasKey ? `Key ${p.apiKeyMasked ?? "set"}` : "No key"}
            {p.drivers.length ? ` · ${p.drivers.map((d) => DRIVER_LABEL[d] ?? d).join(", ")}` : ""}
            {p.models?.length ? ` · ${p.models.length} models` : ""}
          </T>
          {p.source !== "user" ? (
            <T variant="micro" tone="faint">
              From {p.source}
            </T>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Button small variant="secondary" title="Refresh models" loading={busy === p.id} onPress={() => void refresh(p.id)} />
            {p.source === "user" ? (
              <ArmButton
                small
                variant="ghost"
                title="Remove"
                armedTitle="Tap to remove"
                onConfirm={async () => {
                  try {
                    setR(await api.deleteProvider(p.id));
                  } catch (e) {
                    setError(msg(e));
                  }
                }}
              />
            ) : null}
          </View>
        </Card>
      ))}
      {r && !adding ? (
        <View style={{ flexDirection: "row" }}>
          <Button small variant="secondary" title="+ Add provider" onPress={() => setAdding(true)} />
        </View>
      ) : null}
      {r && adding ? (
        <AddProvider
          kinds={r.kinds}
          onCancel={() => setAdding(false)}
          onSaved={(next) => {
            setR(next);
            setAdding(false);
          }}
        />
      ) : null}
    </SettingsScreen>
  );
}

function AddProvider({ kinds, onCancel, onSaved }: { kinds: ProvidersResponse["kinds"]; onCancel: () => void; onSaved: (r: ProvidersResponse) => void }) {
  const [kind, setKind] = useState<ProviderKind>(kinds[0]?.id ?? "anthropic");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const info = kinds.find((k) => k.id === kind);
  const needsKey = kind !== "ollama";

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await api.saveProvider({
        kind,
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      onSaved(r);
      void api.providerModels(r.saved).catch(() => {});
    } catch (e) {
      setErr(msg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <View style={{ gap: 12 }}>
        <Segmented small value={kind} options={kinds.map((k) => ({ value: k.id, label: k.label }))} onChange={setKind} />
        {info?.drivers.length ? (
          <T variant="micro" tone="muted">
            Works with {info.drivers.map((d) => DRIVER_LABEL[d] ?? d).join(", ")}
          </T>
        ) : null}
        <Field label="Label" value={label} onChangeText={setLabel} placeholder={info?.label ?? "Label"} />
        <Field mono label="Base URL" value={baseUrl} onChangeText={setBaseUrl} placeholder={BASE_HINT[kind]} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <Field mono label={needsKey ? "API key" : "API key (optional)"} value={apiKey} onChangeText={setApiKey} secureTextEntry autoCapitalize="none" autoCorrect={false} />
        {err ? (
          <T variant="meta" tone="destructive">
            {err}
          </T>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button small title="Save" loading={saving} disabled={needsKey && !apiKey.trim()} onPress={() => void save()} />
          <Button small variant="ghost" title="Cancel" onPress={onCancel} />
        </View>
      </View>
    </Card>
  );
}
