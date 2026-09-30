import * as React from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/ui/settings";
import { Input, inputClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { intakeApi, type EmailProvider, type IntakeUpdate, type IntakeView } from "@/lib/intake-api";

/**
 * "Starts from your inbox": a private email address (via a provider's inbound webhook), a Slack
 * `/agent` command + message shortcut, and the questions an intake is waiting on. Everything the
 * person has to paste elsewhere is one click to copy; secrets are write-only.
 */

const PROVIDERS: Array<{ id: EmailProvider; name: string; how: string }> = [
  { id: "cloudflare", name: "Cloudflare Email Routing", how: "Create an Email Worker with the snippet below and route an address (e.g. agent@yourdomain) to it." },
  { id: "postmark", name: "Postmark", how: "Inbound stream → Settings → Webhook URL. Tick “Include raw email content” off; JSON is fine." },
  { id: "sendgrid", name: "SendGrid Inbound Parse", how: "Settings → Inbound Parse → Add host & URL. Either parsed or raw mode works." },
  { id: "mailgun", name: "Mailgun", how: "Receiving → Create route → Forward to the URL. Paste the HTTP webhook signing key below to verify signatures." },
];

function CopyField({ value, label, multiline }: { value: string; label: string; multiline?: boolean }) {
  const [done, setDone] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      toast.error("Could not copy — select and copy manually");
    }
  };
  return (
    <div className="flex items-start gap-2">
      {multiline ? (
        <textarea readOnly aria-label={label} value={value} rows={8} className={cn(inputClass, "h-auto py-2 font-mono text-micro")} onFocus={(e) => e.currentTarget.select()} />
      ) : (
        <Input readOnly mono aria-label={label} value={value} onFocus={(e) => e.currentTarget.select()} />
      )}
      <Button variant="outline" size="icon" aria-label={`Copy ${label}`} onClick={copy}>
        {done ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

function SecretInput({ label, isSet, onSave }: { label: string; isSet: boolean; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = React.useState("");
  return (
    <div className="flex items-center gap-2">
      <Input mono type="password" autoComplete="off" aria-label={label} placeholder={isSet ? "•••••• saved — type to replace" : label} value={v} onChange={(e) => setV(e.target.value)} />
      <Button variant="outline" size="sm" disabled={!v.trim()} onClick={() => onSave(v).then(() => setV(""))}>
        Save
      </Button>
      {isSet && (
        <Button variant="danger" size="sm" onClick={() => onSave("")}>
          Clear
        </Button>
      )}
    </div>
  );
}

function ListInput({ label, value, placeholder, onSave }: { label: string; value: string[]; placeholder: string; onSave: (v: string[]) => Promise<void> }) {
  const [text, setText] = React.useState(value.join(", "));
  React.useEffect(() => setText(value.join(", ")), [value]);
  const next = text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const dirty = next.join(",") !== value.join(",");
  return (
    <div className="flex items-center gap-2">
      <Input aria-label={label} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
      <Button variant="outline" size="sm" disabled={!dirty} onClick={() => onSave(next)}>
        Save
      </Button>
    </div>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => <div className="text-muted-foreground text-micro mb-1.5 font-medium">{children}</div>;

const OUTCOME: Record<string, string> = { fired: "started", skipped: "held", rejected: "rejected", failed: "failed" };

export function InboxIntake() {
  const [v, setV] = React.useState<IntakeView | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [provider, setProvider] = React.useState<EmailProvider>("cloudflare");
  const [repo, setRepo] = React.useState("");

  const load = React.useCallback(() => {
    intakeApi.get().then((x) => {
      setV(x);
      setRepo(x.channel.defaultRepo ?? "");
      setErr(null);
    }, (e: Error) => setErr(e.message));
  }, []);
  React.useEffect(load, [load]);

  const save = async (u: IntakeUpdate) => {
    try {
      const x = await intakeApi.update(u);
      setV(x);
      toast.success("Saved");
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  };
  const safeSave = (u: IntakeUpdate) => save(u).catch(() => {});

  if (err) return <SettingsSection id="inbox" title="Starts from your inbox"><p className="text-destructive text-meta">{err}</p></SettingsSection>;
  if (!v) return <SettingsSection id="inbox" title="Starts from your inbox"><p className="text-muted-foreground text-meta">Loading…</p></SettingsSection>;

  const p = PROVIDERS.find((x) => x.id === provider)!;
  const allowed = [v.accountEmail, ...v.channel.allowEmails].filter(Boolean).join(", ");

  return (
    <>
      {v.pending.length > 0 && (
        <SettingsSection id="inbox-pending" title="Waiting on you" meta={`${v.pending.length} intake${v.pending.length > 1 ? "s" : ""} · which repo?`}>
          <ul className="flex flex-col gap-3">
            {v.pending.map((q) => (
              <li key={q.id} className="border-border rounded-md border p-3">
                <div className="text-muted-foreground text-micro mb-1">
                  {q.source === "email" ? `Email${q.meta.from ? ` from ${q.meta.from}` : ""}` : "Slack"} · {new Date(q.createdAt).toLocaleString()}
                  {q.attachmentCount ? ` · ${q.attachmentCount} image${q.attachmentCount > 1 ? "s" : ""}` : ""}
                </div>
                <p className="text-foreground text-meta mb-2 line-clamp-3 whitespace-pre-wrap">{q.task}</p>
                <div className="flex flex-wrap gap-2">
                  {q.choices.map((c) => (
                    <Button
                      key={c}
                      size="sm"
                      variant="outline"
                      className="font-mono"
                      onClick={() =>
                        intakeApi.answer(q.id, c).then(
                          (r) => {
                            toast.success(`Started on ${c}`, { action: { label: "Open", onClick: () => location.assign(r.url) } });
                            load();
                          },
                          (e: Error) => toast.error(e.message)
                        )
                      }
                    >
                      {c}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => intakeApi.dismiss(q.id).then(load, (e: Error) => toast.error(e.message))}>
                    Dismiss
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}

      <SettingsSection
        id="inbox"
        title="Starts from your inbox"
        meta="email · Slack"
        purpose="Forward an email or send a Slack thread and it becomes a run. The repo is read from the text; if it is unclear you are asked first."
      >
        <div className="flex flex-col gap-5">
          <div>
            <Label>Default repo (used when the text names none)</Label>
            <div className="flex items-center gap-2">
              <Input mono placeholder="owner/name" value={repo} onChange={(e) => setRepo(e.target.value)} />
              <Button variant="outline" size="sm" disabled={repo === (v.channel.defaultRepo ?? "")} onClick={() => safeSave({ defaultRepo: repo })}>
                Save
              </Button>
            </div>
          </div>

          <div>
            <h3 className="text-foreground text-body mb-2 font-semibold">Email</h3>
            <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
              {PROVIDERS.map((x) => (
                <Button key={x.id} size="xs" role="tab" aria-selected={x.id === provider} variant={x.id === provider ? "secondary" : "ghost"} onClick={() => setProvider(x.id)}>
                  {x.name}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-meta mb-2">{p.how}</p>
            <Label>Your private webhook URL — anyone with it can submit mail, so keep it secret</Label>
            <CopyField label="email webhook URL" value={v.email.urls[provider]} />
            {provider === "cloudflare" && (
              <div className="mt-3">
                <Label>Email Worker</Label>
                <CopyField label="Cloudflare Email Worker" value={v.email.cloudflareWorker} multiline />
              </div>
            )}
            {provider === "mailgun" && (
              <div className="mt-3">
                <Label>Mailgun HTTP webhook signing key</Label>
                <SecretInput label="Mailgun signing key" isSet={v.channel.hasMailgunKey} onSave={(x) => save({ mailgunKey: x })} />
              </div>
            )}
            <div className="mt-3">
              <Label>Accepted senders — always {v.accountEmail ?? "your account email"}, plus (addresses or @domain)</Label>
              <ListInput label="extra allowed senders" placeholder="teammate@company.com, @company.com" value={v.channel.allowEmails} onSave={(x) => safeSave({ allowEmails: x })} />
              {!allowed && <p className="text-attention text-micro mt-1">Your account has no email, so nothing is accepted until you add one.</p>}
            </div>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => confirm("The current address stops working immediately. Rotate?") && intakeApi.rotate().then(setV, (e: Error) => toast.error(e.message))}>
              <RotateCcw /> Rotate address
            </Button>
          </div>

          <div>
            <h3 className="text-foreground text-body mb-2 font-semibold">Slack</h3>
            <ol className="text-muted-foreground text-meta mb-3 list-decimal space-y-1 pl-5">
              <li>api.slack.com/apps → Create New App → From a manifest, paste the manifest below, install it.</li>
              <li>Basic Information → paste the Signing Secret here. For the message shortcut to read whole threads, also paste the Bot User OAuth Token.</li>
              <li>Run <code>/agent hello</code> once — the reply shows your Slack user ID; add it below.</li>
            </ol>
            <Label>Request URL</Label>
            <CopyField label="Slack request URL" value={v.slack.url} />
            <div className="mt-3">
              <Label>App manifest</Label>
              <CopyField label="Slack app manifest" value={v.slack.manifest} multiline />
            </div>
            <div className="mt-3 grid gap-3">
              <div>
                <Label>Signing secret</Label>
                <SecretInput label="Slack signing secret" isSet={v.channel.hasSlackSecret} onSave={(x) => save({ slackSigningSecret: x })} />
              </div>
              <div>
                <Label>Bot token (optional, xoxb-…)</Label>
                <SecretInput label="Slack bot token" isSet={v.channel.hasSlackBotToken} onSave={(x) => save({ slackBotToken: x })} />
              </div>
              <div>
                <Label>Slack user IDs allowed to start runs</Label>
                <ListInput label="Slack user IDs" placeholder="U012ABCDEF" value={v.channel.slackUsers} onSave={(x) => safeSave({ slackUsers: x })} />
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-foreground text-body mb-2 font-semibold">Pasted links</h3>
            <p className="text-muted-foreground text-meta mb-2">Paste a GitHub issue or Sentry issue link into the composer to fill in its title and body. GitHub uses your connected account; Sentry needs an auth token (scope event:read).</p>
            <SecretInput label="Sentry auth token" isSet={v.channel.hasSentryToken} onSave={(x) => save({ sentryToken: x })} />
          </div>

          <div>
            <h3 className="text-foreground text-body mb-2 font-semibold">Recent deliveries</h3>
            {v.deliveries.length === 0 ? (
              <p className="text-muted-foreground text-meta">Nothing received yet.</p>
            ) : (
              <ul className="text-meta divide-border divide-y">
                {v.deliveries.map((d) => (
                  <li key={d.id} className="flex gap-3 py-1.5">
                    <span className="text-muted-foreground w-36 shrink-0 tabular-nums">{new Date(d.at).toLocaleString()}</span>
                    <span className={cn("w-16 shrink-0", d.outcome === "fired" ? "text-foreground" : d.outcome === "skipped" ? "text-muted-foreground" : "text-destructive")}>{OUTCOME[d.outcome] ?? d.outcome}</span>
                    <span className="text-muted-foreground min-w-0 truncate">
                      {[d.reason, d.detail].filter(Boolean).join(" · ")}
                      {d.box && (
                        <a className="text-primary ml-2 underline-offset-4 hover:underline" href={`/dashboard/box/${encodeURIComponent(d.box)}`}>
                          open
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
