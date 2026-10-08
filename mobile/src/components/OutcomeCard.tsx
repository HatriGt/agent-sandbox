import React, { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { api, type RunOutcome } from "@/lib/api";
import { friendlyName } from "@/lib/format";
import { shortDuration } from "@/lib/planTasks";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Icon, type IconName } from "./ui/Icon";
import { FadeInUp, PressScale, stagger } from "@/components/motion";

/**
 * The outcome card (docs/plan-demo-parity.md bet 2), mobile twin of
 * web/src/components/thread/OutcomeCard.tsx: what did I get, can I trust it, what did it cost, and
 * why it started. Only recorded facts; unknown is "—". Green passes, red fails, everything else
 * neutral — amber stays reserved for "needs you".
 */
const DASH = "—";
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
export const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
export const fmtUsd = (n: number) => (n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

type ChipTone = "ok" | "destructive" | "default";
/**
 * The collapsed facts as chips (web RunPill summary / OutcomeCard chips): PR · files ± · tests or
 * verified · duration · tokens · cost. Only facts that exist; "no changes" when the diff is empty.
 */
export function outcomeChips(o: RunOutcome): { text: string; tone: ChipTone; icon?: IconName }[] {
  const out: { text: string; tone: ChipTone; icon?: IconName }[] = [];
  const prs = o.result.prs;
  if (prs[0]) out.push({ text: `PR #${prs[0].number}${prs.length > 1 ? ` +${prs.length - 1}` : ""}`, tone: "default", icon: "git-pull-request" });
  const d = o.result.diff;
  if (d && d.files) out.push({ text: `${plural(d.files, "file")} +${d.additions} −${d.deletions}`, tone: "default", icon: "file-plus" });
  const t = o.trust.tests;
  if (t) out.push({ text: t.failed ? `tests ${t.passed}/${t.passed + t.failed} ✕` : `tests ${t.passed}/${t.passed} ✓`, tone: t.failed ? "destructive" : "ok" });
  else if (o.trust.verified) out.push({ text: o.trust.verified.pass ? "verified ✓" : "unverified", tone: o.trust.verified.pass ? "ok" : "destructive" });
  if (!prs.length && d && !d.files) out.push({ text: "no changes", tone: "default" });
  if (o.cost.durationMs) out.push({ text: shortDuration(o.cost.durationMs), tone: "default", icon: "clock" });
  if (o.cost.tokens) out.push({ text: `${fmtTokens(o.cost.tokens.input + o.cost.tokens.output)} tokens`, tone: "default" });
  if (o.cost.usd !== null) out.push({ text: fmtUsd(o.cost.usd), tone: "default" });
  return out;
}

function Chip({ text, tone, icon }: { text: string; tone: ChipTone; icon?: IconName }) {
  const { palette } = useTheme();
  const color = tone === "ok" ? palette.ok : tone === "destructive" ? palette.destructive : palette.mutedForeground;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: palette.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
      {icon ? <Icon name={icon} size={10} color={color} /> : null}
      <T variant="micro" mono style={{ color }}>
        {text}
      </T>
    </View>
  );
}

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

/**
 * The latest archived outcome for a live box's finished run; null until it exists. The archive
 * lands just after the finish edge, so a miss retries a few times, then stays absent.
 */
export function useOutcome(session: string, fetchKey: string, enabled: boolean): RunOutcome | null {
  const [o, setO] = useState<RunOutcome | null>(null);
  useEffect(() => {
    setO(null);
    if (!enabled || !session) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (left: number) =>
      api
        .outcome({ box: session })
        .then((r) => {
          if (!cancelled) setO(r.outcome);
        })
        .catch(() => {
          if (!cancelled && left > 0) timer = setTimeout(() => load(left - 1), 4000);
        });
    load(3);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session, fetchKey, enabled]);
  return o;
}

/** An outcome section; hoisted so a re-render keeps its identity (an inline component would remount and replay the entrance). */
function Section({ title, index, children }: { title: string; index: number; children: React.ReactNode }) {
  return (
    <FadeInUp delay={stagger(index, 60)} style={{ gap: 3 }}>
      <T variant="micro" tone="faint" weight="semibold">
        {title}
      </T>
      {children}
    </FadeInUp>
  );
}

export function OutcomeView({ outcome: o }: { outcome: RunOutcome }) {
  const { palette } = useTheme();
  const router = useRouter();
  const failed = o.state === "failed";
  const tests = testsLine(o);
  const chips = outcomeChips(o);
  const openBox = (box: string) => router.push({ pathname: "/box/[name]", params: { name: box } });
  const openLink = (l: { href: string; external: boolean }) => {
    if (l.external) void Linking.openURL(l.href);
    else {
      const m = l.href.match(/\/dashboard\/box\/([^/?#]+)/);
      if (m) openBox(decodeURIComponent(m[1]));
    }
  };

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
        {chips.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
            {chips.map((c) => (
              <Chip key={c.text} {...c} />
            ))}
          </View>
        ) : null}

        <Section title="What you got" index={1}>
          {o.result.prs.length ? (
            o.result.prs.map((p) => (
              <PressScale key={p.url} onPress={() => void Linking.openURL(p.url)} accessibilityRole="link" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon name="git-pull-request" size={12} color={palette.foreground} />
                <T variant="meta" numberOfLines={1}>
                  {p.repo}#{p.number}
                </T>
              </PressScale>
            ))
          ) : (
            <T variant="meta" tone="muted">
              no pull request
            </T>
          )}
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

        <Section title="Can you trust it" index={2}>
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
      </View>
    </FadeInUp>
  );
}
