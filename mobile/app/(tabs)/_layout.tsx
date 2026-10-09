import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { Redirect, withLayoutContext } from "expo-router";
import { createMaterialTopTabNavigator, type MaterialTopTabBarProps, type MaterialTopTabNavigationOptions, type MaterialTopTabNavigationEventMap } from "@react-navigation/material-top-tabs";
import type { ParamListBase, TabNavigationState } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic, isReducedMotion, PressScale, SPRING } from "@/components/motion";
import { composeTask } from "@/state/composerFocus";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useFleet } from "@/hooks/useFleet";
import { StatusLine } from "@/components/StatusLine";

// Tabs on a native pager (react-native-pager-view): the swipe is the platform's own - the scene
// is under the finger from the first pixel, flings and settles natively, and can never park
// half-way. The bottom-tabs navigator has no pager; this is material-top-tabs with our bar.
const { Navigator } = createMaterialTopTabNavigator();
const Tabs = withLayoutContext<MaterialTopTabNavigationOptions, typeof Navigator, TabNavigationState<ParamListBase>, MaterialTopTabNavigationEventMap>(Navigator);

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
function PillTabBar({ state, navigation }: MaterialTopTabBarProps) {
  const { palette, dark } = useTheme();
  const insets = useSafeAreaInsets();
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

/** Swipe commit haptic: one tick whenever the pager settles on a different tab. */
function SettleHaptic({ index }: { index: number }) {
  const last = useRef(index);
  useEffect(() => {
    if (last.current !== index) haptic("selection");
    last.current = index;
  }, [index]);
  return null;
}

export default function TabsLayout() {
  const { signedIn, ready } = useAuth();
  const { palette } = useTheme();
  if (ready && !signedIn) return <Redirect href="/welcome" />;

  return (
    <Tabs
      tabBarPosition="bottom"
      tabBar={(props) => (
        <>
          <SettleHaptic index={props.state.index} />
          <PillTabBar {...props} />
        </>
      )}
      screenOptions={{
        lazy: false,
        animationEnabled: !isReducedMotion(),
        sceneStyle: { backgroundColor: palette.background },
      }}
      style={{ backgroundColor: palette.background }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="fleet" />
      <Tabs.Screen name="activity" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
