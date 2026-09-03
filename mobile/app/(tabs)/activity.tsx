import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { clearActivity, loadActivity, subscribeActivity, type ActivityEvent } from "@/lib/activity";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/** Device-local feed of state edges (the server stores no run history by design). */
export default function Activity() {
  const router = useRouter();
  const { palette } = useTheme();
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    const load = () => void loadActivity().then((e) => setEvents([...e]));
    load();
    return subscribeActivity(load);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: 40 }}>
        <T serif variant="h1" style={{ marginTop: 12 }}>
          Activity
        </T>
        {events.length === 0 ? (
          <T variant="body" tone="muted">
            State changes you've seen on this device land here: when a machine needs you, finishes, or
            fails. Nothing yet.
          </T>
        ) : (
          events.map((e) => (
            <Card key={e.id} onPress={() => router.push(`/box/${encodeURIComponent(e.box)}`)}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <T
                  variant="body"
                  tone={e.kind === "waiting" ? "attention" : e.kind === "done" ? "ok" : "destructive"}
                >
                  {e.kind === "waiting" ? "◆" : e.kind === "done" ? "✓" : "✕"}
                </T>
                <T variant="body" weight="medium" style={{ flex: 1 }} numberOfLines={1}>
                  {e.title ?? e.box}
                </T>
                <T variant="micro" tone="faint">
                  {ago(e.at)}
                </T>
              </View>
              <T variant="meta" tone="muted" style={{ marginTop: 4 }}>
                {e.kind === "waiting" ? (e.detail ?? "needs you") : e.kind === "done" ? "finished" : (e.detail ?? "failed")}
              </T>
            </Card>
          ))
        )}
        {events.length > 0 && (
          <Button title="Clear" variant="ghost" onPress={() => void clearActivity()} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
