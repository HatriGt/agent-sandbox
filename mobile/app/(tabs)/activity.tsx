import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, FlatList, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ledgerApi, type AuditEventRow, type LedgerRow } from "@/lib/api";
import {
  ACTIVITY_FILTERS,
  auditRow,
  dayLabel,
  loadActivity,
  localRow,
  runRow,
  subscribeActivity,
  type ActivityFilter,
  type RowTone,
  type TimelineRow,
} from "@/lib/activity";
import { ago, friendlyName } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { HistoryList } from "@/components/HistoryList";
import { Segmented as Chips } from "@/components/settings/Segmented";
import { radius, type Palette } from "@/theme/tokens";
import { CardSkeleton, FadeIn, haptic, isReducedMotion, PressScale } from "@/components/motion";

type Tab = "activity" | "history";
const TABS: Tab[] = ["activity", "history"];
const LIST_STYLE = { padding: 20, gap: 10, paddingBottom: 110 };
const PAGE = 50;
const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

/** Segmented control whose selection pill glides between halves (native-driver spring). */
function Segmented({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const { palette } = useTheme();
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(TABS.indexOf(tab))).current;
  useEffect(() => {
    const to = TABS.indexOf(tab);
    if (isReducedMotion()) x.setValue(to);
    else Animated.spring(x, { toValue: to, useNativeDriver: true, speed: 22, bounciness: 4 }).start();
  }, [tab, x]);
  const half = (w - 6) / 2;
  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{
        flexDirection: "row",
        padding: 3,
        borderRadius: radius.lg,
        backgroundColor: palette.card,
        borderWidth: 1,
        borderColor: palette.border,
        marginBottom: 4,
      }}
    >
      {w > 0 ? (
        <Animated.View
          style={{
            position: "absolute",
            top: 3,
            bottom: 3,
            left: 3,
            width: half,
            borderRadius: radius.md,
            backgroundColor: palette.background,
            transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, half] }) }],
          }}
        />
      ) : null}
      {TABS.map((t) => (
        <PressScale
          key={t}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === t }}
          onPress={() => {
            if (t !== tab) haptic("selection");
            onChange(t);
          }}
          style={{ flex: 1, alignItems: "center", paddingVertical: 7 }}
        >
          <T variant="meta" weight="medium" tone={tab === t ? "default" : "muted"}>
            {t === "activity" ? "Timeline" : "History"}
          </T>
        </PressScale>
      ))}
    </View>
  );
}

function toneColor(palette: Palette, tone: RowTone) {
  return tone === "destructive" ? palette.destructive : tone === "live" ? palette.live : tone === "ok" ? palette.ok : tone === "attention" ? palette.attention : palette.faint;
}

/** One timeline line: clock · dot · verb + box link · detail · status. Memoized per row. */
const TimelineLine = memo(function TimelineLine({ r, head, first, onRun }: { r: TimelineRow; head: string | null; first: boolean; onRun: () => void }) {
  const router = useRouter();
  const { palette } = useTheme();
  const failed = r.tone === "destructive";
  // One press target per row: a run opens its receipt in History; otherwise the box, if any.
  const onPress = r.run != null ? onRun : r.box ? () => router.push(`/box/${encodeURIComponent(r.box!)}`) : undefined;
  const label = r.run != null ? `${r.verb} ${r.box ?? ""} — open in History` : r.box ? `${r.verb} ${friendlyName(r.box)} — open` : undefined;
  const body = (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 6 }}>
      <T variant="micro" mono tone="faint" style={{ width: 40, textAlign: "right", marginTop: 2 }}>
        {clock.format(r.at)}
      </T>
      <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 7, backgroundColor: toneColor(palette, r.tone) }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="meta" tone={failed ? "muted" : "default"} numberOfLines={2}>
          {r.verb}
          {r.box ? (
            <>
              {" "}
              <T variant="meta" mono>
                {friendlyName(r.box)}
              </T>
            </>
          ) : null}
        </T>
        {r.detail ? (
          <T variant="micro" tone="muted" numberOfLines={1}>
            {r.detail}
          </T>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <T variant="micro" style={{ color: toneColor(palette, r.tone) }}>
            {r.status}
          </T>
          <T variant="micro" tone="faint">
            {ago(r.at)}
          </T>
        </View>
      </View>
    </View>
  );
  return (
    <>
      {head ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: first ? 4 : 12, paddingBottom: 4 }}>
          <T variant="micro" tone="faint" weight="medium" style={{ width: 40, textAlign: "right" }}>
            {head}
          </T>
          <View style={{ flex: 1, height: 1, backgroundColor: palette.border }} />
        </View>
      ) : null}
      {onPress ? (
        <PressScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
          {body}
        </PressScale>
      ) : (
        body
      )}
    </>
  );
});

/**
 * Activity: THE timeline — everything that happened as you, in one place: audit calls, each run's
 * finish from the ledger (the row opens that run in History), and the state changes this device
 * witnessed on live machines. History stays the second segment, owning each run's receipt.
 */
export default function Activity() {
  const { palette } = useTheme();
  // Home's "Recent runs → View all" lands on the History segment.
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === "history" ? "history" : "activity");
  useEffect(() => {
    if (params.tab === "history") setTab("history");
  }, [params.tab]);
  const [audit, setAudit] = useState<AuditEventRow[] | null>(null);
  const [runs, setRuns] = useState<LedgerRow[] | null>(null);
  const [auditDone, setAuditDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [live, setLive] = useState<TimelineRow[]>([]);

  const loadAudit = useCallback(async (cursor?: { at: string; id: number }) => {
    setBusy(true);
    try {
      const r = await api.audit({ limit: PAGE, before: cursor?.at, beforeId: cursor?.id });
      setAudit((prev) => [...(cursor ? (prev ?? []) : []), ...r.events]);
      if (r.events.length < PAGE) setAuditDone(true);
    } catch {
      setAudit((prev) => prev ?? []);
      setAuditDone(true);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void loadAudit();
    let cancelled = false;
    ledgerApi({ limit: PAGE })
      .then((r) => !cancelled && setRuns(r.rows))
      .catch(() => !cancelled && setRuns((prev) => prev ?? []));
    return () => {
      cancelled = true;
    };
  }, [loadAudit]);
  useEffect(() => {
    const load = () => void loadActivity().then((e) => setLive(e.map(localRow)));
    load();
    return subscribeActivity(load);
  }, []);

  const rows = useMemo<TimelineRow[] | null>(() => {
    if (audit === null && runs === null) return null;
    const merged = [...live, ...(audit ?? []).flatMap((e) => auditRow(e) ?? []), ...(runs ?? []).map(runRow)];
    merged.sort((a, b) => b.at - a.at);
    return merged;
  }, [audit, runs, live]);

  const counts = useMemo(() => {
    const c: Record<ActivityFilter, number> = { all: 0, machines: 0, code: 0, account: 0, failed: 0 };
    for (const r of rows ?? []) {
      c.all++;
      c[r.kind]++;
      if (r.tone === "destructive") c.failed++;
    }
    return c;
  }, [rows]);
  const visible = useMemo(() => (rows ?? []).filter((r) => (filter === "all" ? true : filter === "failed" ? r.tone === "destructive" : r.kind === filter)), [rows, filter]);
  // Day headers precomputed once per change, not re-derived inside every row render.
  const heads = useMemo(() => {
    let prev: string | null = null;
    return visible.map((r) => {
      const label = dayLabel(r.at);
      const head = label !== prev ? label : null;
      prev = label;
      return head;
    });
  }, [visible]);

  const oldest = audit && audit.length > 0 ? audit[audit.length - 1] : null;
  const more = () => oldest && void loadAudit({ at: oldest.at, id: oldest.id });
  const openHistory = useCallback(() => setTab("history"), []);
  const renderItem = useCallback(
    ({ item, index }: { item: TimelineRow; index: number }) => <TimelineLine r={item} head={heads[index]} first={index === 0} onRun={openHistory} />,
    [heads, openHistory],
  );

  const header = (
    <View style={{ gap: 10 }}>
      <T serif variant="h1" style={{ marginTop: 12 }}>
        Activity
      </T>
      <Segmented tab={tab} onChange={setTab} />
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      {/* Keyed so a segment switch cross-fades the new list in rather than snapping. */}
      <FadeIn key={tab} style={{ flex: 1 }}>
        {tab === "history" ? (
          <HistoryList header={header} contentContainerStyle={LIST_STYLE} />
        ) : (
          <FlatList
            data={visible}
            keyExtractor={(r) => r.id}
            renderItem={renderItem}
            extraData={heads}
            initialNumToRender={16}
            windowSize={9}
            contentContainerStyle={LIST_STYLE}
            ListHeaderComponent={
              <View style={{ gap: 10 }}>
                {header}
                <T variant="meta" tone="muted">
                  What happened as you: your actions, each run's start and finish, and what live machines did while this device was open. Audit kept 90 days.
                </T>
                {rows && rows.length > 0 ? (
                  <Chips small value={filter} onChange={setFilter} options={ACTIVITY_FILTERS.map((f) => ({ value: f.value, label: `${f.label} ${counts[f.value]}` }))} />
                ) : null}
              </View>
            }
            ListEmptyComponent={
              rows === null ? (
                <View style={{ gap: 10 }}>
                  <CardSkeleton />
                  <CardSkeleton />
                  <CardSkeleton />
                </View>
              ) : rows.length === 0 ? (
                <Card style={{ gap: 4 }}>
                  <T variant="body" weight="medium">
                    Nothing yet
                  </T>
                  <T variant="meta" tone="muted">
                    Starting a machine, answering it, a run finishing - each lands here with its time.
                  </T>
                </Card>
              ) : (
                <Card style={{ gap: 4 }}>
                  <T variant="body" weight="medium">{`No ${filter} rows loaded`}</T>
                  <T variant="meta" tone="muted">
                    {auditDone ? "There are none in the last 90 days." : "Load more to look further back."}
                  </T>
                </Card>
              )
            }
            ListFooterComponent={rows && rows.length > 0 && !auditDone && oldest ? <Button title="Show more" variant="ghost" small loading={busy} onPress={more} /> : null}
          />
        )}
      </FadeIn>
    </SafeAreaView>
  );
}
