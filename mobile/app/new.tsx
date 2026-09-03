import React, { useEffect, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { api, type RepoInfo, type SkillView } from "@/lib/api";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TextInput } from "react-native";

type Attachment = { name: string; dataUrl: string };
const MAX_ATTACHMENTS = 8;

/**
 * Delegate: fire-and-stream. POST returns the box name and we navigate straight
 * to the Thread in its booting state — never the blocking MCP shape.
 */
export default function NewTask() {
  const router = useRouter();
  const { palette } = useTheme();
  const { me } = useAuth();
  const [task, setTask] = useState("");
  const [repoQuery, setRepoQuery] = useState("");
  const [repoResults, setRepoResults] = useState<RepoInfo[]>([]);
  const [picked, setPicked] = useState<{ repo: string; ref?: string }[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarify, setClarify] = useState<string | null>(null);

  const trialExpired = me?.kind === "user" && me.expired;

  useEffect(() => {
    api.skills().then((r) => setSkills(r.skills.filter((s) => s.enabled))).catch(() => {});
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

  const submit = async () => {
    if (!task.trim()) return;
    setBusy(true);
    setError(null);
    setClarify(null);
    try {
      const r = await api.delegate({
        task: task.trim(),
        repos: picked.length ? picked : undefined,
        attachments: attachments.length ? attachments : undefined,
      });
      if (r.ok) {
        router.replace(`/box/${encodeURIComponent(r.box)}`);
      } else {
        setClarify(r.question);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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
              borderWidth: 1,
              borderColor: palette.input,
              borderRadius: radius["2xl"],
              backgroundColor: palette.card,
              padding: 14,
              color: palette.foreground,
              fontFamily: fonts.sans,
              fontSize: type.lead.fontSize,
              lineHeight: type.lead.lineHeight,
              textAlignVertical: "top",
            }}
          />

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
              <Pressable
                key={p.repo}
                onPress={() => setPicked((ps) => ps.filter((x) => x.repo !== p.repo))}
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <T variant="meta" mono style={{ flex: 1 }}>
                  {p.repo}
                  {p.ref ? `@${p.ref}` : ""}
                </T>
                <T variant="meta" tone="destructive">
                  remove
                </T>
              </Pressable>
            ))}
            <Field placeholder="Search repos…" value={repoQuery} onChangeText={setRepoQuery} autoCapitalize="none" mono />
            {repoQuery.trim().length > 0 &&
              repoResults
                .filter((r) => !picked.some((p) => p.repo === r.fullName))
                .map((r) => (
                  <Pressable
                    key={r.fullName}
                    onPress={() => {
                      setPicked((ps) => [...ps, { repo: r.fullName }]);
                      setRepoQuery("");
                    }}
                    style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.border }}
                  >
                    <T variant="meta" mono>
                      {r.fullName}
                      {r.private ? " · private" : ""}
                    </T>
                    {r.description ? (
                      <T variant="micro" tone="faint" numberOfLines={1}>
                        {r.description}
                      </T>
                    ) : null}
                  </Pressable>
                ))}
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
        <View style={{ padding: 16 }}>
          <Button title="Delegate" onPress={submit} loading={busy} disabled={!task.trim() || !!trialExpired} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
