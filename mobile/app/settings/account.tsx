import React, { useState } from "react";
import { View } from "react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/state/auth";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

export default function AccountSettings() {
  const { me, refreshMe } = useAuth();
  const u = me?.kind === "user" ? me : null;
  const [name, setName] = useState(u?.name ?? "");
  const [email, setEmail] = useState(u?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (body: Parameters<typeof api.updateAccount>[0], msg: string) => {
    setBusy(true);
    setNote(null);
    try {
      await api.updateAccount(body);
      await refreshMe();
      setNote(msg);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsScreen title="Account">
      {note ? <T variant="meta" tone="muted">{note}</T> : null}
      <Field label="Name" value={name} onChangeText={setName} />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Button title="Save profile" loading={busy} onPress={() => save({ name: name.trim(), email: email.trim() || null }, "Profile saved.")} />
      <View style={{ height: 16 }} />
      <T variant="h3" weight="semibold">Change password</T>
      <Field label="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
      <Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
      <Button
        title="Change password"
        variant="secondary"
        disabled={!newPassword}
        loading={busy}
        onPress={() => save({ currentPassword, newPassword }, "Password changed.")}
      />
    </SettingsScreen>
  );
}
