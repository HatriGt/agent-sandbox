// Automations on the phone (docs/plan-agent-cloud.md, Mobile): read the list, pause/resume, and
// "Run now". Creating and editing stays on the web — the trigger editor (template preview, secrets
// shown once) is a desk task.
import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Switch, View, Pressable } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api, type Automation, type AutomationResult } from "@/lib/api";
import { ago } from "@/lib/format";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const KIND: Record<Automation["kind"], string> = { schedule: "Schedule", webhook: "Webhook", github: "GitHub", chain: "After another" };

function resultLine(r: AutomationResult | null): { text: string; tone: "muted" | "ok" | "destructive" } | null {
  if (!r) return null;
  if (r.finished) return { text: `${r.finished.headline || r.finished.state} · ${ago(r.at)}`, tone: r.finished.state === "done" ? "ok" : "destructive" };
  if (r.outcome === "started") return { text: `Started ${ago(r.at)}`, tone: "muted" };
  if (r.outcome === "skipped") return { text: `Skipped ${ago(r.at)}${r.reason ? ` — ${r.reason}` : ""}`, tone: "muted" };
  return { text: `Failed to start ${ago(r.at)}${r.reason ? ` — ${r.reason}` : ""}`, tone: "destructive" };
}

function Row({ a, onChange }: { a: Automation; onChange: (a: Automation) => void }) {
  const router = useRouter();
  const { palette } = useTheme();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const last = resultLine(a.lastResult);

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
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="body" weight="semibold" numberOfLines={1}>
            {a.name}
          </T>
          <T variant="micro" tone="faint" numberOfLines={2}>
            {KIND[a.kind]} · {a.when}
            {a.repo ? ` · ${a.repo}` : ""}
          </T>
        </View>
        <Switch
          value={a.enabled}
          onValueChange={(v) => void toggle(v)}
          trackColor={{ true: palette.live }}
          accessibilityLabel={`${a.name} ${a.enabled ? "on" : "off"}`}
        />
      </View>
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
          <Pressable onPress={() => a.lastResult?.box && router.push(`/box/${encodeURIComponent(a.lastResult.box)}`)} accessibilityRole="link">
            <T variant="meta" tone={last.tone} numberOfLines={2}>
              {last.text}
            </T>
          </Pressable>
        )
      ) : null}
      {note ? (
        <T variant="meta" tone="destructive" numberOfLines={3}>
          {note}
        </T>
      ) : null}
      {a.kind !== "chain" ? (
        <Button title="Run now" variant="secondary" small loading={busy} onPress={() => void runNow()} style={{ alignSelf: "flex-start" }} />
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

  const load = useCallback(async () => {
    try {
      setList((await api.automations()).triggers);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const replace = (a: Automation) => setList((l) => (l ?? []).map((x) => (x.id === a.id ? { ...x, ...a } : x)));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 12 }}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))} hitSlop={12} style={{ padding: 8 }}>
          <T variant="body" tone="muted">
            ‹ Back
          </T>
        </Pressable>
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
          Runs that start on a schedule, a webhook, or a GitHub event. Create and edit them on the web dashboard.
        </T>
        {error ? (
          <T variant="meta" tone="destructive">
            {error}
          </T>
        ) : null}
        {list === null && !error ? <T variant="meta" tone="faint">Loading…</T> : null}
        {list?.length === 0 ? (
          <Card>
            <T variant="body" weight="medium">
              No automations yet
            </T>
            <T variant="meta" tone="muted">
              Add one under Automations on the web dashboard; it shows up here to pause or run.
            </T>
          </Card>
        ) : null}
        {list?.map((a) => <Row key={a.id} a={a} onChange={replace} />)}
      </ScrollView>
    </SafeAreaView>
  );
}
