import React, { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { T } from "./ui/AppText";

/**
 * The SendBar: rounded-2xl composer. Two lanes, never conflated — "reply"
 * steers the driver (resume), "ask" is the read-only co-pilot with its own
 * visual identity (outlined, secondary).
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

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      if (lane === "ask" && onAsk) await onAsk(t);
      else await onSend(t);
      setText("");
    } finally {
      setBusy(false);
    }
  };

  const isAsk = lane === "ask";
  return (
    <View style={{ gap: 6 }}>
      {onAsk ? (
        <View style={{ flexDirection: "row", gap: 6 }}>
          {(["reply", "ask"] as const).map((l) => (
            <Pressable
              key={l}
              onPress={() => setLane(l)}
              style={{
                paddingVertical: 4,
                paddingHorizontal: 12,
                borderRadius: radius.pill,
                backgroundColor: lane === l ? palette.accent : "transparent",
                borderWidth: 1,
                borderColor: lane === l ? palette.lineStrong : "transparent",
              }}
            >
              <T variant="micro" weight="medium" tone={lane === l ? "default" : "faint"}>
                {l === "reply" ? (running ? "Queue for the agent" : "Reply") : "Ask (read-only)"}
              </T>
            </Pressable>
          ))}
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
          borderRadius: radius["2xl"],
          backgroundColor: palette.card,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <TextInput
          value={text}
          onChangeText={setText}
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
            paddingTop: 6,
            paddingBottom: 6,
          }}
        />
        <Pressable
          onPress={send}
          disabled={disabled || busy || !text.trim()}
          style={({ pressed }) => ({
            backgroundColor: text.trim() ? palette.primary : palette.muted,
            borderRadius: radius.pill,
            paddingHorizontal: 14,
            paddingVertical: 8,
            opacity: pressed || busy ? 0.7 : 1,
            marginBottom: 2,
          })}
        >
          <T variant="meta" weight="semibold" style={{ color: text.trim() ? palette.primaryForeground : palette.faint }}>
            {busy ? "…" : isAsk ? "Ask" : running ? "Queue" : "Send"}
          </T>
        </Pressable>
      </View>
    </View>
  );
}
