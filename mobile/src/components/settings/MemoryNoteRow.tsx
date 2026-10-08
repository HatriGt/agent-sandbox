import React, { useState } from "react";
import { View } from "react-native";
import { animateLayout, FadeIn, PressScale } from "@/components/motion";
import { useRouter } from "expo-router";
import type { MemoryNote } from "@/lib/api";
import { ago, friendlyName, plural } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Chevron } from "@/components/ui/Chevron";
import { KIND_ICON, KIND_LABEL, isOperatorKind } from "./memoryKinds";
import { SelectionFill } from "./Segmented";

export type NotePatch = { text?: string; area?: string; paths?: string; links?: string; repo?: string };

export interface NoteActions {
  onKeep: (n: MemoryNote) => Promise<void>;
  onPin: (n: MemoryNote, pinned: boolean) => Promise<void>;
  onVerify: (n: MemoryNote) => Promise<void>;
  onDelete: (n: MemoryNote) => Promise<void>;
  onSave: (n: MemoryNote, patch: NotePatch) => Promise<void>;
  onPromote: (n: MemoryNote) => Promise<void>;
  onArea: (n: MemoryNote, area: string) => void;
}

/** A playbook's text is a title line plus steps; split it so the steps can fold. */
function splitPlaybook(text: string): { title: string; steps: string[] } {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return { title: lines[0] ?? text, steps: lines.slice(1) };
}

/**
 * One memory note (web: Memory.tsx › NoteRow). Kind glyph + label, the statement (a playbook folds
 * its steps), why, provenance line, unverified line with "Still true", earlier versions, Keep /
 * Forget while pending, and the row actions: Promote (playbooks), Pin, Edit, Forget.
 */
export function MemoryNoteRow({ note: n, actions, showRepo, inArea, dim }: { note: MemoryNote; actions: NoteActions; showRepo?: boolean; inArea?: boolean; dim?: boolean }) {
  const { palette } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState(n.text);
  const [dRepo, setDRepo] = useState(n.repo ?? "");
  const [dArea, setDArea] = useState(n.area ?? "");
  const [dPaths, setDPaths] = useState((n.paths ?? []).join(", "));
  const [dLinks, setDLinks] = useState((n.links ?? []).join(", "));
  const pending = n.status === "pending";
  const playbook = n.kind === "playbook";
  const kb = !isOperatorKind(n.kind);
  const uses = n.uses ?? 0;
  const proven = playbook && uses >= 2;
  const history = n.history ?? [];

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const startEdit = () => {
    setDraft(n.text);
    setDRepo(n.repo ?? "");
    setDArea(n.area ?? "");
    setDPaths((n.paths ?? []).join(", "));
    setDLinks((n.links ?? []).join(", "));
    animateLayout();
    setEditing(true);
  };
  const save = () =>
    run("save", async () => {
      const t = draft.trim();
      if (!t) {
        animateLayout();
        return setEditing(false);
      }
      const patch: NotePatch = {};
      if (t !== n.text) patch.text = t;
      if (kb) {
        if (dRepo.trim().toLowerCase() !== (n.repo ?? "")) patch.repo = dRepo.trim();
        if (dArea.trim() !== (n.area ?? "")) patch.area = dArea.trim();
        if (dPaths.trim() !== (n.paths ?? []).join(", ")) patch.paths = dPaths.trim();
        if (dLinks.trim() !== (n.links ?? []).join(", ")) patch.links = dLinks.trim();
      }
      if (Object.keys(patch).length) await actions.onSave(n, patch);
      animateLayout();
      setEditing(false);
    });

  const openBox = (box: string) => router.push({ pathname: "/box/[name]", params: { name: box } });
  const source = (src: string) =>
    src && src !== "operator" && src !== "you" ? (
      <T variant="micro" tone="faint" onPress={() => openBox(src)} style={{ textDecorationLine: "underline" }}>
        {`from ${friendlyName(src)}`}
      </T>
    ) : (
      "added by you"
    );
  const { title, steps } = playbook ? splitPlaybook(n.text) : { title: n.text, steps: [] as string[] };

  return (
    <View
      style={{
        gap: 6,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: palette.border,
        opacity: dim ? 0.6 : 1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={KIND_ICON[n.kind]} size={13} color={palette.mutedForeground} />
        <T variant="micro" weight="medium" tone="muted">
          {KIND_LABEL[n.kind]}
        </T>
        <View style={{ flex: 1 }} />
        {!editing ? (
          <>
            <PressScale
              scaleTo={0.9}
              haptic="selection"
              onPress={() => void run("pin", () => actions.onPin(n, !n.pinned))}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={n.pinned ? "Unpin note" : "Pin note (never evicted)"}
              accessibilityState={{ selected: !!n.pinned }}
              disabled={busy !== null}
              style={{ padding: 4 }}
            >
              <Icon name="bookmark" size={15} color={n.pinned ? palette.foreground : palette.faint} />
            </PressScale>
            <PressScale scaleTo={0.9} onPress={startEdit} hitSlop={10} accessibilityRole="button" accessibilityLabel="Edit note" style={{ padding: 4 }}>
              <Icon name="edit-2" size={15} color={palette.faint} />
            </PressScale>
          </>
        ) : null}
      </View>

      {editing ? (
        <View style={{ gap: 8 }}>
          <Field
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={playbook ? 1200 : n.kind === "domain" ? 600 : 400}
            accessibilityLabel="Note text"
            style={{ minHeight: playbook ? 120 : 64, textAlignVertical: "top" }}
          />
          {kb ? (
            <>
              <Field value={dRepo} onChangeText={setDRepo} placeholder="repo · owner/name" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Repo this note belongs to" />
              <Field value={dArea} onChangeText={setDArea} placeholder="area · billing/invoicing" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Area" />
              <Field mono value={dPaths} onChangeText={setDPaths} placeholder="code paths, comma-separated" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Code paths" />
              <Field value={dLinks} onChangeText={setDLinks} placeholder="related areas, comma-separated" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Related areas" />
            </>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button small title="Save" loading={busy === "save"} onPress={() => void save()} />
            <Button small variant="ghost" title="Cancel" onPress={() => (setDraft(n.text), animateLayout(), setEditing(false))} />
          </View>
        </View>
      ) : (
        <>
          <T variant="body" weight={playbook ? "medium" : undefined}>
            {title}
          </T>
          {steps.length ? (
            <>
              <PressScale
                onPress={() => {
                  animateLayout();
                  setStepsOpen((v) => !v);
                }}
                accessibilityRole="button"
                accessibilityState={{ expanded: stepsOpen }}
                style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
              >
                <Chevron open={stepsOpen} size={13} color={palette.mutedForeground} />
                <T variant="meta" tone="muted">
                  {plural(steps.length, "step")}
                </T>
              </PressScale>
              {stepsOpen
                ? steps.map((st, i) => (
                    <T key={i} variant="meta" tone="muted" style={{ paddingLeft: 16 }}>
                      {`${i + 1}. ${st.replace(/^(\d+[.)]|[-*•])\s+/, "")}`}
                    </T>
                  ))
                : null}
            </>
          ) : null}
          {n.why ? (
            <T variant="meta" tone="muted">
              {n.why}
            </T>
          ) : null}
          <T variant="micro" tone="faint">
            {source(n.source)}
            {` · ${ago(n.at)}`}
            {showRepo ? ` · ${n.repo ?? (isOperatorKind(n.kind) ? "about you" : "any repo")}` : ""}
            {n.area && !inArea ? (
              <>
                {" · "}
                <T variant="micro" tone="faint" onPress={() => actions.onArea(n, n.area!)} style={{ textDecorationLine: "underline" }}>
                  {n.area}
                </T>
              </>
            ) : null}
            {n.pinned ? " · pinned" : ""}
            {playbook && uses > 0 ? ` · used ${uses}×` : ""}
            {n.paths?.length ? ` · ${n.paths.slice(0, 2).join(", ")}${n.paths.length > 2 ? ` +${n.paths.length - 2}` : ""}` : ""}
          </T>
          {n.stale ? (
            <View style={{ gap: 6 }}>
              <T variant="micro" tone="muted">
                {`Unverified since ${ago(n.stale.at)} — ${n.stale.paths.slice(0, 2).join(", ")} changed in `}
                <T variant="micro" tone="muted" onPress={() => openBox(n.stale!.box)} style={{ textDecorationLine: "underline" }}>
                  {friendlyName(n.stale.box)}
                </T>
                . The next run in this area will confirm or replace it.
              </T>
              <View style={{ flexDirection: "row" }}>
                <Button small variant="outline" title="Still true" loading={busy === "verify"} onPress={() => void run("verify", () => actions.onVerify(n))} />
              </View>
            </View>
          ) : null}
          {history.length ? (
            <>
              <PressScale
                onPress={() => {
                  animateLayout();
                  setHistoryOpen((v) => !v);
                }}
                accessibilityRole="button"
                accessibilityState={{ expanded: historyOpen }}
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Chevron open={historyOpen} size={12} color={palette.faint} />
                <Icon name="clock" size={12} color={palette.faint} />
                <T variant="micro" tone="faint">
                  {plural(history.length, "earlier version")}
                </T>
              </PressScale>
              {historyOpen ? (
                <View style={{ marginLeft: 6, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: palette.border, gap: 6 }}>
                  {history.map((v) => (
                    <View key={v.id}>
                      <T variant="meta" tone="muted">
                        {v.text.split("\n")[0]}
                      </T>
                      <T variant="micro" tone="faint">
                        {source(v.source)}
                        {` · ${ago(v.at)}`}
                        {v.until != null ? ` · replaced ${ago(v.until)}` : ""}
                      </T>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 2, alignItems: "center", flexWrap: "wrap" }}>
            {pending ? <Button small title="Keep" loading={busy === "keep"} onPress={() => void run("keep", () => actions.onKeep(n))} /> : null}
            {pending ? <Button small variant="ghost" title="Forget" loading={busy === "del"} onPress={() => void run("del", () => actions.onDelete(n))} /> : null}
            {playbook ? (
              <Button
                small
                variant={proven ? "outline" : "ghost"}
                title={proven ? `Promote · used ${uses}×` : "Promote to skill"}
                loading={busy === "promote"}
                onPress={() => void run("promote", () => actions.onPromote(n))}
              />
            ) : null}
            <View style={{ flex: 1 }} />
            {!pending ? <ArmButton small variant="ghost" title="Forget" armedTitle="Tap to forget" onConfirm={() => run("del", () => actions.onDelete(n))} /> : null}
          </View>
        </>
      )}
      {err ? (
        <FadeIn>
          <T variant="micro" tone="destructive">
            {err}
          </T>
        </FadeIn>
      ) : null}
    </View>
  );
}

/** A note a newer one replaced (web: Memory.tsx › Earlier row): struck through, who replaced it, Forget. */
export function EarlierNoteRow({ note: n, replacedBy, onDelete }: { note: MemoryNote; replacedBy?: MemoryNote; onDelete: () => Promise<void> }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border, alignItems: "flex-start" }}>
      <View style={{ paddingTop: 2 }}>
        <Icon name={KIND_ICON[n.kind]} size={13} color={palette.faint} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="meta" tone="muted" style={{ textDecorationLine: "line-through" }}>
          {n.text.split("\n")[0]}
        </T>
        <T variant="micro" tone="faint">
          {replacedBy ? `replaced by “${replacedBy.text.split("\n")[0]}”` : "replaced"}
          {n.until != null ? ` · ${ago(n.until)}` : ""}
          {n.repo ? ` · ${n.repo}` : ""}
        </T>
      </View>
      <ArmButton small variant="ghost" title="Forget" armedTitle="Tap to forget" onConfirm={onDelete} />
    </View>
  );
}

/** Pill used for kind filters, the section rail and area chips. */
export function MemoryChip({ label, count, active, onPress }: { label: string; count?: string | number; active?: boolean; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <PressScale
      onPress={onPress}
      haptic="selection"
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active ? palette.lineStrong : palette.border,
        overflow: "hidden",
      }}
    >
      <SelectionFill on={!!active} color={palette.accent} />
      <T variant="micro" weight={active ? "semibold" : "regular"} tone={active ? "default" : "muted"}>
        {label}
      </T>
      {count !== undefined ? (
        <T variant="micro" tone="faint">
          {String(count)}
        </T>
      ) : null}
    </PressScale>
  );
}
