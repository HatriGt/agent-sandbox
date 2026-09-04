import React, { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { api, type UserRow } from "@/lib/api";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Card } from "@/components/ui/Card";

const PLANS = ["trial", "pro", "free"] as const;

/** Minimal admin: users, plan/role changes, delete — all behind arm-to-confirm where destructive. */
export default function Admin() {
  const { palette } = useTheme();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    api.users().then((r) => setUsers(r.users)).catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setNote(null);
    try {
      await fn();
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SettingsScreen title="Users">
      {note ? <T variant="meta" tone="destructive">{note}</T> : null}
      {users?.map((u) => (
        <Card key={u.id}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="body" weight="semibold" numberOfLines={1}>
                {u.login}
                {u.role === "admin" ? " · admin" : ""}
              </T>
              <T variant="micro" mono tone="faint" numberOfLines={2}>
                {u.email ?? "no email"} · {u.boxes} boxes · {u.lastSeenAt ? `seen ${ago(Date.parse(u.lastSeenAt))}` : "never seen"}
              </T>
              {u.plan === "trial" && (
                <T variant="micro" tone={u.expired ? "destructive" : "attention"}>
                  trial{u.expired ? " expired" : u.daysLeft != null ? ` · ${u.daysLeft}d left` : ""}
                </T>
              )}
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
            {PLANS.map((p) => (
              <Pressable
                key={p}
                onPress={() => u.plan !== p && act(() => api.setUserPlan(u.id, p))}
                style={{
                  paddingVertical: 4,
                  paddingHorizontal: 10,
                  borderRadius: radius.pill,
                  backgroundColor: u.plan === p ? palette.accent : "transparent",
                  borderWidth: 1,
                  borderColor: u.plan === p ? palette.lineStrong : palette.border,
                }}
              >
                <T variant="micro" weight={u.plan === p ? "semibold" : "regular"}>
                  {p}
                </T>
              </Pressable>
            ))}
            <View style={{ flex: 1 }} />
            <ArmButton
              title="Delete"
              armedTitle="Tap again"
              small
              onConfirm={() => act(() => api.deleteUser(u.id))}
            />
          </View>
        </Card>
      ))}
    </SettingsScreen>
  );
}
