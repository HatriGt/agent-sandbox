// Automations on the phone (docs/plan-mobile-parity.md): the list with pause/resume, "Run now",
// proposals to approve or dismiss, and a filter for one-off chat schedules. Tapping a row opens the
// editor (app/automation/[id].tsx); "+ New" opens it blank.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api, type Automation, type AutomationResult } from "@/lib/api";
import { deliveryLine, deliveryTone } from "@/lib/automationRuns";
import { ago } from "@/lib/format";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Toggle";
import { Segmented } from "@/components/settings/Segmented";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { FadeIn, FadeInUp, PressScale, stagger } from "@/components/motion";

/** One list for everything that runs on its own: standing rules and what a chat asked for later. */
type Filter = "all" | "rules" | "chat";
const fromChat = (a: Automation) => a.scope === "scheduled";

const KIND: Record<Automation["kind"], string> = { schedule: "Schedule", webhook: "Webhook", github: "GitHub", watch: "Repo activity", chain: "After another" };

function resultLine(r: AutomationResult | null): { text: string; tone: "muted" | "ok" | "destructive" } | null {
  if (!r) return null;
  if (r.finished) return { text: `${r.finished.headline || r.finished.state} · ${ago(r.at)}`, tone: r.finished.state === "done" ? "ok" : "destructive" };
  if (r.outcome === "started") return { text: `Started ${ago(r.at)}`, tone: "muted" };
  if (r.outcome === "skipped") return { text: `Skipped ${ago(r.at)}${r.reason ? ` — ${r.reason}` : ""}`, tone: "muted" };
  return { text: `Failed to start ${ago(r.at)}${r.reason ? ` — ${r.reason}` : ""}`, tone: "destructive" };
}

function Row({ a, index, onChange, onRemove }: { a: Automation; index: number; onChange: (a: Automation) => void; onRemove: (id: string) => void }) {
  const router = useRouter();
  const { palette } = useTheme();
  const pending = !!a.proposed && !a.enabled;
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const last = resultLine(a.lastResult);
  // Swipe-to-delete keeps the arm/confirm step (same contract as HistoryList): first tap arms, second
  // (within 4s) deletes.
  const [armed, setArmed] = useState(false);
  const disarm = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(disarm.current), []);
  const swipeDelete = () => {
    if (!armed) {
      setArmed(true);
      disarm.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    clearTimeout(disarm.current);
    setArmed(false);
    void dismiss();
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
    <FadeInUp delay={stagger(index)}>
    <SwipeRow
      actions={[
        ...(pending ? [] : [{ label: a.enabled ? "Pause" : "Resume", icon: a.enabled ? ("pause" as const) : ("play" as const), onPress: () => void toggle(!a.enabled) }]),
        { label: armed ? "Delete?" : "Delete", icon: "trash-2" as const, tone: "destructive" as const, stayOpen: !armed, onPress: swipeDelete },
      ]}
    >
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
            {a.proposed ? "Proposed by the agent · " : fromChat(a) ? "From a chat · " : ""}
            {KIND[a.kind]} · {a.when}
          </T>
        </View>
        {pending ? (
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <Button title="Dismiss" variant="ghost" small loading={dismissing} onPress={() => void dismiss()} />
            <Button title="Approve" small loading={approving} onPress={() => void approve()} />
          </View>
        ) : (
          <Toggle
            value={a.enabled}
            onValueChange={(v) => void toggle(v)}
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
        <FadeIn>
          <T variant="meta" tone="destructive" numberOfLines={3}>
            {note}
          </T>
        </FadeIn>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {a.kind !== "chain" ? <Button title="Run now" variant="secondary" small loading={busy} onPress={() => void runNow()} /> : null}
        {a.kind === "webhook" && a.spec?.preset ? <Button title="Send test event" variant="secondary" small loading={testing} onPress={() => void sendTest()} /> : null}
        <Button title="Runs" variant="ghost" small onPress={() => router.push(`/automation/${encodeURIComponent(a.id)}`)} />
      </View>
    </Card>
    </SwipeRow>
    </FadeInUp>
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
    const xs = (list ?? []).filter((a) => filter === "all" || (filter === "chat") === fromChat(a));
    return xs.sort((a, b) => Number(!!b.proposed && !b.enabled) - Number(!!a.proposed && !a.enabled) || Number(b.enabled) - Number(a.enabled));
  }, [list, filter]);
  const counts = useMemo(() => {
    const c = { all: list?.length ?? 0, rules: 0, chat: 0 };
    for (const a of list ?? []) c[fromChat(a) ? "chat" : "rules"] += 1;
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
            { value: "rules", label: `Standing rules${counts.rules ? ` · ${counts.rules}` : ""}` },
            { value: "chat", label: `From chat${counts.chat ? ` · ${counts.chat}` : ""}` },
          ]}
        />
        {error ? (
          <FadeIn>
            <T variant="meta" tone="destructive">
              {error}
            </T>
          </FadeIn>
        ) : null}
        {list === null && !error ? <T variant="meta" tone="faint">Loading…</T> : null}
        {list !== null && shown.length === 0 ? (
          <Card>
            <T variant="body" weight="medium">
              {filter === "chat" ? "Nothing from a chat yet" : "No automations yet"}
            </T>
            <T variant="meta" tone="muted">
              {filter === "chat" ? "Ask the agent to run something later or on a schedule and it shows up here for your OK." : "Tap + New to run something on a schedule, after another run, or when an event arrives."}
            </T>
          </Card>
        ) : null}
        {shown.map((a, i) => (
          <Row key={a.id} a={a} index={i} onChange={replace} onRemove={remove} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
