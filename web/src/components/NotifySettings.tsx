import * as React from "react";
import { Check, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { api, type NotifySettings as Settings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const inputCls =
  "border-line-strong focus:ring-ring text-foreground placeholder:text-muted-foreground h-9 w-full rounded-md border bg-transparent px-3 text-meta outline-none focus:ring-2 font-mono";

const EVENTS: { key: keyof Settings["events"]; label: string; desc: string; attention?: boolean }[] = [
  { key: "waiting", label: "Needs you", desc: "The agent paused on a question and is waiting for your answer.", attention: true },
  { key: "done", label: "Done", desc: "A run finished cleanly." },
  { key: "failed", label: "Failed", desc: "A run exited with an error." },
];

/**
 * Walk-away notifications: one webhook URL, three event toggles. The webhook is per owner; the
 * deployment-wide NOTIFY_WEBHOOK_URL (if set) is the fallback when no personal URL is stored.
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
  const dirty = loaded !== null && (url.trim() !== loaded.url || EVENTS.some((e) => events[e.key] !== loaded.events[e.key]));

  const save = async () => {
    if (!urlOk) {
      toast.error("The webhook must be an http(s) URL.");
      return;
    }
    setSaving(true);
    try {
      const s = await api.saveNotifySettings(url.trim(), events);
      setLoaded(s);
      setUrl(s.url);
      setEvents(s.events);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
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

  return (
    <section aria-labelledby="notify-h">
      <h2 id="notify-h" className="text-foreground mb-1 text-h3 font-semibold tracking-[-0.01em]">
        Notifications
      </h2>
      <p className="text-muted-foreground mb-3 max-w-[64ch] text-meta">
        Get pinged when a machine needs you or finishes — point a webhook at Slack, ntfy, Discord, or anything that accepts JSON POSTs.
      </p>
      <label className="flex max-w-xl flex-col gap-1.5">
        <span className="label text-muted-foreground">Webhook URL</span>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hooks.slack.com/…"
          spellCheck={false}
          className={cn(inputCls, !urlOk && "border-destructive/60 focus:ring-destructive/40")}
        />
        {!urlOk && <span className="text-destructive text-micro">Must start with http:// or https://</span>}
        {loaded?.fallbackConfigured && !url.trim() && (
          <span className="text-muted-foreground text-micro">A deployment-wide webhook is configured as fallback.</span>
        )}
      </label>
      <div className="mt-4 flex flex-col gap-2.5">
        {EVENTS.map((ev) => (
          <div key={ev.key} className="flex items-start gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={events[ev.key]}
              onClick={() => setEvents((s) => ({ ...s, [ev.key]: !s[ev.key] }))}
              className={cn(
                "relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors",
                events[ev.key] ? "bg-live" : "bg-muted-foreground/40"
              )}
              aria-label={`${events[ev.key] ? "Disable" : "Enable"} ${ev.label} notifications`}
            >
              <span className={cn("bg-card absolute top-0.5 size-4 rounded-full shadow-e1 transition-[left]", events[ev.key] ? "left-[1.125rem]" : "left-0.5")} />
            </button>
            <div className="min-w-0">
              <p className="text-foreground text-meta font-medium">{ev.label}</p>
              <p className={cn("text-micro", ev.attention ? "text-attention-text" : "text-muted-foreground")}>{ev.desc}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving || !urlOk || (!dirty && !saved)}>
          {saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : null}
          {saved ? "Saved" : "Save"}
        </Button>
        <Button size="sm" variant="outline" onClick={sendTest} disabled={testing || (!loaded?.url && !url.trim() && !loaded?.fallbackConfigured)}>
          {testing ? <Loader2 className="animate-spin" /> : <Send />}
          Send test
        </Button>
      </div>
    </section>
  );
}
