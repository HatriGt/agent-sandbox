import React, { useMemo } from "react";
import { View } from "react-native";
import { useNow } from "@/hooks/useNow";
import type { BoxView, FleetLifecycle, RunOutcome } from "@/lib/api";
import { ago, friendlyName, isSleeping } from "@/lib/format";
import { deadlineLabel, deadlineOf, fmtClock, fmtDuration, parseUptimeSec } from "@/lib/lifecycle";
import type { TraceEvent } from "@/lib/trace";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { latestUsage } from "../TranscriptView";
import { fmtTokens, fmtUsd } from "../OutcomeCard";
import { T } from "../ui/AppText";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { UsageMeter } from "../ui/UsageMeter";
import { SettingsSection } from "@/components/ui/SettingsSection";

/**
 * The run inspector (web RunInspector, Run tab) as a bottom sheet: the facts that are true of this
 * run but do not belong in the conversation — timing, tokens, agent/model, playbook, repos, machine.
 */

const AGENT_LABEL: Record<string, string> = { omp: "oh-my-pi", codex: "Codex CLI", opencode: "OpenCode", claude: "Claude Code" };


function Row({ label, value, tone, mono }: { label: string; value: React.ReactNode; tone?: "default" | "live" | "attention" | "destructive" | "ok" | "muted"; mono?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
      <T variant="meta" tone="muted" style={{ width: 92, flexShrink: 0 }}>
        {label}
      </T>
      <T variant="meta" mono={mono} tone={tone} numberOfLines={2} style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
        {value}
      </T>
    </View>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <T variant="micro" tone="faint">
      {children}
    </T>
  );
}

/** The run's model, from the formatter's "session started (model X)" marker — observed, not assumed. */
function runModelOf(events: TraceEvent[]): string | null {
  for (const e of events) {
    if (e.kind === "lifecycle" && e.detail) {
      const m = e.detail.match(/^model\s+(\S+)/);
      if (m) return m[1];
    }
  }
  return null;
}

export function RunInspectorSheet({
  visible,
  onClose,
  session,
  box,
  lifecycle,
  events,
  running,
  startedAt,
  endedAt,
  outcome,
  queued,
}: {
  visible: boolean;
  onClose: () => void;
  session: string;
  box: (Partial<BoxView> & Pick<BoxView, "runState" | "boxStatus">) | null;
  lifecycle: FleetLifecycle | undefined;
  events: TraceEvent[];
  running: boolean;
  startedAt?: number;
  endedAt?: number;
  /** The archived outcome once the run finished — started-by, cost, model. */
  outcome: RunOutcome | null;
  queued: string[];
}) {
  const { palette } = useTheme();
  const now = useNow(1000, visible && running);
  const elapsedMs = startedAt !== undefined ? Math.max(0, (running ? now : (endedAt ?? now)) - startedAt) : undefined;
  const usage = useMemo(() => latestUsage(events), [events]);
  const model = useMemo(() => runModelOf(events), [events]) ?? outcome?.cost.model ?? null;
  const sleeping = isSleeping(box?.boxStatus);
  const uptime = parseUptimeSec(box?.uptime);
  const deadline =
    box && lifecycle
      ? deadlineOf({ boxStatus: box.boxStatus, runState: box.runState, role: box.role ?? "session", uptime: box.uptime, lastOutputAt: box.lastOutputAt, kept: box.kept, asleepSec: box.asleepSec }, lifecycle, now)
      : null;
  const left = deadline ? deadlineLabel(deadline) : null;
  const agentName = box?.agent ? (AGENT_LABEL[box.agent] ?? box.agent) : null;
  const tokens = outcome?.cost.tokens ? outcome.cost.tokens.input + outcome.cost.tokens.output : usage ? usage.inputTokens + usage.outputTokens : null;
  const repos = box?.repos ?? [];
  const w = box?.workflow;

  return (
    <Sheet visible={visible} onClose={onClose} title="Run">
      <View style={{ paddingBottom: 12 }}>
        <SettingsSection title="Run">
          <Row label="Box" value={friendlyName(session)} mono />
          {outcome?.header.label ? <Row label="Started by" value={outcome.header.label} /> : null}
          {outcome?.header.startedBy?.kind ? <Row label="Trigger" value={outcome.header.startedBy.kind} mono /> : null}
          {w ? <Row label="Playbook" value={`${w.name} · step ${w.step}/${w.total}`} /> : null}
          {w ? <Row label="Step" value={w.line} tone={w.state === "failed" ? "destructive" : undefined} /> : null}
          {box?.harness ? <Row label="Harness" value={box.harness.name} /> : null}
        </SettingsSection>

        <SettingsSection title="Timing">
          {elapsedMs !== undefined ? <Row label={running ? "Elapsed" : "Took"} value={fmtClock(elapsedMs)} mono tone={running ? "live" : undefined} /> : null}
          {startedAt !== undefined ? <Row label="Started" value={new Date(startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })} mono /> : null}
          {box?.lastOutputAt ? <Row label="Last output" value={ago(box.lastOutputAt * 1000)} /> : null}
          {uptime !== undefined ? <Row label={sleeping ? "Ran for" : "Machine up"} value={fmtDuration(uptime)} mono /> : null}
          {left ? <Row label="Time left" value={left} tone={deadline?.remainingSec != null && deadline.remainingSec < 300 ? "attention" : undefined} /> : null}
          {elapsedMs === undefined && startedAt === undefined && !left ? <Empty>No stamps yet.</Empty> : null}
        </SettingsSection>

        <SettingsSection title="Tokens">
          {usage || tokens !== null || outcome?.cost.usd != null ? (
            <>
              {usage ? <Row label="Input" value={fmtTokens(usage.inputTokens)} mono /> : null}
              {usage ? <Row label="Output" value={fmtTokens(usage.outputTokens)} mono /> : null}
              {!usage && tokens !== null ? <Row label="Total" value={fmtTokens(tokens)} mono /> : null}
              {usage ? <Row label="Context" value={fmtTokens(usage.contextTokens)} mono /> : null}
              {outcome?.cost.usd != null ? <Row label="Cost" value={fmtUsd(outcome.cost.usd)} mono /> : null}
            </>
          ) : (
            <Empty>Reported at the end of each turn.</Empty>
          )}
        </SettingsSection>

        <SettingsSection title="Agent">
          {agentName ? <Row label="Driver" value={agentName} /> : null}
          {model ? <Row label="Model" value={model} mono /> : null}
          {box?.skills?.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
              {box.skills.map((s) => (
                <View key={s.name} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.muted, borderRadius: radius.md, paddingHorizontal: 6, paddingVertical: 3 }}>
                  <Icon name="zap" size={10} color={palette.mutedForeground} />
                  <T variant="micro" mono tone="muted">
                    {s.name}
                  </T>
                  {s.how === "auto" ? (
                    <T variant="micro" tone="faint">
                      auto
                    </T>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
          {!agentName && !model && !box?.skills?.length ? <Empty>Defaults.</Empty> : null}
        </SettingsSection>

        <SettingsSection title="Repositories">
          {repos.length ? (
            repos.map((r) => (
              <View key={r.name} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon name="git-branch" size={12} color={palette.faint} />
                <T variant="meta" mono numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                  {r.name}
                </T>
                {r.branch ? (
                  <T variant="meta" mono tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                    @{r.branch}
                  </T>
                ) : null}
              </View>
            ))
          ) : (
            <Empty>None attached.</Empty>
          )}
        </SettingsSection>

        <SettingsSection title="Machine">
          {sleeping ? (
            <Empty>Asleep — no live vitals.</Empty>
          ) : (
            <View style={{ gap: 6 }}>
              {box?.cpu ? <Row label="CPU" value={box.cpu} mono /> : null}
              {box?.memUsage ? <UsageMeter kind="memory" usage={box.memUsage} fluid /> : null}
              {box?.disk ? <UsageMeter kind="disk" usage={box.disk} fluid /> : null}
              {!box?.cpu && !box?.memUsage && !box?.disk ? <Empty>Vitals arrive with the next poll.</Empty> : null}
            </View>
          )}
        </SettingsSection>

        {queued.length > 0 ? (
          <SettingsSection title={`Queued · ${queued.length}`}>
            {queued.map((q, i) => (
              <View key={`${i}-${q}`} style={{ flexDirection: "row", gap: 8 }}>
                <T variant="meta" mono tone="faint">
                  {i + 1}
                </T>
                <T variant="meta" tone="muted" numberOfLines={2} style={{ flex: 1, minWidth: 0 }}>
                  {q}
                </T>
              </View>
            ))}
          </SettingsSection>
        ) : null}
      </View>
    </Sheet>
  );
}
