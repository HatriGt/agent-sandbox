import React, { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { api, type NotifySettings } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

const EVENTS: { key: keyof NotifySettings["events"]; label: string; hint: string }[] = [
  { key: "waiting", label: "Needs you", hint: "The agent stopped on a question — the one state that needs a human." },
  { key: "done", label: "Done", hint: "A run finished cleanly." },
  { key: "failed", label: "Failed", hint: "A run exited non-zero." },
];

/** Server-side webhook pings (Slack, ntfy, Discord relay) — mirrors /dashboard/integrations. */
export default function Notifications() {
  const { palette } = useTheme();
  const [settings, setSettings] = useState<NotifySettings | null>(null);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .notifySettings()
      .then((s) => {
        setSettings(s);
        setUrl(s.url ?? "");
      })
      .catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, []);

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
      <T variant="body" tone="muted">
        The controller POSTs a small JSON event to your webhook when a machine changes state — point it
        at ntfy, Slack, or a Discord relay to get pinged on this phone.
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
      {EVENTS.map((ev) => (
        <View key={ev.key} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <T variant="body" weight="medium">
              {ev.label}
            </T>
            <T variant="micro" tone="faint">
              {ev.hint}
            </T>
          </View>
          <Switch
            value={settings?.events[ev.key] ?? false}
            onValueChange={(v) => save({ events: { [ev.key]: v } })}
            trackColor={{ true: palette.live }}
          />
        </View>
      ))}
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
