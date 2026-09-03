import React from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "./AppText";

/** Bottom sheet (elevation e4/e5 surface — floating panel over a scrim). */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "#00000066" }} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View
          style={{
            backgroundColor: palette.popover,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingBottom: insets.bottom + 12 + keyboardInset,
            maxHeight: 620,
          }}
        >
          <View style={{ alignItems: "center", paddingTop: 8 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: palette.lineStrong }} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 }}>
            <T variant="h3" weight="semibold">{title}</T>
            <Pressable onPress={onClose} hitSlop={12}>
              <T variant="body" tone="muted">Close</T>
            </Pressable>
          </View>
          {scroll ? (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}>
              {children}
            </ScrollView>
          ) : (
            <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>{children}</View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
