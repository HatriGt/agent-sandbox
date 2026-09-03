import React, { useRef, useState } from "react";
import { Animated, Pressable, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Icon } from "./ui/Icon";

/**
 * The SendBar: rounded composer with a circular icon send button that springs
 * in when there's text. Two lanes, never conflated — "reply" steers the driver
 * (resume), "ask" is the read-only co-pilot with a dashed, secondary identity.
 */
export function Composer({
  onSend,
  onAsk,
  running,
  disabled,
  placeholder,
}: {
  onSend: (text: string) => Promise<void> | void;
  onAsk?: (text: string) => Promise<void> | void;
  running?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { palette } = useTheme();
  const [text, setText] = useState("");
  const [lane, setLane] = useState<"reply" | "ask">("reply");
  const [busy, setBusy] = useState(false);
  const sendScale = useRef(new Animated.Value(0)).current;
  const hasText = useRef(false);

  const onChange = (t: string) => {
    setText(t);
    const has = !!t.trim();
    if (has !== hasText.current) {
      hasText.current = has;
      Animated.spring(sendScale, { toValue: has ? 1 : 0, useNativeDriver: true, speed: 30, bounciness: 8 }).start();
    }
  };

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setBusy(true);
    try {
      if (lane === "ask" && onAsk) await onAsk(t);
      else await onSend(t);
      onChange("");
    } finally {
      setBusy(false);
    }
  };

  const isAsk = lane === "ask";
  return (
    <View style={{ gap: 6 }}>
      {onAsk ? (
        <View style={{ flexDirection: "row", gap: 6 }}>
          {(["reply", "ask"] as const).map((l) => {
            const active = lane === l;
            return (
              <Pressable
                key={l}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setLane(l);
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  paddingVertical: 5,
                  paddingHorizontal: 12,
                  borderRadius: radius.pill,
                  backgroundColor: active ? palette.accent : "transparent",
                  borderWidth: 1,
                  borderColor: active ? palette.lineStrong : "transparent",
                }}
              >
                <Icon name={l === "reply" ? "message-circle" : "eye"} size={12} color={active ? palette.foreground : palette.faint} />
                <T variant="micro" weight="medium" tone={active ? "default" : "faint"}>
                  {l === "reply" ? (running ? "Queue for the agent" : "Reply") : "Ask (read-only)"}
                </T>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 8,
          borderWidth: isAsk ? 1.5 : 1,
          borderColor: isAsk ? palette.lineStrong : palette.input,
          borderStyle: isAsk ? "dashed" : "solid",
          borderRadius: radius["2xl"] + 6,
          backgroundColor: palette.card,
          paddingLeft: 16,
          paddingRight: 6,
          paddingVertical: 6,
        }}
      >
        <TextInput
          value={text}
          onChangeText={onChange}
          placeholder={
            placeholder ?? (isAsk ? "Ask about this run — can't steer it" : running ? "Queued until the turn ends…" : "Tell the agent…")
          }
          placeholderTextColor={palette.faint}
          multiline
          editable={!disabled}
          style={{
            flex: 1,
            color: palette.foreground,
            fontFamily: fonts.sans,
            fontSize: type.body.fontSize,
            maxHeight: 120,
            paddingTop: 8,
            paddingBottom: 8,
          }}
        />
        <Animated.View style={{ transform: [{ scale: sendScale }], opacity: sendScale }}>
          <Pressable
            onPress={send}
            disabled={disabled || busy || !text.trim()}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: isAsk ? palette.secondary : palette.primary,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 1,
              opacity: pressed || busy ? 0.7 : 1,
            })}
          >
            <Icon
              name={busy ? "loader" : isAsk ? "eye" : running ? "clock" : "arrow-up"}
              size={18}
              color={isAsk ? palette.foreground : palette.primaryForeground}
            />
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}
