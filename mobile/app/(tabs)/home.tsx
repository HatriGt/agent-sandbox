import React, { useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFleet } from "@/hooks/useFleet";
import { api, ledgerApi, type AuditEventRow, type BoxView, type LedgerRow } from "@/lib/api";
import { describeEvent } from "@/lib/audit";
import { ago, durationWords, fleetSentence, friendlyName, greeting } from "@/lib/format";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { BoxCard } from "@/components/BoxCard";
import { BoxActionsSheet } from "@/components/sheets/BoxActionsSheet";
import { T } from "@/components/ui/AppText";
import { Icon, type IconName } from "@/components/ui/Icon";
import { BrandMark } from "@/components/ui/BrandMark";
import { CardSkeleton, FadeInUp, PressScale } from "@/components/motion";

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

/** "Recent activity" / "Recent runs" heading with the web's "View all" affordance. */
function StripHeader({ title, onAll }: { title: string; onAll: () => void }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
      <T variant="h3" weight="semibold">
        {title}
      </T>
      <PressScale onPress={onAll} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
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
      {rows.map((r) => {
        const failed = r.state === "failed";
        const first = (r.task ?? "").trim().split("\n")[0] || (r.headline ?? "").trim() || "Untitled run";
        const secs = r.startedAt && r.endedAt && r.endedAt > r.startedAt ? Math.round((r.endedAt - r.startedAt) / 1000) : null;
        const tokens = r.inputTokens != null || r.outputTokens != null ? (r.inputTokens ?? 0) + (r.outputTokens ?? 0) : null;
        return (
          <PressScale key={r.id} onPress={onHistory} accessibilityLabel={`${first} — open history`} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 36, paddingVertical: 4 }}>
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
        );
      })}
    </FadeInUp>
  );
}

/** The last few state-changing calls, as the Activity page narrates them. */
function RecentActivity({ onAll }: { onAll: () => void }) {
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
      {rows.map((e) => {
        const d = describeEvent(e);
        const at = Date.parse(e.at);
        const failed = e.status >= 400;
        return (
          <View key={e.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 36, paddingVertical: 4 }}>
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
          </View>
        );
      })}
    </FadeInUp>
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

        <PressScale
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
        </PressScale>

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
            {rest.map((b, i) => (
              <FadeInUp key={b.name} delay={Math.min(i, 5) * 45}>
                <BoxCard box={b} onLongPress={setActions} />
              </FadeInUp>
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

        <RecentRuns onHistory={() => router.push({ pathname: "/(tabs)/activity", params: { tab: "history" } })} />
        <RecentActivity onAll={() => router.push("/(tabs)/activity")} />
      </ScrollView>
      <BoxActionsSheet box={actions} memoryTiers={snap?.lifecycle.memoryTiers} memoryDefault={snap?.lifecycle.memoryDefault} diskTiers={snap?.lifecycle.diskTiers} visible={!!actions} onClose={() => setActions(null)} onChanged={refresh} />
    </SafeAreaView>
  );
}
