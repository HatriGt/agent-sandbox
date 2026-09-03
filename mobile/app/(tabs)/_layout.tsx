import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, View } from "react-native";
import { Redirect, Tabs, useRouter } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { Icon, type IconName } from "@/components/ui/Icon";

const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: "home", label: "Home", icon: "home" },
  { name: "fleet", label: "Fleet", icon: "server" },
  { name: "activity", label: "Activity", icon: "bell" },
  { name: "settings", label: "Settings", icon: "settings" },
];

function TabItem({
  icon,
  focused,
  onPress,
}: {
  icon: IconName;
  focused: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const anim = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: focused ? 1 : 0, useNativeDriver: true, speed: 24, bounciness: 7 }).start();
  }, [focused, anim]);

  // Icon-only: the active tab gets a soft accent circle and a slight lift —
  // no labels (they wrapped and cluttered the pill).
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: "center" }} hitSlop={10}>
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
    </Pressable>
  );
}

/** Floating pill tab bar with a raised center "New" action. */
function PillTabBar({ state, navigation }: BottomTabBarProps) {
  const { palette, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  const go = (name: string) => {
    Haptics.selectionAsync().catch(() => {});
    navigation.navigate(name as never);
  };

  const item = (t: (typeof TABS)[number]) => {
    const idx = state.routes.findIndex((r) => r.name === t.name);
    return <TabItem key={t.name} icon={t.icon} focused={state.index === idx} onPress={() => go(t.name)} />;
  };

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: Math.max(insets.bottom, 10) }}>
      <View
        style={{
          marginHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: palette.popover,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: palette.border,
          paddingHorizontal: 8,
          paddingVertical: 6,
          shadowColor: "#000",
          shadowOpacity: dark ? 0.5 : 0.12,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
        }}
      >
        {left.map(item)}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            router.push("/new");
          }}
          style={({ pressed }) => ({
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
            transform: [{ scale: pressed ? 0.94 : 1 }],
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 10,
          })}
        >
          <Icon name="plus" size={24} color={palette.primaryForeground} />
        </Pressable>
        {right.map(item)}
      </View>
    </View>
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
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="fleet" />
      <Tabs.Screen name="activity" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
