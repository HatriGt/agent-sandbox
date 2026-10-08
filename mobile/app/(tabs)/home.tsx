import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFleet } from "@/hooks/useFleet";
import { api, ledgerApi, type AuditEventRow, type BoxView, type LedgerRow } from "@/lib/api";
import { describeEvent } from "@/lib/audit";
import { ago, durationWords, fleetSentence, friendlyName, greeting } from "@/lib/format";
import { useAuth } from "@/state/auth";
import { focusComposer } from "@/state/composerFocus";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { BoxActionsSheet } from "@/components/sheets/BoxActionsSheet";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { HomeComposer, type HomeComposerHandle } from "@/components/composer/HomeComposer";
import { Capacity, GettingStarted, HowItWorks, LiveRow, TrialEndedNotice, useGettingStartedDismissed, useHowtoDone } from "@/components/composer/HubSections";
import { animateLayout, CardSkeleton, FadeInUp, PressScale, stagger } from "@/components/motion";

/** "Recent activity" / "Recent runs" heading with the web's "View all" affordance. */
function StripHeader({ title, onAll }: { title: string; onAll: () => void }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
      <T variant="h3" weight="semibold">
        {title}
      </T>
      <PressScale onPress={onAll} hitSlop={12} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <T variant="meta" tone="muted">
          View all
        </T>
        <Icon name="arrow-right" size={13} color={palette.mutedForeground} />
      </PressScale>
    </View>
  );
}

/** The last few archived runs — Home's answer to "what happened while I was away". Fetched once per mount. */
function RecentRuns({ onHistory }: { onHistory: () => void }) {
  const { palette } = useTheme();
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    ledgerApi({ limit: 5 })
      .then((r) => !cancelled && setRows(r.rows))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!rows?.length) return null;
  return (
    <FadeInUp delay={150} style={{ gap: 6, marginTop: 12 }}>
      <StripHeader title="Recent runs" onAll={onHistory} />
      {rows.map((r, i) => {
        const failed = r.state === "failed";
        const first = (r.task ?? "").trim().split("\n")[0] || (r.headline ?? "").trim() || "Untitled run";
        const secs = r.startedAt && r.endedAt && r.endedAt > r.startedAt ? Math.round((r.endedAt - r.startedAt) / 1000) : null;
        const tokens = r.inputTokens != null || r.outputTokens != null ? (r.inputTokens ?? 0) + (r.outputTokens ?? 0) : null;
        return (
          <FadeInUp key={r.id} delay={stagger(i, 30)}>
            <PressScale onPress={onHistory} accessibilityLabel={`${first} — open history`} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 36, paddingVertical: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: failed ? palette.destructive : palette.ok }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="meta" numberOfLines={1}>
                  {first}
                </T>
                <T variant="micro" mono tone="faint" numberOfLines={1}>
                  {friendlyName(r.box)}
                  {secs ? ` · ${durationWords(secs)}` : ""}
                  {tokens != null ? ` · ${tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k` : tokens} tok` : ""}
                </T>
              </View>
              <T variant="micro" tone="faint" style={{ flexShrink: 0 }}>
                {ago(r.archivedAt || r.endedAt)}
              </T>
            </PressScale>
          </FadeInUp>
        );
      })}
    </FadeInUp>
  );
}

/** The last few state-changing calls, as the Activity page narrates them. */
function RecentActivity({ onAll, onBox }: { onAll: () => void; onBox: (session: string) => void }) {
  const { palette } = useTheme();
  const [rows, setRows] = useState<AuditEventRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .audit({ limit: 5 })
      .then((r) => !cancelled && setRows(r.events))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!rows?.length) return null;
  return (
    <FadeInUp delay={200} style={{ gap: 6, marginTop: 12 }}>
      <StripHeader title="Recent activity" onAll={onAll} />
      {rows.map((e, i) => {
        const d = describeEvent(e);
        const at = Date.parse(e.at);
        const failed = e.status >= 400;
        return (
          <FadeInUp key={e.id} delay={stagger(i, 30)}>
            <PressScale
              disabled={!d.session}
              onPress={d.session ? () => onBox(d.session!) : undefined}
              accessibilityLabel={d.session ? `${d.verb} ${friendlyName(d.session)} — open` : d.verb}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 36, paddingVertical: 4 }}
            >
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: failed ? palette.destructive : palette.faint }} />
              <T variant="meta" tone={failed ? "muted" : "default"} numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                {d.verb}
                {d.session ? (
                  <>
                    {" "}
                    <T variant="meta" mono>
                      {friendlyName(d.session)}
                    </T>
                  </>
                ) : null}
              </T>
              <T variant="micro" tone="faint" style={{ flexShrink: 0 }}>
                {Number.isFinite(at) ? ago(at) : ""}
              </T>
            </PressScale>
          </FadeInUp>
        );
      })}
    </FadeInUp>
  );
}

/** "Live now" heading with the capacity strip beside it (web Hub.tsx #live-now). */
function LiveHeader({ boxes, capacity }: { boxes: BoxView[]; capacity: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <T variant="h3" weight="semibold">
        Live now
      </T>
      <Capacity boxes={boxes} capacity={capacity} />
    </View>
  );
}

/** The dashed "Nothing running" card (web Hub.tsx aria-label="No runs yet"), capacity under it. */
function NothingRunning({ boxes, capacity }: { boxes: BoxView[]; capacity: number }) {
  const { palette } = useTheme();
  return (
    <FadeInUp delay={100}>
    <View accessibilityLabel="No runs yet" style={{ borderWidth: 1, borderStyle: "dashed", borderColor: palette.border, borderRadius: radius.xl, paddingHorizontal: 24, paddingVertical: 32, alignItems: "center", gap: 4 }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: palette.muted, alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
        <Icon name="layers" size={16} color={palette.mutedForeground} />
      </View>
      <T variant="meta" weight="medium">
        Nothing running
      </T>
      <T variant="meta" tone="muted" style={{ textAlign: "center", maxWidth: 320 }}>
        Describe a task above — with a repository if it needs one — and the machine that picks it up appears here while it works.
      </T>
      {capacity > 0 ? (
        <View style={{ marginTop: 12 }}>
          <Capacity boxes={boxes} capacity={capacity} />
        </View>
      ) : null}
    </View>
    </FadeInUp>
  );
}

/**
 * The Hub (web Hub.tsx): greeting, fleet line, trial notice, how-it-works, the composer, then what is
 * running (or the "Nothing running" card), recent runs and recent activity.
 */
export default function Home() {
  const router = useRouter();
  const { palette } = useTheme();
  const { me } = useAuth();
  const { snap, error, refresh } = useFleet();
  const [refreshing, setRefreshing] = useState(false);
  const [actions, setActions] = useState<BoxView | null>(null);
  const [howtoDone] = useHowtoDone();
  const [gsDismissed, dismissGs] = useGettingStartedDismissed();
  const composer = useRef<HomeComposerHandle>(null);
  const scroll = useRef<ScrollView>(null);
  const composerY = useRef(0);

  const boxes = (snap?.boxes ?? []).filter((b) => b.role !== "pool-free");
  // Waiting runs first, like the web's inbox-first ordering, then everything else live.
  const live = [...boxes].sort((a, b) => Number(b.runState === "waiting") - Number(a.runState === "waiting"));
  const name = me?.kind === "user" ? (me.name ?? me.login) : undefined;
  const isUser = me?.kind === "user";
  const capacity = snap?.lifecycle.capacity ?? 0;
  const loading = !snap && !error;
  const showGs = snap != null && boxes.length === 0 && isUser && gsDismissed === false;
  const showEmpty = snap != null && boxes.length === 0 && (!isUser || gsDismissed === true);
  const showLive = loading || boxes.length > 0;

  // Section swaps (checklist → empty card → live list, the first-run strip leaving) animate as layout.
  const shape = `${howtoDone}|${showGs}|${showEmpty}|${showLive}`;
  const firstShape = useRef(true);
  useEffect(() => {
    if (firstShape.current) {
      firstShape.current = false;
      return;
    }
    animateLayout();
  }, [shape]);

  const toBox = (session: string) => router.push(`/box/${encodeURIComponent(session)}`);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await refresh();
                setRefreshing(false);
              }}
              tintColor={palette.mutedForeground}
            />
          }
        >
          <T serif variant="display" style={{ marginTop: 12 }}>
            {greeting(name)}
          </T>
          <T variant="lead" tone="muted">
            {snap ? fleetSentence(boxes) : error ? `Can't reach the server — ${error}` : "Checking the fleet…"}
          </T>

          <TrialEndedNotice />
          {howtoDone === false ? <HowItWorks /> : null}

          <View onLayout={(e) => (composerY.current = e.nativeEvent.layout.y)}>
            <HomeComposer ref={composer} lifecycle={snap?.lifecycle} onFocus={() => scroll.current?.scrollTo({ y: Math.max(0, composerY.current - 12), animated: true })} />
          </View>

          {!snap && error ? (
            <View style={{ alignItems: "flex-start" }}>
              <Button title="Retry" variant="outline" small onPress={() => void refresh()} />
            </View>
          ) : null}

          {showGs ? <GettingStarted onDismiss={dismissGs} onFocusComposer={() => focusComposer()} /> : null}

          {showEmpty ? <NothingRunning boxes={boxes} capacity={capacity} /> : null}

          {showLive ? (
            <View style={{ gap: 8, marginTop: 4 }}>
              <LiveHeader boxes={boxes} capacity={capacity} />
              {loading ? (
                <View style={{ gap: 10 }}>
                  <CardSkeleton />
                  <CardSkeleton />
                </View>
              ) : (
                <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, backgroundColor: palette.card, overflow: "hidden" }}>
                  {live.map((b, i) => (
                    <FadeInUp key={b.name} delay={stagger(i)}>
                      <LiveRow box={b} last={i === live.length - 1} onOpen={() => toBox(b.name)} onLongPress={() => setActions(b)} />
                    </FadeInUp>
                  ))}
                </View>
              )}
            </View>
          ) : null}

          <RecentRuns onHistory={() => router.navigate({ pathname: "/(tabs)/activity", params: { tab: "history" } })} />
          <RecentActivity onAll={() => router.navigate("/(tabs)/activity")} onBox={toBox} />
        </ScrollView>
      </KeyboardAvoidingView>
      <BoxActionsSheet box={actions} memoryTiers={snap?.lifecycle.memoryTiers} memoryDefault={snap?.lifecycle.memoryDefault} diskTiers={snap?.lifecycle.diskTiers} visible={!!actions} onClose={() => setActions(null)} onChanged={refresh} />
    </SafeAreaView>
  );
}
