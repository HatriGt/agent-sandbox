import React, { useCallback, useEffect, useState } from "react";
import { Alert, Share, View } from "react-native";
import { useRouter } from "expo-router";
import { intakeApi, type IntakeEmailProvider, type IntakeView } from "@/lib/api";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const PROVIDERS: Array<{ id: IntakeEmailProvider; name: string }> = [
  { id: "cloudflare", name: "Cloudflare" },
  { id: "postmark", name: "Postmark" },
  { id: "sendgrid", name: "SendGrid" },
  { id: "mailgun", name: "Mailgun" },
];

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * "Starts from your inbox": the questions an email / Slack intake is waiting on (which repo?), and
 * the addresses to paste into a mail provider or Slack app. Secrets and allowlists are edited on the
 * desktop dashboard (Integrations); the addresses are selectable and shareable here.
 */
export default function Inbox() {
  const router = useRouter();
  const [v, setV] = useState<IntakeView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [provider, setProvider] = useState<IntakeEmailProvider>("cloudflare");

  const load = useCallback(() => {
    intakeApi.get().then(setV, (e) => setNote(msg(e)));
  }, []);
  useEffect(load, [load]);

  const answer = async (id: string, repo: string) => {
    try {
      const r = await intakeApi.answer(id, repo);
      load();
      router.push(`/box/${encodeURIComponent(r.box)}`);
    } catch (e) {
      Alert.alert("Not started", msg(e));
    }
  };

  const rotate = () =>
    Alert.alert("Rotate address?", "The current address stops working immediately.", [
      { text: "Cancel", style: "cancel" },
      { text: "Rotate", style: "destructive", onPress: () => intakeApi.rotate().then(setV, (e) => setNote(msg(e))) },
    ]);

  return (
    <SettingsScreen title="Inbox">
      <T variant="body" tone="muted">
        Forward an email or send a Slack thread and it becomes a run. The repo is read from the text; when it is unclear you
        are asked here first.
      </T>
      {note ? <T variant="meta" tone="destructive">{note}</T> : null}
      {!v ? (
        <T tone="muted">Loading…</T>
      ) : (
        <>
          {v.pending.map((q) => (
            <Card key={q.id}>
              <T variant="micro" tone="faint">
                {q.source === "email" ? `Email${q.meta.from ? ` from ${q.meta.from}` : ""}` : "Slack"} · {new Date(q.createdAt).toLocaleString()}
              </T>
              <T variant="body" numberOfLines={4} style={{ marginVertical: 6 }}>
                {q.task}
              </T>
              <T variant="meta" tone="attention">Which repo?</T>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {q.choices.map((c) => (
                  <Button key={c} small variant="outline" title={c} onPress={() => void answer(q.id, c)} />
                ))}
                <Button small variant="ghost" title="Dismiss" onPress={() => intakeApi.dismiss(q.id).then(load, (e) => setNote(msg(e)))} />
              </View>
            </Card>
          ))}

          <Card>
            <T variant="body" weight="semibold">Email</T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 8 }}>
              {PROVIDERS.map((p) => (
                <Button key={p.id} small variant={p.id === provider ? "secondary" : "ghost"} title={p.name} onPress={() => setProvider(p.id)} />
              ))}
            </View>
            <T variant="micro" mono selectable>
              {v.email.urls[provider]}
            </T>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Button small variant="outline" title="Share / copy" onPress={() => void Share.share({ message: v.email.urls[provider] })} />
              {provider === "cloudflare" ? <Button small variant="outline" title="Share worker code" onPress={() => void Share.share({ message: v.email.cloudflareWorker })} /> : null}
              <Button small variant="ghost" title="Rotate" onPress={rotate} />
            </View>
            <T variant="micro" tone="muted" style={{ marginTop: 8 }}>
              Accepted from {[v.accountEmail, ...v.channel.allowEmails].filter(Boolean).join(", ") || "nobody yet — add an address on the dashboard"}.
            </T>
          </Card>

          <Card>
            <T variant="body" weight="semibold">Slack</T>
            <T variant="micro" mono selectable style={{ marginTop: 6 }}>
              {v.slack.url}
            </T>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Button small variant="outline" title="Share app manifest" onPress={() => void Share.share({ message: v.slack.manifest })} />
            </View>
            <T variant="micro" tone="muted" style={{ marginTop: 8 }}>
              {v.channel.hasSlackSecret ? "Signing secret saved." : "Paste the app's signing secret on the dashboard."} {v.channel.slackUsers.length} linked Slack user
              {v.channel.slackUsers.length === 1 ? "" : "s"}.
            </T>
          </Card>

          <Card>
            <T variant="body" weight="semibold">Recent deliveries</T>
            {v.deliveries.length === 0 ? (
              <T variant="meta" tone="muted">Nothing received yet.</T>
            ) : (
              v.deliveries.slice(0, 10).map((d) => (
                <T key={d.id} variant="micro" tone={d.outcome === "fired" ? "default" : d.outcome === "skipped" ? "muted" : "destructive"} numberOfLines={1}>
                  {new Date(d.at).toLocaleString()} · {d.outcome}
                  {d.reason ? ` · ${d.reason}` : ""}
                  {d.detail ? ` · ${d.detail}` : ""}
                </T>
              ))
            )}
          </Card>
        </>
      )}
    </SettingsScreen>
  );
}
