import React, { useEffect, useState } from "react";
import { Linking, Switch, View } from "react-native";
import { api, type NotifySettings } from "@/lib/api";
import { pushEnabledHere, registerForPush, unregisterPush, type PushStatus } from "@/lib/push";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

const EVENTS: { key: keyof NotifySettings["events"]; label: string; hint: string }[] = [
  { key: "waiting", label: "Needs you", hint: "The agent stopped on a question." },
  { key: "done", label: "Done", hint: "A run finished cleanly." },
  { key: "failed", label: "Failed or stalled", hint: "A run exited non-zero or went quiet." },
];

const PUSH_NOTE: Record<PushStatus, string | null> = {
  on: null,
  off: null,
  denied: "Notifications are blocked for this app in system settings.",
  unavailable: "Push isn't available in this build — Expo Go, a simulator, or an APK built without Firebase config.",
};

/** Push to this phone, plus server-side webhook pings (Slack, ntfy, Discord relay). The event toggles drive both. */
export default function Notifications() {
  const { palette } = useTheme();
  const [settings, setSettings] = useState<NotifySettings | null>(null);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushNote, setPushNote] = useState<string | null>(null);

  useEffect(() => {
    void pushEnabledHere().then(setPushOn);
    api
      .notifySettings()
      .then((s) => {
        setSettings(s);
        setUrl(s.url ?? "");
      })
      .catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, []);

  const togglePush = async (v: boolean) => {
    setPushNote(null);
    if (!v) {
      setPushOn(false);
      await unregisterPush({ optOut: true });
      return;
    }
    const st = await registerForPush({ prompt: true });
    setPushOn(st === "on");
    setPushNote(PUSH_NOTE[st]);
  };

  const save = async (next: { url?: string; events?: Partial<NotifySettings["events"]> }) => {
    setBusy(true);
    setNote(null);
    try {
      const s = await api.saveNotifySettings({ url: next.url ?? url, events: { ...settings?.events, ...next.events } });
      setSettings(s);
      setNote("Saved.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsScreen title="Notifications">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="body" weight="medium">
            Push to this phone
          </T>
          <T variant="micro" tone="faint">
            Shows the run's title only — never its question, task, or code. Tap to open the thread.
          </T>
        </View>
        <Switch value={pushOn} onValueChange={(v) => void togglePush(v)} trackColor={{ true: palette.live }} accessibilityLabel="Push to this phone" />
      </View>
      {pushNote ? (
        <T variant="meta" tone="muted" onPress={pushNote.includes("system settings") ? () => void Linking.openSettings() : undefined}>
          {pushNote}
        </T>
      ) : null}
      {EVENTS.map((ev) => (
        <View key={ev.key} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="body" weight="medium" numberOfLines={1}>
              {ev.label}
            </T>
            <T variant="micro" tone="faint" numberOfLines={2}>
              {ev.hint}
            </T>
          </View>
          <Switch
            value={settings?.events[ev.key] ?? false}
            onValueChange={(v) => save({ events: { [ev.key]: v } })}
            trackColor={{ true: palette.live }}
            accessibilityLabel={ev.label}
          />
        </View>
      ))}
      <T variant="body" tone="muted" style={{ marginTop: 12 }}>
        Webhook: the controller also POSTs a small JSON event to a URL of yours — ntfy, Slack, or a Discord relay.
      </T>
      {note ? <T variant="meta" tone="muted">{note}</T> : null}
      <Field
        label="Webhook URL"
        placeholder="https://ntfy.sh/your-topic"
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        keyboardType="url"
        mono
        hint={settings?.fallbackConfigured ? "A deployment-wide fallback webhook is configured." : undefined}
      />
      <Button title="Save webhook" loading={busy} onPress={() => save({ url })} />
      <Button
        title="Send a test event"
        variant="secondary"
        onPress={() =>
          api
            .testNotify()
            .then(() => setNote("Test sent."))
            .catch((e) => setNote(e instanceof Error ? e.message : String(e)))
        }
      />
    </SettingsScreen>
  );
}
