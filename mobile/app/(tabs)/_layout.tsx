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

const COMMIT_PX = 48;
const FOLLOW_CAP = 56;
const EDGE_PX = 24;

/**
 * Horizontal-swipe layer over the tab scenes: a decisive left/right drag moves to the adjacent
 * tab. The scene follows the finger (rubber-banded) so the commit point is visible, a selection
 * haptic marks crossing it, and the Tabs 'shift' transition is the only animation on commit.
 * PanResponder (not a pager — no native pager in this app) claims the gesture only when it is
 * clearly horizontal, so vertical scrolls and the horizontal chip docks keep working: those sit
 * deeper in the tree and win the responder negotiation for small drags.
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
  const nudge = useRef(new Animated.Value(0)).current;
  // Keep the latest index/count in refs — the PanResponder is created once.
  const at = useRef({ index, count });
  at.current = { index, count };
  // Set once per drag when the finger crosses the commit distance: the haptic says "release now".
  const crossed = useRef(false);

  const pan = useRef(
    PanResponder.create({
      // Claim only decisive horizontal drags (long and flat), and never capture —
      // children get first refusal, so scrolling stays untouched. A drag that began at either
      // screen edge is the system's (Android back gesture, iOS stack pop).
      onMoveShouldSetPanResponder: (e, g) => {
        const startX = e.nativeEvent.pageX - g.dx;
        const w = Dimensions.get("window").width;
        if (startX < EDGE_PX || startX > w - EDGE_PX) return false;
        return Math.abs(g.dx) > 26 && Math.abs(g.dx) > Math.abs(g.dy) * 2.2;
      },
      onPanResponderGrant: () => {
        crossed.current = false;
      },
      onPanResponderMove: (_e, g) => {
        const { index: i, count: n } = at.current;
        const blocked = (g.dx < 0 && i >= n - 1) || (g.dx > 0 && i <= 0);
        if (!blocked && !crossed.current && Math.abs(g.dx) > COMMIT_PX) {
          crossed.current = true;
          haptic("selection");
        }
        if (isReducedMotion()) return;
        // Follow the finger (rubber-banded) so the commit point is visible before release.
        nudge.setValue(Math.max(-FOLLOW_CAP, Math.min(FOLLOW_CAP, g.dx * (blocked ? 0.08 : 0.5))));
      },
      onPanResponderRelease: (_e, g) => {
        const { index: i, count: n } = at.current;
        const goLeft = (g.dx < -COMMIT_PX || g.vx < -0.5) && i < n - 1;
        const goRight = (g.dx > COMMIT_PX || g.vx > 0.5) && i > 0;
        if (goLeft || goRight) {
          if (!crossed.current) haptic("selection");
          // The Tabs 'shift' transition is the one animation for the change: drop the nudge and go.
          nudge.setValue(0);
          onGo(goLeft ? 1 : -1);
        } else {
          Animated.spring(nudge, { toValue: 0, useNativeDriver: true, ...SPRING.snap }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(nudge, { toValue: 0, useNativeDriver: true, ...SPRING.snap }).start();
      },
    }),
  ).current;

  return (
    <Animated.View style={{ flex: 1, transform: [{ translateX: nudge }] }} {...pan.panHandlers}>
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
