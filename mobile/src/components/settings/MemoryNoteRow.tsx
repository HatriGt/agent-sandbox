import React, { useState } from "react";
import { Pressable, View } from "react-native";
import type { MemoryNote } from "@/lib/api";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { KIND_ICON, KIND_INK, KIND_LABEL } from "./memoryKinds";

export interface NoteActions {
  onKeep: (n: MemoryNote) => Promise<void>;
  onPin: (n: MemoryNote, pinned: boolean) => Promise<void>;
  onVerify: (n: MemoryNote) => Promise<void>;
  onDelete: (n: MemoryNote) => Promise<void>;
  onPromote?: (n: MemoryNote) => Promise<void>;
}

/**
 * One memory note: kind glyph + label, the text, a dim "why" line, and badges for pending (needs
 * you: hairline + one filled Keep) and stale ("code moved — verify"). Long-press or ⋯ opens the
 * destructive row (Delete arms, Make a skill for playbooks).
 */
export function MemoryNoteRow({ note: n, actions }: { note: MemoryNote; actions: NoteActions }) {
  const { palette } = useTheme();
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pending = n.status === "pending";
  const ink = palette.foreground;

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

  return (
    <Pressable
      onLongPress={() => setMore((m) => !m)}
      delayLongPress={350}
      style={({ pressed }) => ({
        gap: 6,
        paddingVertical: 12,
        paddingHorizontal: pending ? 12 : 0,
        marginHorizontal: pending ? -12 : 0,
        borderRadius: pending ? radius.lg : 0,
        borderWidth: pending ? 1 : 0,
        borderColor: palette.lineStrong,
        borderBottomWidth: 1,
        borderBottomColor: pending ? palette.lineStrong : palette.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ opacity: KIND_INK[n.kind] }}>
          <Icon name={KIND_ICON[n.kind]} size={13} color={ink} />
        </View>
        <T variant="micro" weight="medium" style={{ opacity: Math.max(0.55, KIND_INK[n.kind]) }}>
          {KIND_LABEL[n.kind]}
        </T>
        {n.area ? (
          <T variant="micro" tone="faint" numberOfLines={1}>
            · {n.area}
          </T>
        ) : null}
        <View style={{ flex: 1 }} />
        {pending ? (
          <T variant="micro" weight="semibold">
            waiting for you
          </T>
        ) : null}
        {n.stale && !pending ? (
          <T variant="micro" tone="muted">
            code moved — verify
          </T>
        ) : null}
        <Pressable
          onPress={() => void run("pin", () => actions.onPin(n, !n.pinned))}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={n.pinned ? "Unpin" : "Pin"}
          disabled={busy !== null}
        >
          <Icon name="bookmark" size={14} color={n.pinned ? ink : palette.faint} />
        </Pressable>
        <Pressable onPress={() => setMore((m) => !m)} hitSlop={10} accessibilityRole="button" accessibilityLabel="More">
          <Icon name="more-horizontal" size={16} color={palette.faint} />
        </Pressable>
      </View>
      <T variant="body">{n.text}</T>
      {n.why ? (
        <T variant="micro" tone="faint">
          {n.why}
        </T>
      ) : null}
      <T variant="micro" tone="faint">
        {ago(n.at)}
        {n.uses ? ` · used ${n.uses}×` : ""}
        {n.paths?.length ? ` · ${n.paths.slice(0, 2).join(", ")}${n.paths.length > 2 ? ` +${n.paths.length - 2}` : ""}` : ""}
      </T>
      {pending || n.stale ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
          {pending ? <Button small title="Keep" loading={busy === "keep"} onPress={() => void run("keep", () => actions.onKeep(n))} /> : null}
          {pending ? <Button small variant="ghost" title="Forget" loading={busy === "del"} onPress={() => void run("del", () => actions.onDelete(n))} /> : null}
          {n.stale && !pending ? (
            <Button small variant="secondary" title="Still true" loading={busy === "verify"} onPress={() => void run("verify", () => actions.onVerify(n))} />
          ) : null}
        </View>
      ) : null}
      {more ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
          {actions.onPromote && n.kind === "playbook" ? (
            <Button small variant="secondary" title="Make a skill" loading={busy === "promote"} onPress={() => void run("promote", () => actions.onPromote!(n))} />
          ) : null}
          <View style={{ flex: 1 }} />
          <ArmButton small title="Delete" armedTitle="Tap again to delete" onConfirm={() => run("del", () => actions.onDelete(n))} />
        </View>
      ) : null}
      {err ? (
        <T variant="micro" tone="destructive">
          {err}
        </T>
      ) : null}
    </Pressable>
  );
}
