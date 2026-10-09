import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Image, ScrollView, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { api, intakeApi, isUnfurlable, type AgentId, type FleetLifecycle, type RepoInfo, type SkillView, type Unfurled } from "@/lib/api";
import { fmtDuration } from "@/lib/lifecycle";
import { setPendingDelegate, takeFailedSubmit } from "@/lib/pending-delegate";
import { clearDraft, DRAFT_NEW, loadDraft, saveDraft, takePrefill } from "@/lib/draft";
import { mergeStarterText, STARTERS, type StarterDef } from "@/lib/starters";
import { slashAt, stripSlashToken, typedSkillToken, type SlashState } from "@/lib/slash";
import { smartJoin, useVoiceSupported } from "@/hooks/useVoiceInput";
import { onFocusComposer, type ComposeRequest } from "@/state/composerFocus";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Icon } from "@/components/ui/Icon";
import { VoiceButton } from "@/components/VoiceButton";
import { VoiceOverlay } from "@/components/voice/VoiceOverlay";
import { animateLayout, FadeInUp, haptic, PressScale, ScalePresence, stagger } from "@/components/motion";
import { currentAgent, RunOptionChips, RunSettingsSheet, useRunOptions, type RunSection, type VerifySpec } from "@/components/sheets/RunSettingsSheet";
import { AddSheet, type PickedRepo } from "./AddSheet";
import { SkillsSheet } from "./SkillsSheet";
import { ModelSheet } from "./ModelSheet";
import { ToolButton } from "./ToolButton";

type Attachment = { name: string; dataUrl: string };
const MAX_ATTACHMENTS = 8;

export interface HomeComposerHandle {
  focus: () => void;
}

/**
 * The Hub's inline composer (web Hub.tsx PromptInput + composer/Toolbar.tsx): one card holding the
 * brief, picked repos with a branch field, image thumbnails, and the toolbar - Plus / Skills /
 * Harness / Playbook / Model / More - each a Sheet on a phone. Submit fires the delegate and pushes
 * /booting, which attaches to the box the moment it surfaces.
 *
 * Mounted once by Home; the tab bar's "+", the empty state and the checklist reach it through the
 * composerFocus event instead of a second screen.
 */
export const HomeComposer = forwardRef<HomeComposerHandle, { lifecycle?: FleetLifecycle; onFocus?: () => void }>(function HomeComposer({ lifecycle, onFocus }, ref) {
  const router = useRouter();
  const { palette } = useTheme();
  const { me } = useAuth();
  // A failed delegate lands back here via /booting: the stash restores the WHOLE submission -
  // repos, photos, model, verify, and what went wrong - not just the task text.
  const [stash] = useState(() => takeFailedSubmit());
  // A one-shot prefill ("new task from this run") beats the stash; the AsyncStorage draft is restored
  // asynchronously below, only if nothing else filled the box first.
  const [prefill] = useState(() => takePrefill());
  const [task, setTask] = useState(() => prefill ?? stash?.task ?? "");
  const taskRef = useRef(task);
  taskRef.current = task;
  const [caret, setCaret] = useState(task.length);
  const draftReady = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const [picked, setPicked] = useState<PickedRepo[]>(() => stash?.picked ?? []);
  const [attachments, setAttachments] = useState<Attachment[]>(() => stash?.attachments ?? []);
  const [skills, setSkills] = useState<SkillView[] | null>(null);
  const [skill, setSkill] = useState<string | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [error, setError] = useState<string | null>(() => stash?.error ?? null);
  const [clarify, setClarify] = useState<string | null>(() => stash?.clarify ?? null);
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [model, setModel] = useState<string | null>(() => stash?.model ?? null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifySpec | null>(() => stash?.verify ?? null);
  // Run settings: agent / harness / playbook / attempts. Agent, harness and playbook stick across
  // launches; a failed submit restores exactly what was sent (including attempts).
  const run = useRunOptions(stash?.run ? { ...stash.run, agent: stash.run.agent as AgentId | null } : null);
  const [sheet, setSheet] = useState<null | "add" | "skills" | "model" | RunSection>(null);
  const [addOnRepos, setAddOnRepos] = useState(false);
  // Link unfurl: a pasted GitHub issue/PR or Sentry link becomes a task (server-side fetch).
  const [unfurled, setUnfurled] = useState<Unfurled | null>(null);
  const unfurlGen = useRef(0);
  const unfurlSeen = useRef<string | null>(null);

  const trialExpired = me?.kind === "user" && me.expired;

  // Voice mode: the overlay's take lands at the caret; starting the machine stays manual.
  const voiceSupported = useVoiceSupported();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const insertSpoken = (spoken: string) => {
    setVoiceOpen(false);
    if (!spoken) return;
    setTask((prev) => {
      const at = inputRef.current?.isFocused() ? Math.min(caret, prev.length) : prev.length;
      const glue = smartJoin(prev.slice(0, at), spoken);
      setCaret(at + glue.length);
      return prev.slice(0, at) + glue + prev.slice(at);
    });
  };
  const dictating = voiceOpen;

  const focus = () => inputRef.current?.focus();
  useImperativeHandle(ref, () => ({ focus }), []);

  // The "+" tab, Run again, a share intent, the Playbooks Run button: all arrive here.
  const workflowWanted = useRef<string | null>(null);
  useEffect(
    () =>
      onFocusComposer((req: ComposeRequest) => {
        if (req.task) {
          setTask(req.task);
          setCaret(req.task.length);
        }
        if (req.workflow) workflowWanted.current = req.workflow;
        setTimeout(focus, 50);
      }),
    [],
  );
  // Applied once the sticky picks and lists are in, so the sticky read cannot clobber it.
  useEffect(() => {
    if (run.loading || !workflowWanted.current) return;
    run.update({ workflow: workflowWanted.current });
    workflowWanted.current = null;
  }, [run.loading, run.update]);

  // Draft: restore on mount if nothing else filled the box, then save as you type (debounced in
  // draft.ts). Saving waits for the restore so an empty first render can never wipe a saved draft.
  useEffect(() => {
    let cancelled = false;
    loadDraft(DRAFT_NEW).then((d) => {
      if (cancelled) return;
      if (d && !taskRef.current) {
        setTask(d);
        setCaret(d.length);
      }
      draftReady.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (draftReady.current) saveDraft(DRAFT_NEW, task);
  }, [task]);

  // Unfurl: the whole box is one GitHub issue/PR or Sentry link -> fetch it server-side (300 ms
  // after the last edit) and swap the URL for title + body, unless the person typed over it
  // meanwhile. Each URL is tried once; errors silently keep the pasted link.
  useEffect(() => {
    const s = task.trim();
    if (!isUnfurlable(s) || unfurlSeen.current === s) return;
    const gen = ++unfurlGen.current;
    const t = setTimeout(() => {
      unfurlSeen.current = s;
      intakeApi.unfurl(s).then(
        (u) => {
          if (gen !== unfurlGen.current || taskRef.current.trim() !== s) return;
          setTask(u.task);
          setCaret(u.task.length);
          setUnfurled(u);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          const repo = u.repo;
          if (repo) setPicked((ps) => (ps.length ? ps : [{ repo }]));
        },
        () => {},
      );
    }, 300);
    return () => clearTimeout(t);
  }, [task]);

  useEffect(() => {
    api
      .skills()
      .then((r) => setSkills(r.skills.filter((s) => s.enabled)))
      .catch(() => setSkills([]));
    api
      .models()
      .then((r) => {
        setModels(r.models);
        setDefaultModel(r.default);
      })
      .catch(() => {});
  }, []);

  // `/name ` typed by hand becomes the skill chip (web updateSlash); `/` at a word start opens the
  // inline menu below the box.
  const updateText = (next: string, c: number) => {
    setTask(next);
    setCaret(c);
    setSlash(skill ? null : slashAt(next, c));
    if (!skill && skills) {
      const t = typedSkillToken(next);
      if (t && skills.some((s) => s.name === t.name)) {
        setSkill(t.name);
        setTask(next.slice(0, t.start) + next.slice(t.start + t.length));
        setSlash(null);
      }
    }
  };
  const pickSkill = (name: string | null) => {
    if (!name) {
      animateLayout();
      setSkill(null);
      return;
    }
    // From the `/` menu the typed token goes; from the Skills button the text is left alone.
    const stripped = slash ? stripSlashToken(task, slash.start) : { value: task, caret: task.length };
    animateLayout();
    setSkill(name);
    setTask(stripped.value);
    setCaret(stripped.caret);
    setSlash(null);
  };
  const slashHits = slash && skills ? skills.filter((s) => s.name.startsWith(slash.query.toLowerCase())).slice(0, 6) : [];

  const toggleRepo = (r: RepoInfo) =>
    setPicked((prev) =>
      prev.some((p) => p.repo.toLowerCase() === r.fullName.toLowerCase())
        ? prev.filter((p) => p.repo.toLowerCase() !== r.fullName.toLowerCase())
        : [...prev, { repo: r.fullName, defaultBranch: r.defaultBranch, private: r.private }],
    );

  const pickImage = async (camera: boolean) => {
    setSheet(null);
    const fn = camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const res = await fn({ mediaTypes: ["images"], quality: 0.7, base64: true });
    const asset = res.assets?.[0];
    if (!asset?.base64) return;
    if (attachments.length >= MAX_ATTACHMENTS) return;
    const mime = asset.mimeType ?? "image/jpeg";
    animateLayout();
    setAttachments((a) => [...a, { name: asset.fileName ?? `photo-${a.length + 1}.jpg`, dataUrl: `data:${mime};base64,${asset.base64}` }]);
  };

  const applyStarter = (s: StarterDef) => {
    haptic("selection");
    // Never destroy a typed brief: append the template under it instead (lib/starters.ts).
    const next = mergeStarterText(task, s.task);
    setTask(next);
    setCaret(next.length);
    if (s.needsRepo && picked.length === 0) {
      setAddOnRepos(true);
      setSheet("add");
    } else {
      focus();
    }
  };

  const typed = task.trim();
  const canSend = !!(typed || attachments.length || skill) && !trialExpired;

  // Fire-and-navigate, like the web swapping to BootingThread the moment you submit: the delegate
  // promise rides to /booting, which replaces itself with the thread as soon as the box name is back.
  const submit = () => {
    if (!canSend) return;
    setError(null);
    setClarify(null);
    // A picked skill goes as the leading `/name` token: the controller is instructed to invoke it.
    const text = skill ? `/${skill}${typed ? ` ${typed}` : ""}` : typed;
    const agent = currentAgent(run.value, run.sources.prefs);
    const repos = picked.map((p) => ({ repo: p.repo, ...(p.ref ? { ref: p.ref } : {}) }));
    const promise = api.delegate({
      task: text,
      repos: repos.length ? repos : undefined,
      attachments: attachments.length ? attachments : undefined,
      ...(run.value.provider
        ? { provider: run.value.provider, ...(run.value.providerModel ? { model: run.value.providerModel } : {}) }
        : model
          ? { model }
          : {}),
      ...(verify?.text.trim() ? { verify: verify.mode === "command" ? { command: verify.text.trim() } : { criterion: verify.text.trim() } } : {}),
      // Web parity: the agent goes only when explicitly picked; a below-floor driver carries the
      // acknowledgement the sheet collected ("supervised: partial").
      ...(run.value.agent ? { agent: run.value.agent, ...(agent?.supervised === false ? { allowPartialSupervision: true } : {}) } : {}),
      ...(run.value.harness ? { harness: run.value.harness } : {}),
      ...(run.value.workflow ? { workflow: run.value.workflow } : {}),
      ...(run.value.attempts > 1 ? { attempts: run.value.attempts } : {}),
    });
    // The draft is gone once the server accepted the task - a failure comes back via the stash.
    promise
      .then((r) => {
        if (r.ok) clearDraft(DRAFT_NEW);
      })
      .catch(() => {});
    setPendingDelegate({
      task: text,
      promise,
      // Fleet-as-of-submit: /booting attaches the moment a NEW box (or a pool box flipping
      // pool-free -> claimed) surfaces - the web's early-attach. A rejected fleet read resolves to
      // null (NOT an empty map); /booting re-baselines off its first real poll.
      known: api
        .fleet()
        .then((s) => new Map(s.boxes.map((b) => [b.name, b.role])))
        .catch(() => null),
      draft: {
        task: text,
        picked: repos,
        attachments,
        model,
        ...(verify?.text.trim() ? { verify: { mode: verify.mode, text: verify.text.trim() } } : {}),
        run: { ...run.value },
      },
    });
    // The box is cleared here, not on return: the stash brings everything back if it fails.
    setTask("");
    setCaret(0);
    setSkill(null);
    setPicked([]);
    setAttachments([]);
    setUnfurled(null);
    inputRef.current?.blur();
    router.push("/booting");
  };

  const sources = run.sources;
  const pickedHarness = run.value.harness ? sources.harnesses.find((x) => x.id === run.value.harness) : undefined;
  const pickedWorkflow = run.value.workflow ? sources.workflows.find((x) => x.id === run.value.workflow) : undefined;
  const modelLabel = run.value.provider
    ? [sources.providers.find((p) => p.id === run.value.provider)?.label ?? run.value.provider, run.value.providerModel].filter(Boolean).join(" · ")
    : (models.find((m) => m.id === (model ?? defaultModel))?.label ?? "Model");
  const moreDot = (!!run.value.agent && run.value.agent !== sources.prefs?.defaultAgent) || run.value.attempts > 1 || !!verify?.text.trim();
  const caption = error
    ? error
    : lifecycle?.maxDurationSec
      ? `Enter starts the machine · runs up to ${fmtDuration(lifecycle.maxDurationSec)}${lifecycle.idleTimeoutSec ? `, sleeps after ${fmtDuration(lifecycle.idleTimeoutSec)} quiet` : ""}`
      : "Enter starts the machine · a repo named in the task is attached automatically";

  return (
    <View style={{ gap: 6 }}>
      <VoiceOverlay open={voiceOpen} onDone={insertSpoken} onCancel={() => setVoiceOpen(false)} />
      {clarify ? (
        <FadeInUp>
          <View style={{ backgroundColor: palette.attention, borderRadius: radius.xl, padding: 12 }}>
            <T variant="body" style={{ color: palette.attentionInk }}>
              ◆ {clarify}
            </T>
          </View>
        </FadeInUp>
      ) : null}

      {/* The card */}
      <View
        style={{
          borderWidth: dictating ? 1.5 : 1,
          borderColor: dictating ? palette.live : palette.input,
          borderRadius: radius["2xl"],
          backgroundColor: palette.card,
          overflow: "hidden",
        }}
      >
        {/* Skill chip - the picked skill sits above the text like the web's chip row. */}
        {skill ? (
          <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingTop: 10 }}>
            <PressScale
              onPress={() => pickSkill(null)}
              accessibilityLabel={`Remove skill /${skill}`}
              style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 9, paddingRight: 7, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: palette.accent }}
            >
              <Icon name="zap" size={11} color={palette.live} />
              <T variant="micro" mono weight="medium">
                /{skill}
              </T>
              <Icon name="x" size={11} color={palette.faint} />
            </PressScale>
          </View>
        ) : null}
        <TextInput
          ref={inputRef}
          value={task}
          onChangeText={(t) => updateText(t, caret + (t.length - task.length))}
          onSelectionChange={(e) => {
            const c = e.nativeEvent.selection.start;
            setCaret(c);
            setSlash(skill ? null : slashAt(task, c));
          }}
          onFocus={onFocus}
          placeholder={skill ? `Add details for /${skill} — or just start…` : "Describe a task. A fresh sandbox picks it up…  ( / skills )"}
          placeholderTextColor={palette.faint}
          multiline
          editable={!trialExpired}
          // Enter starts the machine (like the web); pasted newlines are preserved.
          submitBehavior="blurAndSubmit"
          returnKeyType="send"
          onSubmitEditing={submit}
          accessibilityLabel="Task"
          style={{
            minHeight: 88,
            maxHeight: 220,
            paddingHorizontal: 14,
            paddingTop: 12,
            paddingBottom: 8,
            color: palette.foreground,
            fontFamily: fonts.sans,
            fontSize: type.lead.fontSize,
            lineHeight: type.lead.lineHeight,
            textAlignVertical: "top",
          }}
        />

        {/* `/` menu, inline under the text like the thread composer. */}
        {slash && slashHits.length > 0 ? (
          <View style={{ marginHorizontal: 10, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, backgroundColor: palette.popover, overflow: "hidden" }}>
            {slashHits.map((s) => (
              <PressScale
                key={s.name}
                onPress={() => pickSkill(s.name)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: pressed ? palette.accent : "transparent" })}
              >
                <Icon name="zap" size={13} color={palette.mutedForeground} />
                <T variant="meta" mono weight="medium">
                  /{s.name}
                </T>
                <T variant="micro" tone="faint" numberOfLines={1} style={{ flex: 1 }}>
                  {s.description}
                </T>
              </PressScale>
            ))}
          </View>
        ) : null}

        {unfurled ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingBottom: 6 }}>
            <Icon name={unfurled.source === "github" ? "github" : "alert-circle"} size={12} color={palette.mutedForeground} />
            <T variant="micro" tone="muted" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
              from {unfurled.source === "github" ? "GitHub" : "Sentry"}: {unfurled.title}
            </T>
            <PressScale onPress={() => setUnfurled(null)} hitSlop={10} accessibilityLabel="Dismiss">
              <Icon name="x" size={12} color={palette.faint} />
            </PressScale>
          </View>
        ) : null}

        {/* Repo chips with a branch field, image thumbnails, and run-option chips. */}
        {picked.length > 0 || attachments.length > 0 ? (
          <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 6 }}>
            {picked.map((p) => (
              <View
                key={p.repo}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", maxWidth: "100%", paddingLeft: 10, paddingRight: 4, height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.muted }}
              >
                {p.private ? <Icon name="lock" size={11} color={palette.mutedForeground} /> : <Icon name="git-branch" size={11} color={palette.mutedForeground} />}
                <T variant="micro" mono weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {p.repo}
                </T>
                <TextInput
                  value={p.ref ?? ""}
                  onChangeText={(ref) => setPicked((ps) => ps.map((x) => (x.repo === p.repo ? { ...x, ref: ref || undefined } : x)))}
                  placeholder={p.defaultBranch ?? "branch"}
                  placeholderTextColor={palette.faint}
                  accessibilityLabel={`Branch for ${p.repo}`}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ width: 84, color: palette.live, fontFamily: fonts.mono, fontSize: type.micro.fontSize, paddingVertical: 0 }}
                />
                <PressScale
                  onPress={() => {
                    animateLayout();
                    setPicked((ps) => ps.filter((x) => x.repo !== p.repo));
                  }}
                  hitSlop={8}
                  accessibilityLabel={`Remove ${p.repo}`}
                  style={{ padding: 6 }}
                >
                  <Icon name="x" size={11} color={palette.faint} />
                </PressScale>
              </View>
            ))}
            {attachments.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {attachments.map((a, i) => (
                  <PressScale
                    key={i}
                    accessibilityLabel={`Remove ${a.name}`}
                    onPress={() => {
                      animateLayout();
                      setAttachments((as) => as.filter((_, j) => j !== i));
                    }}
                  >
                    <Image source={{ uri: a.dataUrl }} style={{ width: 52, height: 52, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border }} />
                    <View style={{ position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: palette.foreground, alignItems: "center", justifyContent: "center" }}>
                      <Icon name="x" size={10} color={palette.background} />
                    </View>
                  </PressScale>
                ))}
              </ScrollView>
            ) : null}
          </View>
        ) : null}

        {/* Toolbar */}
        <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 6, paddingRight: 6, paddingBottom: 6, gap: 2 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ alignItems: "center", gap: 2 }} style={{ flex: 1 }}>
            <ToolButton
              icon="plus"
              accessibilityLabel="Add a repository or image"
              dot={picked.length > 0 || attachments.length > 0}
              onPress={() => {
                setAddOnRepos(false);
                setSheet("add");
              }}
            />
            <ToolButton icon="slash" label="Skills" accessibilityLabel="Run a skill with this message" dot={!!skill} onPress={() => setSheet("skills")} />
            {sources.harnesses.length > 0 ? (
              <ToolButton icon="layers" label={pickedHarness?.name ?? "Harness"} accessibilityLabel="Harness" dot={!!pickedHarness} onPress={() => setSheet("harness")} />
            ) : null}
            {sources.workflows.length > 0 ? (
              <ToolButton icon="list" label={pickedWorkflow?.name ?? "Playbook"} accessibilityLabel="Playbook" dot={!!pickedWorkflow} onPress={() => setSheet("workflow")} />
            ) : null}
            {models.length > 0 || sources.providers.length > 0 ? (
              <ToolButton icon="cpu" label={modelLabel} accessibilityLabel="Model" dot={!!model || !!run.value.provider} onPress={() => setSheet("model")} />
            ) : null}
            <ToolButton icon="more-horizontal" accessibilityLabel="More run options" dot={moreDot} onPress={() => setSheet("agent")} />
          </ScrollView>
          {voiceSupported && !trialExpired ? <VoiceButton onPress={() => setVoiceOpen(true)} size={32} /> : null}
          <ScalePresence visible={canSend}>
            <PressScale
              onPress={submit}
              haptic="medium"
              accessibilityRole="button"
              accessibilityLabel="Start a machine with this task"
              style={({ pressed }) => ({
                width: 34,
                height: 34,
                borderRadius: 17,
                marginLeft: 4,
                backgroundColor: palette.primary,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Icon name="arrow-up" size={18} color={palette.primaryForeground} />
            </PressScale>
          </ScalePresence>
        </View>
      </View>

      {/* Off-default run options as removable chips, under the card like the web's chip row. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <RunOptionChips value={run.value} sources={sources} onOpen={(s) => setSheet(s)} onChange={run.update} />
        {verify?.text.trim() ? (
          <PressScale
            onPress={() => setSheet("verify")}
            style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: palette.accent, borderWidth: 1, borderColor: palette.lineStrong }}
          >
            <Icon name="shield" size={11} color={palette.mutedForeground} />
            <T variant="micro" weight="medium" numberOfLines={1} style={{ maxWidth: 160 }}>
              Verify · {verify.text.trim()}
            </T>
            <PressScale onPress={() => setVerify(null)} hitSlop={8} accessibilityLabel="Remove verify">
              <Icon name="x" size={11} color={palette.faint} />
            </PressScale>
          </PressScale>
        ) : null}
      </View>

      <T variant="micro" tone={error ? "destructive" : "faint"} style={{ paddingHorizontal: 4 }} accessibilityLiveRegion={error ? "assertive" : "none"}>
        {caption}
      </T>

      {/* Starters: one-tap briefs. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }} accessibilityLabel="Task starters">
        {STARTERS.map((s, i) => (
          <FadeInUp key={s.label} delay={stagger(i, 25)}>
            <PressScale
              onPress={() => applyStarter(s)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                height: 32,
                paddingLeft: 10,
                paddingRight: 12,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: pressed ? palette.lineStrong : palette.border,
                backgroundColor: palette.card,
              })}
            >
              <Icon name={s.icon} size={13} color={palette.faint} />
              <T variant="meta" tone="muted">
                {s.label}
              </T>
            </PressScale>
          </FadeInUp>
        ))}
      </View>

      <AddSheet visible={sheet === "add"} onClose={() => setSheet(null)} picked={picked} onToggleRepo={toggleRepo} onPickImage={(c) => void pickImage(c)} startOnRepos={addOnRepos} />
      <SkillsSheet visible={sheet === "skills"} onClose={() => setSheet(null)} skills={skills} current={skill} onPick={pickSkill} />
      <ModelSheet
        visible={sheet === "model"}
        onClose={() => setSheet(null)}
        models={models}
        defaultModel={defaultModel}
        model={model}
        providers={sources.providers}
        provider={run.value.provider ?? null}
        providerModel={run.value.providerModel ?? null}
        onPick={(m) => {
          setModel(m.id === defaultModel ? null : m.id);
          run.update({ provider: null, providerModel: null });
        }}
        onPickProvider={(provider, providerModel) => run.update({ provider, providerModel })}
      />
      <RunSettingsSheet
        visible={sheet === "harness" || sheet === "workflow" || sheet === "agent" || sheet === "attempts" || sheet === "verify" || sheet === "provider"}
        title={sheet === "harness" ? "Harness" : sheet === "workflow" ? "Playbook" : sheet === "provider" ? "Model provider" : "More"}
        sections={sheet === "harness" ? ["harness"] : sheet === "workflow" ? ["workflow"] : sheet === "provider" ? ["provider"] : ["agent", "attempts", "verify"]}
        onClose={() => setSheet(null)}
        value={run.value}
        onChange={run.update}
        sources={sources}
        loading={run.loading}
        error={run.error}
        onRetry={run.reload}
        verify={{ value: verify, onChange: setVerify }}
      />
    </View>
  );
});
