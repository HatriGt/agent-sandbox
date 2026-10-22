import React, { useRef, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import type { SettledTurn, SideChatHandle, TurnId } from "@/lib/sidechat";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { PressScale, TypingDots } from "@/components/motion";
import { MarkdownLite } from "./MarkdownLite";
import { T } from "./ui/AppText";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Sheet } from "./ui/Sheet";

/**
 * The side chat: a bottom sheet with its own input, answered by a read-only helper inside the
 * sandbox. Nothing here is part of the agent's transcript. The Sheet already pads for the keyboard.
 */
export function SideChatSheet({ side, sleeping }: { side: SideChatHandle; sleeping: boolean }) {
  const { palette } = useTheme();
  const { chat } = side;
  const pending = chat.pending;
  const list = useRef<ScrollView>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<TurnId>>(new Set());
  const toggleExpanded = (id: TurnId) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  const canSend = !sleeping && !chat.pending && chat.draft.trim().length > 0;
  const send = () => {
    if (canSend) side.ask(chat.draft);
  };
  const hint = sleeping ? "Wake the sandbox to ask about it." : chat.pending ? "Reading the box…" : "Read-only. The agent is not interrupted.";

  return (
    <Sheet visible={chat.open} onClose={side.close} title="Side chat" scroll={false}>
      <View style={{ flexShrink: 1, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T variant="micro" tone="faint">
            {hint}
          </T>
          {chat.turns.length > 0 ? (
            <PressScale onPress={side.startFresh} hitSlop={10} accessibilityRole="button" accessibilityLabel="Start fresh">
              <T variant="micro" tone="muted" weight="medium">
                Start fresh
              </T>
            </PressScale>
          ) : null}
        </View>

        <ScrollView
          ref={list}
          style={{ flexGrow: 0, flexShrink: 1 }}
          contentContainerStyle={{ gap: 14, paddingBottom: 4 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        >
          {chat.turns.length === 0 && !chat.pending ? (
            <T variant="body" tone="muted">
              Ask what changed, why it is stuck, or whether the PR is green.
            </T>
          ) : null}
          {chat.turns.map((turn, i) => (
            <View key={turn.id} style={{ gap: 8 }}>
              {i > 0 && turn.kind === "answered" && !turn.continued ? <NewThreadDivider /> : null}
              <Question text={turn.question} expanded={expanded.has(turn.id)} onPress={() => toggleExpanded(turn.id)} />
              <Answer turn={turn} onRetry={() => side.ask(turn.question)} />
            </View>
          ))}
          {pending ? (
            <View style={{ gap: 8 }}>
              <Question text={pending.question} expanded={expanded.has(pending.id)} onPress={() => toggleExpanded(pending.id)} />
              <View style={{ paddingVertical: 6 }}>
                <TypingDots color={palette.faint} />
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 8,
            borderWidth: 1,
            borderColor: sleeping ? palette.sleep : palette.input,
            borderRadius: radius["2xl"] + 6,
            backgroundColor: palette.card,
            paddingLeft: 14,
            paddingRight: 6,
            paddingVertical: 6,
            opacity: sleeping ? 0.6 : 1,
          }}
        >
          <TextInput
            value={chat.draft}
            onChangeText={side.setDraft}
            placeholder={sleeping ? "Wake the sandbox to ask about it" : "What changed? Why is it stuck?"}
            placeholderTextColor={palette.faint}
            multiline
            submitBehavior="blurAndSubmit"
            returnKeyType="send"
            onSubmitEditing={send}
            editable={!sleeping}
            accessibilityLabel="Ask the sandbox"
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
          <PressScale
            onPress={send}
            disabled={!canSend}
            hitSlop={6}
            accessibilityLabel="Ask"
            accessibilityState={{ disabled: !canSend, busy: !!chat.pending }}
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: palette.primary,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 1,
              opacity: canSend ? 1 : 0.45,
            }}
          >
            <Icon name="arrow-up" size={18} color={palette.primaryForeground} />
          </PressScale>
        </View>
      </View>
    </Sheet>
  );
}

function Question({ text, expanded, onPress }: { text: string; expanded: boolean; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} scaleTo={0.995} accessibilityRole="button" accessibilityLabel={expanded ? "Collapse question" : "Expand question"}>
      <T variant="body" weight="medium" numberOfLines={expanded ? undefined : 2}>
        {text}
      </T>
    </PressScale>
  );
}

function Answer({ turn, onRetry }: { turn: SettledTurn; onRetry: () => void }) {
  const { palette } = useTheme();
  if (turn.kind === "failed") {
    return (
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="x" size={13} color={palette.destructive} />
          <T variant="meta" tone="destructive" style={{ flex: 1 }}>
            {turn.error}
          </T>
        </View>
        <Button title="Retry" variant="secondary" small onPress={onRetry} style={{ alignSelf: "flex-start" }} />
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <MarkdownLite text={turn.answer} />
      {turn.partial ? (
        <T variant="micro" tone="faint">
          Partial. The box stopped answering before it finished.
        </T>
      ) : null}
    </View>
  );
}

function NewThreadDivider() {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: palette.border }} />
      <T variant="micro" tone="faint">
        New thread
      </T>
      <View style={{ flex: 1, height: 1, backgroundColor: palette.border }} />
    </View>
  );
}

/** The composer-row shortcut to the sheet, with an unread count. */
export function SideChatButton({ unread, onPress }: { unread: number; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <PressScale
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Side chat, ${unread} unread` : "Side chat"}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: unread > 0 ? palette.lineStrong : palette.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name="eye" size={12} color={palette.faint} />
      <T variant="micro" weight="medium" tone="faint">
        Ask
      </T>
      {unread > 0 ? (
        <View style={{ minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: palette.primary, alignItems: "center", justifyContent: "center" }}>
          <T variant="micro" weight="semibold" tone="inverse" tnum>
            {unread}
          </T>
        </View>
      ) : null}
    </PressScale>
  );
}
