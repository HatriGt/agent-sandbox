import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { api, type AttemptGroupView, type AttemptView } from "@/lib/api";
import { shortDuration } from "@/lib/planTasks";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Icon } from "./ui/Icon";
import { FadeInUp } from "./ui/Motion";

/**
 * "Tries several approaches": a task run as 2-3 parallel attempts, scored by the controller; the
 * winner gets the PR. Shows the group, the winner, lets you override the pick or answer a tie.
 */
const DASH = "—";
const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
const fmtUsd = (n: number) => (n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

const STATUS: Record<AttemptGroupView["status"], string> = {
  running: "attempts running",
  deciding: "scoring attempts…",
  "needs-pick": "tie — pick one",
  decided: "winner picked",
  "no-winner": "no attempt succeeded",
  failed: "failed",
};

// src/attempts.ts AttemptFacts.state: only a recorded finish has a branch to open a PR from.
const FINISHED = new Set(["done", "failed"]);

function factsLine(a: AttemptView): string {
  const f = a.facts;
  if (!f) return a.error ?? DASH;
  const out: string[] = [];
  if (f.tests) out.push(f.tests.failed ? `${f.tests.failed} failed` : `${f.tests.passed} passed`);
  else if (f.exitCode !== null) out.push(`exit ${f.exitCode}`);
  if (f.verified !== null) out.push(f.verified ? "✓ verified" : "unverified");
  if (f.diffLines !== null) out.push(`${f.diffLines} lines`);
  if (f.costUsd !== null) out.push(fmtUsd(f.costUsd));
  else if (f.tokens !== null) out.push(`${fmtTokens(f.tokens)} tok`);
  if (f.durationMs !== null) out.push(shortDuration(f.durationMs));
  return out.join(" · ") || f.state;
}

/** Fetches the attempt group a box belongs to; renders nothing when it isn't part of one. */
export function AttemptGroupCard({ box, fetchKey }: { box: string; fetchKey?: string }) {
  const [g, setG] = useState<AttemptGroupView | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .attemptGroupOfBox(box)
      .then((r) => !cancelled && setG(r.group))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [box, fetchKey]);
  // Keep polling while undecided so the winner appears without a refresh.
  useEffect(() => {
    if (!g || !["running", "deciding"].includes(g.status)) return;
    const t = setInterval(() => {
      api.attemptGroup(g.id).then(setG).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [g?.id, g?.status]);
  if (!g) return null;
  return <AttemptGroupPanel group={g} currentBox={box} onChange={setG} />;
}

export function AttemptGroupPanel({ group: g, currentBox, onChange }: { group: AttemptGroupView; currentBox?: string; onChange: (g: AttemptGroupView) => void }) {
  const { palette } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (pick: { box: string } | { choice: number }) => {
      setBusy(true);
      try {
        onChange(await api.attemptPick(g.id, pick));
      } catch (e) {
        Alert.alert("Couldn't pick", e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [g.id, onChange],
  );

  const overrideOpen = (g.status === "decided" || g.status === "no-winner") && (g.overrideUntil === null || g.overrideUntil > Date.now());
  const confirmPick = (a: AttemptView) =>
    Alert.alert("Pick this one instead?", `${a.label} will get the PR instead of the current winner.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Pick", onPress: () => void submit({ box: a.box! }) },
    ]);
  const needsPick = g.status === "needs-pick";
  const bad = g.status === "failed" || g.status === "no-winner";

  return (
    <FadeInUp>
      <View
        accessibilityLabel="Attempts"
        style={{
          backgroundColor: palette.card,
          borderWidth: 1,
          borderColor: needsPick ? palette.attention : palette.border,
          borderRadius: radius.xl,
          marginBottom: 10,
          padding: 12,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="git-branch" size={14} color={needsPick ? palette.attention : bad ? palette.destructive : palette.foreground} />
          <T variant="meta" weight="semibold">
            {g.attempts.length} attempts
          </T>
          <T variant="micro" tone={needsPick ? "attention" : bad ? "destructive" : g.status === "decided" ? "ok" : "muted"} numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
            {STATUS[g.status]}
            {g.status === "decided" && g.decidedBy ? ` (${g.decidedBy === "user" ? "by you" : "auto"})` : ""}
          </T>
        </View>

        {g.attempts.map((a) => {
          const open = a.box && a.box !== currentBox ? () => router.push({ pathname: "/box/[name]", params: { name: a.box! } }) : undefined;
          const canPick = overrideOpen && !a.winner && !a.tornDown && !!a.box && !!a.facts && FINISHED.has(a.facts.state);
          return (
            <View
              key={a.index}
              style={{
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: a.winner ? palette.ok : palette.border,
                padding: 8,
                gap: 4,
                opacity: a.tornDown && !a.winner ? 0.6 : 1,
              }}
            >
              <Pressable onPress={open} disabled={!open} accessibilityRole={open ? "link" : undefined} style={{ gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  {a.winner ? <Icon name="award" size={12} color={palette.ok} /> : null}
                  <T variant="meta" weight={a.winner ? "semibold" : "regular"} tone={a.winner ? "ok" : "default"} numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                    {a.label}
                    {a.box === currentBox ? " (this thread)" : ""}
                  </T>
                  {open ? <Icon name="chevron-right" size={12} color={palette.mutedForeground} /> : null}
                </View>
                <T variant="micro" mono tone={a.error ? "destructive" : "muted"} numberOfLines={2}>
                  {factsLine(a)}
                </T>
              </Pressable>
              {canPick ? (
                <T variant="micro" tone="muted" weight="semibold" onPress={busy ? undefined : () => confirmPick(a)}>
                  Pick this one instead ›
                </T>
              ) : null}
            </View>
          );
        })}

        {needsPick ? (
          <View style={{ gap: 6 }}>
            {g.question ? <T variant="meta">{g.question}</T> : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {g.choices.map((c, i) => (
                <Pressable
                  key={i}
                  disabled={busy}
                  onPress={() => void submit({ choice: i })}
                  style={{ borderWidth: 1, borderColor: palette.attention, borderRadius: radius.lg, paddingHorizontal: 10, paddingVertical: 6, opacity: busy ? 0.5 : 1 }}
                >
                  <T variant="meta" tone="attention">
                    {c.label}
                  </T>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {g.prUrls.map((u) => (
          <Pressable key={u} onPress={() => void Linking.openURL(u)} accessibilityRole="link" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="git-pull-request" size={12} color={palette.foreground} />
            <T variant="meta" numberOfLines={1}>
              {u.replace(/^https?:\/\/github\.com\//, "")}
            </T>
          </Pressable>
        ))}
        {g.note ? (
          <T variant="micro" tone="muted">
            {g.note}
          </T>
        ) : null}
      </View>
    </FadeInUp>
  );
}
