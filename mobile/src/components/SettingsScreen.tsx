import React, { useRef } from "react";
import { Animated, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "./ui/AppText";
import { Icon } from "./ui/Icon";
import { PressScale } from "@/components/motion";

const BAR_H = 48;
/** Scroll distance over which the large title hands off to the bar title. */
const HANDOFF = 36;

/**
 * Shared chrome for pushed screens: a native-feeling bar (chevron back, actions on the right) over a
 * large serif title that scrolls with the content. As the large title slides under the bar, a
 * compact copy fades in on the bar and a hairline appears, so the screen always says where you are.
 * Scroll-driven on the native thread; no jump, no layout work per frame.
 */
export function SettingsScreen({
  title,
  subtitle,
  right,
  scrollRef,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  scrollRef?: React.Ref<ScrollView>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { palette } = useTheme();
  const y = useRef(new Animated.Value(0)).current;
  const handoff = y.interpolate({ inputRange: [HANDOFF, HANDOFF + 24], outputRange: [0, 1], extrapolate: "clamp" });
  const barTitleY = y.interpolate({ inputRange: [HANDOFF, HANDOFF + 24], outputRange: [6, 0], extrapolate: "clamp" });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      <View style={{ height: BAR_H, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 }}>
        <PressScale
          onPress={() => (router.canGoBack() ? router.back() : router.navigate("/(tabs)/home"))}
          hitSlop={10}
          scaleTo={0.9}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="chevron-left" size={24} color={palette.foreground} />
        </PressScale>
        <Animated.View pointerEvents="none" style={{ flex: 1, alignItems: "center", opacity: handoff, transform: [{ translateY: barTitleY }] }}>
          <T variant="meta" weight="semibold" numberOfLines={1}>
            {title}
          </T>
        </Animated.View>
        <View style={{ minWidth: 40, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>{right}</View>
        <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, backgroundColor: palette.border, opacity: handoff }} />
      </View>
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 12, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={{ gap: 4, marginBottom: 4 }}>
          <T serif variant="h1">
            {title}
          </T>
          {subtitle ? (
            <T variant="meta" tone="muted">
              {subtitle}
            </T>
          ) : null}
        </View>
        {children}
      </Animated.ScrollView>
    </SafeAreaView>
  );
}
