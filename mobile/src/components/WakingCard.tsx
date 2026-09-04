import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "./ui/AppText";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

// Same staged copy as the web's WakingCard, advanced purely by elapsed time.
const STAGES = [
  { at: 0, text: "Starting the microVM" },
  { at: 4, text: "Restoring the workspace and the agent's session" },
  { at: 9, text: "Reconnecting the transcript" },
];
const STUCK_AT = 45;

const RING = 32;

/**
 * The waking mark, ported from the web's PowerRing: a faint pulsing halo, a track ring, and a
 * comet arc that orbits while booting — all in the product's live blue, never the sleep violet.
 * Done: the ring completes and a check pops in. Stuck: the ring turns the alarm colour.
 * No SVG in this app, so the arc is the border-circle trick: a rotating circle whose border is
 * transparent on three sides reads as a smooth quarter-arc, with a dot riding its leading edge.
 */
function PowerRing({ state, color, trackColor }: { state: "active" | "done" | "stuck"; color: string; trackColor: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (state !== "active") return;
    let loops: Animated.CompositeAnimation[] = [];
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      loops = [
        Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1300, easing: Easing.linear, useNativeDriver: true })),
        Animated.loop(
          Animated.sequence([
            Animated.timing(halo, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(halo, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ]),
        ),
      ];
      loops.forEach((l) => l.start());
    });
    return () => {
      cancelled = true;
      loops.forEach((l) => l.stop());
    };
  }, [state, spin, halo]);

  useEffect(() => {
    if (state !== "done") return;
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 10 }).start();
  }, [state, pop]);

  return (
    <View style={{ width: RING + 8, height: RING + 8, alignItems: "center", justifyContent: "center" }}>
      {state === "active" && (
        <Animated.View
          style={{
            position: "absolute",
            width: RING + 8,
            height: RING + 8,
            borderRadius: (RING + 8) / 2,
            backgroundColor: color,
            opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.2] }),
            transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.15] }) }],
          }}
        />
      )}
      {/* track */}
      <View
        style={{
          position: "absolute",
          width: RING,
          height: RING,
          borderRadius: RING / 2,
          borderWidth: 2,
          borderColor: state === "done" ? color : trackColor,
        }}
      />
      {state === "active" && (
        <Animated.View
          style={{
            position: "absolute",
            width: RING,
            height: RING,
            transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
          }}
        >
          {/* the comet arc: only the top border is inked, so the circle reads as a quarter-arc */}
          <View
            style={{
              width: RING,
              height: RING,
              borderRadius: RING / 2,
              borderWidth: 2,
              borderColor: "transparent",
              borderTopColor: color,
            }}
          />
          {/* the comet head, riding the arc's leading edge */}
          <View
            style={{
              position: "absolute",
              top: -1.5,
              left: RING / 2 - 2.5,
              width: 5,
              height: 5,
              borderRadius: 2.5,
              backgroundColor: color,
            }}
          />
        </Animated.View>
      )}
      {state === "done" && (
        <Animated.View style={{ opacity: pop, transform: [{ scale: pop }] }}>
          <Icon name="check" size={15} color={color} />
        </Animated.View>
      )}
      {state === "stuck" && <Icon name="power" size={13} color={color} />}
    </View>
  );
}

/** The current stage line, crossfading up when the copy advances — the web's AnimatePresence swap. */
function StageText({ text, live }: { text: string; live: boolean }) {
  const anim = useRef(new Animated.Value(1)).current;
  const prev = useRef(text);
  useEffect(() => {
    if (prev.current === text) return;
    prev.current = text;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [text, anim]);
  return (
    <Animated.View
      style={{ opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}
    >
      <T variant="meta" tone="muted" numberOfLines={1}>
        {text}
        {live ? "…" : ""}
      </T>
    </Animated.View>
  );
}

/** One rail segment; the active one sweeps its fill left-to-right on a loop, like the web's wake-fill. */
function RailSegment({ state, color, trackColor }: { state: "done" | "active" | "todo"; color: string; trackColor: string }) {
  const sweep = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  useEffect(() => {
    if (state !== "active") return;
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        sweep.setValue(0.6);
        return;
      }
      loop = Animated.loop(
        Animated.timing(sweep, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [state, sweep]);

  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: trackColor, overflow: "hidden" }}
    >
      {state === "done" && <View style={{ height: 3, borderRadius: 2, backgroundColor: color }} />}
      {state === "active" && w > 0 && (
        <Animated.View
          style={{
            height: 3,
            width: w,
            borderRadius: 2,
            backgroundColor: color,
            transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-w, w] }) }],
          }}
        />
      )}
    </View>
  );
}

/**
 * Waking progress, matching the web's WakingCard: a plain status row (no boxed card), a blue
 * power ring with an orbiting comet, staged copy that crossfades as it advances, and a
 * three-segment boot → restore → reconnect rail. Retry appears once it looks stuck.
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
  const state: "active" | "done" | "stuck" = !sleeping ? "done" : stuck ? "stuck" : "active";
  const color = stuck ? palette.attentionText : palette.live;

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 8, marginBottom: 10 }}>
      <PowerRing state={state} color={color} trackColor={`${palette.live}33`} />
      <View style={{ flex: 1, gap: 2, paddingTop: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <T variant="body" weight="medium" style={{ color: stuck ? palette.attentionText : palette.foreground }}>
            {!sleeping ? "Awake" : stuck ? "Taking longer than usual" : "Waking the sandbox"}
          </T>
          {sleeping && (
            <T variant="micro" mono tone="faint">
              {elapsed}s
            </T>
          )}
        </View>
        <StageText
          text={
            !sleeping
              ? "Back. The transcript follows."
              : stuck
                ? "The machine hasn't reported back yet."
                : STAGES[stageIdx].text
          }
          live={sleeping && !stuck}
        />
        {!stuck && (
          <View style={{ flexDirection: "row", gap: 4, width: 160, marginTop: 6 }}>
            {STAGES.map((_, i) => (
              <RailSegment
                key={i}
                state={!sleeping || i < stageIdx ? "done" : i === stageIdx ? "active" : "todo"}
                color={color}
                trackColor={`${palette.live}26`}
              />
            ))}
          </View>
        )}
        {stuck && onRetry && (
          <View style={{ marginTop: 8, alignSelf: "flex-start" }}>
            <Button title="Try waking again" small variant="secondary" onPress={onRetry} />
          </View>
        )}
      </View>
    </View>
  );
}
