import React from "react";
import { View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { Icon } from "./ui/Icon";
import { PressScale } from "@/components/motion";

/** The composer's mic: a ghost icon button that opens the full-screen VoiceOverlay. */
export function VoiceButton({ onPress, size = 34 }: { onPress: () => void; size?: number }) {
  const { palette } = useTheme();
  return (
    <PressScale onPress={onPress} haptic="light" hitSlop={8} accessibilityRole="button" accessibilityLabel="Dictate with your voice">
      <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center" }}>
        <Icon name="mic" size={16} color={palette.faint} />
      </View>
    </PressScale>
  );
}
