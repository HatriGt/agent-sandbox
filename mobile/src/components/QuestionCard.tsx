import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { parseQuestion } from "@/lib/question";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { MarkdownLite } from "./MarkdownLite";
import { T } from "./ui/AppText";
import { Icon } from "./ui/Icon";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";

/**
 * The structured decision control: amber = needs you (the reserved hue),
 * options as big touch targets, "Something else…" for free text. Answers go
 * through resume — the only steering channel.
 */
export function QuestionCard({
  question,
  onAnswer,
  busy,
}: {
  question: string;
  onAnswer: (text: string) => void;
  busy?: boolean;
}) {
  const { palette } = useTheme();
  const parsed = parseQuestion(question);
  const [other, setOther] = useState(false);
  const [text, setText] = useState("");

  return (
    <View
      style={{
        backgroundColor: palette.attention,
        borderRadius: radius["2xl"],
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="alert-circle" size={13} color={palette.attentionInk} />
        <T variant="micro" weight="semibold" style={{ color: palette.attentionInk, letterSpacing: 0.5 }}>
          NEEDS YOU
        </T>
      </View>
      <T variant="lead" weight="semibold" style={{ color: palette.attentionInk }} selectable>
        {parsed.title || question.split("\n")[0]}
      </T>
      {parsed.context ? (
        <View style={{ backgroundColor: palette.card, borderRadius: radius.lg, padding: 10 }}>
          <MarkdownLite text={parsed.context} />
        </View>
      ) : null}
      {!other &&
        parsed.options.map((opt, i) => (
          <Pressable
            key={i}
            disabled={busy}
            onPress={() => onAnswer(opt)}
            style={({ pressed }) => ({
              backgroundColor: palette.card,
              borderRadius: radius.lg,
              paddingVertical: 12,
              paddingHorizontal: 14,
              opacity: pressed || busy ? 0.7 : 1,
              flexDirection: "row",
              gap: 10,
              alignItems: "center",
            })}
          >
            <T variant="meta" mono tone="faint" style={{ flexShrink: 0 }}>
              {i + 1}
            </T>
            {/* Options wrap rather than truncate — an unreadable half-option is worse than a
                three-line one — but the column must be allowed to shrink so the chevron stays in. */}
            <T variant="body" weight="medium" style={{ flex: 1, minWidth: 0 }}>
              {opt}
            </T>
            <View style={{ flexShrink: 0 }}>
              <Icon name="chevron-right" size={14} />
            </View>
          </Pressable>
        ))}
      {other ? (
        <View style={{ gap: 8 }}>
          <Field
            placeholder="Tell the agent what to do…"
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            style={{ minHeight: 70 }}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Send" onPress={() => text.trim() && onAnswer(text.trim())} loading={busy} style={{ flex: 1 }} />
            <Button title="Back" variant="secondary" onPress={() => setOther(false)} />
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setOther(true)} style={{ paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="edit-2" size={13} color={palette.attentionInk} />
          <T variant="body" weight="medium" style={{ color: palette.attentionInk }}>
            Something else…
          </T>
        </Pressable>
      )}
    </View>
  );
}
