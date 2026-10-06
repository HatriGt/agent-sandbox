// Automations on the phone (docs/plan-mobile-parity.md): the list with pause/resume, "Run now",
// proposals to approve or dismiss, and a filter for one-off chat schedules. Tapping a row opens the
// editor (app/automation/[id].tsx); "+ New" opens it blank.
import React, { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, Switch, View, Pressable } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api, type Automation, type AutomationDelivery, type AutomationResult, type AutomationScope } from "@/lib/api";
import { ago } from "@/lib/format";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Segmented } from "@/components/settings/Segmented";
import { PressScale } from "@/components/motion";

type Filter = "all" | AutomationScope;

const KIND: Record<Automation["kind"], string> = { schedule: "Schedule", webhook: "Webhook", github: "GitHub", watch: "Repo activity", chain: "After another" };

function resultLine(r: AutomationResult | null): { text: string; tone: "muted" | "ok" | "destructive" } | null {
  if (!r) return null;
  if (r.finished) return { text: `${r.finished.headline || r.finished.state} · ${ago(r.at)}`, tone: r.finished.state === "done" ? "ok" : "destructive" };
  if (r.outcome === "started") return { text: `Started ${ago(r.at)}`, tone: "muted" };
  if (r.outcome === "skipped") return { text: `Skipped ${ago(r.at)}${r.reason ? ` — ${r.reason}` : ""}`, tone: "muted" };
  return { text: `Failed to start ${ago(r.at)}${r.reason ? ` — ${r.reason}` : ""}`, tone: "destructive" };
}

const REASON: Record<NonNullable<AutomationDelivery["reason"]>, string> = {
  cooldown: "cooldown",
  disabled: "paused",
  limit: "limit reached",
  dedupe: "duplicate",
  ignored: "not a match",
  signature: "bad signature",
  payload: "bad payload",
  error: "error",
};

/** "fired → box-1" / "skipped · cooldown" / "rejected · bad signature" (mirrors the web). */
function deliveryLine(d: AutomationDelivery): string {
  const head = d.outcome === "fired" ? `fired${d.box ? ` → ${d.box}` : ""}` : `${d.outcome === "failed" ? "could not start" : d.outcome}${d.reason ? ` · ${REASON[d.reason]}` : ""}`;
  return d.test ? `test · ${head}` : head;
}
const deliveryTone = (d: AutomationDelivery) => (d.outcome === "fired" ? ("ok" as const) : d.outcome === "skipped" ? ("muted" as const) : ("destructive" as const));

function Row({ a, onChange, onRemove }: { a: Automation; onChange: (a: Automation) => void; onRemove: (id: string) => void }) {
  const router = useRouter();
  const { palette } = useTheme();
  const pending = !!a.proposed && !a.enabled;
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [log, setLog] = useState<AutomationDelivery[] | null>(null);
  const [open, setOpen] = useState(false);
  const last = resultLine(a.lastResult);

  const loadLog = async () => {
    try {
      setLog((await api.automationDeliveries(a.id)).deliveries);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };
  const toggleLog = () => {
    const next = !open;
    setOpen(next);
    if (next) void loadLog();
  };

  const sendTest = async () => {
    setTesting(true);
    setNote(null);
    try {
      const r = await api.testAutomation(a.id);
      const started = r.result?.outcome === "started";
      void Haptics.notificationAsync(started ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
      if (r.result) onChange({ ...a, lastResult: r.result });
      setNote(started ? null : (r.result?.reason ?? r.skipped ?? r.ignored ?? "The test event did not fire."));
      if (open) void loadLog();
      if (started && r.result?.box) router.push(`/box/${encodeURIComponent(r.result.box)}`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const toggle = async (v: boolean) => {
    setNote(null);
    onChange({ ...a, enabled: v }); // optimistic; reverted on error
    try {
      onChange((await api.setAutomationEnabled(a.id, v)).trigger);
    } catch (e) {
      onChange({ ...a, enabled: !v });
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  const approve = async () => {
    setApproving(true);
    setNote(null);
    try {
      onChange((await api.setAutomationEnabled(a.id, true)).trigger);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setApproving(false);
    }
  };

  const dismiss = async () => {
    setDismissing(true);
    setNote(null);
    try {
      await api.deleteAutomation(a.id);
      onRemove(a.id);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
      setDismissing(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    setNote(null);
    try {
      const { result } = await api.runAutomation(a.id);
      void Haptics.notificationAsync(result.outcome === "started" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
      onChange({ ...a, lastResult: result, lastFired: result.at });
      if (result.outcome === "started" && result.box) router.push(`/box/${encodeURIComponent(result.box)}`);
      else setNote(result.reason ?? `Not started (${result.outcome}).`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      onPress={() => router.push(`/automation/${encodeURIComponent(a.id)}`)}
      // "Needs you" is ink: a hairline, no tinted fill (theme commits 21d16af / 44fb21c).
      style={[{ gap: 6 }, pending ? { borderColor: palette.lineStrong, borderRadius: radius.xl } : !a.enabled ? { opacity: 0.75 } : null]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="body" weight="semibold" numberOfLines={1}>
            {a.name}
          </T>
          <T variant="micro" tone="faint" numberOfLines={2}>
            {a.proposed ? "Scheduled by the agent · " : a.scope === "scheduled" ? "From a chat · " : ""}
            {KIND[a.kind]} · {a.when}
            {a.repo ? ` · ${a.repo}` : ""}
          </T>
        </View>
        {pending ? (
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <Button title="Dismiss" variant="ghost" small loading={dismissing} onPress={() => void dismiss()} />
            <Button title="Approve" small loading={approving} onPress={() => void approve()} />
          </View>
        ) : (
          <Switch
            value={a.enabled}
            onValueChange={(v) => void toggle(v)}
            trackColor={{ true: palette.live }}
            accessibilityLabel={`${a.name} ${a.enabled ? "on" : "off"}`}
          />
        )}
      </View>
      {pending ? (
        <T variant="meta" weight="medium">
          Waiting for your approval{a.sourceTitle ? ` — from "${a.sourceTitle}"` : ""}
        </T>
      ) : null}
      {a.active > 0 ? (
        <T variant="meta" tone="live">
          {a.active === 1 ? "1 run in progress" : `${a.active} runs in progress`}
        </T>
      ) : null}
      {last ? (
        last.tone === "muted" || !a.lastResult?.finished?.archiveId ? (
          <T variant="meta" tone={last.tone} numberOfLines={2}>
            {last.text}
          </T>
        ) : (
          <PressScale onPress={() => a.lastResult?.box && router.push(`/box/${encodeURIComponent(a.lastResult.box)}`)} accessibilityRole="link">
            <T variant="meta" tone={last.tone} numberOfLines={2}>
              {last.text}
            </T>
          </PressScale>
        )
      ) : null}
      {a.lastDelivery ? (
        <T variant="micro" tone={deliveryTone(a.lastDelivery)} numberOfLines={2}>
          Last delivery {ago(a.lastDelivery.at)}: {deliveryLine(a.lastDelivery)}
          {a.lastDelivery.detail && a.lastDelivery.outcome !== "fired" ? ` — ${a.lastDelivery.detail}` : ""}
        </T>
      ) : null}
      {note ? (
        <T variant="meta" tone="destructive" numberOfLines={3}>
          {note}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {a.kind !== "chain" ? <Button title="Run now" variant="secondary" small loading={busy} onPress={() => void runNow()} /> : null}
        {a.kind === "webhook" && a.spec?.preset ? <Button title="Send test event" variant="secondary" small loading={testing} onPress={() => void sendTest()} /> : null}
        <Button title={open ? "Hide deliveries" : "Deliveries"} variant="ghost" small onPress={toggleLog} />
      </View>
      {open ? (
        log === null ? (
          <T variant="micro" tone="faint">
            Loading…
          </T>
        ) : log.length === 0 ? (
          <T variant="micro" tone="faint">
            Nothing has arrived yet.
          </T>
        ) : (
          <View style={{ gap: 4 }}>
            {log.map((d) => (
              <PressScale key={d.id} disabled={!d.box} onPress={() => d.box && router.push(`/box/${encodeURIComponent(d.box)}`)}>
                <T variant="micro" tone={deliveryTone(d)} numberOfLines={2}>
                  {ago(d.at)} · {deliveryLine(d)}
                  {d.detail && d.outcome !== "fired" ? ` — ${d.detail}` : ""}
                </T>
              </PressScale>
            ))}
          </View>
        )
      ) : null}
    </Card>
  );
}

export default function AutomationsRoute() {
  const { signedIn } = useAuth();
  if (!signedIn) return <Redirect href="/welcome" />;
  return <Automations />;
}

function Automations() {
  const router = useRouter();
  const { palette } = useTheme();
  const [list, setList] = useState<Automation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    try {
      setList((await api.automations()).triggers);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  // Fires on mount and again when coming back from the editor, so a save shows up.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const replace = (a: Automation) => setList((l) => (l ?? []).map((x) => (x.id === a.id ? { ...x, ...a } : x)));
  const remove = (id: string) => setList((l) => (l ?? []).filter((x) => x.id !== id));

  // Waiting on you first, then live ones, then paused (same order as the web).
  const shown = useMemo(() => {
    const xs = (list ?? []).filter((a) => filter === "all" || a.scope === filter);
    return xs.sort((a, b) => Number(!!b.proposed && !b.enabled) - Number(!!a.proposed && !a.enabled) || Number(b.enabled) - Number(a.enabled));
  }, [list, filter]);
  const counts = useMemo(() => {
    const c = { all: list?.length ?? 0, automation: 0, scheduled: 0 };
    for (const a of list ?? []) c[a.scope] += 1;
    return c;
  }, [list]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 12 }}>
        <PressScale onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))} hitSlop={12} style={{ padding: 8 }}>
          <T variant="body" tone="muted">
            ‹ Back
          </T>
        </PressScale>
        <View style={{ flex: 1 }} />
        <PressScale onPress={() => router.push("/automation/new")} hitSlop={12} style={{ padding: 8 }} accessibilityRole="button" accessibilityLabel="New automation">
          <T variant="body" weight="medium">
            + New
          </T>
        </PressScale>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 0, gap: 12, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <T serif variant="h1">
          Automations
        </T>
        <T variant="body" tone="muted">
          Runs that start on a schedule, after another run, on a webhook, or on a GitHub event. Tap one to edit it.
        </T>
        <Segmented
          small
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `All${counts.all ? ` · ${counts.all}` : ""}` },
            { value: "automation", label: `Automations${counts.automation ? ` · ${counts.automation}` : ""}` },
            { value: "scheduled", label: `Scheduled${counts.scheduled ? ` · ${counts.scheduled}` : ""}` },
          ]}
        />
        {error ? (
          <T variant="meta" tone="destructive">
            {error}
          </T>
        ) : null}
        {list === null && !error ? <T variant="meta" tone="faint">Loading…</T> : null}
        {list !== null && shown.length === 0 ? (
          <Card>
            <T variant="body" weight="medium">
              {filter === "scheduled" ? "Nothing scheduled from a chat" : "No automations yet"}
            </T>
            <T variant="meta" tone="muted">
              {filter === "scheduled" ? "Ask the agent to run something later or on a schedule and it shows up here for your OK." : "Tap + New to run something on a schedule, after another run, or when an event arrives."}
            </T>
          </Card>
        ) : null}
        {shown.map((a) => (
          <Row key={a.id} a={a} onChange={replace} onRemove={remove} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
