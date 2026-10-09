import React, { useEffect, useRef } from "react";
import { Animated, Dimensions, Easing, PanResponder, StyleSheet, View } from "react-native";
import { Redirect, Tabs, useRouter } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic, isReducedMotion, PressScale, SPRING } from "@/components/motion";
import { composeTask } from "@/state/composerFocus";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useFleet } from "@/hooks/useFleet";
import { StatusLine } from "@/components/StatusLine";

const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: "home", label: "Home", icon: "home" },
  { name: "fleet", label: "Fleet", icon: "server" },
  { name: "activity", label: "Activity", icon: "bell" },
  { name: "settings", label: "Settings", icon: "settings" },
];

function TabItem({
  icon,
  label,
  focused,
  onPress,
}: {
  icon: IconName;
  label: string;
  focused: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const anim = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    if (isReducedMotion()) {
      anim.setValue(focused ? 1 : 0);
      return;
    }
    Animated.spring(anim, { toValue: focused ? 1 : 0, useNativeDriver: true, ...SPRING.snap }).start();
  }, [focused, anim]);

  // Icon-only: the active tab gets a soft accent circle and a slight lift —
  // no labels (they wrapped and cluttered the pill); the label is read by the screen reader.
  return (
    <PressScale
      scaleTo={0.9}
      haptic="selection"
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      style={{ flex: 1, alignItems: "center" }}
      hitSlop={10}
    >
      <View style={{ alignItems: "center", justifyContent: "center", width: 44, height: 44 }}>
        <Animated.View
          style={{
            position: "absolute",
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: palette.accent,
            opacity: anim,
            transform: [{ scale: anim }],
          }}
        />
        <Animated.View style={{ transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) }] }}>
          <Icon name={icon} size={20} color={focused ? palette.foreground : palette.faint} />
        </Animated.View>
      </View>
    </PressScale>
  );
}

const STATUS_H = 22;

/** Floating pill tab bar with a raised center "New" action, over the fleet status strip. */
function PillTabBar({ state, navigation }: BottomTabBarProps) {
  const { palette, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const fleet = useFleet();
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  const item = (t: (typeof TABS)[number]) => {
    const idx = state.routes.findIndex((r) => r.name === t.name);
    return <TabItem key={t.name} icon={t.icon} label={t.label} focused={state.index === idx} onPress={() => navigation.navigate(t.name as never)} />;
  };

  return (
    <View pointerEvents="box-none" style={{ paddingBottom: insets.bottom, backgroundColor: palette.card }}>
      <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + STATUS_H + 10 }}>
      <View
        style={{
          marginHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: palette.popover,
          borderRadius: 999,
          paddingHorizontal: 8,
          paddingVertical: 6,
          // Border OR shadow: a hairline in dark (shadows vanish on dark bg), a shadow in light.
          ...(dark
            ? { borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border }
            : { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 }),
        }}
      >
        {left.map(item)}
        <PressScale
          scaleTo={0.92}
          haptic="medium"
          accessibilityRole="button"
          accessibilityLabel="New task"
          onPress={() => composeTask()}
          style={{
            width: 50,
            height: 50,
            borderRadius: 25,
            marginTop: -22,
            marginHorizontal: 6,
            backgroundColor: palette.primary,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 3,
            borderColor: palette.background,
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 10,
          }}
        >
          <Icon name="plus" size={24} color={palette.primaryForeground} />
        </PressScale>
        {right.map(item)}
      </View>
      </View>
      <View style={{ height: STATUS_H }}>
        <StatusLine snap={fleet.snap} error={fleet.error} />
      </View>
    </View>
  );
}

/** Decisive-horizontal test: 12px moved, flatter than ~1:1.6. Fires in the capture phase so a drag
 *  that began on a card or row still pages, yet a scroll (vertical) or a chip dock (short, fast
 *  horizontal flicks are already native-scrolling before 12px) keeps its own gesture. */
const CLAIM_PX = 12;
const CLAIM_RATIO = 1.6;
const EDGE_PX = 24;
/** Commit when the finger crossed a quarter of the width, or flicked. */
const COMMIT_FRACTION = 0.25;
const COMMIT_VX = 0.3;
/** How far the leaving scene travels on commit before the Tabs transition takes over. */
const EXIT_FRACTION = 0.4;

/**
 * Horizontal-swipe layer over the tab scenes: the scene tracks the finger 1:1 (rubber-banded past
 * the first/last tab), a selection haptic marks the commit point, and on release it either springs
 * back or carries on out of the way while the Tabs 'shift' transition brings the neighbour in — one
 * continuous motion, like a pager. PanResponder, not a native pager: the app has none and OTA can't
 * add one. Claimed in the capture phase so pressables under the finger don't swallow the drag.
 */
function SwipeBetweenTabs({
  index,
  count,
  onGo,
  children,
}: {
  index: number;
  count: number;
  onGo: (dir: 1 | -1) => void;
  children: React.ReactNode;
}) {
  const drag = useRef(new Animated.Value(0)).current;
  // Keep the latest index/count in refs — the PanResponder is created once.
  const at = useRef({ index, count });
  at.current = { index, count };
  const crossed = useRef(false);
  const width = Dimensions.get("window").width;

  const settle = () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, ...SPRING.snap }).start();

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (e, g) => {
        const startX = e.nativeEvent.pageX - g.dx;
        const w = Dimensions.get("window").width;
        // A drag from either screen edge is the system's (Android back gesture, iOS stack pop).
        if (startX < EDGE_PX || startX > w - EDGE_PX) return false;
        return Math.abs(g.dx) > CLAIM_PX && Math.abs(g.dx) > Math.abs(g.dy) * CLAIM_RATIO;
      },
      onPanResponderGrant: () => {
        crossed.current = false;
      },
      onPanResponderMove: (_e, g) => {
        const { index: i, count: n } = at.current;
        const w = Dimensions.get("window").width;
        const blocked = (g.dx < 0 && i >= n - 1) || (g.dx > 0 && i <= 0);
        const commit = w * COMMIT_FRACTION;
        if (!blocked && Math.abs(g.dx) > commit !== crossed.current) {
          crossed.current = !crossed.current;
          haptic("selection");
        }
        if (isReducedMotion()) return;
        // 1:1 under the finger; a rubber band past the ends so the edge is felt, not hit.
        drag.setValue(blocked ? g.dx * 0.15 : g.dx);
      },
      onPanResponderRelease: (_e, g) => {
        const { index: i, count: n } = at.current;
        const w = Dimensions.get("window").width;
        const commit = w * COMMIT_FRACTION;
        const goLeft = (g.dx < -commit || g.vx < -COMMIT_VX) && i < n - 1;
        const goRight = (g.dx > commit || g.vx > COMMIT_VX) && i > 0;
        if (!goLeft && !goRight) return settle();
        if (!crossed.current) haptic("selection");
        const dir: 1 | -1 = goLeft ? 1 : -1;
        if (isReducedMotion()) {
          drag.setValue(0);
          return onGo(dir);
        }
        // Keep moving with the finger's momentum while the neighbour shifts in, then reset this
        // scene's offset once it is off-screen so it comes back centred next time.
        Animated.timing(drag, { toValue: -dir * w * EXIT_FRACTION, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() =>
          drag.setValue(0),
        );
        onGo(dir);
      },
      onPanResponderTerminate: settle,
    }),
  ).current;

  // Fade as the scene leaves so the hand-off to the incoming tab reads as one surface, not two.
  const opacity = drag.interpolate({ inputRange: [-width, 0, width], outputRange: [0.35, 1, 0.35], extrapolate: "clamp" });

  return (
    <Animated.View style={{ flex: 1, opacity, transform: [{ translateX: drag }] }} {...pan.panHandlers}>
      {children}
    </Animated.View>
  );
}

export default function TabsLayout() {
  const { signedIn, ready } = useAuth();
  const { palette } = useTheme();
  if (ready && !signedIn) return <Redirect href="/welcome" />;

  return (
    <Tabs
      tabBar={(props) => <PillTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        // Cross-fade + shift between tabs (bottom-tabs v7) — pairs with the swipe nudge below.
        animation: "shift",
        transitionSpec: {
          animation: "timing",
          config: { duration: 220, easing: Easing.out(Easing.cubic) },
        },
        sceneStyle: { backgroundColor: palette.background },
      }}
      screenLayout={({ children, navigation, route }) => {
        const state = navigation.getState();
        const index = state.routes.findIndex((r) => r.name === route.name);
        return (
          <SwipeBetweenTabs
            index={index}
            count={state.routes.length}
            onGo={(dir) => {
              const next = state.routes[index + dir];
              if (next) navigation.navigate(next.name as never);
            }}
          >
            {children}
          </SwipeBetweenTabs>
        );
      }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="fleet" />
      <Tabs.Screen name="activity" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
