import React, { useRef, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import type { TraceEvent } from "@/lib/trace";
import { runStats, toMarkdown } from "@/lib/transcript-tools";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Icon, type IconName } from "./ui/Icon";

/** Icon action with spring press + a success pop (icon swaps to a check). */
function IconAction({
  name,
  label,
  color,
  bg,
  onPress,
  done,
}: {
  name: IconName;
  label: string;
  color: string;
  bg: string;
  onPress: () => void;
  done?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 8 }).start();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityLabel={label}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onPress();
        }}
        onPressIn={() => to(0.9)}
        onPressOut={() => to(1)}
        hitSlop={6}
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={done ? "check" : name} size={14} color={color} />
      </Pressable>
    </Animated.View>
  );
}

/**
 * End-of-run receipt — one compact line, not a card: state mark, outcome word,
 * stats, and two icon actions (copy transcript / run again). A hairline row in
 * the transcript's flow, in the same voice as the lifecycle dividers.
 */
export function RunSummary({
  events,
  exitCode,
  title,
  session,
  onRunAgain,
}: {
  events: TraceEvent[];
  exitCode?: number | null;
  title: string;
  session: string;
  onRunAgain?: () => void;
}) {
  const { palette } = useTheme();
  const [copied, setCopied] = useState(false);
  const ok = exitCode == null || exitCode === 0;
  const interrupted = exitCode === 254 || exitCode === 253;
  const stats = runStats(events);
  const bits = [
    `${stats.steps} steps`,
    stats.files ? `${stats.files} files` : null,
    stats.commands ? `${stats.commands} commands` : null,
    stats.failed ? `${stats.failed} failed` : null,
  ].filter(Boolean);

  const color = ok ? palette.ok : interrupted ? palette.mutedForeground : palette.destructive;
  // 137 is 128+SIGKILL: the guest kernel OOM-killed the agent. Different cause, different remedy —
  // so it gets its own word and points at the control that fixes it.
  const oom = exitCode === 137;
  const word = ok ? "Completed" : oom ? "Out of memory" : interrupted ? "Interrupted" : `Exited · code ${exitCode}`;
  const sub = oom
    ? "the kernel killed the agent — raise this machine's memory from the actions menu, then send a message to continue"
    : interrupted
      ? exitCode === 254
        ? "the sandbox restarted mid-run — send a message to continue"
        : "stopped by you to deliver a message immediately"
      : null;

  return (
    <View style={{ marginVertical: 10, gap: 4 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: palette.card,
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: radius.pill,
          paddingVertical: 6,
          paddingLeft: 12,
          paddingRight: 6,
        }}
      >
        <Icon name={ok ? "check-circle" : interrupted ? "pause-circle" : "x-circle"} size={15} color={color} />
        <T variant="meta" weight="semibold" numberOfLines={1} style={{ color, flexShrink: 0 }}>
          {word}
        </T>
        <T variant="micro" mono tone="faint" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          {bits.join(" · ")}
        </T>
        <View style={{ flexDirection: "row", gap: 6, flexShrink: 0 }}>
          <IconAction
            name="copy"
            label="Copy transcript"
            color={copied ? palette.ok : palette.mutedForeground}
            bg={copied ? `${palette.ok}22` : palette.secondary}
            done={copied}
            onPress={async () => {
              await Clipboard.setStringAsync(toMarkdown(events, { title, machine: session }));
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          />
          {onRunAgain && (
            <IconAction name="rotate-cw" label="Run again" color={palette.mutedForeground} bg={palette.secondary} onPress={onRunAgain} />
          )}
        </View>
      </View>
      {sub ? (
        <T variant="micro" tone="faint" style={{ paddingHorizontal: 12 }}>
          {sub}
        </T>
      ) : null}
    </View>
  );
}
