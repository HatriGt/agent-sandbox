import React, { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { useRouter } from "expo-router";
import { api, type BoxView } from "@/lib/api";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { AcctAgentSection, AcctLinkRow, AcctNotifySection, AcctSection } from "@/components/settings/AcctSections";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SELF_HOST = "https://github.com/HatriGt/agent-sandbox/blob/main/docs/self-hosting.md";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Web Account page (web/src/components/Account.tsx), same sections in the same order. */
export default function AccountSettings() {
  const router = useRouter();
  const { palette } = useTheme();
  const { me, refreshMe } = useAuth();
  const user = me?.kind === "user" ? me : null;
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileNote, setProfileNote] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: "", next: "", again: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwNote, setPwNote] = useState<{ tone: "ok" | "destructive"; text: string } | null>(null);

  // Live usage: running machines against the plan cap; on failure fall back to the static line.
  const [fleetBoxes, setFleetBoxes] = useState<BoxView[] | null>(null);
  useEffect(() => {
    api
      .fleet()
      .then((r) => setFleetBoxes(r.boxes.filter((b) => /^running$/i.test(b.boxStatus) || (/^stopped$/i.test(b.boxStatus) && b.role !== "pool-free"))))
      .catch(() => {});
  }, []);
  const inUse = fleetBoxes ? fleetBoxes.filter((b) => /^running$/i.test(b.boxStatus)).length : null;
  const maxBoxes = user?.maxBoxes ?? null;
  const isAdmin = user?.role === "admin" || me?.kind === "operator";
  const showPlan = !!user && user.mode === "saas" && (user.plan === "trial" || user.plan === "pro");

  const emailOk = email.trim() === "" || EMAIL.test(email.trim());
  const dirty = name.trim() !== (user?.name ?? "").trim() || email.trim() !== (user?.email ?? "").trim();
  const pwMatch = pw.again === "" || pw.next === pw.again;
  const pwShort = pw.next.length > 0 && pw.next.length < 10;

  const saveProfile = async () => {
    if (!dirty || !emailOk) return;
    setSaving(true);
    setProfileNote(null);
    try {
      await api.updateAccount({ name, email: email || null });
      await refreshMe();
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setProfileNote(`Could not save: ${msg(e)}`);
    } finally {
      setSaving(false);
    }
  };
  const changePw = async () => {
    if (pw.next !== pw.again) return;
    setPwBusy(true);
    setPwNote(null);
    try {
      await api.updateAccount({ currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: "", next: "", again: "" });
      setPwNote({ tone: "ok", text: user?.hasPassword ? "Password changed" : "Password set — you can now sign in with it" });
      await refreshMe();
    } catch (e) {
      setPwNote({ tone: "destructive", text: `Could not change the password: ${msg(e)}` });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <SettingsScreen title="Account">
      <T variant="meta" tone="muted">
        {user ? `@${user.login}` : "Operator"} · {isAdmin ? "admin" : "member"}
        {!showPlan ? ` · ${inUse !== null && maxBoxes ? `${inUse} of ${maxBoxes} machines in use` : `up to ${maxBoxes ?? "∞"} machines at once`}` : ""}
      </T>

      {user && showPlan ? (
        <View style={{ gap: 8, padding: 16, borderRadius: radius.xl, backgroundColor: user.expired ? `${palette.destructive}1a` : palette.card, borderWidth: user.expired ? 0 : 1, borderColor: palette.border }}>
          <T variant="h3" weight="semibold">
            {user.plan === "pro" ? "Pro" : user.expired ? "Trial ended" : "Free trial"}
          </T>
          <T variant="meta" tone="muted">
            {user.plan === "pro"
              ? "Unlimited time. Thank you."
              : user.expired
                ? "Your history and settings are kept; starting or resuming machines needs an upgrade — or self-host for free."
                : `${user.daysLeft === 0 ? "Ends today" : `${user.daysLeft} day${user.daysLeft === 1 ? "" : "s"} left`} · ends ${new Date(user.trialEndsAt ?? 0).toLocaleDateString()} · no card on file`}
          </T>
          {inUse !== null && maxBoxes ? (
            <T variant="meta" tone="muted">
              {inUse} of {maxBoxes} machines in use
              {user.plan === "trial" && !user.expired ? `  ·  ${user.daysLeft === 0 ? "ends today" : `${user.daysLeft}d left`}` : ""}
            </T>
          ) : maxBoxes ? (
            <T variant="meta" tone="muted">
              up to {maxBoxes} machines at once
            </T>
          ) : null}
          {user.plan !== "pro" ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Button small title="Upgrade" onPress={() => void Linking.openURL(user.billingUrl ?? "mailto:hello@agent-sandbox.dev?subject=Agent%20Sandbox%20upgrade")} />
              <Button small variant="ghost" title="Self-host for free" onPress={() => void Linking.openURL(SELF_HOST)} />
            </View>
          ) : null}
        </View>
      ) : null}

      {user ? (
        <AcctSection title="Profile" meta={user.github ? "GitHub sign-in linked" : undefined} purpose="How you appear in the console and in notifications.">
          <Field label="Name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
          <Field
            label="Email (optional)"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@example.com"
            hint="Only used to address notifications."
          />
          {!emailOk ? <T variant="micro" tone="destructive">That does not look like an email address.</T> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Button small title={saved ? "Saved" : "Save"} loading={saving} disabled={!dirty || !emailOk} onPress={() => void saveProfile()} />
            {dirty && !saving && !saved ? <T variant="meta" tone="muted">Unsaved changes</T> : null}
          </View>
          {profileNote ? <T variant="meta" tone="destructive">{profileNote}</T> : null}
        </AcctSection>
      ) : null}

      {user ? (
        <AcctSection
          title={user.hasPassword ? "Change password" : "Set a password"}
          purpose={user.hasPassword ? "Sessions on other devices stay signed in." : "You signed in with a token or GitHub; a password lets you sign in with your username too."}
        >
          {user.hasPassword ? (
            <Field label="Current" value={pw.current} onChangeText={(v) => setPw({ ...pw, current: v })} secureTextEntry autoComplete="current-password" textContentType="password" />
          ) : null}
          <Field label="New" value={pw.next} onChangeText={(v) => setPw({ ...pw, next: v })} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="10 or more characters." />
          {pwShort ? <T variant="micro" tone="destructive">{`10+ characters · ${10 - pw.next.length} to go`}</T> : null}
          <Field label="Again" value={pw.again} onChangeText={(v) => setPw({ ...pw, again: v })} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
          {!pwMatch ? <T variant="micro" tone="destructive">Doesn't match</T> : pw.again.length > 0 ? <T variant="micro" tone="ok">Matches</T> : null}
          <View style={{ flexDirection: "row" }}>
            <Button
              small
              variant="outline"
              title={user.hasPassword ? "Change password" : "Set password"}
              loading={pwBusy}
              disabled={pw.next.length < 10 || !pwMatch || pw.again === "" || (user.hasPassword && !pw.current)}
              onPress={() => void changePw()}
            />
          </View>
          {pwNote ? <T variant="meta" tone={pwNote.tone}>{pwNote.text}</T> : null}
        </AcctSection>
      ) : null}

      <AcctAgentSection />
      <AcctNotifySection />

      <View style={{ marginTop: 12 }}>
        {user ? <AcctLinkRow title="API keys" icon="key" hint="What Cursor, Claude Code or a CI job presents to the MCP endpoint." onPress={() => router.push("/settings/api-keys")} /> : null}
        {user ? <AcctLinkRow title="Signed-in devices" icon="smartphone" hint="Sessions holding your account. Sign one out if you do not recognise it." onPress={() => router.push("/settings/devices")} /> : null}
        <AcctLinkRow title="Recent activity" icon="list" hint="Every state-changing call made as you." onPress={() => router.push("/settings/audit")} />
        {isAdmin && me?.mode === "saas" ? <AcctLinkRow title="Manage users" icon="shield" onPress={() => router.push("/settings/admin")} /> : null}
        <AcctLinkRow title="Connect an IDE" icon="zap" onPress={() => router.push("/settings/connect")} />
      </View>

      {!user ? (
        <T variant="meta" tone="muted">
          You are signed in with the operator token — the deployment's root identity. For day-to-day work, sign up for a personal account and, if you need to manage people, use{" "}
          <T variant="meta" style={{ textDecorationLine: "underline" }} onPress={() => router.push("/settings/admin")}>
            Manage users
          </T>
          .
        </T>
      ) : null}
    </SettingsScreen>
  );
}
