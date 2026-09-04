import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { api, type ApiKeyRow } from "@/lib/api";
import { ago } from "@/lib/format";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    api.apiKeys().then((r) => setKeys(r.keys)).catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  return (
    <SettingsScreen title="API keys">
      <T variant="body" tone="muted">
        Bearer keys for scripts, CI and devices. This phone signed in with one — revoking it signs the
        device out.
      </T>
      {note ? <T variant="meta" tone="destructive">{note}</T> : null}
      {minted ? (
        <Card>
          <T variant="meta" weight="medium">
            Copy it now — it won't be shown again:
          </T>
          <T variant="code" mono selectable style={{ marginTop: 6 }}>
            {minted}
          </T>
        </Card>
      ) : null}
      {keys?.map((k) => (
        <Card key={k.id}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="body" weight="medium" numberOfLines={1}>
                {k.name}
              </T>
              <T variant="micro" mono tone="faint" numberOfLines={2}>
                {k.prefix}… · {k.last_used_at ? `used ${ago(Date.parse(k.last_used_at))}` : "never used"}
              </T>
            </View>
            {!k.revoked_at && (
              <ArmButton
                title="Revoke"
                armedTitle="Tap again"
                small
                onConfirm={async () => {
                  await api.revokeApiKey(k.id);
                  load();
                }}
              />
            )}
          </View>
        </Card>
      ))}
      <Field placeholder="Key name (e.g. CI, laptop)" value={name} onChangeText={setName} />
      <Button
        title="Create key"
        disabled={!name.trim()}
        onPress={async () => {
          try {
            const r = await api.createApiKey(name.trim());
            setMinted(r.token);
            setName("");
            load();
          } catch (e) {
            setNote(e instanceof Error ? e.message : String(e));
          }
        }}
      />
    </SettingsScreen>
  );
}
