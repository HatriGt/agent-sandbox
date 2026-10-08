import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Switch, View } from "react-native";
import { api, autopilotApi, type AgentId, type AgentPrefs, type HarnessView, type NotifySettings } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PickerRow, PickerSheet } from "@/components/settings/PickerSheet";
import { DriverBadges } from "@/components/settings/HarnessParts";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Section heading in web SettingsSection order: title · meta, purpose, optional trailing action. */
export function AcctSection({ title, meta, purpose, action, children }: { title: string; meta?: string; purpose?: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <View style={{ gap: 10, marginTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <T variant="h3" weight="semibold" style={{ flex: 1 }}>
          {title}
          {meta ? <T variant="micro" tone="faint">{`  ${meta}`}</T> : null}
        </T>
        {action}
      </View>
      {purpose ? (
        <T variant="meta" tone="muted">
          {purpose}
        </T>
      ) : null}
      {children}
    </View>
  );
}

/** Row linking to a sub-screen — same shape as the Settings tab's RowLink. */
export function AcctLinkRow({ title, hint, icon, onPress }: { title: string; hint?: string; icon: IconName; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => ({ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: palette.border, opacity: pressed ? 0.7 : 1, flexDirection: "row", alignItems: "center", gap: 12 })}
    >
      <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: palette.secondary, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={15} color={palette.foreground} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="body" weight="medium" numberOfLines={1}>
          {title}
        </T>
        {hint ? (
          <T variant="micro" tone="faint" numberOfLines={2}>
            {hint}
          </T>
        ) : null}
      </View>
      <Icon name="chevron-right" size={16} color={palette.faint} />
    </Pressable>
  );
}

const FACTORY: AgentId = "claude";
const DESC: Record<AgentId, string> = {
  claude: "Anthropic's Claude Code CLI — question-pausing and the full toolset.",
  omp: "oh-my-pi — a batteries-included pi fork (LSP, debugger, kernels).",
  codex: "OpenAI's Codex CLI — runs on OpenAI or OpenAI-compatible models.",
  opencode: "OpenCode — open-source agent that runs on any provider, including local models.",
};

/**
 * Web AgentSettings: default coding agent (driver) and model for NEW threads — the Drivers tab of
 * Harnesses and the Account page. `harnesses` adds a per-driver count of saved harnesses that pin it.
 */
export function AcctAgentSection({ harnesses = [], title = "Coding agent" }: { harnesses?: HarnessView[]; title?: string }) {
  const { palette } = useTheme();
  const [prefs, setPrefs] = useState<AgentPrefs | null>(null);
  const [catalog, setCatalog] = useState<{ default: string; models: { id: string; label: string }[] } | null>(null);
  // Which control is saving: an agent id, or "model" for the picker.
  const [busy, setBusy] = useState<AgentId | "model" | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    api.agentPrefs().then(setPrefs).catch(() => {});
    api.models().then((r) => setCatalog({ default: r.default, models: r.models })).catch(() => {});
  }, []);

  const save = async (next: { defaultAgent: AgentId; defaultModel: string }, who: AgentId | "model") => {
    if (!prefs || busy) return;
    setBusy(who);
    setError(null);
    try {
      const choice = prefs.agents.find((a) => a.id === next.defaultAgent);
      setPrefs(await autopilotApi.saveAgentDefaults({ ...next, ...(choice?.supervised === false ? { allowPartialSupervision: true } : {}) }));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(`Could not save: ${msg(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const pick = (id: AgentId) => {
    if (prefs && prefs.defaultAgent !== id) void save({ defaultAgent: id, defaultModel: prefs.defaultModel ?? "" }, id);
  };

  const isFactory = prefs?.defaultAgent === FACTORY && !prefs?.defaultModel;
  const defaultLabel = catalog?.default ? (catalog.models.find((m) => m.id === catalog.default)?.label ?? catalog.default) : null;
  const modelValue = prefs?.defaultModel ? (catalog?.models.find((m) => m.id === prefs.defaultModel)?.label ?? `${prefs.defaultModel}${catalog ? " (not in the catalog)" : ""}`) : undefined;

  return (
    <AcctSection
      title={title}
      meta={saved ? "Saved" : undefined}
      purpose="The coding agent — and model — new machines run. A harness can pin a driver; otherwise this default is used. Threads already running keep what they started with."
      action={prefs && !isFactory ? <Button small variant="ghost" title="Reset to default" disabled={busy !== null} onPress={() => void save({ defaultAgent: FACTORY, defaultModel: "" }, FACTORY)} /> : null}
    >
      {error ? <T variant="meta" tone="destructive">{error}</T> : null}
      {!prefs ? (
        <T tone="muted">Loading…</T>
      ) : (
        <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
          {prefs.agents.map((a) => {
            const active = prefs.defaultAgent === a.id;
            const pinned = harnesses.filter((h) => h.driver === a.id).length;
            return (
              <Pressable
                key={a.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: active, disabled: busy !== null }}
                disabled={busy !== null}
                onPress={() => pick(a.id)}
                style={{
                  flexDirection: "row",
                  gap: 12,
                  padding: 12,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: active ? palette.ring : palette.border,
                  backgroundColor: active ? palette.card : "transparent",
                }}
              >
                <View style={{ width: 16, height: 16, marginTop: 2, borderRadius: 8, borderWidth: 1, borderColor: active ? palette.ring : palette.lineStrong, alignItems: "center", justifyContent: "center" }}>
                  {busy === a.id ? <ActivityIndicator size="small" color={palette.mutedForeground} style={{ transform: [{ scale: 0.6 }] }} /> : active ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.ring }} /> : null}
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <T variant="meta" weight="medium">
                      {a.label}
                    </T>
                    {a.id === FACTORY ? <T variant="micro" tone="faint">default</T> : null}
                    {a.id !== "claude" ? (
                      <View style={{ borderWidth: 1, borderColor: palette.lineStrong, borderRadius: radius.pill, paddingHorizontal: 6 }}>
                        <T variant="micro" tone="muted">beta</T>
                      </View>
                    ) : null}
                    {pinned > 0 ? (
                      <T variant="micro" tone="faint" style={{ marginLeft: "auto" }}>
                        {`${pinned} harness${pinned === 1 ? "" : "es"}`}
                      </T>
                    ) : null}
                  </View>
                  <T variant="micro" tone="muted">
                    {DESC[a.id] ?? ""}
                  </T>
                  <View style={{ marginTop: 4 }}>
                    <DriverBadges choice={a} />
                  </View>
                  {a.capabilities?.caveat ? <T variant="micro" tone="faint">{a.capabilities.caveat}</T> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      {prefs ? (
        <>
          <PickerRow label="Default model" value={busy === "model" ? "Saving…" : modelValue} placeholder={`Deployment default${defaultLabel ? ` — ${defaultLabel}` : ""}`} onPress={() => catalog && busy === null && setPicking(true)} />
          <T variant="micro" tone="faint">
            {catalog === null ? "Loading the model catalog…" : prefs.defaultModel ? "Preselected in every new-task composer you open; a thread keeps whatever it started on." : `New tasks start on the deployment default${defaultLabel ? ` (${defaultLabel})` : ""}.`}
          </T>
          <PickerSheet
            visible={picking}
            title="Default model"
            options={[
              ...(catalog?.models ?? []).map((m) => ({ value: m.id, label: m.label })),
              ...(prefs.defaultModel && catalog && !catalog.models.some((m) => m.id === prefs.defaultModel) ? [{ value: prefs.defaultModel, label: `${prefs.defaultModel} (not in the catalog)` }] : []),
            ]}
            value={prefs.defaultModel || undefined}
            allowNone
            noneLabel={`Deployment default${defaultLabel ? ` — ${defaultLabel}` : ""}`}
            onPick={(v) => void save({ defaultAgent: prefs.defaultAgent, defaultModel: v ?? "" }, "model")}
            onClose={() => setPicking(false)}
          />
        </>
      ) : null}
    </AcctSection>
  );
}

type EventKey = keyof NotifySettings["events"];
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

/** Web NotifySettings: one webhook URL plus grouped event toggles. */
export function AcctNotifySection() {
  const { palette } = useTheme();
  const [loaded, setLoaded] = useState<NotifySettings | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<NotifySettings["events"]>({ waiting: true, done: true, failed: true });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "destructive"; text: string } | null>(null);

  const apply = (s: NotifySettings) => {
    setLoaded(s);
    setUrl(s.url ?? "");
    setEvents(s.events);
  };
  useEffect(() => {
    api.notifySettings().then(apply).catch(() => {});
  }, []);

  const urlOk = url === "" || /^https?:\/\/\S+$/i.test(url.trim());
  const dirty = loaded !== null && (url.trim() !== (loaded.url ?? "") || ALL.some((k) => events[k] !== loaded.events[k]));
  const onCount = ALL.filter((k) => events[k]).length;
  const canTest = !!loaded?.url || !!url.trim() || !!loaded?.fallbackConfigured;

  const save = async () => {
    if (!urlOk) return;
    setSaving(true);
    setNote(null);
    try {
      apply(await api.saveNotifySettings({ url: url.trim(), events }));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setNote({ tone: "destructive", text: `Could not save: ${msg(e)}` });
    } finally {
      setSaving(false);
    }
  };
  const sendTest = async () => {
    setTesting(true);
    setNote(null);
    try {
      const r = await api.testNotify();
      setNote(r.ok ? { tone: "ok", text: `Test delivered — the webhook answered ${r.status}.` } : { tone: "destructive", text: `The webhook refused it — it answered ${r.status}.` });
    } catch (e) {
      setNote({ tone: "destructive", text: `Test failed: ${msg(e)}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <AcctSection
      title="Notifications"
      meta={loaded ? `${onCount} of ${ALL.length} on` : undefined}
      purpose="Get pinged when a machine needs you or finishes. Point a webhook at Slack, ntfy, Discord — anything that accepts a JSON POST."
    >
      {loaded === null ? (
        <T tone="muted">Loading…</T>
      ) : (
        <>
          <Field
            label="Webhook URL (optional)"
            mono
            value={url}
            onChangeText={setUrl}
            placeholder="https://hooks.slack.com/…"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            hint={loaded.fallbackConfigured && !url.trim() ? "Empty — the deployment-wide webhook is used as fallback." : "Receives a JSON body per event; nothing else is sent anywhere."}
          />
          {!urlOk ? <T variant="micro" tone="destructive">Must start with http:// or https://</T> : null}
          <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, overflow: "hidden" }}>
            {GROUPS.map((g, gi) => (
              <View key={g.title} style={gi > 0 ? { borderTopWidth: 1, borderTopColor: palette.border } : undefined}>
                <View style={{ backgroundColor: palette.muted, paddingHorizontal: 12, paddingVertical: 6 }}>
                  <T variant="micro" tone="faint" weight="medium">
                    {g.title.toUpperCase()}
                  </T>
                </View>
                {g.events.map((ev, i) => (
                  <View key={ev.key} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: palette.border }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T variant="meta" weight="medium">
                        {ev.label}
                      </T>
                      <T variant="micro" tone={ev.attention ? "attention" : "muted"}>
                        {ev.desc}
                      </T>
                    </View>
                    <Switch
                      accessibilityLabel={`${ev.label} notifications`}
                      value={events[ev.key]}
                      onValueChange={(next) => setEvents((s) => ({ ...s, [ev.key]: next }))}
                    />
                  </View>
                ))}
              </View>
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <Button small title={saved ? "Saved" : "Save"} loading={saving} disabled={!urlOk || !dirty} onPress={() => void save()} />
            <Button small variant="outline" title="Send test" loading={testing} disabled={!canTest} onPress={() => void sendTest()} />
            {dirty && !saving && !saved ? <T variant="meta" tone="muted">Unsaved changes</T> : null}
          </View>
          {note ? <T variant="meta" tone={note.tone}>{note.text}</T> : null}
        </>
      )}
    </AcctSection>
  );
}
