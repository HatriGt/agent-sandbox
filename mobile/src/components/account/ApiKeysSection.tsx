import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { api, type ApiKeyRow } from "@/lib/api";
import { serverUrl } from "@/lib/config";
import { ago } from "@/lib/format";
import { AcctSection } from "@/components/settings/AcctSections";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { OneTimeSecret } from "@/components/settings/OneTimeSecret";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Web ApiKeys: personal bearer keys, shown once at creation; only the prefix is kept. */
export function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "destructive"; text: string } | null>(null);

  const load = useCallback(() => {
    api.apiKeys().then((r) => setKeys(r.keys)).catch(() => setKeys([]));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    setNote(null);
    try {
      const label = name.trim() || "key";
      const k = await api.createApiKey(label);
      setFresh({ token: k.token, name: label });
      setName("");
      load();
    } catch (e) {
      setNote({ tone: "destructive", text: `Could not create the key: ${msg(e)}` });
    } finally {
      setCreating(false);
    }
  };
  const revoke = async (k: ApiKeyRow) => {
    setNote(null);
    try {
      await api.revokeApiKey(k.id);
      setKeys((prev) => prev?.filter((x) => x.id !== k.id) ?? prev);
      setNote({ tone: "ok", text: `Revoked ${k.name} — anything still using it gets a 401 from now on.` });
      load();
    } catch (e) {
      setNote({ tone: "destructive", text: `Could not revoke: ${msg(e)}` });
    }
  };
  const active = (keys ?? []).filter((k) => !k.revoked_at);

  return (
    <AcctSection title="API keys" meta={keys ? `${active.length} active` : undefined} purpose="What Cursor, Claude Code or a CI job presents to the MCP endpoint. Each key is shown once; only its prefix is kept.">
      {fresh ? (
        <OneTimeSecret
          label={`Copy ${fresh.name} now — it will not be shown again.`}
          value={fresh.token}
          hint={`MCP: ${serverUrl()}/mcp with header Authorization: Bearer <key>`}
          onDone={() => setFresh(null)}
        />
      ) : null}
      {note ? <T variant="meta" tone={note.tone}>{note.text}</T> : null}
      {keys === null ? (
        <T tone="muted">Loading…</T>
      ) : active.length === 0 ? (
        <Card style={{ gap: 4 }}>
          <T variant="body" weight="medium">No keys yet</T>
          <T variant="meta" tone="muted">A key lets an editor or a script start machines as you. Name one below.</T>
        </Card>
      ) : (
        active.map((k) => (
          <Card key={k.id}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="body" weight="medium" numberOfLines={1}>
                  {k.name}
                </T>
                <T variant="micro" mono tone="faint" numberOfLines={2}>
                  {`${k.prefix} •••• ••••`} · {k.last_used_at && Number.isFinite(Date.parse(k.last_used_at)) ? `used ${ago(Date.parse(k.last_used_at))}` : "never used"}
                </T>
              </View>
              <ArmButton title="Revoke" armedTitle="Revoke?" small onConfirm={() => revoke(k)} />
            </View>
          </Card>
        ))
      )}
      <Field
        accessibilityLabel="Key name"
        placeholder="Name this key — e.g. Cursor on laptop"
        value={name}
        onChangeText={setName}
        onSubmitEditing={() => void create()}
        returnKeyType="done"
      />
      <Button title="New key" variant="outline" loading={creating} onPress={() => void create()} />
    </AcctSection>
  );
}
