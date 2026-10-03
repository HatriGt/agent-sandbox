import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Share, View } from "react-native";
import { useRouter } from "expo-router";
import { api, intakeApi, type IntakeEmailProvider, type IntakeView, type RepoInfo } from "@/lib/api";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChipInput } from "@/components/settings/ChipInput";
import { PickerRow, PickerSheet } from "@/components/settings/PickerSheet";

const PROVIDERS: Array<{ id: IntakeEmailProvider; name: string }> = [
  { id: "cloudflare", name: "Cloudflare" },
  { id: "postmark", name: "Postmark" },
  { id: "sendgrid", name: "SendGrid" },
  { id: "mailgun", name: "Mailgun" },
];

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * "Starts from your inbox": the questions an email / Slack intake is waiting on (which repo?), the
 * addresses to paste into a mail provider or Slack app, and the allowlists + default repo. Secrets
 * (signing secret, Mailgun key) are still pasted on the desktop dashboard.
 */
export default function Inbox() {
  const router = useRouter();
  const [v, setV] = useState<IntakeView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState<"allowEmails" | "slackUsers" | "defaultRepo" | null>(null);
  const [provider, setProvider] = useState<IntakeEmailProvider>("cloudflare");
  const [repoSheet, setRepoSheet] = useState(false);
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [repoBusy, setRepoBusy] = useState(false);
  const repoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    intakeApi.get().then(setV, (e) => setNote(msg(e)));
  }, []);
  useEffect(load, [load]);

  const update = async (key: NonNullable<typeof saving>, u: Parameters<typeof intakeApi.update>[0]) => {
    if (!v) return;
    const prev = v;
    setSaving(key);
    setNote(null);
    setV({ ...v, channel: { ...v.channel, ...u } }); // optimistic
    try {
      setV(await intakeApi.update(u));
    } catch (e) {
      setV(prev);
      setNote(msg(e));
    } finally {
      setSaving(null);
    }
  };

  const searchRepos = (q: string) => {
    if (repoTimer.current) clearTimeout(repoTimer.current);
    repoTimer.current = setTimeout(async () => {
      setRepoBusy(true);
      try {
        setRepos((await api.repos(q)).repos);
      } catch {
        /* keep previous */
      } finally {
        setRepoBusy(false);
      }
    }, 250);
  };

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

          <Card style={{ gap: 12 }}>
            <T variant="body" weight="semibold">Who may start runs</T>
            <ChipInput
              label="Email addresses"
              values={v.channel.allowEmails}
              onChange={(next) => void update("allowEmails", { allowEmails: next })}
              placeholder="name@company.com"
              hint={`${v.accountEmail ? `Your account email (${v.accountEmail}) is always accepted. ` : ""}Anything else is dropped.`}
              disabled={saving !== null}
            />
            <ChipInput
              label="Slack users"
              values={v.channel.slackUsers}
              onChange={(next) => void update("slackUsers", { slackUsers: next })}
              placeholder="U0123ABCDEF"
              hint="Slack member IDs (profile → ⋯ → Copy member ID)."
              disabled={saving !== null}
            />
            <PickerRow
              label="Default repo"
              value={v.channel.defaultRepo}
              placeholder="Ask each time"
              onPress={() => {
                setRepoSheet(true);
                if (!repos.length) searchRepos("");
              }}
            />
            {saving ? (
              <T variant="micro" tone="faint">
                Saving…
              </T>
            ) : null}
          </Card>

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
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <Button small variant="outline" title="Share / copy" onPress={() => void Share.share({ message: v.email.urls[provider] })} />
              {provider === "cloudflare" ? <Button small variant="outline" title="Share worker code" onPress={() => void Share.share({ message: v.email.cloudflareWorker })} /> : null}
              <Button small variant="ghost" title="Rotate" onPress={rotate} />
            </View>
            {provider === "mailgun" && !v.channel.hasMailgunKey ? (
              <T variant="micro" tone="muted" style={{ marginTop: 8 }}>
                Paste the Mailgun signing key on the desktop dashboard to verify deliveries.
              </T>
            ) : null}
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
              {v.channel.hasSlackSecret ? "Signing secret saved." : "Paste the app's signing secret on the desktop dashboard."}
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

          <PickerSheet
            visible={repoSheet}
            title="Default repo"
            options={repos.map((r) => ({ value: r.fullName, label: r.fullName, hint: r.description }))}
            value={v.channel.defaultRepo}
            allowNone
            noneLabel="Ask each time"
            onPick={(r) => void update("defaultRepo", { defaultRepo: r ?? "" })}
            onClose={() => setRepoSheet(false)}
            onSearch={searchRepos}
            searching={repoBusy}
            emptyText="Type to search your repos."
          />
        </>
      )}
    </SettingsScreen>
  );
}
