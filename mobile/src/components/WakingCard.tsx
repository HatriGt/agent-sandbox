import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Icon } from "./ui/Icon";
import { TypingDots } from "./ui/Motion";

// Same staged copy as the web's WakingCard, advanced purely by elapsed time.
const STAGES = [
  { at: 0, text: "starting the microVM" },
  { at: 4, text: "restoring workspace + session" },
  { at: 9, text: "reconnecting the transcript" },
];
const STUCK_AT = 45;

/** The current stage as a quiet mono chip that crossfades up when the copy advances. */
function StageChip({ text }: { text: string }) {
  const { palette } = useTheme();
  const anim = useRef(new Animated.Value(1)).current;
  const prev = useRef(text);
  useEffect(() => {
    if (prev.current === text) return;
    prev.current = text;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [text, anim]);
  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
        backgroundColor: palette.muted,
        borderRadius: radius.sm,
        paddingHorizontal: 6,
        paddingVertical: 2,
        flexShrink: 1,
        minWidth: 0,
      }}
    >
      <T variant="micro" mono tone="muted" numberOfLines={1}>
        {text}
      </T>
    </Animated.View>
  );
}

/** The pill's shared shell: border, card background, pill radius — the WorkingIndicator silhouette. */
function Pill({ children }: { children: React.ReactNode }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", marginBottom: 12 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          maxWidth: "100%",
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: radius.pill,
          backgroundColor: palette.card,
          paddingVertical: 8,
          paddingLeft: 12,
          paddingRight: 12,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * Waking progress in the WorkingIndicator's pill silhouette, matching the web: three breathing
 * dots in the live blue, "Waking the sandbox", the current boot stage as a mono chip that
 * crossfades as it advances, and the elapsed seconds. Done swaps the dots for a check; stuck
 * (45s) turns amber and offers a Retry inside the pill.
 */
export function WakingCard({
  sleeping,
  startedAt,
  onRetry,
}: {
  sleeping: boolean;
  startedAt: number;
  onRetry?: () => void;
}) {
  const { palette } = useTheme();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const stageIdx = sleeping ? STAGES.reduce((a, s, i) => (elapsed >= s.at ? i : a), 0) : STAGES.length - 1;
  const stuck = sleeping && elapsed >= STUCK_AT;

  return (
    <Pill>
      {!sleeping ? (
        <Icon name="check" size={14} color={palette.live} />
      ) : stuck ? (
        <Icon name="alert-circle" size={14} color={palette.attentionText} />
      ) : (
        <TypingDots color={palette.live} />
      )}
      <T variant="meta" weight="medium" style={{ color: stuck ? palette.attentionText : palette.foreground, flexShrink: 0 }}>
        {!sleeping ? "Awake" : stuck ? "Taking longer than usual" : "Waking the sandbox"}
      </T>
      {!stuck && <StageChip text={!sleeping ? "back — the transcript follows" : STAGES[stageIdx].text} />}
      {sleeping && !stuck && (
        <T variant="micro" mono tone="faint" style={{ flexShrink: 0 }}>
          {elapsed}s
        </T>
      )}
      {stuck && onRetry && (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            backgroundColor: `${palette.live}1a`,
            borderRadius: radius.pill,
            paddingVertical: 4,
            paddingHorizontal: 10,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Icon name="rotate-cw" size={11} color={palette.live} />
          <T variant="micro" weight="semibold" tone="live">
            Retry
          </T>
        </Pressable>
      )}
    </Pill>
  );
}

/**
 * The counterpart for a box the operator put to sleep on purpose: the same pill, resting — a moon,
 * one line, and a Wake action. Without this, staying on the thread after "Sleep now" showed the
 * waking pill and the auto-wake immediately bounced the box back up.
 */
export function SleepingCard({ onWake }: { onWake: () => void }) {
  const { palette } = useTheme();
  return (
    <Pill>
      <Icon name="moon" size={14} color={palette.sleep} />
      <T variant="meta" weight="medium" style={{ flexShrink: 0 }}>
        Asleep
      </T>
      <T variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
        workspace and session kept
      </T>
      <Pressable
        onPress={onWake}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          backgroundColor: `${palette.live}1a`,
          borderRadius: radius.pill,
          paddingVertical: 4,
          paddingHorizontal: 10,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icon name="sun" size={11} color={palette.live} />
        <T variant="micro" weight="semibold" tone="live">
          Wake
        </T>
      </Pressable>
    </Pill>
  );
}
