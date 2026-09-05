import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api, ApiError } from "@/lib/api";
import { takePendingDelegate } from "@/lib/pending-delegate";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { FadeInUp } from "@/components/ui/Motion";

/**
 * Shown the instant a task is submitted. Two ways out, whichever fires first:
 *  1. EARLY ATTACH — poll the fleet and jump to the box the moment it surfaces
 *     (a warm pool claim shows up in ~1-2s as pool-free -> pool-claimed).
 *  2. The delegate promise resolving (clarify question / error / slow path).
 * The delegate call itself blocks server-side until the run's first boundary,
 * so waiting on it alone is what made this screen sit for 10+ seconds.
 */

const STAGES = [
  { at: 0, text: "Claiming a warm machine from the pool" },
  { at: 3, text: "Checking out your repos into the workspace" },
  { at: 7, text: "Handing the task to the agent" },
];

/** Orbiting spark + breathing rings around the machine mark — the boot heartbeat. */
function BootMark({ color, ringColor }: { color: string; ringColor: string }) {
  const orbit = useRef(new Animated.Value(0)).current;
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 10 }).start();
    let loops: Animated.CompositeAnimation[] = [];
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      loops = [
        Animated.loop(Animated.timing(orbit, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true })),
        Animated.loop(Animated.timing(ring1, { toValue: 1, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true })),
        Animated.loop(
          Animated.sequence([
            Animated.delay(1000),
            Animated.timing(ring2, { toValue: 1, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          ]),
        ),
      ];
      loops.forEach((l) => l.start());
    });
    return () => {
      cancelled = true;
      loops.forEach((l) => l.stop());
    };
  }, [orbit, ring1, ring2, pop]);

  const spin = orbit.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const ring = (v: Animated.Value) => ({
    position: "absolute" as const,
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1.5,
    borderColor: ringColor,
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.15] }) }],
  });

  return (
    <View style={{ width: 140, height: 140, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={ring(ring1)} />
      <Animated.View style={ring(ring2)} />
      {/* Orbit track: a rotating layer carrying one spark on its edge. */}
      <Animated.View
        style={{
          position: "absolute",
          width: 96,
          height: 96,
          alignItems: "center",
          transform: [{ rotate: spin }],
        }}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginTop: -4 }} />
      </Animated.View>
      <Animated.View
        style={{
          width: 64,
          height: 64,
          borderRadius: radius.xl,
          backgroundColor: `${color}1a`,
          borderWidth: 1,
          borderColor: `${color}44`,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ scale: pop }],
        }}
      >
        <Icon name="box" size={26} color={color} />
      </Animated.View>
    </View>
  );
}

export default function Booting() {
  const router = useRouter();
  const { palette } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const task = useRef<string>("");
  const [elapsed, setElapsed] = useState(0);
  const settled = useRef(false);

  useEffect(() => {
    const p = takePendingDelegate();
    if (!p) {
      router.replace("/(tabs)/home");
      return;
    }
    task.current = p.task;

    const attach = (box: string) => {
      if (settled.current) return;
      settled.current = true;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      router.replace(`/box/${encodeURIComponent(box)}`);
    };

    // Path 1 — early attach: poll the fleet; a brand-new box, or a pool box
    // flipping pool-free -> claimed, is OUR box (same rule as the web).
    // This poll NEVER stops for a delegate transport error: it is the only
    // path that can still find the box after the long-held delegate request
    // drops on a flaky mobile network (the server keeps working regardless).
    let stop = false;
    void (async () => {
      const known = await p.known;
      while (!stop && !settled.current) {
        try {
          const s = await api.fleet();
          const fresh = s.boxes.find((b) => {
            if (b.role === "pool-free") return false;
            const before = known.get(b.name);
            if (before === undefined) return true;
            return before === "pool-free"; // it just flipped to claimed/session
          });
          if (fresh) return attach(fresh.name);
        } catch {
          /* transient; keep polling */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    })();

    // Path 2 — the delegate promise: authoritative for clarify questions and a
    // server-side REFUSAL. A transport failure (the request held for minutes
    // over mobile data and dropped) is NOT authoritative — the box usually
    // started anyway. Give the fleet poll a grace window to attach; only then
    // show the error, and even then keep polling so a late box still wins.
    p.promise
      .then((r) => {
        if (r.ok) attach(r.box);
        else {
          settled.current = true;
          setQuestion(r.question);
        }
      })
      .catch((e) => {
        if (settled.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        // A real HTTP status is the server refusing (capacity, auth, bad repo) — final, show now.
        // No status = the socket died in transit; the delegation is probably still running.
        if (e instanceof ApiError && e.status > 0) {
          settled.current = true;
          setError(msg);
          return;
        }
        setTimeout(() => {
          if (!settled.current) setError(msg);
        }, 15_000);
      });

    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [router]);

  const stageIdx = STAGES.reduce((a, s, i) => (elapsed >= s.at ? i : a), 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 28, gap: 6 }}>
        {error || question ? (
          <View style={{ gap: 14, alignItems: "center" }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: radius.xl,
                backgroundColor: question ? `${palette.attention}33` : `${palette.destructive}1a`,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name={question ? "help-circle" : "x-circle"} size={24} color={question ? palette.attentionText : palette.destructive} />
            </View>
            <T serif variant="h2" style={{ textAlign: "center" }}>
              {question ? "The controller needs more detail" : "Could not start the task"}
            </T>
            <T variant="body" tone={question ? "muted" : "destructive"} style={{ textAlign: "center" }}>
              {question ?? error}
            </T>
            {error ? (
              <T variant="meta" tone="muted" style={{ textAlign: "center" }}>
                The connection dropped, but the machine may have started anyway — check the fleet list, or resend the task.
              </T>
            ) : null}
            <Button title="Back to the task" onPress={() => router.replace({ pathname: "/new", params: { task: task.current } })} />
          </View>
        ) : (
          <>
            <BootMark color={palette.live} ringColor={palette.live} />
            <FadeInUp>
              <T serif variant="h2" style={{ textAlign: "center" }}>
                Starting a machine…
              </T>
            </FadeInUp>
            {/* Staged copy — remounts (and re-animates) as the stage advances. */}
            <FadeInUp key={stageIdx} distance={6}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.live }} />
                <T variant="meta" tone="muted">
                  {STAGES[stageIdx].text}
                </T>
              </View>
            </FadeInUp>
            {task.current ? (
              <View
                style={{
                  marginTop: 18,
                  maxWidth: 320,
                  backgroundColor: palette.card,
                  borderWidth: 1,
                  borderColor: palette.border,
                  borderRadius: radius.xl,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                }}
              >
                <T variant="meta" tone="muted" numberOfLines={3} style={{ textAlign: "center" }}>
                  {task.current}
                </T>
              </View>
            ) : null}
            {elapsed >= 12 ? (
              <FadeInUp>
                <T variant="micro" tone="faint" style={{ marginTop: 10 }}>
                  Cold boot — the pool was empty, so a fresh microVM is being built.
                </T>
              </FadeInUp>
            ) : null}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
