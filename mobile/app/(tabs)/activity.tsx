import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { clearActivity, loadActivity, subscribeActivity, type ActivityEvent } from "@/lib/activity";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { FadeInUp } from "@/components/ui/Motion";
import { HistoryList } from "@/components/HistoryList";
import { radius } from "@/theme/tokens";

type Tab = "activity" | "history";

/**
 * Two records of the past, deliberately kept apart:
 *  · Activity — this device's own feed of state edges it witnessed (local, instant, may have gaps).
 *  · History  — the server's archive of finished runs (authoritative, survives the machine).
 */
export default function Activity() {
  const router = useRouter();
  const { palette } = useTheme();
  const [tab, setTab] = useState<Tab>("activity");
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    const load = () => void loadActivity().then((e) => setEvents([...e]));
    load();
    return subscribeActivity(load);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: 110 }}>
        <T serif variant="h1" style={{ marginTop: 12 }}>
          Activity
        </T>

        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: "row",
            gap: 4,
            padding: 3,
            borderRadius: radius.lg,
            backgroundColor: palette.card,
            borderWidth: 1,
            borderColor: palette.border,
            marginBottom: 4,
          }}
        >
          {(["activity", "history"] as const).map((t) => (
            <Pressable
              key={t}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t }}
              onPress={() => setTab(t)}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: "center",
                paddingVertical: 7,
                borderRadius: radius.md,
                backgroundColor: tab === t ? palette.background : "transparent",
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <T variant="meta" weight="medium" tone={tab === t ? "default" : "muted"}>
                {t === "activity" ? "On this device" : "History"}
              </T>
            </Pressable>
          ))}
        </View>

        {tab === "history" ? (
          <HistoryList />
        ) : events.length === 0 ? (
          <T variant="body" tone="muted">
            State changes you've seen on this device land here: when a machine needs you, finishes, or
            fails. Nothing yet.
          </T>
        ) : (
          events.map((e, i) => (
            <FadeInUp key={e.id} delay={Math.min(i, 8) * 40}>
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
          ))
        )}
        {tab === "activity" && events.length > 0 && (
          <Button title="Clear" variant="ghost" onPress={() => void clearActivity()} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
