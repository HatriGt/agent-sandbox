import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Animated, FlatList, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { clearActivity, loadActivity, subscribeActivity, type ActivityEvent } from "@/lib/activity";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { HistoryList } from "@/components/HistoryList";
import { radius } from "@/theme/tokens";
import { FadeIn, FadeInUp, haptic, isReducedMotion, PressScale, stagger } from "@/components/motion";

type Tab = "activity" | "history";
const TABS: Tab[] = ["activity", "history"];
const LIST_STYLE = { padding: 20, gap: 10, paddingBottom: 110 };

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
            {t === "activity" ? "On this device" : "History"}
          </T>
        </PressScale>
      ))}
    </View>
  );
}

const ActivityRow = memo(function ActivityRow({ e, i }: { e: ActivityEvent; i: number }) {
  const router = useRouter();
  const { palette } = useTheme();
  return (
    <FadeInUp delay={stagger(i)}>
      <Card onPress={() => router.push(`/box/${encodeURIComponent(e.box)}`)}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Icon
            name={e.kind === "waiting" ? "alert-circle" : e.kind === "done" ? "check-circle" : "x-circle"}
            size={16}
            color={e.kind === "waiting" ? palette.attention : e.kind === "done" ? palette.ok : palette.destructive}
          />
          <T variant="body" weight="medium" style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
            {e.title ?? e.box}
          </T>
          <T variant="micro" tone="faint" numberOfLines={1} style={{ flexShrink: 0 }}>
            {ago(e.at)}
          </T>
        </View>
        <T variant="meta" tone="muted" style={{ marginTop: 4 }}>
          {e.kind === "waiting" ? (e.detail ?? "needs you") : e.kind === "done" ? "finished" : (e.detail ?? "failed")}
        </T>
      </Card>
    </FadeInUp>
  );
});

/**
 * Two records of the past, deliberately kept apart:
 *  · Activity — this device's own feed of state edges it witnessed (local, instant, may have gaps).
 *  · History  — the server's archive of finished runs (authoritative, survives the machine).
 */
export default function Activity() {
  const { palette } = useTheme();
  const [tab, setTab] = useState<Tab>("activity");
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    const load = () => void loadActivity().then((e) => setEvents([...e]));
    load();
    return subscribeActivity(load);
  }, []);

  const renderItem = useCallback(({ item, index }: { item: ActivityEvent; index: number }) => <ActivityRow e={item} i={index} />, []);

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
            data={events}
            keyExtractor={(e) => e.id}
            renderItem={renderItem}
            initialNumToRender={12}
            windowSize={9}
            contentContainerStyle={LIST_STYLE}
            ListHeaderComponent={header}
            ListEmptyComponent={
              <T variant="body" tone="muted">
                State changes you've seen on this device land here: when a machine needs you, finishes, or
                fails. Nothing yet.
              </T>
            }
            ListFooterComponent={events.length > 0 ? <Button title="Clear" variant="ghost" onPress={() => void clearActivity()} /> : null}
          />
        )}
      </FadeIn>
    </SafeAreaView>
  );
}
