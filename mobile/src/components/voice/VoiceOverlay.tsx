import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { playVoiceSound } from "@/lib/voice-sounds";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { Icon } from "@/components/ui/Icon";
import { DUR, EASE_OUT, FadeIn, haptic, isReducedMotion, PressScale, SPRING } from "@/components/motion";
import { VoiceOrb } from "./VoiceOrb";

/**
 * Full-screen voice mode (ChatGPT-style): listening starts the moment it opens, finalized phrases
 * stack up under the orb with the in-flight phrase in muted italics, Done hands the whole take to
 * the composer, Cancel (or Android back) discards it. Tapping the orb pauses/resumes the mic.
 * Nothing is sent from here — the composer still owns sending.
 */
export function VoiceOverlay({ open, onDone, onCancel }: { open: boolean; onDone: (text: string) => void; onCancel: () => void }) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(open);
  const [committed, setCommitted] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const { state, interim, level, start, stop } = useVoiceInput({ onFinal: (t) => setCommitted((c) => [...c, t]) });
  const backdrop = useRef(new Animated.Value(0)).current;
  const content = useRef(new Animated.Value(0.96)).current;
  const scroll = useRef<ScrollView>(null);
  const startChimed = useRef(false);

  // Enter/exit: the Modal is animationType none; we fade the backdrop and spring the content.
  useEffect(() => {
    if (open) {
      setMounted(true);
      setCommitted([]);
      setPaused(false);
      startChimed.current = false;
      haptic("medium");
      const reduced = isReducedMotion();
      backdrop.setValue(reduced ? 1 : 0);
      content.setValue(reduced ? 1 : 0.96);
      if (!reduced) {
        Animated.timing(backdrop, { toValue: 1, duration: 180, easing: EASE_OUT, useNativeDriver: true }).start();
        Animated.spring(content, { toValue: 1, ...SPRING.sheet, useNativeDriver: true }).start();
      }
      void start();
      return;
    }
    stop();
    if (isReducedMotion()) {
      setMounted(false);
      return;
    }
    Animated.timing(backdrop, { toValue: 0, duration: DUR.fast, easing: EASE_OUT, useNativeDriver: true }).start(({ finished }) => finished && setMounted(false));
    Animated.timing(content, { toValue: 0.96, duration: DUR.fast, easing: EASE_OUT, useNativeDriver: true }).start();
  }, [open, start, stop, backdrop, content]);

  // The start chime waits for the mic to actually be live, not for the sheet to appear.
  useEffect(() => {
    if (open && state === "listening" && !startChimed.current) {
      startChimed.current = true;
      playVoiceSound("start");
    }
  }, [open, state]);

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: !isReducedMotion() });
  }, [committed, interim]);

  if (!mounted) return null;

  const hasText = committed.length > 0 || !!interim.trim();
  const listening = state === "listening";

  const cancel = () => {
    playVoiceSound("cancel");
    onCancel();
  };
  const done = () => {
    if (!hasText) return;
    // stop() commits the in-flight phrase through onFinal, but that lands next render; take it
    // from the current interim so Done never loses the last words.
    const tail = interim.trim();
    stop();
    const all = tail ? [...committed, tail] : committed;
    haptic("success");
    playVoiceSound("stop");
    onDone(all.join(" "));
  };
  const togglePause = () => {
    haptic("selection");
    if (paused) {
      setPaused(false);
      void start();
    } else {
      setPaused(true);
      stop();
    }
  };
  const retry = () => {
    setPaused(false);
    void start();
  };

  const label = paused ? "Paused" : state === "error" ? "Microphone unavailable" : listening ? "Listening" : "Starting…";

  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={cancel}>
      <Animated.View style={{ flex: 1, backgroundColor: palette.background, opacity: backdrop.interpolate({ inputRange: [0, 1], outputRange: [0, 0.98] }) }} />
      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 20,
          paddingHorizontal: 24,
          opacity: backdrop,
          transform: [{ scale: content }],
        }}
      >
        <View style={{ alignItems: "center", gap: 8, minHeight: 44 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {listening && !paused ? <PulseDot color={palette.live} /> : null}
            <T variant="meta" weight="medium" style={{ color: state === "error" ? palette.destructive : palette.mutedForeground }}>
              {label}
            </T>
          </View>
          {state === "error" && !paused ? (
            <PressScale onPress={retry} accessibilityRole="button" accessibilityLabel="Retry microphone">
              <T variant="meta" weight="semibold" style={{ color: palette.foreground, textDecorationLine: "underline" }}>
                Retry
              </T>
            </PressScale>
          ) : null}
        </View>

        <View style={{ alignItems: "center", paddingVertical: 8 }}>
          <Pressable onPress={togglePause} accessibilityRole="button" accessibilityLabel={paused ? "Resume listening" : "Pause listening"} hitSlop={20}>
            <VoiceOrb level={level} paused={paused} />
          </Pressable>
          <T variant="micro" style={{ color: palette.faint, marginTop: -8 }}>
            Tap the orb to {paused ? "resume" : "pause"}
          </T>
        </View>

        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, flexGrow: 1, justifyContent: "flex-start" }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center" }}>
            {committed.map((phrase, i) => (
              <FadeIn key={i}>
                <T variant="h3" style={{ color: palette.foreground, textAlign: "center" }}>
                  {phrase}{" "}
                </T>
              </FadeIn>
            ))}
            {interim ? (
              <FadeIn key={`interim-${committed.length}`}>
                <T variant="h3" style={{ color: palette.mutedForeground, fontStyle: "italic", textAlign: "center" }}>
                  {interim}
                </T>
              </FadeIn>
            ) : null}
            {!hasText ? (
              <T variant="body" style={{ color: palette.faint, textAlign: "center" }}>
                {paused ? "Resume to keep dictating." : "Say what you want the agent to do."}
              </T>
            ) : null}
          </View>
        </ScrollView>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 28, paddingTop: 12 }}>
          <PressScale onPress={cancel} haptic="light" accessibilityRole="button" accessibilityLabel="Cancel dictation" hitSlop={8}>
            <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" }}>
              <Icon name="x" size={22} color={palette.foreground} />
            </View>
          </PressScale>
          <PressScale onPress={done} disabled={!hasText} accessibilityRole="button" accessibilityLabel="Use dictated text" accessibilityState={{ disabled: !hasText }} hitSlop={8}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: palette.primary, opacity: hasText ? 1 : 0.4, alignItems: "center", justifyContent: "center" }}>
              <Icon name="check" size={24} color={palette.primaryForeground} />
            </View>
          </PressScale>
        </View>
      </Animated.View>
    </Modal>
  );
}

/** The small breathing dot next to "Listening". Reduce-motion: a steady dot. */
function PulseDot({ color }: { color: string }) {
  const t = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (isReducedMotion()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 0.3, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity: t }} />;
}

