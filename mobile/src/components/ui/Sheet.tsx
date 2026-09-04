import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "./AppText";

/**
 * Bottom sheet — spring slide-up over a fading scrim, dismissed by the scrim,
 * the Close affordance, or dragging the grab handle down past a threshold
 * (drag follows the finger; a released short drag springs back).
 */
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
  const { height: screenH } = useWindowDimensions();

  // `mounted` keeps the Modal alive through the exit animation.
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(screenH)).current;
  const scrim = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    if (visible) {
      closing.current = false;
      setMounted(true);
      slide.setValue(screenH);
      scrim.setValue(0);
      Animated.parallel([
        Animated.spring(slide, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 4 }),
        Animated.timing(scrim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      dismiss(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const dismiss = (notify: boolean) => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(slide, { toValue: screenH, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scrim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => {
      setMounted(false);
      if (notify) onClose();
    });
  };

  // Drag-to-dismiss on the header strip: follows the finger going down,
  // resists (does nothing) going up, releases past 90px or with a flick.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) slide.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 90 || g.vy > 0.9) dismiss(true);
        else Animated.spring(slide, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
      },
    }),
  ).current;

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => dismiss(true)}>
      <Animated.View style={{ flex: 1, backgroundColor: "#00000066", opacity: scrim }}>
        <Pressable style={{ flex: 1 }} onPress={() => dismiss(true)} />
      </Animated.View>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      >
        <Animated.View
          style={{
            backgroundColor: palette.popover,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingBottom: insets.bottom + 12 + keyboardInset,
            // A flat 620 is taller than a small phone's screen once the status bar is taken out,
            // which pushed the sheet's own header off the top. Cap against the actual viewport.
            maxHeight: Math.min(620, screenH - insets.top - 24),
            transform: [{ translateY: slide }],
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: -4 },
            elevation: 16,
          }}
        >
          <View {...pan.panHandlers}>
            <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 2 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: palette.lineStrong }} />
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 16,
                paddingVertical: 12,
              }}
            >
              {/* A sheet title is often a box title the user typed, so it can be arbitrarily long;
                  Close must stay put and the title give way. */}
              <T variant="h3" weight="semibold" numberOfLines={1} style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                {title}
              </T>
              <Pressable onPress={() => dismiss(true)} hitSlop={12} style={{ flexShrink: 0 }}>
                <T variant="body" tone="muted">
                  Close
                </T>
              </Pressable>
            </View>
          </View>
          {scroll ? (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}>
              {children}
            </ScrollView>
          ) : (
            <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>{children}</View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
