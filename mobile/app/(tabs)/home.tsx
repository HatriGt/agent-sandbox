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
import { Icon, type IconName } from "@/components/ui/Icon";
import { BrandMark } from "@/components/ui/BrandMark";
import { FadeInUp } from "@/components/ui/Motion";
import { CardSkeleton } from "@/components/ui/Skeleton";

function SectionHeader({ icon, label, tone }: { icon: IconName; label: string; tone: "attention" | "live" | "muted" }) {
  const { palette } = useTheme();
  const color = tone === "attention" ? palette.attentionText : tone === "live" ? palette.live : palette.mutedForeground;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name={icon} size={14} color={color} />
      <T variant="meta" weight="semibold" style={{ color }}>
        {label}
      </T>
    </View>
  );
}

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

        <Pressable
          onPress={() => router.push("/new")}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderWidth: 1,
            borderColor: palette.input,
            borderRadius: radius["2xl"],
            backgroundColor: palette.card,
            padding: 16,
            marginTop: 8,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Icon name="plus-circle" size={18} color={palette.faint} />
          <T variant="body" tone="faint" style={{ flex: 1 }}>
            Delegate a task…
          </T>
          <Icon name="camera" size={16} color={palette.faint} />
        </Pressable>

        {!snap && !error && (
          <View style={{ gap: 8, marginTop: 12 }}>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </View>
        )}

        {waiting.length > 0 && (
          <View style={{ gap: 8, marginTop: 12 }}>
            <SectionHeader icon="alert-circle" label="Waiting on you" tone="attention" />
            {waiting.map((b, i) => (
              <FadeInUp key={b.name} delay={i * 60}>
                <BoxCard box={b} onLongPress={setActions} />
              </FadeInUp>
            ))}
          </View>
        )}

        {live.length > 0 && (
          <View style={{ gap: 8, marginTop: 12 }}>
            <SectionHeader icon="activity" label="Live now" tone="live" />
            {live.map((b, i) => (
              <FadeInUp key={b.name} delay={i * 60}>
                <BoxCard box={b} onLongPress={setActions} />
              </FadeInUp>
            ))}
          </View>
        )}

        {rest.length > 0 && (
          <View style={{ gap: 8, marginTop: 12 }}>
            <SectionHeader icon="archive" label="Recent" tone="muted" />
            {rest.map((b) => (
              <BoxCard key={b.name} box={b} onLongPress={setActions} />
            ))}
          </View>
        )}

        {snap && boxes.length === 0 && (
          <View style={{ marginTop: 32, gap: 14, alignItems: "center" }}>
            <BrandMark size={72} animate />
            <T variant="body" tone="muted" style={{ textAlign: "center" }}>
              Nothing running. Delegate a task and walk away — you'll see it here the moment it needs you.
            </T>
          </View>
        )}
      </ScrollView>
      <BoxActionsSheet box={actions} memoryTiers={snap?.lifecycle.memoryTiers} memoryDefault={snap?.lifecycle.memoryDefault} visible={!!actions} onClose={() => setActions(null)} onChanged={refresh} />
    </SafeAreaView>
  );
}
