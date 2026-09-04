import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { api, type SessionRow } from "@/lib/api";
import { ago } from "@/lib/format";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Card } from "@/components/ui/Card";

export default function Devices() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    api.sessions().then((r) => setSessions(r.sessions)).catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  return (
    <SettingsScreen title="Signed-in devices">
      {note ? <T variant="meta" tone="destructive">{note}</T> : null}
      {sessions?.map((s) => (
        <Card key={s.id}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="body" weight="medium" numberOfLines={1}>
                {s.userAgent?.slice(0, 60) || "Unknown device"}
                {s.current ? " · this device" : ""}
              </T>
              <T variant="micro" mono tone="faint" numberOfLines={2}>
                {s.ip ?? ""} · {s.lastSeenAt ? `seen ${ago(Date.parse(s.lastSeenAt))}` : `since ${ago(Date.parse(s.createdAt))}`}
              </T>
            </View>
            {!s.current && (
              <ArmButton
                title="Revoke"
                armedTitle="Tap again"
                small
                onConfirm={async () => {
                  await api.revokeSession(s.id);
                  load();
                }}
              />
            )}
          </View>
        </Card>
      ))}
      {sessions && sessions.length > 1 && (
        <ArmButton
          title="Sign out all other devices"
          armedTitle="Tap again to revoke all others"
          onConfirm={async () => {
            await api.revokeOtherSessions();
            load();
          }}
        />
      )}
      {sessions && sessions.length === 0 && (
        <T variant="body" tone="muted">
          No cookie sessions — this device uses an API key (see API keys).
        </T>
      )}
    </SettingsScreen>
  );
}
