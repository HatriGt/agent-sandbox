import React, { useEffect, useRef, useState } from "react";
import { Animated, Keyboard, Pressable, ScrollView, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { api, type SkillView } from "@/lib/api";
import { expandMentions, mentionAt, type MentionState } from "@/lib/mention";
import { slashAt, stripSlashToken, typedSkillToken, type SlashState } from "@/lib/slash";
import { smartJoin, useVoiceInput } from "@/hooks/useVoiceInput";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Icon } from "./ui/Icon";
import { VoiceButton, VoicePill } from "./VoiceButton";

/**
 * The SendBar, at web parity: two lanes (agent / read-only ask), `@` file
 * mentions backed by /files.json, `/` skill menu backed by /skills.json —
 * both insert chips, not text — a circular icon send button, and a hint line.
 */
export function Composer({
  session,
  onSend,
  onAsk,
  running,
  sleeping,
  disabled,
  placeholder,
  accessoryLeft,
}: {
  session?: string;
  onSend: (text: string) => Promise<void> | void;
  onAsk?: (text: string) => Promise<void> | void;
  running?: boolean;
  sleeping?: boolean;
  disabled?: boolean;
  placeholder?: string;
  accessoryLeft?: React.ReactNode;
}) {
  const { palette } = useTheme();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [lane, setLane] = useState<"reply" | "ask">("reply");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [skill, setSkill] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [fileHits, setFileHits] = useState<string[]>([]);
  const sendScale = useRef(new Animated.Value(0)).current;
  const hasContent = useRef(false);
  const inputRef = useRef<TextInput>(null);

  // Dictation: finalized phrases land at the caret through updateText, so chips and menus keep
  // working; the interim phrase streams in the pill above. Sending stays behind the button.
  const voice = useVoiceInput({
    onFinal: (spoken) => {
      setText((prev) => {
        const at = inputRef.current?.isFocused() ? Math.min(caret, prev.length) : prev.length;
        const glue = smartJoin(prev.slice(0, at), spoken);
        const next = prev.slice(0, at) + glue + prev.slice(at);
        setCaret(at + glue.length);
        syncSendButton(next, files, skill);
        return next;
      });
    },
  });

  useEffect(() => {
    if (!session) return;
    api.skills().then((r) => setSkills(r.skills.filter((s) => s.enabled))).catch(() => {});
  }, [session]);

  // Debounced file search while the @ menu is open.
  useEffect(() => {
    if (!mention || !session) {
      setFileHits([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .files(session, mention.query)
        .then((r) => setFileHits(r.files.slice(0, 8)))
        .catch(() => setFileHits([]));
    }, 120);
    return () => clearTimeout(t);
  }, [mention?.query, mention, session]);

  const syncSendButton = (t: string, f: string[], s: string | null) => {
    const has = !!t.trim() || f.length > 0 || !!s;
    if (has !== hasContent.current) {
      hasContent.current = has;
      Animated.spring(sendScale, { toValue: has ? 1 : 0, useNativeDriver: true, speed: 30, bounciness: 8 }).start();
    }
  };

  const updateText = (t: string, c = caret) => {
    // Hand-typing a complete `/name ` converts to a chip, like the web.
    if (!skill && lane === "reply") {
      const tok = typedSkillToken(t);
      if (tok && skills.some((s) => s.name === tok.name)) {
        setSkill(tok.name);
        t = t.slice(0, tok.start) + t.slice(tok.start + tok.length);
      }
    }
    setText(t);
    syncSendButton(t, files, skill);
    if (lane === "reply" && session) {
      setMention(mentionAt(t, Math.min(c, t.length)));
      setSlash(skill ? null : slashAt(t, Math.min(c, t.length)));
    } else {
      setMention(null);
      setSlash(null);
    }
  };

  const pickFile = (path: string) => {
    if (mention) {
      const before = text.slice(0, mention.start);
      const after = text.slice(mention.start + 1 + mention.query.length);
      setText((before + after).replace(/ $/, ""));
    }
    const next = files.includes(path) ? files : [...files, path];
    setFiles(next);
    setMention(null);
    syncSendButton(text, next, skill);
    inputRef.current?.focus();
  };

  const pickSkill = (name: string) => {
    if (slash) {
      const r = stripSlashToken(text, slash.start);
      setText(r.value);
    }
    setSkill(name);
    setSlash(null);
    syncSendButton(text, files, name);
    inputRef.current?.focus();
  };

  const send = async () => {
    let t = text.trim();
    if ((!t && !files.length && !skill) || busy) return;
    voice.stop();
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setBusy(true);
    try {
      if (lane === "ask" && onAsk) {
        await onAsk(t);
      } else {
        if (files.length) t = `${t}\n\nFiles: ${files.map((f) => `@${f}`).join(" ")}`;
        t = expandMentions(t);
        if (skill) t = `/${skill}${t ? ` ${t}` : ""}`;
        await onSend(t);
      }
      setText("");
      setFiles([]);
      setSkill(null);
      setMention(null);
      setSlash(null);
      syncSendButton("", [], null);
    } finally {
      setBusy(false);
    }
  };

  const isAsk = lane === "ask";
  const slashHits = slash ? skills.filter((s) => s.name.includes(slash.query)).slice(0, 6) : [];
  const menuOpen = (mention && fileHits.length > 0) || slashHits.length > 0;

  const hint = sleeping
    ? "Waking the sandbox. Type ahead — it is sent the moment the machine is back."
    : isAsk
      ? "Answered by a read-only helper inside the sandbox. The agent is not interrupted."
      : running
        ? "The agent is mid-turn. Your message is queued and delivered when this turn finishes."
        : null;

  const dictating = voice.state === "listening" || voice.state === "arming";

  return (
    <View style={{ gap: 6 }}>
      <VoicePill state={voice.state} interim={voice.interim} />
      {/* @ / menus float above the composer */}
      {menuOpen && (
        <View
          style={{
            backgroundColor: palette.popover,
            borderWidth: 1,
            borderColor: palette.border,
            borderRadius: radius.xl,
            maxHeight: 260,
            overflow: "hidden",
          }}
        >
          <ScrollView keyboardShouldPersistTaps="always">
            {slashHits.map((s) => (
              <Pressable
                key={s.name}
                onPress={() => pickSkill(s.name)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  backgroundColor: pressed ? palette.accent : "transparent",
                })}
              >
                <Icon name="zap" size={13} color={palette.live} />
                <T variant="meta" mono weight="medium">
                  /{s.name}
                </T>
                <T variant="micro" tone="faint" numberOfLines={1} style={{ flex: 1 }}>
                  {s.description}
                </T>
              </Pressable>
            ))}
            {mention &&
              fileHits.map((f) => (
                <Pressable
                  key={f}
                  onPress={() => pickFile(f)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: pressed ? palette.accent : "transparent",
                  })}
                >
                  <Icon name="file" size={13} color={palette.mutedForeground} />
                  <T variant="meta" mono weight="medium" numberOfLines={1}>
                    {f.split("/").pop()}
                  </T>
                  <T variant="micro" mono tone="faint" numberOfLines={1} style={{ flex: 1, textAlign: "right" }}>
                    {f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ""}
                  </T>
                </Pressable>
              ))}
          </ScrollView>
        </View>
      )}

      {/* Chips: picked skill + mentioned files */}
      {(skill || files.length > 0) && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {skill && (
            <Pressable
              onPress={() => {
                setSkill(null);
                syncSendButton(text, files, null);
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingVertical: 4,
                paddingHorizontal: 10,
                borderRadius: radius.pill,
                backgroundColor: palette.accent,
                borderWidth: 1,
                borderColor: palette.live,
              }}
            >
              <Icon name="zap" size={11} color={palette.live} />
              <T variant="micro" mono weight="semibold" tone="live">
                /{skill}
              </T>
              <Icon name="x" size={11} color={palette.faint} />
            </Pressable>
          )}
          {files.map((f) => (
            <Pressable
              key={f}
              onPress={() => {
                const next = files.filter((x) => x !== f);
                setFiles(next);
                syncSendButton(text, next, skill);
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingVertical: 4,
                paddingHorizontal: 10,
                borderRadius: radius.pill,
                backgroundColor: palette.secondary,
              }}
            >
              <Icon name="file" size={11} color={palette.mutedForeground} />
              <T variant="micro" mono numberOfLines={1} style={{ maxWidth: 180 }}>
                {f.split("/").pop()}
              </T>
              <Icon name="x" size={11} color={palette.faint} />
            </Pressable>
          ))}
        </View>
      )}

      {/* Lane toggle + accessories */}
      {onAsk ? (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          {(["reply", "ask"] as const).map((l) => {
            const active = lane === l;
            const askDisabled = l === "ask" && sleeping;
            return (
              <Pressable
                key={l}
                disabled={askDisabled}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setLane(l);
                  if (l === "ask") {
                    setMention(null);
                    setSlash(null);
                  }
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
                  opacity: askDisabled ? 0.4 : 1,
                }}
              >
                <Icon name={l === "reply" ? "terminal" : "eye"} size={12} color={active ? palette.foreground : palette.faint} />
                <T variant="micro" weight="medium" tone={active ? "default" : "faint"}>
                  {l === "reply" ? (running ? "Queue for agent" : "Agent") : "Side question"}
                </T>
              </Pressable>
            );
          })}
          <View style={{ flex: 1 }} />
          {!isAsk && accessoryLeft}
        </View>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 8,
          borderWidth: dictating ? 1.5 : isAsk ? 1.5 : 1,
          borderColor: dictating ? palette.live : sleeping ? palette.sleep : isAsk ? palette.lineStrong : palette.input,
          borderStyle: isAsk ? "dashed" : "solid",
          borderRadius: radius["2xl"] + 6,
          backgroundColor: palette.card,
          paddingLeft: 12,
          paddingRight: 6,
          paddingVertical: 6,
        }}
      >
        {!isAsk && session ? (
          <Pressable
            onPress={() => {
              const insert = text && !/\s$/.test(text) ? " @" : "@";
              const t = text + insert;
              setText(t);
              setCaret(t.length);
              setMention(mentionAt(t, t.length));
              inputRef.current?.focus();
            }}
            hitSlop={8}
            style={{ paddingBottom: 10 }}
          >
            <Icon name="at-sign" size={17} color={palette.faint} />
          </Pressable>
        ) : null}
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={(t) => updateText(t, caret + (t.length - text.length))}
          onSelectionChange={(e) => {
            const c = e.nativeEvent.selection.start;
            setCaret(c);
            if (lane === "reply" && session) {
              setMention(mentionAt(text, c));
              setSlash(skill ? null : slashAt(text, c));
            }
          }}
          placeholder={
            placeholder ??
            (skill
              ? `Add details for /${skill} — or just send…`
              : sleeping
                ? "Type ahead — sends once the sandbox is awake…"
                : isAsk
                  ? "Ask about this run — what changed, why is it stuck…"
                  : running
                    ? "Queue a follow-up for when this turn finishes…"
                    : "Send a follow-up…  ( / skills · @ files )")
          }
          placeholderTextColor={palette.faint}
          multiline
          // Enter sends (like the web); the keyboard drops so the reply is
          // visible. Long text still wraps — there is no Shift+Enter on a phone,
          // and pasted newlines are preserved.
          submitBehavior="blurAndSubmit"
          returnKeyType="send"
          onSubmitEditing={() => void send()}
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
        {voice.supported && (
          <View style={{ paddingBottom: 2 }}>
            <VoiceButton state={voice.state} level={voice.level} onToggle={voice.toggle} />
          </View>
        )}
        <Animated.View style={{ transform: [{ scale: sendScale }], opacity: sendScale }}>
          <Pressable
            onPress={send}
            disabled={disabled || busy}
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
      {hint ? (
        <T variant="micro" tone="faint" style={{ paddingHorizontal: 4 }}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}
