import React from "react";
import { View } from "react-native";
import type { FleetSnapshot } from "@/lib/api";
import { isSleeping, isUp } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { WorkingDot } from "@/components/motion";

/**
 * The strip above the tab bar (web: StatusBar): what the fleet is doing and whether we can still
 * reach the host. Offline is a condition, not a failure of yours — muted ink, never red.
 */
export function StatusLine({ snap, error }: { snap: FleetSnapshot | null; error: string | null }) {
  const { palette } = useTheme();
  const runs = snap?.boxes.filter((b) => b.role !== "pool-free") ?? [];
  const running = runs.filter((b) => b.runState === "running" && isUp(b.boxStatus)).length;
  const waiting = runs.filter((b) => b.runState === "waiting").length;
  const sleeping = runs.filter((b) => isSleeping(b.boxStatus)).length;
  const offline = !snap && !!error;
  const stale = !!snap && !!error;

  return (
    <View
      accessibilityRole="summary"
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 3,
        borderTopWidth: 1,
        borderTopColor: palette.border,
        backgroundColor: palette.card,
      }}
    >
      {offline || stale ? (
        <>
          <WorkingDot size={5} color={palette.mutedForeground} />
          <T variant="micro" tone="muted">
            {offline ? "offline · retrying" : "reconnecting…"}
          </T>
        </>
      ) : !snap ? (
        <>
          <WorkingDot size={5} color={palette.mutedForeground} />
          <T variant="micro" tone="muted">
            connecting…
          </T>
        </>
      ) : (
        <T variant="micro" tone="muted" tnum>
          {running} running
          <T variant="micro" tone="faint">
            {" · "}
          </T>
          <T variant="micro" tone={waiting ? "attention" : "muted"} tnum>
            {waiting} waiting
          </T>
          <T variant="micro" tone="faint">
            {" · "}
          </T>
          {sleeping} sleeping
        </T>
      )}
    </View>
  );
}
