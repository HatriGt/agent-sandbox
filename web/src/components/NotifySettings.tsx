import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Send } from "lucide-react";
import { toast } from "sonner";
import { api, type NotifySettings as Settings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Collapse } from "@/components/ui/collapse";
import { cn } from "@/lib/utils";

const inputCls =
  "border-line-strong focus:ring-ring text-foreground placeholder:text-muted-foreground h-9 w-full rounded-md border bg-transparent px-3 text-meta outline-none focus:ring-2 font-mono transition-[border-color,box-shadow] duration-150";

const EVENTS: { key: keyof Settings["events"]; label: string; desc: string; attention?: boolean }[] = [
  { key: "waiting", label: "Needs you", desc: "The agent paused on a question and is waiting for your answer.", attention: true },
  { key: "done", label: "Done", desc: "A run finished cleanly." },
  { key: "failed", label: "Failed", desc: "A run exited with an error." },
];

/**
 * Save → (spinner) → Saved at one fixed width: the tick pops in beside the label and the label
 * crossfades, so the button never changes size mid-request. Shared by every settings section.
 */
export function SaveButton({ onClick, saving, saved, disabled, label = "Save", className }: { onClick: () => void; saving: boolean; saved: boolean; disabled?: boolean; label?: string; className?: string }) {
  const still = useReducedMotion();
  return (
    <Button size="sm" onClick={onClick} loading={saving} disabled={disabled && !saved} className={cn("min-w-[5.5rem]", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        {saved && (
          <motion.span
            key="tick"
            initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
            transition={{ type: "spring", stiffness: 600, damping: 30 }}
            className="inline-flex"
          >
            <Check className="size-4" />
          </motion.span>
        )}
      </AnimatePresence>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={saved ? "saved" : "save"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="inline-block">
          {saved ? "Saved" : label}
        </motion.span>
      </AnimatePresence>
    </Button>
  );
}

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

  return (
    <section aria-labelledby="notify-h">
      <h2 id="notify-h" className="text-foreground mb-1 text-h3 font-semibold tracking-[-0.01em]">
        Notifications
      </h2>
      <p className="text-muted-foreground mb-4 max-w-[64ch] text-meta">
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
          aria-invalid={!urlOk || undefined}
          className={cn(inputCls, !urlOk && "border-destructive/60 focus:ring-destructive/40")}
        />
        <Collapse open={!urlOk}>
          <span className="text-destructive block text-micro">Must start with http:// or https://</span>
        </Collapse>
        <Collapse open={!!loaded?.fallbackConfigured && !url.trim()}>
          <span className="text-muted-foreground block text-micro">A deployment-wide webhook is configured as fallback.</span>
        </Collapse>
      </label>
      <div className="mt-4 flex flex-col gap-2.5">
        {EVENTS.map((ev) => (
          <div key={ev.key} className="flex items-start gap-3">
            <Switch
              checked={events[ev.key]}
              onCheckedChange={(next) => setEvents((s) => ({ ...s, [ev.key]: next }))}
              disabled={loaded === null}
              className="mt-0.5"
              aria-label={`${events[ev.key] ? "Disable" : "Enable"} ${ev.label} notifications`}
            />
            <div className="min-w-0">
              <p className="text-foreground text-meta font-medium">{ev.label}</p>
              <p className={cn("text-micro", ev.attention ? "text-attention-text" : "text-muted-foreground")}>{ev.desc}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <SaveButton onClick={() => void save()} saving={saving} saved={saved} disabled={!urlOk || !dirty} />
        <Button size="sm" variant="outline" onClick={() => void sendTest()} loading={testing} disabled={!loaded?.url && !url.trim() && !loaded?.fallbackConfigured}>
          <Send />
          Send test
        </Button>
      </div>
    </section>
  );
}
