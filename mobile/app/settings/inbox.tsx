import React, { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { intakeApi, type IntakeEmailProvider, type IntakeView } from "@/lib/api";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Segmented } from "@/components/settings/Segmented";

type IntakeUpdate = Parameters<typeof intakeApi.update>[0];

const PROVIDERS: Array<{ id: IntakeEmailProvider; name: string; how: string }> = [
  { id: "cloudflare", name: "Cloudflare Email Routing", how: "Create an Email Worker with the snippet below and route an address (e.g. agent@yourdomain) to it." },
  { id: "postmark", name: "Postmark", how: "Inbound stream → Settings → Webhook URL. Tick “Include raw email content” off; JSON is fine." },
  { id: "sendgrid", name: "SendGrid Inbound Parse", how: "Settings → Inbound Parse → Add host & URL. Either parsed or raw mode works." },
  { id: "mailgun", name: "Mailgun", how: "Receiving → Create route → Forward to the URL. Paste the HTTP webhook signing key below to verify signatures." },
];
const OUTCOME: Record<string, string> = { fired: "started", skipped: "held", rejected: "rejected", failed: "failed" };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Label({ children }: { children: React.ReactNode }) {
  return (
    <T variant="micro" weight="medium" tone="muted" style={{ marginBottom: 6 }}>
      {children}
    </T>
  );
}

function CopyField({ value, label, multiline }: { value: string; label: string; multiline?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <View style={{ flex: 1 }}>
        <Field mono editable={false} selectTextOnFocus value={value} accessibilityLabel={label} multiline={multiline} numberOfLines={multiline ? 8 : 1} style={multiline ? { maxHeight: 180, textAlignVertical: "top" } : undefined} />
      </View>
      <Button
        small
        variant="outline"
        title={done ? "Copied" : "Copy"}
        onPress={() =>
          void Clipboard.setStringAsync(value).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
        }
      />
    </View>
  );
}

function SecretInput({ label, isSet, onSave }: { label: string; isSet: boolean; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState("");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ flex: 1 }}>
        <Field mono secureTextEntry autoCapitalize="none" autoCorrect={false} accessibilityLabel={label} placeholder={isSet ? "•••••• saved — type to replace" : label} value={v} onChangeText={setV} />
      </View>
      <Button small variant="outline" title="Save" disabled={!v.trim()} onPress={() => void onSave(v).then(() => setV(""), () => {})} />
      {isSet ? <Button small variant="destructive" title="Clear" onPress={() => void onSave("").catch(() => {})} /> : null}
    </View>
  );
}

function ListInput({ label, value, placeholder, onSave }: { label: string; value: string[]; placeholder: string; onSave: (v: string[]) => Promise<void> }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => setText(value.join(", ")), [value]);
  const next = text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const dirty = next.join(",") !== value.join(",");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ flex: 1 }}>
        <Field accessibilityLabel={label} placeholder={placeholder} value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} />
      </View>
      <Button small variant="outline" title="Save" disabled={!dirty} onPress={() => void onSave(next)} />
    </View>
  );
}

/** "Starts from your inbox" + "Waiting on you" (web: InboxIntake.tsx). Secrets are write-only. */
export default function Inbox() {
  const router = useRouter();
  const [v, setV] = useState<IntakeView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [provider, setProvider] = useState<IntakeEmailProvider>("cloudflare");
  const [repo, setRepo] = useState("");

  const load = useCallback(() => {
    intakeApi.get().then(
      (x) => {
        setV(x);
        setRepo(x.channel.defaultRepo ?? "");
        setErr(null);
      },
      (e) => setErr(msg(e))
    );
  }, []);
  useEffect(load, [load]);

  const save = async (u: IntakeUpdate) => {
    try {
      setV(await intakeApi.update(u));
      setNote({ text: "Saved" });
    } catch (e) {
      setNote({ text: msg(e), bad: true });
      throw e;
    }
  };
  const safeSave = (u: IntakeUpdate) => save(u).catch(() => {});

  const rotate = () =>
    Alert.alert("Rotate address?", "The current address stops working immediately. Rotate?", [
      { text: "Cancel", style: "cancel" },
      { text: "Rotate", style: "destructive", onPress: () => intakeApi.rotate().then(setV, (e) => setNote({ text: msg(e), bad: true })) },
    ]);

  if (err || !v)
    return (
      <SettingsScreen title="Starts from your inbox">
        {err ? (
          <T variant="meta" tone="destructive">
            {err}
          </T>
        ) : (
          <T tone="muted">Loading…</T>
        )}
      </SettingsScreen>
    );

  const p = PROVIDERS.find((x) => x.id === provider)!;
  const allowed = [v.accountEmail, ...v.channel.allowEmails].filter(Boolean).join(", ");

  return (
    <SettingsScreen title="Starts from your inbox">
      {note ? (
        <T variant="meta" tone={note.bad ? "destructive" : "muted"}>
          {note.text}
        </T>
      ) : null}
      {v.pending.length > 0 ? (
        <View style={{ gap: 10 }}>
          <T variant="h3" weight="semibold">
            Waiting on you
          </T>
          <T variant="micro" tone="faint">
            {v.pending.length} intake{v.pending.length > 1 ? "s" : ""} · which repo?
          </T>
          {v.pending.map((q) => (
            <Card key={q.id}>
              <T variant="micro" tone="muted">
                {q.source === "email" ? `Email${q.meta.from ? ` from ${q.meta.from}` : ""}` : "Slack"} · {new Date(q.createdAt).toLocaleString()}
                {q.attachmentCount ? ` · ${q.attachmentCount} image${q.attachmentCount > 1 ? "s" : ""}` : ""}
              </T>
              <T variant="meta" numberOfLines={3} style={{ marginVertical: 6 }}>
                {q.task}
              </T>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {q.choices.map((c) => (
                  <Button
                    key={c}
                    small
                    variant="outline"
                    title={c}
                    onPress={() =>
                      intakeApi.answer(q.id, c).then(
                        (r) => {
                          setNote({ text: `Started on ${c}` });
                          load();
                          router.push(`/box/${encodeURIComponent(r.box)}`);
                        },
                        (e) => setNote({ text: msg(e), bad: true })
                      )
                    }
                  />
                ))}
                <Button small variant="ghost" title="Dismiss" onPress={() => intakeApi.dismiss(q.id).then(load, (e) => setNote({ text: msg(e), bad: true }))} />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      <T variant="micro" tone="faint">
        email · Slack
      </T>
      <T variant="meta" tone="muted">
        Forward an email or send a Slack thread and it becomes a run. The repo is read from the text; if it is unclear you are asked first.
      </T>

      <View>
        <Label>Default repo (used when the text names none)</Label>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field mono placeholder="owner/name" value={repo} onChangeText={setRepo} autoCapitalize="none" autoCorrect={false} />
          </View>
          <Button small variant="outline" title="Save" disabled={repo === (v.channel.defaultRepo ?? "")} onPress={() => void safeSave({ defaultRepo: repo })} />
        </View>
      </View>

      <Card style={{ gap: 10 }}>
        <T variant="body" weight="semibold">
          Email
        </T>
        <Segmented small value={provider} onChange={setProvider} options={PROVIDERS.map((x) => ({ value: x.id, label: x.name }))} />
        <T variant="meta" tone="muted">
          {p.how}
        </T>
        <View>
          <Label>Your private webhook URL — anyone with it can submit mail, so keep it secret</Label>
          <CopyField label="email webhook URL" value={v.email.urls[provider]} />
        </View>
        {provider === "cloudflare" ? (
          <View>
            <Label>Email Worker</Label>
            <CopyField label="Cloudflare Email Worker" value={v.email.cloudflareWorker} multiline />
          </View>
        ) : null}
        {provider === "mailgun" ? (
          <View>
            <Label>Mailgun HTTP webhook signing key</Label>
            <SecretInput label="Mailgun signing key" isSet={v.channel.hasMailgunKey} onSave={(x) => save({ mailgunKey: x })} />
          </View>
        ) : null}
        <View>
          <Label>Accepted senders — always {v.accountEmail ?? "your account email"}, plus (addresses or @domain)</Label>
          <ListInput label="extra allowed senders" placeholder="teammate@company.com, @company.com" value={v.channel.allowEmails} onSave={(x) => safeSave({ allowEmails: x })} />
          {!allowed ? (
            <T variant="micro" tone="attention" style={{ marginTop: 4 }}>
              Your account has no email, so nothing is accepted until you add one.
            </T>
          ) : null}
        </View>
        <View style={{ flexDirection: "row" }}>
          <Button small variant="ghost" title="↺ Rotate address" onPress={rotate} />
        </View>
      </Card>

      <Card style={{ gap: 10 }}>
        <T variant="body" weight="semibold">
          Slack
        </T>
        <T variant="meta" tone="muted">
          1. api.slack.com/apps → Create New App → From a manifest, paste the manifest below, install it.{"\n"}2. Basic Information → paste the Signing Secret here. For the message shortcut to read whole threads, also paste the Bot User OAuth Token.{"\n"}3. Run{" "}
          <T variant="meta" mono>
            /agent hello
          </T>{" "}
          once — the reply shows your Slack user ID; add it below.
        </T>
        <View>
          <Label>Request URL</Label>
          <CopyField label="Slack request URL" value={v.slack.url} />
        </View>
        <View>
          <Label>App manifest</Label>
          <CopyField label="Slack app manifest" value={v.slack.manifest} multiline />
        </View>
        <View>
          <Label>Signing secret</Label>
          <SecretInput label="Slack signing secret" isSet={v.channel.hasSlackSecret} onSave={(x) => save({ slackSigningSecret: x })} />
        </View>
        <View>
          <Label>Bot token (optional, xoxb-…)</Label>
          <SecretInput label="Slack bot token" isSet={v.channel.hasSlackBotToken} onSave={(x) => save({ slackBotToken: x })} />
        </View>
        <View>
          <Label>Slack user IDs allowed to start runs</Label>
          <ListInput label="Slack user IDs" placeholder="U012ABCDEF" value={v.channel.slackUsers} onSave={(x) => safeSave({ slackUsers: x })} />
        </View>
      </Card>

      <Card style={{ gap: 10 }}>
        <T variant="body" weight="semibold">
          Pasted links
        </T>
        <T variant="meta" tone="muted">
          Paste a GitHub issue or Sentry issue link into the composer to fill in its title and body. GitHub uses your connected account; Sentry needs an auth token (scope event:read).
        </T>
        <SecretInput label="Sentry auth token" isSet={v.channel.hasSentryToken} onSave={(x) => save({ sentryToken: x })} />
      </Card>

      <Card style={{ gap: 6 }}>
        <T variant="body" weight="semibold">
          Recent deliveries
        </T>
        {v.deliveries.length === 0 ? (
          <T variant="meta" tone="muted">
            Nothing received yet.
          </T>
        ) : (
          v.deliveries.map((d) => (
            <View key={d.id} style={{ gap: 1 }}>
              <T variant="micro" tone="muted">
                {new Date(d.at).toLocaleString()} ·{" "}
                <T variant="micro" tone={d.outcome === "fired" ? "default" : d.outcome === "skipped" ? "muted" : "destructive"}>
                  {OUTCOME[d.outcome] ?? d.outcome}
                </T>
              </T>
              <T variant="micro" tone="muted" numberOfLines={2}>
                {[d.reason, d.detail].filter(Boolean).join(" · ")}
                {d.box ? (
                  <T variant="micro" tone="live" onPress={() => router.push(`/box/${encodeURIComponent(d.box!)}`)}>
                    {"  open"}
                  </T>
                ) : null}
              </T>
            </View>
          ))
        )}
      </Card>
    </SettingsScreen>
  );
}
