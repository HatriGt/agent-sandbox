import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { playVoiceSound } from "@/lib/voice-sounds";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { DUR, EASE_OUT, FadeInUp, haptic, isReducedMotion, PressScale, SPRING } from "@/components/motion";
import { VoiceOrb } from "./VoiceOrb";

/**
 * Full-screen voice mode (ChatGPT-style): listening starts the moment it opens; the transcript fills
 * the screen with finalized phrases in foreground and the in-flight phrase muted, bottom-anchored so
 * the latest words sit nearest the orb. The orb sits alone at the bottom with a Done pill beneath;
 * tapping the orb pauses/resumes the mic, Cancel is top-right and Android back cancels. Haptics mark
 * every state change (mic live, phrase finalized, pause/resume, done, cancel). Nothing is sent from
 * here — the composer still owns sending.
 */
const ORB = 200;

export function VoiceOverlay({ open, onDone, onCancel }: { open: boolean; onDone: (text: string) => void; onCancel: () => void }) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(open);
  const [committed, setCommitted] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const { width: winW, height: winH } = useWindowDimensions();
  const [orbCenter, setOrbCenter] = useState<{ x: number; y: number } | null>(null);
  const { state, interim, levelV, start, stop } = useVoiceInput({
    onFinal: (t) => {
      setCommitted((c) => [...c, t]);
      haptic("selection");
      playVoiceSound("phrase");
    },
  });
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
      haptic("light");
      playVoiceSound("open");
    }
  }, [open, state]);

  if (!mounted) return null;

  const hasText = committed.length > 0 || !!interim.trim();
  const listening = state === "listening";

  const cancel = () => {
    haptic("light");
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
    playVoiceSound("done");
    onDone(all.join(" "));
  };
  const togglePause = () => {
    haptic(paused ? "light" : "medium");
    if (paused) {
      setPaused(false);
      playVoiceSound("resume");
      void start();
    } else {
      setPaused(true);
      playVoiceSound("pause");
      stop();
    }
  };
  const retry = () => {
    setPaused(false);
    void start();
  };

  const label = paused ? "Paused" : state === "error" ? "Microphone unavailable" : listening ? "Listening" : "Starting…";
  const win = { width: winW, height: winH };

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
        {/* Full-screen shader layer: the sphere is drawn at the orb slot, the glow bleeds everywhere. */}
        {orbCenter ? <VoiceOrb level={levelV} paused={paused} size={ORB} center={orbCenter} viewport={win} /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 }}>
          {listening && !paused ? <PulseDot color="#5DA6F5" /> : null}
          <T variant="meta" weight="medium" style={{ color: state === "error" ? palette.destructive : palette.mutedForeground }}>
            {label}
          </T>
          {state === "error" && !paused ? (
            <PressScale onPress={retry} haptic="light" accessibilityRole="button" accessibilityLabel="Retry microphone" hitSlop={8}>
              <T variant="meta" weight="semibold" style={{ color: palette.foreground, textDecorationLine: "underline" }}>
                Retry
              </T>
            </PressScale>
          ) : null}
          <View style={{ flex: 1 }} />
          <PressScale onPress={cancel} haptic="light" accessibilityRole="button" accessibilityLabel="Cancel dictation" hitSlop={12}>
            <T variant="meta" weight="medium" style={{ color: palette.mutedForeground }}>
              Cancel
            </T>
          </PressScale>
        </View>

        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", paddingVertical: 20 }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: !isReducedMotion() })}
        >
          {hasText ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {committed.map((phrase, i) => (
                <FadeInUp key={i} distance={6}>
                  <T variant="h2" serif style={{ color: palette.foreground }}>
                    {phrase}{" "}
                  </T>
                </FadeInUp>
              ))}
              {interim ? (
                <FadeInUp key={`interim-${committed.length}`} distance={6}>
                  <T variant="h2" serif style={{ color: palette.mutedForeground, opacity: 0.6 }}>
                    {interim}
                  </T>
                </FadeInUp>
              ) : null}
            </View>
          ) : (
            <T variant="h2" serif style={{ color: palette.faint }}>
              Say something…
            </T>
          )}
        </ScrollView>

        <View style={{ alignItems: "center", gap: 2, paddingTop: 8 }}>
          <Pressable
            onPress={togglePause}
            onLayout={(e) => {
              // Window-space centre of the orb slot; the full-bleed canvas draws the sphere here.
              e.target.measureInWindow((x, y, w, h) => setOrbCenter({ x: x + w / 2, y: y + h / 2 }));
            }}
            accessibilityRole="button"
            accessibilityLabel={paused ? "Resume listening" : "Pause listening"}
            hitSlop={12}
            style={{ width: ORB, height: ORB }}
          />
          <PressScale onPress={done} disabled={!hasText} haptic="medium" accessibilityRole="button" accessibilityLabel="Use dictated text" accessibilityState={{ disabled: !hasText }} hitSlop={12}>
            <View style={{ paddingHorizontal: 28, paddingVertical: 12, borderRadius: 999, backgroundColor: hasText ? palette.primary : "transparent", borderWidth: 1, borderColor: hasText ? palette.primary : palette.border, opacity: hasText ? 1 : 0.5 }}>
              <T variant="meta" weight="semibold" style={{ color: hasText ? palette.primaryForeground : palette.mutedForeground }}>
                Done
              </T>
            </View>
          </PressScale>
          <T variant="micro" style={{ color: palette.faint, marginTop: 8 }}>
            Tap the orb to {paused ? "resume" : "pause"}
          </T>
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

