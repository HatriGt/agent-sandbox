import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Icon } from "./ui/Icon";
import { WorkingDot } from "./ui/WorkingDot";

// Same staged copy as the web's WakingCard, advanced purely by elapsed time.
const STAGES: { at: number; text: string }[] = [
  { at: 0, text: "Starting the microVM" },
  { at: 4, text: "Restoring the workspace and the agent's session" },
  { at: 9, text: "Reconnecting the transcript" },
];

/** Waking progress: violet while asleep, green beat once awake. */
export function WakingCard({ sleeping, startedAt }: { sleeping: boolean; startedAt: number }) {
  const { palette } = useTheme();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const stage = sleeping
    ? ([...STAGES].reverse().find((s) => elapsed >= s.at) ?? STAGES[0]).text
    : "Back. The transcript follows.";
  const color = sleeping ? palette.sleep : palette.ok;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderWidth: 1,
        borderColor: color,
        borderRadius: radius.xl,
        padding: 12,
        marginBottom: 12,
      }}
    >
      {sleeping ? <WorkingDot color={color} /> : <Icon name="check-circle" size={16} color={color} />}
      <View style={{ flex: 1 }}>
        <T variant="body" weight="semibold" style={{ color }}>
          {sleeping ? "Waking the sandbox" : "Awake"}
        </T>
        <T variant="meta" tone="muted">
          {stage}
        </T>
      </View>
      {sleeping && (
        <T variant="micro" mono tone="faint">
          {elapsed}s
        </T>
      )}
    </View>
  );
}
