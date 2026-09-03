import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFleet } from "@/hooks/useFleet";
import type { BoxView } from "@/lib/api";
import { fleetSentence, greeting } from "@/lib/format";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { BoxCard } from "@/components/BoxCard";
import { BoxActionsSheet } from "@/components/sheets/BoxActionsSheet";
import { T } from "@/components/ui/AppText";

/** The Hub: serif greeting, fleet sentence, "Waiting on you" first, then live boxes. */
export default function Home() {
  const router = useRouter();
  const { palette } = useTheme();
  const { me } = useAuth();
  const { snap, error, refresh } = useFleet();
  const [refreshing, setRefreshing] = useState(false);
  const [actions, setActions] = useState<BoxView | null>(null);

  const boxes = (snap?.boxes ?? []).filter((b) => b.role !== "pool-free");
  const waiting = boxes.filter((b) => b.runState === "waiting");
  const live = boxes.filter((b) => b.runState === "running");
  const rest = boxes.filter((b) => b.runState !== "waiting" && b.runState !== "running");
  const name = me?.kind === "user" ? (me.name ?? me.login) : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
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

        <Pressable
          onPress={() => router.push("/new")}
          style={{
            borderWidth: 1,
            borderColor: palette.input,
            borderRadius: radius["2xl"],
            backgroundColor: palette.card,
            padding: 16,
            marginTop: 8,
          }}
        >
          <T variant="body" tone="faint">
            Delegate a task…
          </T>
        </Pressable>

        {waiting.length > 0 && (
          <View style={{ gap: 8, marginTop: 12 }}>
            <T variant="meta" weight="semibold" tone="attention">
              ◆ Waiting on you
            </T>
            {waiting.map((b) => (
              <BoxCard key={b.name} box={b} onLongPress={setActions} />
            ))}
          </View>
        )}

        {live.length > 0 && (
          <View style={{ gap: 8, marginTop: 12 }}>
            <T variant="meta" weight="semibold" tone="live">
              ● Live now
            </T>
            {live.map((b) => (
              <BoxCard key={b.name} box={b} onLongPress={setActions} />
            ))}
          </View>
        )}

        {rest.length > 0 && (
          <View style={{ gap: 8, marginTop: 12 }}>
            <T variant="meta" weight="semibold" tone="muted">
              Recent
            </T>
            {rest.map((b) => (
              <BoxCard key={b.name} box={b} onLongPress={setActions} />
            ))}
          </View>
        )}

        {snap && boxes.length === 0 && (
          <View style={{ marginTop: 24, gap: 6 }}>
            <T variant="body" tone="muted">
              Nothing running. Delegate a task and walk away — you'll see it here the moment it needs you.
            </T>
          </View>
        )}
      </ScrollView>
      <BoxActionsSheet box={actions} visible={!!actions} onClose={() => setActions(null)} onChanged={refresh} />
    </SafeAreaView>
  );
}
