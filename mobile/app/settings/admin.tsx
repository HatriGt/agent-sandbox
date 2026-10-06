import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { api, type UserRow } from "@/lib/api";
import { serverUrl } from "@/lib/config";
import { ago } from "@/lib/format";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { radius, type Palette } from "@/theme/tokens";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { OneTimeSecret } from "@/components/settings/OneTimeSecret";
import { Segmented } from "@/components/settings/Segmented";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ROLES = [
  { value: "user" as const, label: "Member" },
  { value: "admin" as const, label: "Admin" },
];

/** Plan pill, same tones as web planTone. */
function planTone(u: UserRow, p: Palette): { bg: string; fg: string; label: string } {
  if (u.plan === "pro") return { bg: `${p.ok}1a`, fg: p.ok, label: "pro" };
  if (u.plan === "free") return { bg: p.muted, fg: p.mutedForeground, label: "free" };
  if (u.expired) return { bg: `${p.destructive}1a`, fg: p.destructive, label: "trial ended" };
  const days = u.daysLeft ?? 0;
  return days <= 2 ? { bg: `${p.attention}33`, fg: p.attentionText, label: `trial · ${days}d` } : { bg: `${p.live}1a`, fg: p.live, label: `trial · ${days}d` };
}

/** Web Admin › Users: create a user (one-time token), role, plan, issue token, remove. */
export default function Admin() {
  const { palette } = useTheme();
  const { me } = useAuth();
  const myId = me?.kind === "user" ? me.id : null;
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [login, setLogin] = useState("");
  const [creating, setCreating] = useState(false);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ login: string; token: string } | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "destructive"; text: string } | null>(null);

  const load = useCallback(() => {
    api.users().then((r) => setUsers(r.users)).catch(() => setUsers([]));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    const l = login.trim();
    if (!l || creating) return;
    setCreating(true);
    setNote(null);
    try {
      const u = await api.createUser(l, "user");
      setFresh({ login: u.login, token: u.token });
      setLogin("");
      load();
    } catch (e) {
      setNote({ tone: "destructive", text: `Could not create the user: ${msg(e)}` });
    } finally {
      setCreating(false);
    }
  };
  const issue = async (u: UserRow) => {
    setNote(null);
    try {
      const k = await api.issueUserKey(u.id);
      setFresh({ login: u.login, token: k.token });
    } catch (e) {
      setNote({ tone: "destructive", text: `Could not issue a token: ${msg(e)}` });
    }
  };
  const setPlan = async (u: UserRow, plan: "trial" | "pro" | "free", days?: number) => {
    setNote(null);
    try {
      await api.setUserPlan(u.id, plan, days);
      setNote({ tone: "ok", text: `${u.login} is now ${plan === "pro" ? "pro" : `on a ${days ?? 7}-day trial`}` });
      load();
    } catch (e) {
      setNote({ tone: "destructive", text: `Could not change the plan: ${msg(e)}` });
    }
  };
  const setRole = async (u: UserRow, role: "user" | "admin") => {
    if (u.role === role || roleBusy) return;
    setRoleBusy(u.id);
    setNote(null);
    // Optimistic; a failure snaps back with the reload.
    setUsers((prev) => prev?.map((x) => (x.id === u.id ? { ...x, role } : x)) ?? prev);
    try {
      await api.setUserRole(u.id, role);
      setNote({ tone: "ok", text: role === "admin" ? `${u.login} is now an admin` : `${u.login} is now a member` });
    } catch (e) {
      setNote({ tone: "destructive", text: `Could not change the role: ${msg(e)}` });
    } finally {
      setRoleBusy(null);
      load();
    }
  };
  const remove = async (u: UserRow) => {
    setNote(null);
    try {
      await api.deleteUser(u.id);
      setUsers((prev) => prev?.filter((x) => x.id !== u.id) ?? prev);
      setNote({ tone: "ok", text: `Removed ${u.login}` });
      load();
    } catch (e) {
      setNote({ tone: "destructive", text: `Could not remove: ${msg(e)}` });
    }
  };
  const admins = (users ?? []).filter((u) => u.role === "admin").length;

  return (
    <SettingsScreen title="Admin">
      <T variant="meta" tone="muted">
        People on this controller. Admins see and can act on every machine.
      </T>
      <T variant="h3" weight="semibold" style={{ marginTop: 8 }}>
        Users
        {users ? <T variant="micro" tone="faint">{`  ${users.length} · ${admins} admin${admins === 1 ? "" : "s"}`}</T> : null}
      </T>
      <T variant="meta" tone="muted">
        Each person gets their own machines, GitHub accounts and MCP servers. Admins see and can act on everything.
      </T>
      {fresh ? (
        <OneTimeSecret
          label={`Access token for ${fresh.login} — hand it over now; it will not be shown again.`}
          value={fresh.token}
          hint={`They paste it at ${serverUrl()}/dashboard — the same token also works as their MCP API key.`}
          onDone={() => setFresh(null)}
        />
      ) : null}
      {note ? <T variant="meta" tone={note.tone}>{note.text}</T> : null}
      {users === null ? (
        <T tone="muted">Loading…</T>
      ) : users.length === 0 ? (
        <Card style={{ gap: 4 }}>
          <T variant="body" weight="medium">No users yet</T>
          <T variant="meta" tone="muted">Add a login below; you get a one-time token to hand them.</T>
        </Card>
      ) : (
        users.map((u) => {
          const plan = planTone(u, palette);
          const isMe = u.id === myId;
          const seen = u.lastSeenAt && Number.isFinite(Date.parse(u.lastSeenAt)) ? ago(Date.parse(u.lastSeenAt)) : null;
          return (
            <Card key={u.id} style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T variant="meta" weight="medium" numberOfLines={1}>
                    {u.login}
                    {isMe ? <T variant="micro" tone="faint">{"  you"}</T> : null}
                  </T>
                  <T variant="micro" tone="faint" numberOfLines={2}>
                    {u.boxes} {u.boxes === 1 ? "machine" : "machines"} · {u.keys} {u.keys === 1 ? "key" : "keys"}
                    {u.github ? " · GitHub linked" : ""}
                    {seen ? ` · seen ${seen}` : " · never signed in"}
                  </T>
                </View>
                <View style={{ backgroundColor: plan.bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <T variant="micro" weight="medium" style={{ color: plan.fg }}>
                    {plan.label}
                  </T>
                </View>
              </View>
              <View style={{ gap: 4 }}>
                {isMe ? (
                  <T variant="micro" tone="faint">You cannot change your own role</T>
                ) : (
                  <Segmented small value={u.role} onChange={(r) => void setRole(u, r)} options={ROLES} />
                )}
              </View>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <Button small variant="outline" title="Issue token" onPress={() => void issue(u)} />
                {u.plan !== "pro" ? <Button small variant="ghost" title="Make pro" onPress={() => void setPlan(u, "pro")} /> : null}
                {u.plan === "trial" ? <Button small variant="ghost" title="Extend trial +7 days" onPress={() => void setPlan(u, "trial", 7)} /> : null}
                {u.plan === "pro" ? <Button small variant="ghost" title="Back to trial" onPress={() => void setPlan(u, "trial", 7)} /> : null}
                <View style={{ flex: 1 }} />
                <ArmButton title="Remove" armedTitle="Confirm remove" small disabled={isMe} onConfirm={() => remove(u)} />
              </View>
            </Card>
          );
        })
      )}
      <Field
        accessibilityLabel="New user login"
        placeholder="Login for the new user — e.g. neo"
        value={login}
        onChangeText={setLogin}
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={() => void create()}
        returnKeyType="done"
      />
      <Button title="Add user" variant="outline" loading={creating} disabled={!login.trim()} onPress={() => void create()} />
    </SettingsScreen>
  );
}
