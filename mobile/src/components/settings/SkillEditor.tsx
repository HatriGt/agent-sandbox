// The authoring surface, ported from web/src/components/skills/SkillEditor.tsx. Full-screen: a header
// (back · /name · save state · ⋯ · Save), a toolbar (file · Write/Preview · Details), the frontmatter
// as two fields over the body, supporting files in a sheet, the inspector in a sheet. Same upsert /
// toggle / remove bodies as the web.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Share, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import type { SkillView } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { MarkdownLite } from "@/components/MarkdownLite";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { Segmented } from "./Segmented";
import { type SkillFile, toSkillMd } from "./skillImport";
import { SkillFileTree, type TreeActions } from "./SkillFileTree";
import { SkillInspector } from "./SkillInspector";
import { byteLength, type Draft, fmtKb, MAX_CONTENT, type Mutate, NAME_RE, slugify, sourceOf } from "./SkillModel";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SkillEditor({
  visible,
  initial,
  draft,
  onMutate,
  onSaved,
  onClose,
}: {
  visible: boolean;
  initial?: SkillView;
  draft?: Draft;
  onMutate: Mutate;
  /** After a successful save: the parent swaps in the saved skill so the editor's baseline moves. */
  onSaved: (s: SkillView) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {visible ? <EditorBody initial={initial} draft={draft} onMutate={onMutate} onSaved={onSaved} onClose={onClose} /> : null}
    </Modal>
  );
}

function EditorBody({ initial, draft, onMutate, onSaved, onClose }: { initial?: SkillView; draft?: Draft; onMutate: Mutate; onSaved: (s: SkillView) => void; onClose: () => void }) {
  const { palette } = useTheme();
  const base = useMemo<Draft>(
    () => ({
      name: initial?.name ?? draft?.name ?? "",
      description: initial?.description ?? draft?.description ?? "",
      content: initial?.content ?? draft?.content ?? "",
      files: initial?.files ?? draft?.files ?? [],
    }),
    [initial, draft],
  );
  const [name, setName] = useState(base.name);
  const [description, setDescription] = useState(base.description);
  const [content, setContent] = useState(base.content);
  const [files, setFiles] = useState<SkillFile[]>(base.files ?? []);
  const [active, setActive] = useState("SKILL.md");
  const activeFile = active === "SKILL.md" ? null : (files.find((f) => f.path === active) ?? null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [previewRaw, setPreviewRaw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filesSheet, setFilesSheet] = useState(false);
  const [infoSheet, setInfoSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const nameRef = useRef<TextInput>(null);
  const saving = useRef(false);

  // When the parent swaps in the freshly saved skill, the baseline moves under us — nothing else changes.
  useEffect(() => {
    if (initial && initial.name !== name && !saving.current) setName(initial.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.name]);

  const trimmedName = name.trim();
  const nameError = trimmedName && !NAME_RE.test(trimmedName) ? "Lowercase letters, digits and dashes; up to 50 characters." : null;
  const valid = !!trimmedName && !nameError && !!description.trim() && !!content.trim() && content.length <= MAX_CONTENT;

  const dirtyFiles = useMemo(() => {
    const d: Record<string, true> = {};
    if (content !== base.content) d["SKILL.md"] = true;
    const savedFiles = base.files ?? [];
    for (const f of files) {
      const prev = savedFiles.find((p) => p.path === f.path);
      if (!prev || prev.content !== f.content) d[f.path] = true;
    }
    return d;
  }, [content, files, base]);
  const filesRemoved = (base.files ?? []).some((p) => !files.some((f) => f.path === p.path));
  const dirty = !initial || name !== base.name || description !== base.description || filesRemoved || Object.keys(dirtyFiles).length > 0;
  const hasAnything = !!(content.trim() || description.trim() || name.trim() || files.length);

  const save = async (): Promise<boolean> => {
    if (!valid || saving.current || (initial && !dirty)) return false;
    saving.current = true;
    setBusy(true);
    setErr(null);
    try {
      const r = await onMutate(
        {
          action: "upsert",
          previousName: initial?.name,
          skill: { name: trimmedName, description: description.trim(), content, files: files.length ? files : undefined, enabled: initial?.enabled ?? true },
        },
        initial ? undefined : `/${trimmedName} is live — every sandbox gets it on its next turn`,
      );
      const saved = r.skills.find((s) => s.name === trimmedName);
      if (saved) onSaved(saved);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
      return true;
    } catch (e) {
      setErr(msg(e));
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const requestClose = () => {
    if (!(dirty && (initial || hasAnything))) return onClose();
    Alert.alert("Unsaved changes", initial ? `/${initial.name} has edits that are not saved.` : "This skill has not been created yet.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onClose },
      ...(valid ? [{ text: initial ? "Save & leave" : "Create & leave", onPress: () => void save().then((ok) => ok && onClose()) }] : []),
    ]);
  };

  const remove = async () => {
    if (!initial) return;
    setBusy(true);
    try {
      await onMutate({ action: "remove", name: initial.name }, `/${initial.name} removed`);
      onClose();
    } catch (e) {
      setErr(msg(e));
      setBusy(false);
    }
  };

  const toggle = async (next: boolean) => {
    if (!initial) return;
    setToggling(true);
    try {
      const r = await onMutate({ action: "toggle", name: initial.name, enabled: next });
      const s = r.skills.find((x) => x.name === initial.name);
      if (s) onSaved(s);
    } catch (e) {
      Alert.alert("Could not update", msg(e));
    } finally {
      setToggling(false);
    }
  };

  const rawMd = toSkillMd({ name: trimmedName || "your-skill", description: description.trim(), content });

  const treeActions: TreeActions = {
    onAdd: (path) => setFiles((fs) => [...fs, { path, content: "" }]),
    onRename: (from, to) => {
      setFiles((fs) => fs.map((f) => (f.path === from ? { ...f, path: to } : f)));
      if (active === from) setActive(to);
    },
    onRemove: (path) => {
      setFiles((fs) => fs.filter((f) => f.path !== path));
      if (active === path) setActive("SKILL.md");
    },
  };

  const focusName = () => {
    setActive("SKILL.md");
    setMode("write");
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const menuItems: { icon: IconName; label: string; hint?: string; destructive?: boolean; run: () => void }[] = [
    { icon: "edit-3", label: "Rename", run: focusName },
    {
      icon: "download",
      label: "Download SKILL.md",
      run: () => void Share.share({ title: `${trimmedName || "skill"}.SKILL.md`, message: toSkillMd({ name: trimmedName || "skill", description: description.trim(), content }) }),
    },
    {
      icon: "copy",
      label: "Copy as markdown",
      run: () => {
        void Clipboard.setStringAsync(rawMd);
        Alert.alert("SKILL.md copied");
      },
    },
    ...(initial
      ? [
          { icon: "power" as const, label: initial.enabled ? "Turn off" : "Turn on", hint: initial.enabled ? "on" : "off", run: () => void toggle(!initial.enabled) },
          {
            icon: "trash-2" as const,
            label: "Delete skill…",
            destructive: true,
            run: () =>
              Alert.alert(`Delete /${initial.name}?`, "Every sandbox loses it on its next turn. This cannot be undone.", [
                { text: "Cancel", style: "cancel" },
                { text: "Delete skill", style: "destructive", onPress: () => void remove() },
              ]),
          },
        ]
      : []),
  ];

  const saveState = savedFlash ? "Saved" : dirty && initial ? "Unsaved" : !initial ? "Draft" : null;
  const inputBase = { color: palette.foreground, padding: 0 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 52, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Pressable onPress={requestClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to skills" style={{ padding: 6 }}>
          <Icon name="arrow-left" size={20} />
        </Pressable>
        <Pressable onPress={focusName} accessibilityRole="button" accessibilityLabel="Rename" style={{ flexShrink: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <T variant="body" weight="medium" mono={!!trimmedName} tone={trimmedName ? "default" : "muted"} numberOfLines={1} style={{ flexShrink: 1 }}>
            {trimmedName ? `/${trimmedName}` : "New skill"}
          </T>
          {initial && sourceOf(initial.name) === "starter" ? <StarterBadge /> : null}
        </Pressable>
        {saveState ? (
          <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: saveState === "Unsaved" ? palette.attention : saveState === "Saved" ? palette.ok : palette.faint }} />
            <T variant="micro" weight="medium" tone={saveState === "Unsaved" ? "attention" : saveState === "Saved" ? "ok" : "muted"}>
              {saveState}
            </T>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => setMenu(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="More actions" style={{ padding: 6 }}>
          <Icon name="more-horizontal" size={20} />
        </Pressable>
        <Button small title={initial ? "Save" : "Create skill"} loading={busy} disabled={!valid || busy || (!!initial && !dirty)} onPress={() => void save()} />
      </View>

      {/* Toolbar: files · mode · details */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <Pressable
          onPress={() => setFilesSheet(true)}
          accessibilityRole="button"
          accessibilityLabel="Files"
          style={{ flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "45%", borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 5 }}
        >
          <Icon name="file-text" size={14} />
          <T variant="micro" mono numberOfLines={1} style={{ flexShrink: 1 }}>
            {active}
          </T>
          <T variant="micro" tone="faint">
            {files.length + 1}
          </T>
        </Pressable>
        {!activeFile ? (
          <Segmented
            small
            value={mode}
            onChange={setMode}
            options={[
              { value: "write", label: "Write" },
              { value: "preview", label: "Preview" },
            ]}
          />
        ) : null}
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => setInfoSheet(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Details" style={{ padding: 4 }}>
          <Icon name="info" size={18} />
        </Pressable>
      </View>

      {/* Body */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {activeFile ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border }}>
              <T variant="micro" mono numberOfLines={1} style={{ flexShrink: 1 }}>
                {activeFile.path}
              </T>
              {dirtyFiles[active] ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.attention }} /> : null}
              <View style={{ flex: 1 }} />
              <T variant="micro" tone="faint">
                {fmtKb(byteLength(activeFile.content))}
              </T>
            </View>
            <TextInput
              key={activeFile.path}
              multiline
              value={activeFile.content}
              onChangeText={(v) => setFiles((fs) => fs.map((f) => (f.path === activeFile.path ? { ...f, content: v } : f)))}
              accessibilityLabel={`Edit ${activeFile.path}`}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textAlignVertical="top"
              style={[inputBase, { minHeight: 360, paddingHorizontal: 16, paddingTop: 12, fontFamily: fonts.mono, fontSize: type.code.fontSize, lineHeight: type.code.lineHeight }]}
            />
          </>
        ) : (
          <>
            {/* Frontmatter */}
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: palette.border }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <T mono tone={name ? "muted" : "faint"} style={{ fontSize: 20, lineHeight: 26 }}>
                  /
                </T>
                <TextInput
                  ref={nameRef}
                  value={name}
                  onChangeText={(v) => setName(slugify(v.replace(/\s+/g, "-")))}
                  editable={mode !== "preview"}
                  placeholder="skill-name"
                  placeholderTextColor={palette.faint}
                  accessibilityLabel="Skill name — the /command in chat"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  autoFocus={!initial && !draft?.name}
                  style={[inputBase, { flex: 1, fontFamily: fonts.mono, fontSize: 20, lineHeight: 26 }]}
                />
              </View>
              <TextInput
                multiline
                value={description}
                onChangeText={setDescription}
                editable={mode !== "preview"}
                placeholder="When should the agent use this? One or two sentences — this is what makes it pick the skill up unprompted."
                placeholderTextColor={palette.faint}
                accessibilityLabel="When the agent should use this skill"
                style={[inputBase, { marginTop: 8, maxHeight: 112, fontFamily: fonts.sans, fontSize: type.body.fontSize, lineHeight: type.body.lineHeight }]}
              />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, minHeight: 16 }}>
                {nameError || description.length > 1024 ? (
                  <T variant="micro" tone="destructive" accessibilityRole="alert" style={{ flex: 1 }}>
                    {nameError ?? "The description is limited to 1,024 characters."}
                  </T>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                <T variant="micro" tone="faint">
                  frontmatter · name, description
                </T>
              </View>
            </View>

            {mode === "write" ? (
              <TextInput
                multiline
                value={content}
                onChangeText={setContent}
                accessibilityLabel="Skill instructions (markdown)"
                placeholder={"Write the steps the agent should follow.\n\n1. Reproduce first — run the exact failing command.\n2. Read the first error, not the last.\n3. Fix the cause, then re-run the whole suite."}
                placeholderTextColor={palette.faint}
                textAlignVertical="top"
                style={[inputBase, { minHeight: 360, paddingHorizontal: 16, paddingTop: 12, fontFamily: fonts.mono, fontSize: type.code.fontSize, lineHeight: type.code.lineHeight }]}
              />
            ) : (
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.border }}>
                  <T variant="micro" tone="muted" style={{ flex: 1 }}>
                    {previewRaw ? "The file the controller writes into the sandbox." : "As the agent reads it."}
                  </T>
                  <Segmented
                    small
                    value={previewRaw ? "raw" : "rendered"}
                    onChange={(v) => setPreviewRaw(v === "raw")}
                    options={[
                      { value: "rendered", label: "Rendered" },
                      { value: "raw", label: "Raw" },
                    ]}
                  />
                </View>
                {previewRaw ? (
                  <T mono variant="code" selectable style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                    {rawMd}
                  </T>
                ) : content.trim() ? (
                  <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 16 }}>
                    <View style={{ backgroundColor: palette.muted, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 10 }}>
                      <T variant="meta" weight="medium" mono>
                        /{trimmedName || "your-skill"}
                      </T>
                      <T variant="meta" tone="muted">
                        {description.trim() || "No description yet."}
                      </T>
                    </View>
                    <MarkdownLite text={content} />
                  </View>
                ) : (
                  <T variant="meta" tone="muted" style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                    Nothing to preview yet — switch to Write and describe the steps.
                  </T>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Footer */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 6, borderTopWidth: 1, borderTopColor: palette.border }}>
        {activeFile ? (
          <T variant="micro" tone="faint" numberOfLines={1} style={{ flex: 1 }}>
            Ships beside SKILL.md — reference it from the instructions as “see {activeFile.path}”.
          </T>
        ) : (
          <>
            <View style={{ flex: 1 }} />
            <T variant="micro" tone={content.length > MAX_CONTENT * 0.9 ? "destructive" : "faint"}>
              {content.length.toLocaleString()} / {MAX_CONTENT.toLocaleString()}
            </T>
          </>
        )}
      </View>
      {err ? (
        <T variant="micro" tone="destructive" accessibilityRole="alert" style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
          {err}
        </T>
      ) : null}

      <Sheet visible={filesSheet} onClose={() => setFilesSheet(false)} title="Files">
        <T variant="meta" tone="muted" style={{ marginBottom: 8 }}>
          Everything this skill ships.
        </T>
        <SkillFileTree
          files={files}
          active={active}
          dirty={dirtyFiles}
          actions={treeActions}
          onSelect={(p) => {
            setActive(p);
            setFilesSheet(false);
          }}
        />
      </Sheet>
      <Sheet visible={infoSheet} onClose={() => setInfoSheet(false)} title="How the agent sees it">
        <SkillInspector name={trimmedName} description={description} content={content} files={files} saved={initial} enabled={initial?.enabled ?? true} onToggle={initial ? (v) => void toggle(v) : undefined} toggling={toggling} />
      </Sheet>
      <Sheet visible={menu} onClose={() => setMenu(false)} title="More actions">
        <View style={{ paddingBottom: 8 }}>
          {menuItems.map((m) => (
            <Pressable
              key={m.label}
              disabled={m.icon === "power" && toggling}
              onPress={() => {
                setMenu(false);
                m.run();
              }}
              accessibilityRole="button"
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, borderTopWidth: m.destructive ? 1 : 0, borderTopColor: palette.border, opacity: pressed ? 0.6 : 1 })}
            >
              <Icon name={m.icon} size={17} color={m.destructive ? palette.destructive : undefined} />
              <T variant="body" tone={m.destructive ? "destructive" : "default"} style={{ flex: 1 }}>
                {m.label}
              </T>
              {m.hint ? (
                <T variant="micro" tone="faint">
                  {m.hint}
                </T>
              ) : null}
            </Pressable>
          ))}
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

/** Where the skill came from: `starter` (seeded by the controller) is marked; your own are quiet. */
export function StarterBadge() {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: palette.muted, borderRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 1 }}>
      <Icon name="star" size={9} />
      <T variant="micro" tone="muted">
        starter
      </T>
    </View>
  );
}
