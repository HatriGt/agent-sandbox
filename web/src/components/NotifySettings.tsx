import * as React from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { api, type NotifySettings as Settings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, Input } from "@/components/ui/field";
import { SaveButton } from "@/components/ui/save-button";
import { Panel, SettingsSection } from "@/components/ui/settings";
import { Swap } from "@/components/ui/swap";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

type EventKey = keyof Settings["events"];
const GROUPS: { title: string; events: { key: EventKey; label: string; desc: string; attention?: boolean }[] }[] = [
  { title: "Needs you", events: [{ key: "waiting", label: "Question", desc: "The agent paused on a question and is waiting for your answer.", attention: true }] },
  {
    title: "Run finished",
    events: [
      { key: "done", label: "Done", desc: "A run finished cleanly." },
      { key: "failed", label: "Failed", desc: "A run exited with an error." },
    ],
  },
];
const ALL: EventKey[] = GROUPS.flatMap((g) => g.events.map((e) => e.key));

/**
 * Walk-away notifications: one webhook URL, event toggles grouped by what they mean. The webhook is
 * per owner; the deployment-wide NOTIFY_WEBHOOK_URL (if set) is the fallback when none is stored.
 */
export function NotifySettings() {
  const [loaded, setLoaded] = React.useState<Settings | null>(null);
  const [url, setUrl] = React.useState("");
  const [events, setEvents] = React.useState<Settings["events"]>({ waiting: true, done: true, failed: true });
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .notifySettings(ctrl.signal)
      .then((s) => {
        setLoaded(s);
        setUrl(s.url);
        setEvents(s.events);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const urlOk = url === "" || /^https?:\/\/\S+$/i.test(url.trim());
  const dirty = loaded !== null && (url.trim() !== loaded.url || ALL.some((k) => events[k] !== loaded.events[k]));
  const onCount = ALL.filter((k) => events[k]).length;

  const save = async () => {
    if (!urlOk) return;
    setSaving(true);
    try {
      const s = await api.saveNotifySettings(url.trim(), events);
      setLoaded(s);
      setUrl(s.url);
      setEvents(s.events);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const r = await api.testNotify();
      if (r.ok) toast.success("Test delivered", { description: `The webhook answered ${r.status}.` });
      else toast.error("The webhook refused it", { description: `It answered ${r.status}.` });
    } catch (e) {
      toast.error("Test failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const canTest = !!loaded?.url || !!url.trim() || !!loaded?.fallbackConfigured;
  return (
    <SettingsSection id="notify" title="Notifications" meta={loaded ? `${onCount} of ${ALL.length} on` : undefined} purpose="Get pinged when a machine needs you or finishes. Point a webhook at Slack, ntfy, Discord — anything that accepts a JSON POST.">
      <Swap state={loaded === null ? "loading" : "form"}>
        {loaded === null ? (
          <div className="flex max-w-xl flex-col gap-4" aria-busy="true" aria-label="Loading">
            <Bar className="h-2.5 w-20" />
            <Bar className="h-9 w-full" />
            <Bar className="h-24 w-full rounded-xl" />
          </div>
        ) : (
          <div className="flex max-w-xl flex-col gap-4">
            <Field label="Webhook URL" optional error={!urlOk ? "Must start with http:// or https://" : undefined} help={loaded.fallbackConfigured && !url.trim() ? "Empty — the deployment-wide webhook is used as fallback." : "Receives a JSON body per event; nothing else is sent anywhere."}>
              {(wire) => <Input {...wire} type="url" mono value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.slack.com/…" spellCheck={false} />}
            </Field>
            <Panel>
              {GROUPS.map((g, gi) => (
                <div key={g.title} className={cn(gi > 0 && "border-t")}>
                  <p className="label text-faint bg-muted/40 px-3.5 py-1.5">{g.title}</p>
                  <ul className="divide-y">
                    {g.events.map((ev) => (
                      <li key={ev.key}>
                        <label className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5">
                          <span className="min-w-0 flex-1">
                            <span className="text-foreground block text-meta font-medium">{ev.label}</span>
                            <span className={cn("block text-micro", ev.attention ? "text-attention-text" : "text-muted-foreground")}>{ev.desc}</span>
                          </span>
                          <Switch checked={events[ev.key]} onCheckedChange={(next) => setEvents((s) => ({ ...s, [ev.key]: next }))} aria-label={`${ev.label} notifications`} />
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Panel>
            <div className="flex flex-wrap items-center gap-2">
              <SaveButton onClick={() => void save()} saving={saving} saved={saved} disabled={!urlOk || !dirty} />
              <Button size="sm" variant="outline" onClick={() => void sendTest()} loading={testing} disabled={!canTest}>
                <Send />
                Send test
              </Button>
              <Swap state={dirty && !saving && !saved} className="inline-flex">
                {dirty && !saving && !saved ? <span className="text-muted-foreground text-meta">Unsaved changes</span> : null}
              </Swap>
            </div>
          </div>
        )}
      </Swap>
    </SettingsSection>
  );
}
