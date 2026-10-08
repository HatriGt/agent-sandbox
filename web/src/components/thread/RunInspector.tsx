import * as React from "react";
import { ArrowUpRight, Cpu, GitBranch, PanelRightClose } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { BoxView, FleetLifecycle } from "@/lib/api";
import type { TraceEvent } from "@/lib/trace";
import { contextHealth, lastUsage } from "@/lib/context-health";
import { deadlineLabel, deadlineOf, displayState, fmtDuration, parseUptimeSec } from "@/lib/lifecycle";
import { fmtAgo, friendlyName, isSleeping, threadTitle } from "@/lib/format";
import { questionHeadline } from "@/lib/question";
import { fmtTokens } from "./OutcomeCard";
import { UsageMeter } from "@/components/ui/usage-meter";
import { StatusDot } from "@/components/ui/data-table";
import { SkillMark } from "@/lib/skillGlyph";
import { useNow } from "@/hooks/useNow";
import { useReducedMotion } from "@/lib/motion-pref";
import { formatDuration } from "./TraceItems";
import { cn } from "@/lib/utils";

/**
 * The run inspector (Ctrl+I): a 316px aside beside the conversation with the facts that are
 * otherwise buried in header tooltips and the receipt — and, on its second tab, the rest of the
 * fleet grouped by what it needs from you. Every number here is observed (stamps, the fleet poll,
 * the trace's ⟦usage⟧ sentinels); nothing is estimated.
 */

export const INSPECTOR_WIDTH = 316;
export type InspectorTab = "run" | "fleet";

export function RunInspector({
  box,
  lifecycle,
  events,
  running,
  startedAt,
  endedAt,
  model,
  repos,
  queued,
  fleet,
  onOpenBox,
  onClose,
}: {
  box: BoxView;
  lifecycle: FleetLifecycle;
  events: TraceEvent[];
  running: boolean;
  startedAt?: number;
  endedAt?: number;
  /** The model the run recorded (lifecycle marker or receipt); absent → the row is not shown. */
  model: string | null;
  repos: { name: string; branch?: string }[];
  queued: { id: string; text: string }[];
  /** The whole visible fleet, this box included; the Fleet tab filters it. */
  fleet: BoxView[];
  onOpenBox?: (name: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = React.useState<InspectorTab>("run");
  const still = useReducedMotion();
  const others = fleet.filter((b) => b.name !== box.name);
  const needsYou = others.filter((b) => !isSleeping(b) && b.runState === "waiting").length;

  return (
    <motion.aside
      key="inspector"
      aria-label="Run inspector"
      initial={still ? { opacity: 0 } : { opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={still ? { opacity: 0 } : { opacity: 0, x: 16 }}
      transition={{ duration: still ? 0.12 : 0.22, ease: [0.22, 1, 0.36, 1] }}
      style={{ width: INSPECTOR_WIDTH }}
      className="bg-card hidden shrink-0 flex-col border-l md:flex"
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <div role="tablist" aria-label="Inspector" className="flex items-center gap-0.5">
          {(["run", "fleet"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "relative flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-meta font-medium transition-colors",
                tab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "run" ? "Run" : "Fleet"}
              {t === "fleet" && needsYou > 0 && <span className="bg-attention text-attention-ink stamp rounded-full px-1.5 text-micro leading-4">{needsYou}</span>}
              {tab === t && <motion.span layoutId={still ? undefined : "inspector-tab"} className="bg-accent absolute inset-0 -z-10 rounded-md" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the inspector"
          title="Close · Ctrl+I"
          className="text-muted-foreground hover:text-foreground ml-auto grid size-7 cursor-pointer place-items-center rounded-md transition-colors"
        >
          <PanelRightClose className="size-4" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          {tab === "run" ? (
            <motion.div key="run" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: still ? 0 : 0.12 }}>
              <RunTab box={box} lifecycle={lifecycle} events={events} running={running} startedAt={startedAt} endedAt={endedAt} model={model} repos={repos} queued={queued} />
            </motion.div>
          ) : (
            <motion.div key="fleet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: still ? 0 : 0.12 }}>
              <FleetTab boxes={others} onOpen={onOpenBox} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b px-4 py-3 last:border-b-0">
      <h3 className="label text-muted-foreground mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-baseline justify-between gap-3 py-0.5 text-meta", className)}>
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground min-w-0 truncate text-right tabular-nums">{children}</span>
    </div>
  );
}

function RunTab({
  box,
  lifecycle,
  events,
  running,
  startedAt,
  endedAt,
  model,
  repos,
  queued,
}: {
  box: BoxView;
  lifecycle: FleetLifecycle;
  events: TraceEvent[];
  running: boolean;
  startedAt?: number;
  endedAt?: number;
  model: string | null;
  repos: { name: string; branch?: string }[];
  queued: { id: string; text: string }[];
}) {
  const now = useNow(running);
  const elapsedMs = startedAt !== undefined ? Math.max(0, (running ? now : (endedAt ?? now)) - startedAt) : undefined;
  const usage = React.useMemo(() => lastUsage(events), [events]);
  const ctx = usage ? contextHealth(usage.contextTokens) : null;
  const deadline = React.useMemo(() => deadlineOf(box, lifecycle, now), [box, lifecycle, now]);
  const left = deadlineLabel(deadline);
  const sleeping = isSleeping(box);
  const uptime = parseUptimeSec(box.uptime);
  const agentName = box.agent ? (({ omp: "oh-my-pi", codex: "Codex CLI", opencode: "OpenCode", claude: "Claude Code" } as Record<string, string>)[box.agent] ?? box.agent) : null;

  return (
    <>
      <Section title="Timing">
        {elapsedMs !== undefined && (
          <Row label={running ? "Elapsed" : "Took"}>
            <span className={cn("stamp", running && "text-live")}>{formatDuration(elapsedMs)}</span>
          </Row>
        )}
        {startedAt !== undefined && <Row label="Started">{new Date(startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</Row>}
        {box.lastOutputAt && <Row label="Last output">{fmtAgo(box.lastOutputAt, now)}</Row>}
        {uptime !== undefined && <Row label={sleeping ? "Ran for" : "Machine up"}>{fmtDuration(uptime)}</Row>}
        {left && <Row label="Time left"><span className={cn(deadline.remainingSec != null && deadline.remainingSec < 300 && "text-attention-text")}>{left}</span></Row>}
        {elapsedMs === undefined && startedAt === undefined && !left && <p className="text-faint text-micro">No stamps yet.</p>}
      </Section>

      <Section title="Tokens">
        {usage ? (
          <>
            <Row label="Input">{fmtTokens(usage.inputTokens)}</Row>
            <Row label="Output">{fmtTokens(usage.outputTokens)}</Row>
            {ctx && (
              <div className="mt-1.5">
                <div className="flex items-baseline justify-between text-meta">
                  <span className="text-muted-foreground">Context</span>
                  <span className={cn("stamp", ctx.level === "critical" ? "text-destructive" : ctx.level === "high" ? "text-attention-text" : "text-foreground")}>
                    {Math.round(ctx.fraction * 100)}% · {fmtTokens(usage.contextTokens)}
                  </span>
                </div>
                <div role="meter" aria-label={ctx.label} aria-valuenow={Math.round(ctx.fraction * 100)} aria-valuemin={0} aria-valuemax={100} className="bg-border/70 mt-1 h-1 overflow-hidden rounded-full">
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-700", ctx.level === "critical" ? "bg-destructive" : ctx.level === "high" ? "bg-warn" : "bg-live")}
                    style={{ width: `${Math.max(ctx.fraction * 100, 2)}%` }}
                  />
                </div>
                {ctx.advice && <p className="text-attention-text mt-1.5 text-micro leading-snug">{ctx.advice}</p>}
              </div>
            )}
          </>
        ) : (
          <p className="text-faint text-micro">Reported at the end of each turn.</p>
        )}
      </Section>

      <Section title="Agent">
        {agentName && <Row label="Driver">{agentName}</Row>}
        {model && <Row label="Model"><span className="stamp">{model}</span></Row>}
        {box.harness && (
          <Row label="Harness">
            <span title={box.harness.line}>{box.harness.name}</span>
          </Row>
        )}
        {box.workflow && <Row label="Playbook">{box.workflow.line}</Row>}
        {!!box.skills?.length && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {box.skills.map((s) => (
              <span key={s.name} title={s.how === "explicit" ? "You asked for it" : "Matched by the controller"} className="bg-muted text-muted-foreground stamp inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-micro">
                <SkillMark name={s.name} size={12} />
                {s.name}
                {s.how === "auto" && <span className="text-faint">auto</span>}
              </span>
            ))}
          </div>
        )}
        {!agentName && !model && !box.harness && !box.workflow && !box.skills?.length && <p className="text-faint text-micro">Defaults.</p>}
      </Section>

      <Section title="Repositories">
        {repos.length ? (
          <ul className="flex flex-col gap-1">
            {repos.map((r) => (
              <li key={r.name} className="flex min-w-0 items-center gap-1.5 text-meta">
                <GitBranch className="text-faint size-3 shrink-0" aria-hidden />
                <span className="stamp text-foreground truncate">{r.name}</span>
                {r.branch && <span className="stamp text-muted-foreground ml-auto truncate">@{r.branch}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-faint text-micro">None attached.</p>
        )}
      </Section>

      <Section title="Machine">
        {sleeping ? (
          <p className="text-faint text-micro">Asleep — no live vitals.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {box.cpu && (
              <span className="inline-flex items-center gap-1.5 text-micro">
                <Cpu className="text-faint size-3 shrink-0" aria-hidden />
                <span className="stamp text-muted-foreground">cpu {box.cpu}</span>
              </span>
            )}
            <UsageMeter kind="memory" usage={box.memUsage} width="w-24" />
            <UsageMeter kind="disk" usage={box.disk} width="w-24" />
            {!box.cpu && !box.memUsage && !box.disk && <p className="text-faint text-micro">Vitals arrive with the next poll.</p>}
          </div>
        )}
      </Section>

      {queued.length > 0 && (
        <Section title={`Queued · ${queued.length}`}>
          <ol className="flex flex-col gap-1">
            {queued.map((q, i) => (
              <li key={q.id} className="flex min-w-0 items-start gap-2 text-meta">
                <span className="text-faint stamp shrink-0">{i + 1}</span>
                <span className="text-muted-foreground line-clamp-2 min-w-0">{q.text}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </>
  );
}

type FleetGroup = "working" | "needs-you" | "idle" | "asleep";

function groupOf(b: BoxView): FleetGroup {
  const s = displayState(b);
  return s === "sleeping" ? "asleep" : s === "running" ? "working" : s === "waiting" ? "needs-you" : "idle";
}

const GROUP: Record<FleetGroup, { label: string; tone: "live" | "attention" | "muted" | "ok" }> = {
  working: { label: "Working", tone: "live" },
  "needs-you": { label: "Needs you", tone: "attention" },
  idle: { label: "Idle", tone: "muted" },
  asleep: { label: "Asleep", tone: "muted" },
};

/** The one-line "now" for a fleet row: the question when waiting, else the last-output age. */
function nowLine(b: BoxView, group: FleetGroup, now: number): string | null {
  if (group === "needs-you" && b.question) return questionHeadline(b.question, 80);
  if (group === "asleep") return b.asleepSec != null && b.asleepSec >= 60 ? `asleep ${fmtDuration(b.asleepSec)}` : "wakes on reply";
  if (b.stalled) return "no output for a while";
  if (b.lastOutputAt) return `${group === "working" ? "last action" : "finished"} ${fmtAgo(b.lastOutputAt, now)}`;
  return null;
}

function FleetTab({ boxes, onOpen }: { boxes: BoxView[]; onOpen?: (name: string) => void }) {
  const now = useNow(true, 30_000);
  const order: FleetGroup[] = ["needs-you", "working", "idle", "asleep"];
  const grouped = order.map((g) => ({ g, items: boxes.filter((b) => groupOf(b) === g) })).filter((x) => x.items.length > 0);
  if (!grouped.length) return <p className="text-faint px-4 py-3 text-micro">No other machines right now.</p>;
  return (
    <>
      {grouped.map(({ g, items }) => (
        <Section key={g} title={`${GROUP[g].label} · ${items.length}`}>
          <ul className="-mx-2 flex flex-col">
            {items.map((b) => {
              const line = nowLine(b, g, now);
              return (
                <li key={b.name}>
                  <button
                    type="button"
                    onClick={() => onOpen?.(b.name)}
                    disabled={!onOpen}
                    className="group/row hover:bg-muted flex w-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors disabled:cursor-default"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <StatusDot tone={GROUP[g].tone} pulse={g === "working"} className="min-w-0 flex-1">
                        <span className="text-foreground truncate text-meta font-medium">{threadTitle(b)}</span>
                      </StatusDot>
                      <ArrowUpRight className="text-faint size-3 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100" aria-hidden />
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 pl-4 text-micro">
                      <span className="text-faint stamp shrink-0">{friendlyName(b.name)}</span>
                      {line && (
                        <span className={cn("truncate", g === "needs-you" ? "text-attention-text" : b.stalled ? "text-destructive" : "text-muted-foreground")}>· {line}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      ))}
    </>
  );
}
