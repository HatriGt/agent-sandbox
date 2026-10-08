import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
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
import { EASE_DRAWER, haptic, isReducedMotion, SPRING } from "@/components/motion";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./AppText";

/**
 * How many sheets are on screen. RN `Modal` paints above everything in the root, so the toast host
 * waits for this to reach zero before showing a card that would otherwise land underneath.
 */
let openSheets = 0;
const sheetListeners = new Set<(n: number) => void>();
function setOpenSheets(n: number) {
  openSheets = n;
  sheetListeners.forEach((l) => l(n));
}
export function useSheetsOpen(): boolean {
  const [n, setN] = useState(openSheets);
  useEffect(() => {
    sheetListeners.add(setN);
    setN(openSheets);
    return () => {
      sheetListeners.delete(setN);
    };
  }, []);
  return n > 0;
}

/**
 * Bottom sheet. Springs up over a scrim; leaves by scrim tap, Close, the system back, or dragging
 * the header strip down. The drag follows the finger (with friction upward), the scrim fades with
 * it, and release either flicks the sheet away with its own velocity or snaps it home.
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
  const closing = useRef(false);
  const sheetH = useRef(Math.min(620, screenH - insets.top - 24));
  // Scrim is derived from the sheet's position, so it tracks a drag for free.
  const scrim = slide.interpolate({ inputRange: [0, sheetH.current], outputRange: [1, 0], extrapolate: "clamp" });

  // Where the sheet currently is, for the exit timing. Animated hides its value behind a listener.
  const position = useRef(screenH);
  useEffect(() => {
    const id = slide.addListener(({ value }) => {
      position.current = value;
    });
    return () => slide.removeListener(id);
  }, [slide]);

  useEffect(() => {
    if (visible) {
      closing.current = false;
      setMounted(true);
      if (isReducedMotion()) {
        slide.setValue(0);
      } else {
        slide.setValue(screenH);
        Animated.spring(slide, { toValue: 0, useNativeDriver: true, ...SPRING.sheet }).start();
      }
    } else if (mounted) {
      dismiss(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // One place owns the open-sheet count: the mount lifetime.
  useEffect(() => {
    if (!mounted) return;
    setOpenSheets(openSheets + 1);
    return () => setOpenSheets(Math.max(0, openSheets - 1));
  }, [mounted]);

  /** `velocity` is the finger's release speed (RN `vy`), 0 for a programmatic close. */
  const dismiss = (notify: boolean, velocity = 0) => {
    if (closing.current) return;
    closing.current = true;
    const finish = () => {
      setMounted(false);
      if (notify) onClose();
    };
    if (isReducedMotion()) {
      slide.setValue(screenH);
      finish();
      return;
    }
    // Remaining travel decides the duration; a flick shortens it further so the sheet keeps the
    // finger's pace instead of slowing down right after release.
    const remain = Math.max(0, screenH - position.current);
    const base = 120 + (remain / screenH) * 160;
    const duration = Math.max(90, Math.min(280, velocity > 0 ? base / (1 + velocity) : base));
    Animated.timing(slide, { toValue: screenH, duration, easing: EASE_DRAWER, useNativeDriver: true }).start(finish);
  };

  const snapBack = () => Animated.spring(slide, { toValue: 0, useNativeDriver: true, ...SPRING.snap }).start();
  const crossed = useRef(false);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        crossed.current = false;
      },
      onPanResponderMove: (_e, g) => {
        // Down follows the finger; up is allowed with friction so the sheet feels attached, not walled.
        slide.setValue(g.dy > 0 ? g.dy : g.dy * 0.18);
        // A tick when the drag crosses the release point tells the thumb "letting go now closes it".
        const over = g.dy > Math.min(90, sheetH.current * 0.25);
        if (over !== crossed.current) {
          crossed.current = over;
          haptic("selection");
        }
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > Math.min(90, sheetH.current * 0.25) || g.vy > 0.7) dismiss(true, Math.max(0, g.vy));
        else snapBack();
      },
      onPanResponderTerminate: snapBack,
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => dismiss(true)}>
      <Animated.View style={{ flex: 1, backgroundColor: palette.scrim, opacity: scrim }}>
        <Pressable style={{ flex: 1 }} onPress={() => dismiss(true)} accessibilityRole="button" accessibilityLabel="Close sheet" />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        <Animated.View
          onLayout={(e) => {
            sheetH.current = e.nativeEvent.layout.height || sheetH.current;
          }}
          style={{
            backgroundColor: palette.popover,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
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
          <View {...pan.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel={`${title}. Swipe down to close`}>
            <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 2 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: palette.lineStrong }} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 }}>
              {/* A sheet title is often a box title the user typed, so it can be arbitrarily long;
                  Close must stay put and the title give way. */}
              <T variant="h3" weight="semibold" numberOfLines={1} style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                {title}
              </T>
              <Pressable onPress={() => dismiss(true)} hitSlop={14} style={{ flexShrink: 0, minHeight: 44, justifyContent: "center" }} accessibilityRole="button" accessibilityLabel="Close">
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
