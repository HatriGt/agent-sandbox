import React, { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { api, type RunOutcome } from "@/lib/api";
import { friendlyName } from "@/lib/format";
import { shortDuration } from "@/lib/planTasks";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Icon } from "./ui/Icon";
import { FadeInUp } from "./ui/Motion";

/**
 * The outcome card (docs/plan-demo-parity.md bet 2), mobile twin of
 * web/src/components/thread/OutcomeCard.tsx: what did I get, can I trust it, what did it cost, and
 * why it started. Only recorded facts; unknown is "—". Green passes, red fails, everything else
 * neutral — amber stays reserved for "needs you".
 */
const DASH = "—";
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
const fmtUsd = (n: number) => (n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

function testsLine(o: RunOutcome): { text: string; tone: "ok" | "destructive" | "default" } {
  const t = o.trust.tests;
  if (t) {
    const total = t.passed + t.failed;
    return { text: t.failed ? `${t.failed} of ${total} tests failed` : `${t.passed}/${total} tests passed`, tone: t.failed ? "destructive" : "ok" };
  }
  if (o.trust.exitCode === null) return { text: `tests ${DASH}`, tone: "default" };
  return { text: `exit ${o.trust.exitCode}`, tone: o.trust.exitCode === 0 ? "default" : "destructive" };
}

/** One line for list rows: only the facts that exist. */
export function outcomeFacts(o: RunOutcome): string {
  const out: string[] = [];
  const pr = o.result.prs[0];
  if (pr) out.push(`PR #${pr.number}`);
  if (o.result.diff?.files) out.push(`+${o.result.diff.additions} −${o.result.diff.deletions}`);
  if (o.trust.tests) out.push(testsLine(o).text);
  if (o.trust.questions) out.push(`asked ${plural(o.trust.questions, "question")}`);
  if (o.cost.usd !== null) out.push(fmtUsd(o.cost.usd));
  else if (o.cost.tokens) out.push(`${fmtTokens(o.cost.tokens.input + o.cost.tokens.output)} tokens`);
  return out.join(" · ");
}

/** Fetches the latest archived outcome for a live box's finished run; nothing until it exists. */
export function OutcomeCard({ session, fetchKey }: { session: string; fetchKey: string }) {
  const [o, setO] = useState<RunOutcome | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setO(null);
    const load = (left: number) =>
      api
        .outcome({ box: session })
        .then((r) => {
          if (!cancelled) setO(r.outcome);
        })
        .catch(() => {
          // The archive lands just after the finish edge; retry a few times, then stay absent.
          if (!cancelled && left > 0) timer = setTimeout(() => load(left - 1), 4000);
        });
    load(3);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [session, fetchKey]);
  if (!o) return null;
  return <OutcomeView outcome={o} />;
}

export function OutcomeView({ outcome: o }: { outcome: RunOutcome }) {
  const { palette } = useTheme();
  const router = useRouter();
  const failed = o.state === "failed";
  const tests = testsLine(o);
  const b = o.cost.budget;
  const tokens = o.cost.tokens ? o.cost.tokens.input + o.cost.tokens.output : null;
  const openBox = (box: string) => router.push({ pathname: "/box/[name]", params: { name: box } });
  const openLink = (l: { href: string; external: boolean }) => {
    if (l.external) void Linking.openURL(l.href);
    else {
      const m = l.href.match(/\/dashboard\/box\/([^/?#]+)/);
      if (m) openBox(decodeURIComponent(m[1]));
    }
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={{ gap: 3 }}>
      <T variant="micro" tone="faint" weight="semibold">
        {title}
      </T>
      {children}
    </View>
  );

  return (
    <FadeInUp>
      <View
        accessibilityLabel="Run outcome"
        style={{ backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, marginBottom: 10, padding: 12, gap: 10 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name={failed ? "x-circle" : "check-circle"} size={14} color={failed ? palette.destructive : palette.ok} />
          <T variant="meta" weight="semibold" tone={failed ? "destructive" : "ok"}>
            Outcome
          </T>
          <T variant="micro" tone="muted" numberOfLines={1} style={{ flex: 1, minWidth: 0 }} onPress={o.header.link ? () => openLink(o.header.link!) : undefined}>
            {o.header.label ? `started by ${o.header.label}${o.header.link?.external ? " ↗" : ""}` : `started by ${DASH}`}
          </T>
        </View>

        <Section title="What you got">
          {o.result.prs.length ? (
            o.result.prs.map((p) => (
              <Pressable key={p.url} onPress={() => void Linking.openURL(p.url)} accessibilityRole="link" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon name="git-pull-request" size={12} color={palette.foreground} />
                <T variant="meta" numberOfLines={1}>
                  {p.repo}#{p.number}
                </T>
              </Pressable>
            ))
          ) : (
            <T variant="meta" tone="muted">
              no pull request
            </T>
          )}
          <T variant="micro" mono tone="muted">
            {o.result.diff ? (o.result.diff.files ? `${plural(o.result.diff.files, "file")} · +${o.result.diff.additions} −${o.result.diff.deletions}` : "no file changes") : `diff ${DASH}`}
          </T>
          {o.result.followedBy ? (
            <T variant="micro" tone="muted" onPress={() => openBox(o.result.followedBy!.box)}>
              followed by {friendlyName(o.result.followedBy.box)} ›
            </T>
          ) : null}
          {(o.result.followups ?? []).map((f) => (
            <T key={f.box} variant="micro" tone="muted" onPress={() => openBox(f.box)}>
              {f.line ?? f.subject} ›
            </T>
          ))}
        </Section>

        <Section title="Can you trust it">
          <T variant="meta" tone={tests.tone}>
            {tests.text}
            {o.trust.tests ? ` · ${o.trust.tests.runner}` : ""}
          </T>
          {o.trust.testedWith ? (
            <T variant="micro" tone="muted" numberOfLines={1}>
              Tested with <T variant="micro" mono>{o.trust.testedWith}</T>
            </T>
          ) : null}
          {o.trust.verified ? (
            <T variant="micro" tone={o.trust.verified.pass ? "ok" : "destructive"}>
              {o.trust.verified.pass ? "✓ verified" : "UNVERIFIED"}
            </T>
          ) : null}
          {o.trust.prOnly ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon name="shield" size={12} color={palette.mutedForeground} />
              <T variant="micro" tone="muted">
                PR-only
              </T>
            </View>
          ) : null}
          <T variant="micro" tone="muted">
            {o.trust.questions ? `you were asked ${plural(o.trust.questions, "question")}` : "no questions asked"}
            {o.trust.openQuestions ? ` · ${o.trust.openQuestions} unanswered` : ""}
          </T>
        </Section>

        <Section title="What it cost">
          <T variant="micro" mono>
            {o.cost.durationMs !== null ? shortDuration(o.cost.durationMs) : DASH}
            {b ? ` of ${b.maxMinutes}m` : ""}
            {"  ·  "}
            {tokens !== null ? `${fmtTokens(tokens)} tokens` : `tokens ${DASH}`}
            {b?.maxTokens ? ` of ${fmtTokens(b.maxTokens)}` : ""}
            {"  ·  "}
            {o.cost.usd !== null ? fmtUsd(o.cost.usd) : `$ ${DASH}`}
            {b?.maxUsd ? ` of ${fmtUsd(b.maxUsd)}` : ""}
          </T>
          {b && b.tripped.length ? (
            <T variant="micro" tone="muted">
              budget reached: {b.tripped.join(", ")}
            </T>
          ) : null}
        </Section>
      </View>
    </FadeInUp>
  );
}
