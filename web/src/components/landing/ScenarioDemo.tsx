import * as React from "react";
import {
  Check,
  CircleDot,
  Cpu,
  FileText,
  GitPullRequest,
  Pause,
  Play,
  RotateCcw,
  Search,
  Smartphone,
  Terminal,
  Timer,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

/**
 * The landing's in-page scenario: one unattended run, trigger to receipt, scripted on a single clock.
 * Everything on screen is derived from `t` (ms into the script), so play / pause / replay / seek are
 * trivial, the loop pauses while offscreen, and reduced motion simply pins `t` to the final frame.
 * It borrows the thread's visual language (state pill, trace rows, plan checklist, amber question
 * card, DigestCard receipt). It is an illustrative scenario, labelled as such — no measured numbers.
 */

const END = 15_600; // last event
const LOOP = 21_500; // hold on the receipt, then start over
const EASE = [0.22, 1, 0.36, 1] as const;

const CHAPTERS = [
  { key: "trigger", label: "Trigger", sub: "Issue labelled agent", at: 0 },
  { key: "boot", label: "Boot", sub: "Its own microVM", at: 1000 },
  { key: "work", label: "Work", sub: "Reproduce, trace", at: 2000 },
  { key: "ask", label: "Ask", sub: "Stops for a decision", at: 7400 },
  { key: "ship", label: "Ship", sub: "Verify, PR, receipt", at: 11000 },
] as const;

const Q = "How should a retry after a decline behave?";
const OPTIONS = ["New idempotency key per attempt", "Reuse the key, dedupe server-side"];
const SAY_1 = "Reading the retry path in billing/charge.ts first, then reproducing it.";
const SAY_2 =
  "Found it: a retry reuses the order id as the idempotency key. A new card after a decline is refused as a duplicate, or charged twice when the provider times out. The two fixes mean different things for customers, so I'm asking.";
const SAY_3 = "Applying a key per attempt, with a regression test for the timeout race.";

const PLAN = [
  { text: "Reproduce the double charge", active: 2600, done: 4600 },
  { text: "Find why the retry isn't idempotent", active: 4600, done: 11000 },
  { text: "Fix + regression test", active: 11000, done: 13000 },
  { text: "Verify, open the PR", active: 13000, done: 15000 },
];

type RunState = "triggered" | "booting" | "working" | "needs you" | "done";
function stateAt(t: number): RunState {
  if (t < 1000) return "triggered";
  if (t < 2000) return "booting";
  if (t < 7400) return "working";
  if (t < 11000) return "needs you";
  if (t < 15600) return "working";
  return "done";
}

const typed = (text: string, at: number, t: number, cps = 110) => {
  const n = Math.max(0, Math.floor(((t - at) * cps) / 1000));
  return { text: text.slice(0, n), done: n >= text.length };
};

function useClock(reduced: boolean, visible: boolean) {
  const [t, setT] = React.useState(reduced ? LOOP - 1 : 0);
  const [playing, setPlaying] = React.useState(!reduced);
  React.useEffect(() => {
    if (reduced) {
      setPlaying(false);
      setT(LOOP - 1);
    }
  }, [reduced]);
  React.useEffect(() => {
    if (!playing || !visible || reduced) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(now - last, 120);
      last = now;
      setT((p) => (p + dt >= LOOP ? 0 : p + dt));
    }, 40);
    return () => window.clearInterval(id);
  }, [playing, visible, reduced]);
  return { t, setT, playing, setPlaying };
}

export function ScenarioDemo() {
  const reduced = !!useReducedMotion();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const visible = useInView(rootRef, { amount: 0.3 });
  const { t, setT, playing, setPlaying } = useClock(reduced, visible);
  const state = stateAt(t);
  const chapter = CHAPTERS.reduce((acc, c, i) => (t >= c.at ? i : acc), 0);

  const seek = (i: number) => {
    // Reduced motion: show the chapter's settled end state, no replay.
    const next = CHAPTERS[i + 1]?.at ?? LOOP;
    setT(reduced ? next - 1 : CHAPTERS[i].at);
  };
  const replay = () => {
    setT(0);
    setPlaying(true);
  };

  return (
    <figure ref={rootRef} className="mt-12" aria-labelledby="demo-title" aria-describedby="demo-summary demo-note">
      <p id="demo-summary" className="sr-only">
        Illustrative scenario. At 2:07 a.m. a GitHub issue on a checkout service is labelled agent. A run boots its own microVM,
        reproduces a double charge on declined-card retries, and stops to ask whether a retry should use a new idempotency key per
        attempt. The answer arrives from a phone push notification. The agent applies the fix, runs the tests, opens a pull request,
        and posts a receipt on the issue.
      </p>

      {/* chapter scrubber: segmented progress, click to jump */}
      <div className="grid grid-cols-5 gap-1.5 sm:gap-3" role="group" aria-label="Scenario chapters">
        {CHAPTERS.map((c, i) => {
          const start = c.at;
          const end = CHAPTERS[i + 1]?.at ?? END;
          const fill = Math.max(0, Math.min(1, (t - start) / (end - start)));
          const ask = c.key === "ask";
          const on = chapter === i;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => seek(i)}
              aria-current={on ? "step" : undefined}
              className={cn(focusRing, "group min-w-0 rounded-sm text-left")}
            >
              <span className="bg-muted relative block h-[3px] overflow-hidden rounded-full">
                <span
                  className={cn("absolute inset-y-0 left-0 rounded-full", ask ? "bg-attention" : "bg-foreground")}
                  style={{ width: `${fill * 100}%` }}
                />
              </span>
              <span className={cn("mt-2 flex items-center gap-1.5 text-micro font-semibold transition-colors duration-200", on ? (ask ? "text-attention-text" : "text-foreground") : "text-muted-foreground group-hover:text-foreground")}>
                <span className="stamp font-normal">{String(i + 1).padStart(2, "0")}</span>
                <span className="truncate">{c.label}</span>
              </span>
              <span className="text-muted-foreground mt-0.5 hidden truncate text-micro sm:block">{c.sub}</span>
            </button>
          );
        })}
      </div>

      {/* the product window */}
      <div className="bg-card shadow-e5 relative mt-5 overflow-hidden rounded-xl border">
        <Header t={t} state={state} />
        <div className="grid md:grid-cols-[minmax(0,1fr)_15.5rem]">
          <Thread t={t} reduced={reduced} />
          <SidePanel t={t} state={state} />
        </div>
        <Push t={t} reduced={reduced} />
      </div>

      <figcaption className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => (reduced ? replay() : setPlaying(!playing))}
          className={cn(focusRing, ctrlBtn)}
          aria-label={reduced ? "Play the scenario" : playing ? "Pause the scenario" : "Play the scenario"}
        >
          {playing && !reduced ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          {playing && !reduced ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={replay} className={cn(focusRing, ctrlBtn)} aria-label="Replay the scenario from the start">
          <RotateCcw className="size-3.5" aria-hidden /> Replay
        </button>
        <p id="demo-note" className="text-muted-foreground text-micro sm:ml-auto">
          Illustrative scenario in the product's UI. The repo, times, spend and counts are examples, not measured results.
        </p>
      </figcaption>
    </figure>
  );
}

const focusRing = "focus-visible:ring-ring focus-visible:ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
const ctrlBtn = "text-foreground hover:bg-muted inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-micro font-medium transition-colors duration-200 ease-out";

/* ───────────── header ───────────── */

const PILL: Record<RunState, string> = {
  triggered: "bg-muted text-muted-foreground ring-border",
  booting: "bg-live/10 text-live ring-live/20",
  working: "bg-live/10 text-live ring-live/20",
  "needs you": "bg-attention/20 text-attention-text ring-attention/40",
  done: "bg-ok/10 text-ok ring-ok/20",
};

function Header({ t, state }: { t: number; state: RunState }) {
  const min = 7 + Math.round((Math.min(t, END) / END) * 12);
  const plan = PLAN.filter((p) => t >= p.done).length;
  return (
    <div className="flex h-12 items-center gap-2.5 border-b px-3 sm:px-4">
      <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-micro font-semibold ring-1 ring-inset transition-colors duration-200", PILL[state])}>
        {(state === "working" || state === "booting") && <CircleDot className="breathe size-3" strokeWidth={2.5} aria-hidden />}
        {state === "needs you" && <Pause className="size-3" strokeWidth={2.5} aria-hidden />}
        {state === "done" && <Check className="size-3" strokeWidth={3} aria-hidden />}
        {state === "triggered" && <GitHubMark className="size-3" />}
        {state}
      </span>
      <span className="text-foreground min-w-0 truncate text-meta font-medium">
        <span className="text-muted-foreground hidden font-normal sm:inline">acme/checkout-svc · </span>Double charge on declined-card retry
      </span>
      <span className="stamp text-muted-foreground ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 tabular-nums md:hidden" aria-label={`Plan ${plan} of 4`}>
        {plan}/4
      </span>
      <span className="stamp text-muted-foreground hidden shrink-0 tabular-nums sm:inline md:ml-auto">02:{String(min).padStart(2, "0")} a.m.</span>
    </div>
  );
}

/* ───────────── the thread ───────────── */

function Enter({ children, reduced, className }: { children: React.ReactNode; reduced: boolean; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      layout={reduced ? false : "position"}
    >
      {children}
    </motion.div>
  );
}

function Caret({ on }: { on: boolean }) {
  return on ? <span className="bg-live ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse" aria-hidden /> : null;
}

function Thread({ t, reduced }: { t: number; reduced: boolean }) {
  const s1 = typed(SAY_1, 2000, t);
  const s2 = typed(SAY_2, 5900, t, 170);
  const s3 = typed(SAY_3, 11300, t);
  return (
    <div
      className="relative flex h-[31rem] flex-col justify-end gap-3 overflow-hidden px-3 py-4 text-meta sm:h-[33rem] sm:px-5"
      style={{ maskImage: "linear-gradient(to bottom, transparent 0, #000 3.5rem)", WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 3.5rem)" }}
    >
      <Enter reduced={reduced}>
        <IssueCard t={t} />
      </Enter>
      {t >= 1000 && (
        <Enter reduced={reduced}>
          <BootLine t={t} />
        </Enter>
      )}
      {t >= 2000 && (
        <Enter reduced={reduced}>
          <Say text={s1.text} typing={!s1.done} />
        </Enter>
      )}
      {t >= 3000 && (
        <Enter reduced={reduced}>
          <ToolRow t={t} at={3000} doneAt={3500} icon={<FileText />} name="Read" arg="billing/charge.ts" result="212 lines" />
        </Enter>
      )}
      {t >= 3700 && (
        <Enter reduced={reduced}>
          <ToolRow t={t} at={3700} doneAt={4500} icon={<Terminal />} name="Bash" arg="npm test -- charge.retry" result="1 failed · charged twice" tone="fail" />
        </Enter>
      )}
      {t >= 4900 && (
        <Enter reduced={reduced}>
          <ToolRow t={t} at={4900} doneAt={5400} icon={<Search />} name="Grep" arg="idempotencyKey" result="3 matches" />
        </Enter>
      )}
      {t >= 5900 && (
        <Enter reduced={reduced}>
          <Say text={s2.text} typing={!s2.done} />
        </Enter>
      )}
      {t >= 7400 && (
        <Enter reduced={reduced}>
          <QuestionCard t={t} />
        </Enter>
      )}
      {t >= 10500 && (
        <Enter reduced={reduced} className="flex flex-col items-end gap-1">
          <span className="bg-muted max-w-[85%] rounded-xl rounded-br-md px-3.5 py-2">{OPTIONS[0]}</span>
          <span className="stamp text-muted-foreground inline-flex items-center gap-1">
            <Smartphone className="size-3" aria-hidden /> answered from a phone
          </span>
        </Enter>
      )}
      {t >= 11300 && (
        <Enter reduced={reduced}>
          <Say text={s3.text} typing={!s3.done} />
        </Enter>
      )}
      {t >= 12000 && (
        <Enter reduced={reduced}>
          <ToolRow t={t} at={12000} doneAt={12300} icon={<FileText />} name="Edit" arg="billing/charge.ts" result={<><span className="text-ok">+18</span> <span className="text-destructive">−6</span></>} />
        </Enter>
      )}
      {t >= 12400 && (
        <Enter reduced={reduced}>
          <ToolRow t={t} at={12400} doneAt={13000} icon={<Terminal />} name="Bash" arg="npm run typecheck && npm test" result="48 passed" tone="ok" />
        </Enter>
      )}
      {t >= 13400 && (
        <Enter reduced={reduced}>
          <ToolRow t={t} at={13400} doneAt={14000} icon={<GitPullRequest />} name="gh" arg="pr create --base main" result="#1287" tone="ok" />
        </Enter>
      )}
      {t >= 14600 && (
        <Enter reduced={reduced}>
          <Receipt t={t} />
        </Enter>
      )}
    </div>
  );
}

function IssueCard({ t }: { t: number }) {
  const labelled = t >= 450;
  return (
    <div className="rounded-lg border px-3.5 py-3">
      <div className="text-muted-foreground flex items-center gap-2 text-micro">
        <GitHubMark className="size-3.5" />
        <span>acme/checkout-svc</span>
        <span className="stamp">#418</span>
        <span className="ml-auto">webhook · issue labelled</span>
      </div>
      <p className="text-foreground mt-1.5 font-medium">Customers charged twice when retrying a declined card</p>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="text-muted-foreground rounded-full border px-2 py-px text-micro">bug</span>
        <span className="text-muted-foreground rounded-full border px-2 py-px text-micro">billing</span>
        <AnimatePresence>
          {labelled && (
            <motion.span
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="bg-live/10 text-live ring-live/25 rounded-full px-2 py-px text-micro font-semibold ring-1 ring-inset"
            >
              agent
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function BootLine({ t }: { t: number }) {
  const up = t >= 1700;
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-micro">
      <Cpu className={cn("size-3.5", up ? "text-ok" : "text-live")} aria-hidden />
      <span className="text-foreground font-medium">{up ? "microVM up" : "Booting microVM…"}</span>
      <span className="stamp">fc-7b2e · 2 vCPU · 4 GB</span>
      <span className="stamp">egress: github.com, api.anthropic.com</span>
      <span className="stamp">Claude Code · Sonnet</span>
    </div>
  );
}

function Say({ text, typing }: { text: string; typing: boolean }) {
  return (
    <div className="text-foreground max-w-[62ch] leading-relaxed">
      {text}
      <Caret on={typing} />
    </div>
  );
}

function ToolRow({ t, at, doneAt, icon, name, arg, result, tone }: { t: number; at: number; doneAt: number; icon: React.ReactNode; name: string; arg: string; result: React.ReactNode; tone?: "ok" | "fail" }) {
  void at;
  const done = t >= doneAt;
  return (
    <div className="bg-muted/55 text-foreground flex min-w-0 items-center gap-2.5 rounded-md border px-3 py-1.5 font-mono text-micro">
      <span className="opacity-70 [&_svg]:size-3.5" aria-hidden>
        {icon}
      </span>
      <span className="font-semibold">{name}</span>
      <span className="min-w-0 truncate opacity-70">{arg}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {!done ? (
          <span className="text-live inline-flex items-center gap-1">
            <CircleDot className="breathe size-3" aria-hidden /> running
          </span>
        ) : (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }} className={cn("inline-flex items-center gap-1", tone === "fail" ? "text-destructive" : tone === "ok" ? "text-ok" : "opacity-70")}>
            {tone === "fail" ? <X className="size-3" strokeWidth={3} aria-hidden /> : <Check className="size-3" strokeWidth={3} aria-hidden />}
            {result}
          </motion.span>
        )}
      </span>
    </div>
  );
}

function QuestionCard({ t }: { t: number }) {
  const picked = t >= 10300;
  const answered = t >= 10500;
  return (
    <div className={cn("rounded-xl border transition-colors duration-200", answered ? "border-border" : "border-attention/60 bg-attention/[0.04]")}>
      <div className="px-4 pt-3 pb-2">
        <p className={cn("label mb-1.5 flex items-center gap-1.5", answered ? "text-muted-foreground" : "text-attention-text")}>
          {answered ? <Check className="size-3" strokeWidth={3} aria-hidden /> : <Pause className="size-3" strokeWidth={2.5} aria-hidden />}
          {answered ? "Answered · resuming" : "Paused · needs you"}
        </p>
        <p className="text-foreground text-body font-medium">{Q}</p>
      </div>
      <ul className="flex flex-col gap-1 px-2 pb-2">
        {OPTIONS.map((o, i) => {
          const on = picked && i === 0;
          return (
            <li key={o} className={cn("flex items-center gap-2.5 rounded-md border px-3 py-1.5 transition-colors duration-200", on ? "border-attention bg-attention/10" : "border-transparent")}>
              <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", on ? "border-attention bg-attention text-attention-ink" : "border-line-strong")}>
                {on && <Check className="size-2.5" strokeWidth={3} aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">{o}</span>
              {i === 0 && <span className="text-muted-foreground hidden text-micro sm:inline">recommended</span>}
            </li>
          );
        })}
      </ul>
      {!answered && <p className="text-muted-foreground border-t px-4 py-2 text-micro">Every tool call is blocked until someone answers.</p>}
    </div>
  );
}

function Receipt({ t }: { t: number }) {
  void t;
  return (
    <div className="bg-card raised rounded-xl border px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="bg-ok size-2 shrink-0 rounded-full" aria-hidden />
        <span className="label text-ok shrink-0">Done</span>
        <span className="text-foreground min-w-0 flex-1 truncate">Retries use a fresh idempotency key per attempt</span>
        <span className="stamp text-muted-foreground shrink-0">12 min</span>
      </div>
      <p className="stamp text-muted-foreground mt-1.5 truncate pl-[18px]">2 files · +59 −6 · 1 question asked · started by issue #418</p>
      <p className="text-ok mt-1 truncate pl-[18px] text-micro">
        <Check className="mr-1 inline size-3" strokeWidth={3} aria-hidden />
        Verified: typecheck + 48 tests pass
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t pt-2.5 pl-[18px]">
        <span className="text-foreground inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-micro font-medium">
          <GitPullRequest className="text-ok size-3" aria-hidden /> PR #1287 · fix/retry-idempotency
        </span>
        <span className="text-muted-foreground text-micro">Receipt posted on #418</span>
      </div>
    </div>
  );
}

/* ───────────── side panel: plan, budget, machine ───────────── */

function SidePanel({ t, state }: { t: number; state: RunState }) {
  const done = PLAN.filter((p) => t >= p.done).length;
  const working = Math.max(0, Math.min(t, 7400) - 2000) + Math.max(0, Math.min(t, 15600) - 11000);
  const spend = t < 2000 ? 0 : 0.02 + working * 0.000026;
  const minutes = Math.round((Math.min(t, END) / END) * 12);
  return (
    <aside className="hidden flex-col border-l md:flex" aria-label="Run details">
      <section className="border-b px-4 py-3.5">
        <div className="flex items-center justify-between">
          <p className="label text-muted-foreground">Plan</p>
          <span className="stamp text-muted-foreground tabular-nums">
            {done}/{PLAN.length}
          </span>
        </div>
        <ol className="mt-2 flex flex-col gap-1.5">
          {PLAN.map((p) => {
            const s = t >= p.done ? "done" : t >= p.active ? "active" : "todo";
            return (
              <li key={p.text} className={cn("flex items-start gap-2 text-micro leading-snug transition-colors duration-200", s === "done" ? "text-muted-foreground" : s === "active" ? "text-foreground font-medium" : "text-muted-foreground/80")}>
                <span className={cn("mt-px grid size-3.5 shrink-0 place-items-center rounded transition-colors duration-200", s === "done" ? "bg-ok/20 text-ok" : s === "active" ? "bg-live/10 text-live" : "border")}>
                  {s === "done" ? <Check className="size-2.5" strokeWidth={3} aria-hidden /> : s === "active" ? <CircleDot className="breathe size-2.5" aria-hidden /> : null}
                </span>
                <span className={cn(s === "done" && "line-through decoration-current/40")}>{p.text}</span>
              </li>
            );
          })}
        </ol>
      </section>
      <section className="border-b px-4 py-3.5">
        <div className="flex items-center justify-between">
          <p className="label text-muted-foreground">Budget</p>
          <span className="text-foreground inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-micro font-medium tabular-nums">
            <Timer className="size-3" aria-hidden /> 1 h · $2
          </span>
        </div>
        <div className="bg-muted mt-2.5 h-1 overflow-hidden rounded-full">
          <div className="bg-foreground/70 h-full rounded-full transition-[width] duration-200 ease-out" style={{ width: `${(spend / 2) * 100}%` }} />
        </div>
        <p className="stamp text-muted-foreground mt-1.5 tabular-nums">
          ${spend.toFixed(2)} · {minutes} min of 60
        </p>
      </section>
      <section className="px-4 py-3.5">
        <p className="label text-muted-foreground">Machine</p>
        <p className="text-foreground mt-2 flex items-center gap-2 text-micro font-medium">
          <span
            className={cn(
              "size-2 rounded-full",
              state === "needs you" ? "bg-attention" : state === "done" ? "bg-sleep" : state === "triggered" ? "bg-muted-foreground/50" : "bg-live breathe"
            )}
            aria-hidden
          />
          {state === "triggered" ? "Claiming a warm machine" : state === "booting" ? "Booting" : state === "needs you" ? "Waiting on you" : state === "done" ? "Sleeping · wakes on reply" : "Heartbeat 2s ago"}
        </p>
        <p className="stamp text-muted-foreground mt-1">fc-7b2e · KVM</p>
        <p className="text-muted-foreground mt-3 text-micro leading-relaxed">
          {state === "needs you" ? "Tool calls blocked. A push went to your phone." : "PR-only: pushes to main are refused in the machine."}
        </p>
      </section>
    </aside>
  );
}

/* ───────────── the phone push ───────────── */

function Push({ t, reduced }: { t: number; reduced: boolean }) {
  const show = t >= 8600 && t < 10700;
  const tapped = t >= 9900;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="push"
          initial={reduced ? false : { opacity: 0, y: -14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: tapped ? 0.985 : 1 }}
          exit={reduced ? undefined : { opacity: 0, y: -10, transition: { duration: 0.18 } }}
          transition={{ duration: 0.24, ease: EASE }}
          className="absolute top-14 right-3 left-3 z-10 sm:left-auto sm:w-[21rem]"
          aria-hidden
        >
          <div className="bg-popover/95 rounded-2xl border px-3.5 py-3 shadow-e5 backdrop-blur">
            <div className="text-muted-foreground flex items-center gap-2 text-micro">
              <span className="bg-primary text-primary-foreground grid size-5 place-items-center rounded-[6px]">
                <Logo className="size-3" />
              </span>
              <span className="font-medium">Agent Sandbox</span>
              <Smartphone className="ml-auto size-3" />
              <span>now</span>
            </div>
            <p className="text-foreground mt-1.5 flex items-center gap-1.5 text-meta font-semibold">
              <span className="bg-attention size-1.5 rounded-full" /> checkout-svc needs you
            </p>
            <p className="text-muted-foreground mt-0.5 text-micro">{Q}</p>
            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
              <span className={cn("rounded-lg px-2 py-1.5 text-center text-micro font-medium transition-colors duration-200", tapped ? "bg-attention text-attention-ink" : "bg-muted text-foreground")}>New key per attempt</span>
              <span className="bg-muted text-foreground rounded-lg px-2 py-1.5 text-center text-micro font-medium">Reuse + dedupe</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
