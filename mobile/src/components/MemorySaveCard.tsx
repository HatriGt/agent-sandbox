import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { api, type MemoryKind, type MemoryNew } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { FadeInUp, PressScale } from "@/components/motion";

/**
 * The operator moment for memory (web: MemoryToast). A run proposes a note → a quiet card with the
 * text, Keep / Forget. Kept notes collapse to one "Remembered · …" line with Undo for 8 s. Nothing
 * here needs the operator, so no amber; ids that were acted on stay dismissed for the screen's life
 * even if the snapshot keeps carrying them.
 */

const KIND_LABEL: Record<MemoryKind, string> = {
  preference: "Preference",
  rule: "Rule",
  domain: "Domain knowledge",
  fact: "Fact",
  decision: "Decision",
  lesson: "Lesson",
  playbook: "Playbook",
};

const UNDO_MS = 8_000;

function label(n: MemoryNew): string {
  if (n.revises !== undefined) return `Updated${n.area ? ` · ${n.area}` : ""}`;
  if (n.kind === "domain") return `Domain knowledge${n.area ? ` · ${n.area}` : ""}`;
  return `${KIND_LABEL[n.kind]} to remember`;
}

export function MemorySaveCard({ memoryNew }: { memoryNew: MemoryNew[] | undefined }) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [kept, setKept] = useState<MemoryNew[]>([]);
  const [busy, setBusy] = useState<{ id: string; how: "keep" | "forget" | "undo" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const undoTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const pending = useMemo(() => {
    const seen = new Set<string>();
    const out: MemoryNew[] = [];
    for (const n of memoryNew ?? []) {
      if (n.status !== "pending" || dismissed.has(n.id) || seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
    }
    return out;
  }, [memoryNew, dismissed]);

  useEffect(() => {
    const timers = undoTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  const dismiss = (id: string) => setDismissed((s) => new Set(s).add(id));

  const keep = async (n: MemoryNew) => {
    setBusy({ id: n.id, how: "keep" });
    setError(null);
    try {
      await api.memoryNoteUpdate({ id: n.id, status: "kept" });
      dismiss(n.id);
      setKept((k) => [...k, n]);
      undoTimers.current.set(
        n.id,
        setTimeout(() => {
          setKept((k) => k.filter((x) => x.id !== n.id));
          undoTimers.current.delete(n.id);
        }, UNDO_MS),
      );
    } catch (e) {
      setError(`Could not keep it — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const forget = async (n: MemoryNew, how: "forget" | "undo") => {
    setBusy({ id: n.id, how });
    setError(null);
    try {
      await api.memoryNoteDelete(n.id);
      dismiss(n.id);
      const t = undoTimers.current.get(n.id);
      if (t) clearTimeout(t);
      undoTimers.current.delete(n.id);
      setKept((k) => k.filter((x) => x.id !== n.id));
    } catch (e) {
      setError(`Could not forget it — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  if (pending.length === 0 && kept.length === 0 && !error) return null;

  return (
    <View style={{ gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
      {error ? (
        <T variant="micro" tone="destructive">
          {error}
        </T>
      ) : null}
      {pending.map((n) => (
        <FadeInUp key={n.id}>
          <PendingRow n={n} busy={busy?.id === n.id ? busy.how : null} onKeep={() => void keep(n)} onForget={() => void forget(n, "forget")} />
        </FadeInUp>
      ))}
      {kept.map((n) => (
        <KeptRow key={`kept-${n.id}`} n={n} busy={busy?.id === n.id} onUndo={() => void forget(n, "undo")} />
      ))}
    </View>
  );
}

function PendingRow({ n, busy, onKeep, onForget }: { n: MemoryNew; busy: "keep" | "forget" | "undo" | null; onKeep: () => void; onForget: () => void }) {
  const { palette } = useTheme();
  const showWhy = !!n.why && !(n.revises && n.why.startsWith("Revises: "));
  return (
    <View
      style={{
        backgroundColor: palette.card,
        borderWidth: 1,
        borderColor: palette.border,
        borderRadius: radius.xl,
        padding: 12,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="book-open" size={13} color={palette.mutedForeground} />
        <T variant="micro" weight="semibold" tone="muted">
          {label(n)}
        </T>
      </View>
      {n.revises ? (
        <T variant="meta" tone="faint" numberOfLines={2} style={{ textDecorationLine: "line-through" }}>
          {n.revises}
        </T>
      ) : null}
      <T variant="body" selectable>
        {n.text}
      </T>
      {showWhy ? (
        <T variant="micro" tone="muted">
          {n.why}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 2 }}>
        <Button title="Forget" variant="ghost" small disabled={busy !== null && busy !== "forget"} loading={busy === "forget"} onPress={onForget} />
        <Button title="Keep" variant="primary" small disabled={busy !== null && busy !== "keep"} loading={busy === "keep"} onPress={onKeep} />
      </View>
    </View>
  );
}

function KeptRow({ n, busy, onUndo }: { n: MemoryNew; busy: boolean; onUndo: () => void }) {
  const { palette } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: radius.lg,
        backgroundColor: palette.secondary,
      }}
    >
      <Icon name="check" size={13} color={palette.ok} />
      <T variant="meta" tone="muted" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
        Remembered · {n.text}
      </T>
      <PressScale disabled={busy} hitSlop={8} onPress={onUndo}>
        <T variant="meta" weight="medium">
          {busy ? "Undoing…" : "Undo"}
        </T>
      </PressScale>
    </View>
  );
}
