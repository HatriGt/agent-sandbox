import React, { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFleet } from "@/hooks/useFleet";
import type { BoxView } from "@/lib/api";
import { isSleeping, plural } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { BoxCard } from "@/components/BoxCard";
import { EmptyFleet } from "@/components/EmptyFleet";
import { BoxActionsSheet } from "@/components/sheets/BoxActionsSheet";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { CardSkeleton, CountUp, FadeInUp, ProgressFill, stagger } from "@/components/motion";

const ORDER: Record<string, number> = { waiting: 0, running: 1, done: 2, idle: 3 };

/** Triage-ordered fleet: waiting → running → done → sleeping → pool, plus capacity. */
export default function Fleet() {
  const { palette } = useTheme();
  const { snap, error, refresh } = useFleet();
  const [refreshing, setRefreshing] = useState(false);
  const [actions, setActions] = useState<BoxView | null>(null);

  const boxes = useMemo(
    () =>
      (snap?.boxes ?? []).slice().sort((a, b) => {
        const ap = a.role === "pool-free" ? 9 : isSleeping(a.boxStatus) ? 4 : (ORDER[a.runState] ?? 5);
        const bp = b.role === "pool-free" ? 9 : isSleeping(b.boxStatus) ? 4 : (ORDER[b.runState] ?? 5);
        return ap - bp;
      }),
    [snap],
  );
  const owned = useMemo(() => boxes.filter((b) => b.role !== "pool-free"), [boxes]);
  const occupied = owned.length;
  const capacity = snap?.lifecycle.capacity ?? 0;
  const poolFree = boxes.length - occupied;
  const renderItem = useCallback(
    ({ item, index }: { item: BoxView; index: number }) => (
      <FadeInUp delay={stagger(index)}>
        <BoxCard box={item} onLongPress={setActions} onChanged={refresh} />
      </FadeInUp>
    ),
    [refresh],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      <FlatList
        data={owned}
        keyExtractor={(b) => b.name}
        renderItem={renderItem}
        initialNumToRender={10}
        windowSize={9}
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
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
        <T serif variant="h1" style={{ marginTop: 12 }}>
          Fleet
        </T>
        <T variant="body" tone="muted">
          {error
            ? `Can't reach the server — ${error}`
            : capacity
              ? <><CountUp value={occupied} /> of {capacity} slots occupied{poolFree ? `, ${plural(poolFree, "warm box")} ready` : ""}.</>
              : `${plural(occupied, "machine")}.`}
        </T>
        {!snap && error ? (
          <View style={{ alignItems: "flex-start" }}>
            <Button title="Retry" variant="outline" small onPress={() => void refresh()} />
          </View>
        ) : null}
        {/* One tick per slot, but only while the ticks stay legible — past ~24 slots each tick is
            thinner than the gap between them and the row reads as noise, so it becomes one bar. */}
        {capacity > 0 && capacity <= 24 && (
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
        {capacity > 24 && (
          <View style={{ height: 6, borderRadius: 3, backgroundColor: palette.muted, marginBottom: 6, overflow: "hidden" }}>
            <ProgressFill fraction={occupied / capacity} color={palette.live} height={6} />
          </View>
        )}
          </View>
        }
        ListEmptyComponent={
          !snap && !error ? (
            <View style={{ gap: 10 }}>
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </View>
          ) : snap ? (
            <EmptyFleet copy="No machines owned by this account. Machines are per-owner — runs started from the web with the operator token belong to the operator, not to your GitHub user. Sign in with the same identity you use on the web, or delegate a task to start one here." />
          ) : null
        }
        ListFooterComponent={
          <View style={{ gap: 6 }}>
        {poolFree > 0 && (
          <T variant="micro" tone="faint" style={{ marginTop: 2 }}>
            {plural(poolFree, "pre-booted box")} in the warm pool — a new task claims one instantly.
          </T>
        )}
        <T variant="micro" tone="faint" style={{ marginTop: 6 }}>
          Long-press a machine for pin, sleep and destroy.
        </T>
          </View>
        }
      />
      <BoxActionsSheet box={actions} memoryTiers={snap?.lifecycle.memoryTiers} memoryDefault={snap?.lifecycle.memoryDefault} diskTiers={snap?.lifecycle.diskTiers} visible={!!actions} onClose={() => setActions(null)} onChanged={refresh} />
    </SafeAreaView>
  );
}
