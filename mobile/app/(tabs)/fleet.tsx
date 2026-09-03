import React, { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFleet } from "@/hooks/useFleet";
import type { BoxView } from "@/lib/api";
import { plural } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { BoxCard } from "@/components/BoxCard";
import { BoxActionsSheet } from "@/components/sheets/BoxActionsSheet";
import { T } from "@/components/ui/AppText";

const ORDER: Record<string, number> = { waiting: 0, running: 1, done: 2, idle: 3 };

/** Triage-ordered fleet: waiting → running → done → sleeping → pool, plus capacity. */
export default function Fleet() {
  const { palette } = useTheme();
  const { snap, error, refresh } = useFleet();
  const [refreshing, setRefreshing] = useState(false);
  const [actions, setActions] = useState<BoxView | null>(null);

  const boxes = (snap?.boxes ?? [])
    .slice()
    .sort((a, b) => {
      const ap = a.role === "pool-free" ? 9 : a.boxStatus === "Stopped" ? 4 : (ORDER[a.runState] ?? 5);
      const bp = b.role === "pool-free" ? 9 : b.boxStatus === "Stopped" ? 4 : (ORDER[b.runState] ?? 5);
      return ap - bp;
    });
  const occupied = boxes.filter((b) => b.role !== "pool-free").length;
  const capacity = snap?.lifecycle.capacity ?? 0;
  const poolFree = boxes.filter((b) => b.role === "pool-free").length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: 110 }}
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
        <T serif variant="h1" style={{ marginTop: 12 }}>
          Fleet
        </T>
        <T variant="body" tone="muted">
          {error
            ? `Can't reach the server — ${error}`
            : capacity
              ? `${occupied} of ${capacity} slots occupied${poolFree ? `, ${plural(poolFree, "warm box")} ready` : ""}.`
              : `${plural(occupied, "machine")}.`}
        </T>
        {snap && occupied === 0 && !error && (
          <T variant="meta" tone="faint">
            No machines owned by this account. Machines are per-owner — runs started from the web with the
            operator token belong to the operator, not to your GitHub user. Sign in with the same identity
            you use on the web to see them.
          </T>
        )}
        {capacity > 0 && (
          <View style={{ flexDirection: "row", gap: 4, marginBottom: 6 }}>
            {Array.from({ length: capacity }).map((_, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: i < occupied ? palette.live : palette.muted,
                }}
              />
            ))}
          </View>
        )}
        {boxes
          .filter((b) => b.role !== "pool-free")
          .map((b) => (
            <BoxCard key={b.name} box={b} onLongPress={setActions} />
          ))}
        {poolFree > 0 && (
          <T variant="micro" tone="faint" style={{ marginTop: 8 }}>
            {plural(poolFree, "pre-booted box")} in the warm pool — a new task claims one instantly.
          </T>
        )}
        <T variant="micro" tone="faint" style={{ marginTop: 6 }}>
          Long-press a machine for pin, sleep and destroy.
        </T>
      </ScrollView>
      <BoxActionsSheet box={actions} visible={!!actions} onClose={() => setActions(null)} onChanged={refresh} />
    </SafeAreaView>
  );
}
