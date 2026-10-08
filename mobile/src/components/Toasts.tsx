import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { subscribeEdges, type ActivityEvent } from "@/lib/activity";
import { friendlyName } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { Icon } from "@/components/ui/Icon";
import { DUR, EASE_OUT, haptic, isReducedMotion } from "@/components/motion";

const TTL_MS = 6000;

/**
 * In-app attention cards for the moment a machine pauses on a question while you are elsewhere
 * (web: useAttentionToasts). Fed by the fleet edge-detector — one card per box, a repeat replaces
 * rather than stacks — and skipped for the box whose thread is open, which shows the question itself.
 */
export function Toasts() {
  const pathname = usePathname();
  const [cards, setCards] = useState<ActivityEvent[]>([]);
  const insets = useSafeAreaInsets();
  const path = useRef(pathname);
  path.current = pathname;

  useEffect(
    () =>
      subscribeEdges((ev) => {
        if (ev.kind !== "waiting") return;
        if (path.current === `/box/${ev.box}`) return;
        haptic("warning");
        setCards((prev) => [...prev.filter((c) => c.box !== ev.box), ev]);
      }),
    [],
  );

  // Landing on the box dismisses its card.
  useEffect(() => {
    const m = /^\/box\/([^/]+)$/.exec(pathname);
    if (m) setCards((prev) => (prev.some((c) => c.box === m[1]) ? prev.filter((c) => c.box !== m[1]) : prev));
  }, [pathname]);

  if (!cards.length) return null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + 8, left: 12, right: 12, gap: 8 }}>
      {cards.map((c) => (
        <Toast key={c.id} ev={c} onGone={() => setCards((prev) => prev.filter((x) => x.id !== c.id))} />
      ))}
    </View>
  );
}

function Toast({ ev, onGone }: { ev: ActivityEvent; onGone: () => void }) {
  const { palette, dark } = useTheme();
  const router = useRouter();
  const reduced = isReducedMotion();
  const t = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const gone = useRef(onGone);
  gone.current = onGone;

  useEffect(() => {
    if (!reduced) Animated.timing(t, { toValue: 1, duration: DUR.slow, easing: EASE_OUT, useNativeDriver: true }).start();
    const timer = setTimeout(() => leave(), TTL_MS);
    return () => clearTimeout(timer);
    // Mount-only: the card plays in once and leaves on its own clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leave = (after?: () => void) => {
    const finish = () => {
      gone.current();
      after?.();
    };
    if (reduced) return finish();
    Animated.timing(t, { toValue: 0, duration: DUR.fast, easing: EASE_OUT, useNativeDriver: true }).start(({ finished }) => {
      if (finished) finish();
    });
  };

  return (
    <Animated.View
      style={{
        opacity: t,
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${friendlyName(ev.box)} needs your answer. Open.`}
        onPress={() => leave(() => router.push(`/box/${ev.box}`))}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: palette.border,
          backgroundColor: palette.popover,
          opacity: pressed ? 0.85 : 1,
          shadowColor: "#000",
          shadowOpacity: dark ? 0.5 : 0.12,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
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
          hitSlop={8}
          onPress={() => leave()}
          style={{ padding: 2 }}
        >
          <Icon name="x" size={14} color={palette.faint} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}
