import React, { useEffect, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { api, intakeApi, isUnfurlable, type AgentId, type RepoInfo, type SkillView, type Unfurled } from "@/lib/api";
import { setPendingDelegate, takeFailedSubmit } from "@/lib/pending-delegate";
import { clearDraft, DRAFT_NEW, loadDraft, saveDraft, takePrefill } from "@/lib/draft";
import { currentAgent, harnessSummary, RunOptionChips, RunSettingsSheet, useRunOptions } from "@/components/sheets/RunSettingsSheet";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { smartJoin, useVoiceInput } from "@/hooks/useVoiceInput";
import { VoiceButton, VoicePill } from "@/components/VoiceButton";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TextInput } from "react-native";

type Attachment = { name: string; dataUrl: string };
const MAX_ATTACHMENTS = 8;

// Task starters, verbatim from the web Hub.
const STARTERS: { label: string; text: string; needsRepo?: boolean }[] = [
  {
    label: "Explain a codebase",
    needsRepo: true,
    text: "Read this repository and write a concise architecture overview: the entry points, the main modules and how they depend on each other, and anything surprising. Do not change any files.",
  },
  {
    label: "Fix a bug, open a PR",
    needsRepo: true,
    text: "Find and fix the following bug, add a regression test, and open a pull request:\n\n",
  },
  {
    label: "Run the tests",
    needsRepo: true,
    text: "Install dependencies, run the full test suite, and report exactly what fails with the command and the key error lines. Do not fix anything yet — stop and tell me what you found.",
  },
  {
    label: "Review a diff",
    needsRepo: true,
    text: "Review the changes on the current branch against main. Report correctness bugs first, then anything that could be simpler. Do not change files.",
  },
  {
    label: "Review a PR",
    needsRepo: true,
    text: "Review the following pull request. Check out the PR branch, read the full diff, and leave a review on GitHub: comment on the specific lines for any correctness bug, risky change, or clear improvement. If nothing needs a change, approve the PR instead. Do not merge.\n\nPR: ",
  },
  {
    label: "Research, no repo",
    text: "Write a thorough, well-sourced report on the following, into /workspace/report.md:\n\n",
  },
];

/**
 * Delegate: fire-and-stream. POST returns the box name and we navigate straight
 * to the Thread in its booting state — never the blocking MCP shape.
 */
export default function NewTask() {
  const router = useRouter();
  const { palette } = useTheme();
  const { me } = useAuth();
  // A failed delegate lands back here via /booting: the stash restores the WHOLE submission —
  // repos, photos, model, verify, and what went wrong — not just the task text.
  const [stash] = useState(() => takeFailedSubmit());
  // A one-shot prefill ("new task from this run") beats the stash; the AsyncStorage draft is restored
  // asynchronously below, only if nothing else filled the box first.
  const [prefill] = useState(() => takePrefill());
  const [task, setTask] = useState(() => prefill ?? stash?.task ?? "");
  const taskRef = useRef(task);
  taskRef.current = task;
  const draftReady = useRef(false);
  const [repoQuery, setRepoQuery] = useState("");
  const [repoResults, setRepoResults] = useState<RepoInfo[]>([]);
  const [picked, setPicked] = useState<{ repo: string; ref?: string }[]>(() => stash?.picked ?? []);
  const [attachments, setAttachments] = useState<Attachment[]>(() => stash?.attachments ?? []);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [error, setError] = useState<string | null>(() => stash?.error ?? null);
  const [clarify, setClarify] = useState<string | null>(() => stash?.clarify ?? null);
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [model, setModel] = useState<string | null>(() => stash?.model ?? null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [showModels, setShowModels] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(() => !!stash?.verify);
  const [verifyMode, setVerifyMode] = useState<"command" | "criterion">(() => stash?.verify?.mode ?? "command");
  const [verifyText, setVerifyText] = useState(() => stash?.verify?.text ?? "");
  // Run settings: agent / harness / playbook / attempts. Agent, harness and playbook stick across
  // launches; a failed submit restores exactly what was sent (including attempts).
  const run = useRunOptions(stash?.run ? { ...stash.run, agent: stash.run.agent as AgentId | null } : null);
  const [runOpen, setRunOpen] = useState(false);
  // Link unfurl: a pasted GitHub issue/PR or Sentry link becomes a task (server-side fetch).
  const [unfurled, setUnfurled] = useState<Unfurled | null>(null);
  const unfurlGen = useRef(0);
  const unfurlSeen = useRef<string | null>(null);

  const trialExpired = me?.kind === "user" && me.expired;
  const keyboardInset = useKeyboardInset();

  // Dictate the brief: finalized phrases append to the task; starting the machine stays manual.
  const voice = useVoiceInput({
    onFinal: (spoken) => setTask((prev) => prev + smartJoin(prev, spoken)),
  });
  const dictating = voice.state === "listening" || voice.state === "arming";

  // "Run again" prefill from the thread's ⋯ menu.
  const params = useLocalSearchParams<{ task?: string }>();
  useEffect(() => {
    if (typeof params.task === "string" && params.task && !task) setTask(params.task);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.task]);

  // Draft: restore on mount if nothing else filled the box (no stash, prefill or ?task=), then
  // save as you type (debounced in draft.ts). Saving waits for the restore so an empty first
  // render can never wipe a saved draft.
  useEffect(() => {
    let cancelled = false;
    const hasParam = typeof params.task === "string" && !!params.task;
    loadDraft(DRAFT_NEW).then((d) => {
      if (cancelled) return;
      if (d && !taskRef.current && !hasParam) setTask(d);
      draftReady.current = true;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (draftReady.current) saveDraft(DRAFT_NEW, task);
  }, [task]);

  // Unfurl: the whole box is one GitHub issue/PR or Sentry link → fetch it server-side (300 ms
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
    api.skills().then((r) => setSkills(r.skills.filter((s) => s.enabled))).catch(() => {});
    api
      .models()
      .then((r) => {
        setModels(r.models);
        setDefaultModel(r.default);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .repos(repoQuery)
        .then((r) => setRepoResults(r.repos.slice(0, 8)))
        .catch(() => setRepoResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [repoQuery]);

  const pickImage = async (camera: boolean) => {
    const fn = camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const res = await fn({ mediaTypes: ["images"], quality: 0.7, base64: true });
    const asset = res.assets?.[0];
    if (!asset?.base64) return;
    if (attachments.length >= MAX_ATTACHMENTS) return;
    const mime = asset.mimeType ?? "image/jpeg";
    setAttachments((a) => [
      ...a,
      { name: asset.fileName ?? `photo-${a.length + 1}.jpg`, dataUrl: `data:${mime};base64,${asset.base64}` },
    ]);
  };

  // Fire-and-navigate, like the web swapping to BootingThread the moment you
  // submit: the delegate promise rides to /booting, which shows progress and
  // replaces itself with the thread as soon as the box name comes back.
  const submit = () => {
    if (!task.trim()) return;
    voice.stop();
    setError(null);
    setClarify(null);
    const agent = currentAgent(run.value, run.sources.prefs);
    const promise = api.delegate({
        task: task.trim(),
        repos: picked.length ? picked : undefined,
        attachments: attachments.length ? attachments : undefined,
        ...(run.value.provider
          ? { provider: run.value.provider, ...(run.value.providerModel ? { model: run.value.providerModel } : {}) }
          : model
            ? { model }
            : {}),
        ...(verifyText.trim()
          ? { verify: verifyMode === "command" ? { command: verifyText.trim() } : { criterion: verifyText.trim() } }
          : {}),
        // Web parity: the agent goes only when explicitly picked; a below-floor driver carries the
        // acknowledgement the sheet collected ("supervised: partial").
        ...(run.value.agent
          ? { agent: run.value.agent, ...(agent?.supervised === false ? { allowPartialSupervision: true } : {}) }
          : {}),
        ...(run.value.harness ? { harness: run.value.harness } : {}),
        ...(run.value.workflow ? { workflow: run.value.workflow } : {}),
        ...(run.value.attempts > 1 ? { attempts: run.value.attempts } : {}),
      });
    // The draft is gone once the server accepted the task — a failure comes back via the stash.
    promise
      .then((r) => {
        if (r.ok) clearDraft(DRAFT_NEW);
      })
      .catch(() => {});
    setPendingDelegate({
      task: task.trim(),
      promise,
      // Fleet-as-of-submit: /booting attaches the moment a NEW box (or a pool
      // box flipping pool-free -> claimed) surfaces — the web's early-attach.
      // A rejected fleet read resolves to null (NOT an empty map): an empty map
      // makes every box in the next poll look "fresh", attaching the user to
      // some pre-existing run. /booting re-baselines off its first real poll.
      known: api
        .fleet()
        .then((s) => new Map(s.boxes.map((b) => [b.name, b.role])))
        .catch(() => null),
      draft: {
        task: task.trim(),
        picked,
        attachments,
        model,
        ...(verifyText.trim() ? { verify: { mode: verifyMode, text: verifyText.trim() } } : {}),
        run: { ...run.value },
      },
    });
    router.replace("/booting");
  };

  const pickedHarness = run.value.harness ? run.sources.harnesses.find((x) => x.id === run.value.harness) : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 }}>
          <T serif variant="h2">New task</T>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <T variant="body" tone="muted">Cancel</T>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 14, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          {trialExpired && me?.kind === "user" ? (
            <View style={{ backgroundColor: palette.attention, borderRadius: radius.xl, padding: 14, gap: 8 }}>
              <T variant="body" weight="semibold" style={{ color: palette.attentionInk }}>
                Your trial has ended — machines can't start until you upgrade.
              </T>
              {me.billingUrl ? (
                <Button title="Upgrade" onPress={() => WebBrowser.openBrowserAsync(me.billingUrl!)} />
              ) : null}
            </View>
          ) : null}

          <VoicePill state={voice.state} interim={voice.interim} />
          <View>
            <TextInput
              value={task}
              onChangeText={setTask}
              placeholder="What should the agent do? Repos mentioned in the task are inferred automatically."
              placeholderTextColor={palette.faint}
              multiline
              autoFocus
              editable={!trialExpired}
              style={{
                minHeight: 130,
                borderWidth: dictating ? 1.5 : 1,
                borderColor: dictating ? palette.live : palette.input,
                borderRadius: radius["2xl"],
                backgroundColor: palette.card,
                padding: 14,
                paddingBottom: 44,
                color: palette.foreground,
                fontFamily: fonts.sans,
                fontSize: type.lead.fontSize,
                lineHeight: type.lead.lineHeight,
                textAlignVertical: "top",
              }}
            />
            {voice.supported && !trialExpired && (
              <View style={{ position: "absolute", right: 10, bottom: 8 }}>
                <VoiceButton state={voice.state} level={voice.level} onToggle={voice.toggle} />
              </View>
            )}
          </View>

          {unfurled ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}>
              <Icon name={unfurled.source === "github" ? "github" : "alert-circle"} size={12} color={palette.mutedForeground} />
              <T variant="micro" tone="muted" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                from {unfurled.source === "github" ? "GitHub" : "Sentry"}: {unfurled.title}
              </T>
              <Pressable onPress={() => setUnfurled(null)} hitSlop={10} accessibilityLabel="Dismiss">
                <Icon name="x" size={12} color={palette.faint} />
              </Pressable>
            </View>
          ) : null}

          {/* Run settings: one chip opens the sheet; anything off its default sits beside it as a removable chip. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setRunOpen(true);
              }}
              accessibilityLabel="Run settings"
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: palette.card,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Icon name="sliders" size={12} color={palette.mutedForeground} />
              <T variant="micro" weight="medium">
                Settings
              </T>
              {run.sources.prefs ? (
                <T variant="micro" tone="faint">
                  · {currentAgent(run.value, run.sources.prefs)?.label ?? run.sources.prefs.defaultAgent}
                </T>
              ) : null}
            </Pressable>
            <RunOptionChips value={run.value} sources={run.sources} onOpen={() => setRunOpen(true)} onChange={run.update} />
          </View>
          {pickedHarness ? (
            <T variant="micro" tone="faint" numberOfLines={2} style={{ paddingHorizontal: 4, marginTop: -8 }}>
              {harnessSummary(pickedHarness)}
            </T>
          ) : null}

          {clarify ? (
            <View style={{ backgroundColor: palette.attention, borderRadius: radius.xl, padding: 12 }}>
              <T variant="body" style={{ color: palette.attentionInk }}>
                ◆ {clarify}
              </T>
            </View>
          ) : null}
          {error ? (
            <T variant="meta" tone="destructive">
              ✕ {error}
            </T>
          ) : null}

          <View style={{ gap: 6 }}>
            <T variant="meta" weight="medium" tone="muted">
              Starters
            </T>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {STARTERS.map((s) => (
                  <Pressable
                    key={s.label}
                    // Never destroy a typed brief (web parity): replace only an empty composer or
                    // another untouched starter; otherwise append the template under the text.
                    onPress={() =>
                      setTask((prev) => {
                        const t = prev.trim();
                        const isStarter = STARTERS.some((x) => t === x.text.trim());
                        return !t || isStarter ? s.text : `${prev.replace(/\s+$/, "")}\n\n${s.text}`;
                      })
                    }
                    style={({ pressed }) => ({
                      paddingVertical: 7,
                      paddingHorizontal: 12,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: palette.border,
                      backgroundColor: palette.card,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <T variant="meta">{s.label}</T>
                  </Pressable>
                ))}
            </View>
          </View>

          {skills.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {skills.map((s) => (
                <Pressable
                  key={s.name}
                  onPress={() => setTask((t) => (t.includes(`/${s.name}`) ? t : `${t}${t ? " " : ""}/${s.name} `))}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: palette.border,
                    backgroundColor: task.includes(`/${s.name}`) ? palette.accent : "transparent",
                  }}
                >
                  <T variant="meta" mono>
                    /{s.name}
                  </T>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View style={{ gap: 8 }}>
            <T variant="meta" weight="medium" tone="muted">
              Repositories {picked.length ? `(${picked.length})` : "(optional — inferred from the task)"}
            </T>
            {picked.map((p) => (
              <View key={p.repo} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <T variant="meta" mono style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
                  {p.repo}
                </T>
                <TextInput
                  value={p.ref ?? ""}
                  onChangeText={(ref) =>
                    setPicked((ps) => ps.map((x) => (x.repo === p.repo ? { ...x, ref: ref || undefined } : x)))
                  }
                  placeholder="branch"
                  placeholderTextColor={palette.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    width: 110,
                    color: palette.live,
                    fontFamily: fonts.mono,
                    fontSize: type.code.fontSize,
                    borderBottomWidth: 1,
                    borderBottomColor: palette.input,
                    paddingVertical: 2,
                  }}
                />
                <Pressable onPress={() => setPicked((ps) => ps.filter((x) => x.repo !== p.repo))} hitSlop={8}>
                  <T variant="meta" tone="destructive">
                    ✕
                  </T>
                </Pressable>
              </View>
            ))}
            {/* Results ABOVE the search field so the keyboard never hides them. */}
            {repoQuery.trim().length > 0 && (
              <View
                style={{
                  backgroundColor: palette.popover,
                  borderWidth: 1,
                  borderColor: palette.border,
                  borderRadius: radius.xl,
                  overflow: "hidden",
                }}
              >
                {repoResults.filter((r) => !picked.some((p) => p.repo === r.fullName)).length === 0 ? (
                  <T variant="meta" tone="faint" style={{ padding: 12 }}>
                    Nothing matches "{repoQuery.trim()}".
                  </T>
                ) : (
                  repoResults
                    .filter((r) => !picked.some((p) => p.repo === r.fullName))
                    .map((r) => (
                      <Pressable
                        key={r.fullName}
                        onPress={() => {
                          setPicked((ps) => [...ps, { repo: r.fullName }]);
                          setRepoQuery("");
                        }}
                        style={({ pressed }) => ({
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                          backgroundColor: pressed ? palette.accent : "transparent",
                        })}
                      >
                        <T variant="meta" mono numberOfLines={1}>
                          {r.fullName}
                          {r.private ? " · private" : ""}
                        </T>
                        {r.description ? (
                          <T variant="micro" tone="faint" numberOfLines={1}>
                            {r.description}
                          </T>
                        ) : null}
                      </Pressable>
                    ))
                )}
              </View>
            )}
            <Field placeholder="Search repos…" value={repoQuery} onChangeText={setRepoQuery} autoCapitalize="none" mono />
          </View>

          {models.length > 0 && (
            <View style={{ gap: 6 }}>
              <T variant="meta" weight="medium" tone="muted">
                Model
              </T>
              {showModels ? (
                <View style={{ gap: 4 }}>
                  {models.map((m) => {
                    const active = m.id === (model ?? defaultModel);
                    return (
                      <Pressable
                        key={m.id}
                        onPress={() => {
                          setModel(m.id === defaultModel ? null : m.id);
                          setShowModels(false);
                        }}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                          paddingVertical: 10,
                          paddingHorizontal: 10,
                          borderRadius: radius.lg,
                          backgroundColor: active ? palette.accent : "transparent",
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <T variant="body" weight={active ? "semibold" : "regular"} style={{ flex: 1 }}>
                          {m.label}
                          {m.id === defaultModel ? "  · default" : ""}
                        </T>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Pressable
                  onPress={() => setShowModels(true)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingVertical: 8,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <T variant="body" tone={model ? "live" : "muted"}>
                    {models.find((m) => m.id === (model ?? defaultModel))?.label ?? "Default"}
                  </T>
                  <T variant="meta" tone="faint">
                    change
                  </T>
                </Pressable>
              )}
            </View>
          )}

          <View style={{ gap: 8 }}>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setVerifyOpen((o) => !o);
              }}
              accessibilityLabel="Verify the result"
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingVertical: 4,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Icon name="shield" size={14} color={verifyText.trim() ? palette.live : palette.mutedForeground} />
              <T variant="meta" weight="medium" tone={verifyText.trim() ? "live" : "muted"} style={{ flex: 1 }}>
                Verify the result{verifyText.trim() && !verifyOpen ? ` · ${verifyMode}` : ""}
              </T>
              <Icon name={verifyOpen ? "chevron-down" : "chevron-right"} size={14} color={palette.faint} />
            </Pressable>
            {verifyOpen && (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {(["command", "criterion"] as const).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        setVerifyMode(m);
                      }}
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 12,
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: palette.border,
                        backgroundColor: verifyMode === m ? palette.accent : "transparent",
                      }}
                    >
                      <T variant="meta" weight={verifyMode === m ? "semibold" : "regular"}>
                        {m === "command" ? "Command" : "Criterion"}
                      </T>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  value={verifyText}
                  onChangeText={setVerifyText}
                  placeholder={verifyMode === "command" ? "npm test" : "what must be true when it's done"}
                  placeholderTextColor={palette.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    borderWidth: 1,
                    borderColor: palette.input,
                    borderRadius: radius.xl,
                    backgroundColor: palette.card,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    color: palette.foreground,
                    fontFamily: verifyMode === "command" ? fonts.mono : fonts.sans,
                    fontSize: type.body.fontSize,
                  }}
                />
                <T variant="micro" tone="faint">
                  {verifyMode === "command"
                    ? "Runs in the sandbox after the agent finishes — exit 0 means verified."
                    : "A read-only checker judges this — it can't edit anything."}
                </T>
              </View>
            )}
          </View>

          <View style={{ gap: 8 }}>
            <T variant="meta" weight="medium" tone="muted">
              Attachments {attachments.length ? `(${attachments.length}/${MAX_ATTACHMENTS})` : ""}
            </T>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {attachments.map((a, i) => (
                <Pressable key={i} onPress={() => setAttachments((as) => as.filter((_, j) => j !== i))}>
                  <Image source={{ uri: a.dataUrl }} style={{ width: 64, height: 64, borderRadius: radius.lg }} />
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button title="Photo library" small variant="secondary" onPress={() => pickImage(false)} disabled={attachments.length >= MAX_ATTACHMENTS} />
              <Button title="Camera" small variant="secondary" onPress={() => pickImage(true)} disabled={attachments.length >= MAX_ATTACHMENTS} />
            </View>
            <T variant="micro" tone="faint">
              Photograph a whiteboard or a bug and delegate it.
            </T>
          </View>
        </ScrollView>
        {/* Web parity: a circular arrow-up "Start a machine with this task". */}
        <View style={{ padding: 16, paddingBottom: 16 + keyboardInset, flexDirection: "row", justifyContent: "flex-end" }}>
          <Pressable
            onPress={submit}
            disabled={!task.trim() || !!trialExpired}
            accessibilityLabel="Start a machine with this task"
            style={({ pressed }) => ({
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: task.trim() && !trialExpired ? palette.primary : palette.muted,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Icon name="arrow-up" size={24} color={task.trim() && !trialExpired ? palette.primaryForeground : palette.faint} />
          </Pressable>
        </View>
        <RunSettingsSheet
          visible={runOpen}
          onClose={() => setRunOpen(false)}
          value={run.value}
          onChange={run.update}
          sources={run.sources}
          loading={run.loading}
          error={run.error}
          onRetry={run.reload}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
