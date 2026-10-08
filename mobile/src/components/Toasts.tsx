import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, PanResponder, Pressable, StyleSheet, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { subscribeEdges, type ActivityEvent } from "@/lib/activity";
import { friendlyName } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Icon } from "@/components/ui/Icon";
import { useSheetsOpen } from "@/components/ui/Sheet";
import { DUR, EASE_OUT, haptic, isReducedMotion, SPRING } from "@/components/motion";

const TTL_MS = 6000;
const MAX_VISIBLE = 2;
/** Swipe travel at which a dismissed card is fully off and gone. */
const SWIPE_OUT = 240;

/**
 * In-app attention cards for the moment a machine pauses on a question while you are elsewhere
 * (web: useAttentionToasts). Fed by the fleet edge-detector — one card per box, a repeat replaces
 * rather than stacks — and skipped for the box whose thread is open, which shows the question itself.
 */
export function Toasts() {
  const pathname = usePathname();
  const [cards, setCards] = useState<ActivityEvent[]>([]);
  const insets = useSafeAreaInsets();
  const sheetOpen = useSheetsOpen();
  const path = useRef(pathname);
  path.current = pathname;
  // Sheets are RN Modals and paint above this host, so a card that arrives mid-sheet waits here
  // and is flushed the moment the last sheet closes.
  const held = useRef<ActivityEvent[]>([]);
  const sheetRef = useRef(sheetOpen);
  sheetRef.current = sheetOpen;

  useEffect(
    () =>
      subscribeEdges((ev) => {
        if (ev.kind !== "waiting") return;
        if (path.current === `/box/${ev.box}`) return;
        haptic("warning");
        if (sheetRef.current) {
          held.current = [...held.current.filter((c) => c.box !== ev.box), ev];
          return;
        }
        setCards((prev) => [...prev.filter((c) => c.box !== ev.box), ev]);
      }),
    [],
  );

  useEffect(() => {
    if (sheetOpen || !held.current.length) return;
    const queued = held.current;
    held.current = [];
    setCards((prev) => [...prev.filter((c) => !queued.some((q) => q.box === c.box)), ...queued]);
  }, [sheetOpen]);

  // Landing on the box dismisses its card.
  useEffect(() => {
    const m = /^\/box\/([^/]+)$/.exec(pathname);
    if (!m) return;
    held.current = held.current.filter((c) => c.box !== m[1]);
    setCards((prev) => (prev.some((c) => c.box === m[1]) ? prev.filter((c) => c.box !== m[1]) : prev));
  }, [pathname]);

  if (!cards.length) return null;
  const visible = cards.slice(0, MAX_VISIBLE);
  const more = cards.length - visible.length;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + 8, left: 12, right: 12, gap: 8 }}>
      {visible.map((c) => (
        <Toast key={c.id} ev={c} onGone={() => setCards((prev) => prev.filter((x) => x.id !== c.id))} />
      ))}
      {more > 0 ? (
        <T variant="micro" tone="muted" tnum style={{ textAlign: "center" }}>
          +{more} more
        </T>
      ) : null}
    </View>
  );
}

function Toast({ ev, onGone }: { ev: ActivityEvent; onGone: () => void }) {
  const { palette, dark } = useTheme();
  const router = useRouter();
  const reduced = isReducedMotion();
  const t = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const dx = useRef(new Animated.Value(0)).current;
  const gone = useRef(onGone);
  gone.current = onGone;
  // The 6s clock pauses while the card is held (press-in) and resumes with what was left.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const left = useRef(TTL_MS);
  const startedAt = useRef(0);
  const leaving = useRef(false);

  const leave = (after?: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    pause();
    const finish = () => {
      gone.current();
      after?.();
    };
    if (reduced) return finish();
    Animated.timing(t, { toValue: 0, duration: DUR.fast, easing: EASE_OUT, useNativeDriver: true }).start(({ finished }) => {
      if (finished) finish();
    });
  };
  const resume = () => {
    if (timer.current !== undefined || leaving.current) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => leave(), left.current);
  };
  const pause = () => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    left.current = Math.max(400, left.current - (Date.now() - startedAt.current));
  };

  useEffect(() => {
    if (!reduced) Animated.timing(t, { toValue: 1, duration: DUR.slow, easing: EASE_OUT, useNativeDriver: true }).start();
    AccessibilityInfo.announceForAccessibility(`${friendlyName(ev.box)} needs your answer`);
    resume();
    return pause;
    // Mount-only: the card plays in once and leaves on its own clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Horizontal swipe-to-dismiss: the card follows the finger and fades; a flick or a long pull
  // lets it go, anything shorter springs home. Claimed only for clearly horizontal drags so the
  // tap-to-open Pressable underneath still gets taps.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => pause(),
      onPanResponderMove: (_e, g) => dx.setValue(g.dx),
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dx) > 60 || Math.abs(g.vx) > 0.5) {
          if (leaving.current) return;
          leaving.current = true;
          const dir = g.dx < 0 || (g.dx === 0 && g.vx < 0) ? -1 : 1;
          if (reduced) return gone.current();
          Animated.timing(dx, { toValue: dir * SWIPE_OUT, duration: DUR.fast, easing: EASE_OUT, useNativeDriver: true }).start(({ finished }) => {
            if (finished) gone.current();
          });
          return;
        }
        Animated.spring(dx, { toValue: 0, useNativeDriver: true, ...SPRING.snap }).start();
        resume();
      },
      onPanResponderTerminate: () => {
        Animated.spring(dx, { toValue: 0, useNativeDriver: true, ...SPRING.snap }).start();
        resume();
      },
    }),
  ).current;

  return (
    <Animated.View
      {...pan.panHandlers}
      style={{
        opacity: Animated.multiply(t, dx.interpolate({ inputRange: [-SWIPE_OUT, 0, SWIPE_OUT], outputRange: [0, 1, 0], extrapolate: "clamp" })),
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }, { translateX: dx }],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${friendlyName(ev.box)} needs your answer. Open.`}
        onPressIn={pause}
        onPressOut={resume}
        onPress={() => leave(() => router.push(`/box/${ev.box}`))}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: radius.xl,
          backgroundColor: palette.popover,
          opacity: pressed ? 0.85 : 1,
          // Border OR shadow: a hairline in dark (shadows vanish on dark bg), a shadow in light.
          ...(dark
            ? { borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border }
            : { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 }),
        })}
      >
        <Icon name="help-circle" size={16} color={palette.attentionText} style={{ marginTop: 2 }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="meta" weight="medium">
            {friendlyName(ev.box)} needs your answer
          </T>
          {(ev.detail || ev.title) && (
            <T variant="meta" tone="muted" numberOfLines={2}>
              {ev.detail || ev.title}
            </T>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={14}
          onPress={() => leave()}
          style={{ padding: 2 }}
        >
          <Icon name="x" size={14} color={palette.faint} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}
