import React, { useState } from "react";
import { View } from "react-native";
import { missingSecretOf, parseQuestion } from "@/lib/question";
import { resumeWithSecrets, saveSecret } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { MarkdownLite } from "./MarkdownLite";
import { T } from "./ui/AppText";
import { Icon } from "./ui/Icon";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { smartJoin, useVoiceSupported } from "@/hooks/useVoiceInput";
import { VoiceButton } from "./VoiceButton";
import { VoiceOverlay } from "./voice/VoiceOverlay";
import { animateLayout, FadeInUp, PressScale, stagger } from "@/components/motion";

/**
 * The structured decision control: amber = needs you (the reserved hue),
 * options as big touch targets, "Something else…" for free text. Answers go
 * through resume — the only steering channel.
 */
export function QuestionCard({
  question,
  onAnswer,
  busy,
  session,
  repo,
}: {
  question: string;
  onAnswer: (text: string) => void;
  busy?: boolean;
  /** The box, for the Provide-secret row (resume with one-shot secrets). */
  session?: string;
  /** The box's first repo slug (owner/name), when known — enables "Save for this repo". */
  repo?: string | null;
}) {
  const { palette } = useTheme();
  const parsed = parseQuestion(question);
  const [other, setOther] = useState(false);
  const [text, setText] = useState("");
  // Dictate the free-text answer through the voice overlay; sending stays behind the button.
  const voiceSupported = useVoiceSupported();
  const [voiceOpen, setVoiceOpen] = useState(false);

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
        <View style={{ backgroundColor: palette.card, borderRadius: radius.sm, padding: 10 }}>
          <MarkdownLite text={parsed.context} />
        </View>
      ) : null}
      {session ? <ProvideSecretRow name={missingSecretOf(question)} session={session} repo={repo ?? null} /> : null}
      {!other &&
        parsed.options.map((opt, i) => (
          <FadeInUp key={i} delay={stagger(i, 30)}>
          <PressScale
            disabled={busy}
            haptic="light"
            onPress={() => onAnswer(opt)}
            style={({ pressed }) => ({
              backgroundColor: palette.card,
              borderRadius: radius.sm,
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
          </PressScale>
          </FadeInUp>
        ))}
      {other ? (
        <View style={{ gap: 8 }}>
          <VoiceOverlay
            open={voiceOpen}
            onDone={(spoken) => {
              setVoiceOpen(false);
              if (spoken) setText((prev) => prev + smartJoin(prev, spoken));
            }}
            onCancel={() => setVoiceOpen(false)}
          />
          <Field
            placeholder="Tell the agent what to do…"
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            style={{ minHeight: 70 }}
          />
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Button
              title="Send"
              onPress={() => {
                if (!text.trim()) return;
                onAnswer(text.trim());
              }}
              loading={busy}
              style={{ flex: 1 }}
            />
            {voiceSupported && <VoiceButton onPress={() => setVoiceOpen(true)} size={38} />}
            <Button title="Back" variant="secondary" onPress={() => { animateLayout(); setOther(false); }} />
          </View>
        </View>
      ) : (
        <PressScale
          onPress={() => {
            animateLayout();
            setOther(true);
          }}
          style={{ paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 6 }}
        >
          <Icon name="edit-2" size={13} color={palette.attentionInk} />
          <T variant="body" weight="medium" style={{ color: palette.attentionInk }}>
            Something else…
          </T>
        </PressScale>
      )}
    </View>
  );
}

/**
 * `Provide DEPLOY_TOKEN` — under a question that names an env var it lacks (web TraceItems
 * ResolveSecretRow). One masked input; "Resume with it" hands the value to this turn only via
 * resume `secrets` (-e flags, never stored). "Save for this repo" first stores it in the vault.
 */
function ProvideSecretRow({ name, session, repo }: { name: string | null; session: string; repo: string | null }) {
  const { palette } = useTheme();
  const [value, setValue] = useState("");
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!name) return null;
  const submit = async () => {
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (save && repo) await saveSecret(name, value, repo);
      await resumeWithSecrets(session, `Provided ${name}; continue.`, { [name]: value });
      setValue("");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }} accessibilityRole="text">
        <Icon name="check" size={13} color={palette.attentionInk} />
        <T variant="micro" style={{ color: palette.attentionInk }}>
          <T variant="micro" mono style={{ color: palette.attentionInk }}>
            {name}
          </T>{" "}
          provided — the agent is continuing.
        </T>
      </View>
    );
  }
  return (
    <View style={{ backgroundColor: palette.card, borderRadius: radius.lg, padding: 10, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="key" size={13} color={palette.attentionText} />
        <T variant="meta" weight="medium">
          Provide{" "}
          <T variant="meta" mono weight="medium">
            {name}
          </T>
        </T>
        <T variant="micro" tone="muted" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          this turn only
        </T>
      </View>
      <Field
        mono
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="paste the value"
        value={value}
        onChangeText={setValue}
        onSubmitEditing={() => void submit()}
        editable={!busy}
        accessibilityLabel={`Value for ${name}`}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Button title="Resume with it" onPress={() => void submit()} loading={busy} disabled={!value} style={{ flex: 1 }} />
      </View>
      <PressScale
        disabled={!repo}
        onPress={() => setSave((s) => !s)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: save && !!repo, disabled: !repo }}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" }}
      >
        <Icon name={save && repo ? "check-square" : "square"} size={14} color={repo ? palette.mutedForeground : palette.faint} />
        <T variant="micro" tone={repo ? "muted" : "faint"}>
          {repo ? `Save for ${repo} — the next run there starts with it` : "Save for this repo (no repo attached)"}
        </T>
      </PressScale>
      {error ? (
        <T variant="micro" tone="destructive">
          Could not provide {name}: {error}
        </T>
      ) : null}
    </View>
  );
}
