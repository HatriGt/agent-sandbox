import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "./ui/AppText";

/** Shared chrome for settings sub-screens: back row + serif title. */
export function SettingsScreen({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  const { palette } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ padding: 8 }}>
          <T variant="body" tone="muted">
            ‹ Back
          </T>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 0, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <T serif variant="h1">
          {title}
        </T>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
