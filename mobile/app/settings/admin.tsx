import React, { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { api, type UserRow } from "@/lib/api";
import { ago } from "@/lib/format";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { OneTimeSecret } from "@/components/settings/OneTimeSecret";
import { Segmented } from "@/components/settings/Segmented";

const PLANS = ["trial", "pro", "free"] as const;
type Role = UserRow["role"];
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Admin: create users, issue keys, flip role/plan, delete — destructive bits behind arm-to-confirm. */
export default function Admin() {
  const { palette } = useTheme();
  const { me } = useAuth();
  const myId = me?.kind === "user" ? me.id : undefined;
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** One-time tokens, keyed by user id (or "new" for a just-created user). State only, never stored. */
  const [tokens, setTokens] = useState<Record<string, { label: string; token: string }>>({});

  // Create form
  const [creating, setCreating] = useState(false);
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<Role>("user");

  const load = useCallback(() => {
    api.users().then((r) => setUsers(r.users)).catch((e) => setError(msg(e)));
  }, []);
  useEffect(load, [load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    const l = login.trim();
    if (!l) return;
    await act("create", async () => {
      const r = await api.createUser(l, role);
      setTokens((t) => ({ ...t, [r.id]: { label: `Token for ${r.login}`, token: r.token } }));
      setLogin("");
      setRole("user");
      setCreating(false);
    });
  };

  const issueKey = (u: UserRow) =>
    act(`key:${u.id}`, async () => {
      const r = await api.issueUserKey(u.id);
      setTokens((t) => ({ ...t, [u.id]: { label: `New key for ${u.login} (${r.prefix}…)`, token: r.token } }));
    });

  return (
    <SettingsScreen title="Users">
      <View style={{ flexDirection: "row" }}>
        <Button small variant="secondary" title={creating ? "Cancel" : "+ Create user"} onPress={() => setCreating((c) => !c)} />
      </View>
      {creating ? (
        <Card style={{ gap: 10 }}>
          <Field label="Login" value={login} onChangeText={setLogin} placeholder="jane" autoCapitalize="none" autoCorrect={false} />
          <View style={{ gap: 6 }}>
            <T variant="meta" weight="medium" tone="muted">
              Role
            </T>
            <Segmented
              small
              value={role}
              onChange={setRole}
              options={[
                { value: "user", label: "user" },
                { value: "admin", label: "admin" },
              ]}
            />
          </View>
          <T variant="micro" tone="faint">
            You get a sign-in token to hand over once; they set a password from it.
          </T>
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <Button small title="Create" loading={busy === "create"} disabled={!login.trim()} onPress={() => void create()} />
          </View>
        </Card>
      ) : null}
      {error ? (
        <T variant="meta" tone="destructive">
          {error}
        </T>
      ) : null}
      {users === null && !error ? (
        <T tone="muted">Loading…</T>
      ) : null}
      {users?.map((u) => {
        const tok = tokens[u.id];
        const self = u.id === myId;
        return (
          <Card key={u.id} style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="body" weight="semibold" numberOfLines={1}>
                  {u.login}
                  {u.role === "admin" ? " · admin" : ""}
                  {self ? " · you" : ""}
                </T>
                <T variant="micro" mono tone="faint" numberOfLines={2}>
                  {u.email ?? "no email"} · {u.boxes} boxes · {u.keys} {u.keys === 1 ? "key" : "keys"} · {u.lastSeenAt ? `seen ${ago(Date.parse(u.lastSeenAt))}` : "never seen"}
                </T>
                {u.plan === "trial" && (
                  <T variant="micro" tone={u.expired ? "destructive" : "attention"}>
                    trial{u.expired ? " expired" : u.daysLeft != null ? ` · ${u.daysLeft}d left` : ""}
                  </T>
                )}
              </View>
            </View>
            {tok ? <OneTimeSecret label={tok.label} value={tok.token} onDone={() => setTokens((t) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== u.id)))} /> : null}
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <T variant="micro" tone="faint">
                plan
              </T>
              {PLANS.map((p) => (
                <Pressable
                  key={p}
                  disabled={busy !== null}
                  onPress={() => u.plan !== p && void act(`plan:${u.id}`, () => api.setUserPlan(u.id, p))}
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
            </View>
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <T variant="micro" tone="faint">
                role
              </T>
              <Segmented
                small
                value={u.role}
                onChange={(r) => r !== u.role && !self && void act(`role:${u.id}`, () => api.setUserRole(u.id, r))}
                options={[
                  { value: "user", label: "user" },
                  { value: "admin", label: "admin" },
                ]}
              />
              {self ? (
                <T variant="micro" tone="faint">
                  (not your own)
                </T>
              ) : null}
            </View>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Button small variant="outline" title="Issue key" loading={busy === `key:${u.id}`} onPress={() => void issueKey(u)} />
              <View style={{ flex: 1 }} />
              <ArmButton title="Delete" armedTitle="Tap again" small disabled={self} onConfirm={() => act(`del:${u.id}`, () => api.deleteUser(u.id))} />
            </View>
          </Card>
        );
      })}
    </SettingsScreen>
  );
}
