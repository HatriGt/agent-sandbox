import * as React from "react";
import {
  Check,
  CircleDot,
  Cpu,
  FilePlus2,
  FileText,
  GitBranch,
  GitPullRequest,
  Globe,
  History,
  Link2,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Terminal,
  Timer,
  Webhook,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

/**
 * The landing's in-page scenario: an alert fires at 3 a.m. with nobody at the keyboard, an automation
 * starts a run in its own microVM, the agent investigates on its own, asks one question that is
 * answered with a single tap on a phone, ships a verified PR, and a chained automation follows up.
 * Everything on screen is derived from one clock `t` (ms into the script): play / pause / replay /
 * seek are trivial, the loop pauses offscreen, and reduced motion pins `t` to the final frame.
 */

const END = 22_400;
const LOOP = 29_000;
const EASE = [0.22, 1, 0.36, 1] as const;

const CHAPTERS = [
  { key: "alert", label: "Alert", sub: "A webhook fires", at: 0 },
  { key: "boot", label: "Boot", sub: "Its own microVM", at: 1600 },
  { key: "dig", label: "Investigate", short: "Dig in", sub: "Repro, bisect, test", at: 3000 },
  { key: "ask", label: "One tap", sub: "The call is yours", at: 10600 },
  { key: "ship", label: "Ship", sub: "Verified PR, receipt", at: 13700 },
  { key: "chain", label: "Chain", sub: "Next run starts itself", at: 18400 },
] as const;

const Q = "Patch forward, or revert v2.14?";
const OPTIONS = ["Patch forward: null guard + the new test", "Revert v2.14 (also drops its tax fix)"];
const SAY_1 = "Pulling the stack trace for CHECKOUT-1942, then reproducing it from a captured event.";
const SAY_2 =
  "a41c9e2 (v2.14) made coupons optional, but cart/totals.ts still reads coupon.rate. I can patch forward with a guard and the failing test, or revert the release, which also drops the tax fix shipped with it. That trade-off is yours.";
const SAY_3 = "Patching forward. The new test goes from red to green.";

const BISECT = ["bisecting: 14 revisions left (~4 steps)", "bisecting: 6 revisions left (~3 steps)", "bisecting: 2 revisions left (~1 step)", "a41c9e2 is the first bad commit · v2.14.0"];

const PLAN = [
  { text: "Reproduce from the stack trace", active: 3400, done: 5700 },
  { text: "Bisect to the bad commit", active: 5700, done: 7800 },
  { text: "Write a failing test", active: 7800, done: 9500 },
  { text: "Fix, verify, open the PR", active: 13700, done: 17200 },
];

type RunState = "triggered" | "booting" | "working" | "needs you" | "done";
function stateAt(t: number): RunState {
  if (t < 1600) return "triggered";
  if (t < 3000) return "booting";
  if (t < 10600) return "working";
  if (t < 13700) return "needs you";
  if (t < 17600) return "working";
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
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 120);
      last = now;
      setT((p) => (p + dt >= LOOP ? 0 : p + dt));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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
    const next = CHAPTERS[i + 1]?.at ?? LOOP;
    setT(reduced ? next - 1 : CHAPTERS[i].at);
  };
  const replay = () => {
    setT(0);
    setPlaying(true);
  };

  return (
    <figure ref={rootRef} className="mt-12" aria-labelledby="demo-title" aria-describedby="demo-summary">
      <p id="demo-summary" className="sr-only">
        At 3:12 a.m. a production error spike on a checkout service arrives as a webhook. An automation starts a run in its own
        microVM with an egress allowlist. The agent reproduces the error from a captured event, bisects to the commit
        that caused it, and writes a failing test. It then asks one question, patch forward or revert the release, answered with
        one tap on a phone push. It applies the fix, verifies it, opens a pull request, and posts a receipt on the alert. A chained
        automation then updates the changelog in a second run. Both runs appear in History.
      </p>

      {/* chapter scrubber */}
      <div className="grid grid-cols-6 gap-1.5 sm:gap-3" role="group" aria-label="Scenario chapters">
        {CHAPTERS.map((c, i) => {
          const end = CHAPTERS[i + 1]?.at ?? END;
          const fill = Math.max(0, Math.min(1, (t - c.at) / (end - c.at)));
          const ask = c.key === "ask";
          const on = chapter === i;
          return (
            <button key={c.key} type="button" onClick={() => seek(i)} aria-current={on ? "step" : undefined} aria-label={`Chapter ${i + 1}: ${c.label}, ${c.sub}`} className={cn(focusRing, "group min-w-0 rounded-sm py-1 text-left")}>
              <span className="bg-muted relative block h-[3px] overflow-hidden rounded-full">
                <span className={cn("absolute inset-y-0 left-0 rounded-full", ask ? "bg-attention" : "bg-foreground")} style={{ width: `${fill * 100}%` }} />
              </span>
              <span className={cn("mt-2 flex items-center gap-1.5 text-micro font-semibold transition-colors duration-200", on ? (ask ? "text-attention-text" : "text-foreground") : "text-muted-foreground group-hover:text-foreground")}>
                <span className="stamp hidden font-normal sm:inline">{String(i + 1).padStart(2, "0")}</span>
                <span className="truncate">{"short" in c ? <><span className="sm:hidden">{c.short}</span><span className="hidden sm:inline">{c.label}</span></> : c.label}</span>
              </span>
              <span className="text-muted-foreground mt-0.5 hidden truncate text-micro lg:block">{c.sub}</span>
            </button>
          );
        })}
      </div>

      {/* the product window */}
      <div className="bg-card shadow-e5 relative mt-5 overflow-hidden rounded-xl border">
        <Header t={t} state={state} />
        <div className="grid md:grid-cols-[minmax(0,1fr)_16.5rem]">
          <Thread t={t} reduced={reduced} />
          <SidePanel t={t} state={state} />
        </div>
        <Push t={t} reduced={reduced} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" onClick={() => (reduced ? replay() : setPlaying(!playing))} className={cn(focusRing, ctrlBtn)} aria-label={playing && !reduced ? "Pause the scenario" : "Play the scenario"}>
          {playing && !reduced ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          {playing && !reduced ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={replay} className={cn(focusRing, ctrlBtn)} aria-label="Replay the scenario from the start">
          <RotateCcw className="size-3.5" aria-hidden /> Replay
        </button>
        <span className="stamp text-muted-foreground ml-auto tabular-nums" aria-hidden>
          {humanTouches(t)} human {humanTouches(t) === 1 ? "tap" : "taps"} · {runsStarted(t)} {runsStarted(t) === 1 ? "run" : "runs"}
        </span>
      </div>
    </figure>
  );
}

const humanTouches = (t: number) => (t >= 12900 ? 1 : 0);
const runsStarted = (t: number) => (t >= 18400 ? 2 : t >= 1000 ? 1 : 0);

const focusRing = "focus-visible:ring-ring focus-visible:ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
const ctrlBtn = "text-foreground hover:bg-muted inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-micro font-medium transition-colors duration-200 ease-out";

/* ───────────── header ───────────── */

const PILL: Record<RunState, string> = {
  triggered: "bg-muted text-muted-foreground ring-border",
  booting: "bg-live/10 text-live ring-live/20",
  working: "bg-live/10 text-live ring-live/20",
  "needs you": "bg-card text-attention-text ring-attention/60",
  done: "bg-ok/10 text-ok ring-ok/20",
};

function StatePill({ state, small }: { state: RunState; small?: boolean }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset transition-colors duration-200", small ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-micro", PILL[state])}>
      {(state === "working" || state === "booting") && <CircleDot className="breathe size-3" strokeWidth={2.5} aria-hidden />}
      {state === "needs you" && <Pause className="size-3" strokeWidth={2.5} aria-hidden />}
      {state === "done" && <Check className="size-3" strokeWidth={3} aria-hidden />}
      {state === "triggered" && <Webhook className="size-3" aria-hidden />}
      {state}
    </span>
  );
}

function Header({ t, state }: { t: number; state: RunState }) {
  const min = 12 + Math.round((Math.min(t, END) / END) * 19);
  const plan = PLAN.filter((p) => t >= p.done).length;
  return (
    <div className="flex h-12 items-center gap-2.5 border-b px-3 sm:px-4">
      <StatePill state={state} />
      <span className="text-foreground min-w-0 truncate text-meta font-medium">
        <span className="text-muted-foreground hidden font-normal sm:inline">acme/checkout-svc · </span>TypeError spike in cart totals
      </span>
      <span className="stamp text-muted-foreground ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 tabular-nums md:hidden" aria-label={`Plan ${plan} of 4`}>
        {plan}/4
      </span>
      <span className="stamp text-muted-foreground hidden shrink-0 tabular-nums sm:inline md:ml-auto">03:{String(min).padStart(2, "0")} a.m.</span>
    </div>
  );
}

/* ───────────── the thread ───────────── */

type Item = { at: number; node: (t: number) => React.ReactNode; className?: string };

const ITEMS: Item[] = [
  { at: 0, node: (t) => <AlertCard t={t} /> },
  { at: 1600, node: (t) => <BootLine t={t} /> },
  { at: 3000, node: (t) => <SayTyped text={SAY_1} at={3000} t={t} /> },
  { at: 3700, node: (t) => <ToolRow t={t} doneAt={4200} icon={<Webhook />} name="alert" arg="get CHECKOUT-1942 --stack" result="cart/totals.ts:88" /> },
  { at: 4400, node: (t) => <ToolRow t={t} doneAt={4800} icon={<FileText />} name="Read" arg="src/cart/totals.ts" result="188 lines" /> },
  { at: 5000, node: (t) => <ToolRow t={t} doneAt={5600} icon={<Terminal />} name="Bash" arg="node scripts/replay.js evt_8f2c" result="reproduced · TypeError" tone="fail" /> },
  { at: 5900, node: (t) => <BisectRow t={t} /> },
  { at: 7900, node: (t) => <ToolRow t={t} doneAt={8200} icon={<FilePlus2 />} name="Write" arg="test/totals.null-coupon.test.ts" result={<span className="text-ok">+24</span>} /> },
  { at: 8400, node: (t) => <ToolRow t={t} doneAt={9000} icon={<Terminal />} name="Bash" arg="npm test -- null-coupon" result="1 failed, as expected" tone="fail" /> },
  { at: 9300, node: (t) => <SayTyped text={SAY_2} at={9300} t={t} cps={190} /> },
  { at: 10600, node: (t) => <QuestionCard t={t} /> },
  {
    at: 13300,
    className: "flex flex-col items-end gap-1",
    node: () => (
      <>
        <span className="bg-muted max-w-[85%] rounded-xl rounded-br-md px-3.5 py-2">Patch forward</span>
        <span className="stamp text-muted-foreground inline-flex items-center gap-1">
          <Smartphone className="size-3" aria-hidden /> one tap, from a phone
        </span>
      </>
    ),
  },
  { at: 13700, node: (t) => <SayTyped text={SAY_3} at={13700} t={t} /> },
  { at: 14200, node: (t) => <ToolRow t={t} doneAt={14500} icon={<FileText />} name="Edit" arg="src/cart/totals.ts" result={<><span className="text-ok">+4</span> <span className="text-destructive">−1</span></>} /> },
  { at: 14700, node: (t) => <ToolRow t={t} doneAt={15500} icon={<Terminal />} name="Bash" arg="npm run typecheck && npm test" result="213 passed" tone="ok" /> },
  { at: 15700, node: (t) => <ToolRow t={t} doneAt={16200} icon={<GitPullRequest />} name="gh" arg="pr create --base main" result="#2231 · PR-only" tone="ok" /> },
  { at: 16600, node: () => <Receipt /> },
  { at: 18400, node: (t) => <ChainCard t={t} /> },
  { at: 21400, node: () => <HistoryStrip /> },
];

function Thread({ t, reduced }: { t: number; reduced: boolean }) {
  const shown = ITEMS.filter((it) => t >= it.at);
  return (
    <div
      className="relative flex h-[33rem] flex-col justify-end gap-3 overflow-hidden px-3 py-4 text-meta sm:h-[35rem] sm:px-5"
      style={{ maskImage: "linear-gradient(to bottom, transparent 0, #000 4.5rem)", WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 4.5rem)" }}
    >
      <AnimatePresence>
        {!reduced && t < 2900 && (
          <motion.div
            key="title"
            className="pointer-events-none absolute inset-x-0 top-[22%] flex flex-col items-center text-center"
            initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -10, filter: "blur(6px)", transition: { duration: 0.5 } }}
            transition={{ duration: 0.8, ease: EASE }}
            aria-hidden
          >
            <span className="stamp text-muted-foreground">03:12 a.m. · production</span>
            <span className="text-foreground mt-2 font-serif text-[clamp(1.5rem,3vw,2.2rem)] leading-tight tracking-[-0.02em]">Nobody is at the keyboard.</span>
          </motion.div>
        )}
      </AnimatePresence>
      {shown.map((it, i) => {
        // Camera focus: the newest few beats stay in full ink; older ones recede.
        const age = shown.length - 1 - i;
        const dim = !reduced && age >= 4;
        return (
          <motion.div
            key={it.at}
            className={it.className}
            initial={reduced ? false : { opacity: 0, y: 12, filter: "blur(3px)" }}
            animate={{ opacity: dim ? 0.42 : 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.36, ease: EASE }}
            layout={reduced ? false : "position"}
          >
            {it.node(t)}
          </motion.div>
        );
      })}
    </div>
  );
}

function Caret({ on }: { on: boolean }) {
  return on ? <span className="bg-live ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse" aria-hidden /> : null;
}

function SayTyped({ text, at, t, cps }: { text: string; at: number; t: number; cps?: number }) {
  const s = typed(text, at, t, cps);
  return (
    <div className="text-foreground max-w-[64ch] leading-relaxed">
      {s.text}
      <Caret on={!s.done} />
    </div>
  );
}

function AlertCard({ t }: { t: number }) {
  const matched = t >= 700;
  const queued = t >= 1150;
  return (
    <div className="rounded-lg border px-3.5 py-3">
      <div className="text-muted-foreground flex items-center gap-2 text-micro">
        <span className="bg-destructive/10 text-destructive grid size-5 place-items-center rounded">
          <Webhook className="size-3" aria-hidden />
        </span>
        <span className="font-medium">Webhook · error monitor</span>
        <span className="stamp">CHECKOUT-1942</span>
        <span className="stamp ml-auto">03:12:04</span>
      </div>
      <p className="text-foreground mt-2 font-mono text-micro leading-relaxed">TypeError: Cannot read properties of undefined (reading 'rate')</p>
      <p className="text-muted-foreground mt-0.5 text-micro">cart/totals.ts:88 · 412 events in 5 min · production</p>
      <AnimatePresence>
        {matched && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2.5 text-micro">
              <Link2 className="text-live size-3.5" aria-hidden />
              <span className="text-foreground font-medium">Automation matched</span>
              <span className="text-muted-foreground">Prod error spike → triage</span>
              {queued && (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="stamp text-muted-foreground ml-auto">
                  run started · nobody at the keyboard
                </motion.span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BootLine({ t }: { t: number }) {
  const up = t >= 2800;
  const hosts = ["github.com", "api.anthropic.com", "errors.acme.dev"];
  const n = Math.min(hosts.length, Math.max(0, Math.floor((t - 1800) / 220)));
  return (
    <div className="text-muted-foreground flex flex-col gap-1.5 text-micro">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Cpu className={cn("size-3.5 transition-colors duration-200", up ? "text-ok" : "text-live")} aria-hidden />
        <span className="text-foreground font-medium">{up ? "microVM up" : "Booting microVM…"}</span>
        <span className="stamp">fc-7b2e · KVM · 2 vCPU</span>
        <span className="stamp">harness: triage · Claude Code · Sonnet</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-[22px]">
        <Globe className="size-3" aria-hidden />
        <span>egress</span>
        {hosts.slice(0, n).map((h) => (
          <motion.span key={h} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="stamp rounded border px-1.5">
            {h}
          </motion.span>
        ))}
        {n === hosts.length && <span className="stamp">· all else refused</span>}
      </div>
    </div>
  );
}

function ToolRow({ t, doneAt, icon, name, arg, result, tone, children }: { t: number; doneAt: number; icon: React.ReactNode; name: string; arg: string; result: React.ReactNode; tone?: "ok" | "fail"; children?: React.ReactNode }) {
  const done = t >= doneAt;
  return (
    <div className="bg-muted/55 text-foreground rounded-md border font-mono text-micro">
      <div className="flex min-w-0 items-center gap-2.5 px-3 py-1.5">
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
      {children}
    </div>
  );
}

function BisectRow({ t }: { t: number }) {
  const n = Math.min(BISECT.length, Math.max(1, Math.floor((t - 5900) / 380) + 1));
  return (
    <ToolRow t={t} doneAt={7500} icon={<GitBranch />} name="Bash" arg="git bisect run npm test -- totals" result="first bad: a41c9e2" tone="ok">
      <div className="border-t px-3 py-1.5 pl-9 leading-relaxed opacity-80">
        {BISECT.slice(0, n).map((l, i) => (
          <motion.p key={l} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }} className={cn(i === BISECT.length - 1 && "text-foreground font-semibold")}>
            {l}
          </motion.p>
        ))}
      </div>
    </ToolRow>
  );
}

function QuestionCard({ t }: { t: number }) {
  const picked = t >= 12900;
  const answered = t >= 13300;
  return (
    <div className={cn("rounded-xl border transition-colors duration-300", answered ? "border-border" : "border-attention/60 bg-attention/[0.05]")}>
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
      {!answered && <p className="text-muted-foreground border-t px-4 py-2 text-micro">Tool calls are held until someone answers. A push went to your phone.</p>}
    </div>
  );
}

function Receipt() {
  return (
    <div className="bg-card raised rounded-xl border px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="bg-ok size-2 shrink-0 rounded-full" aria-hidden />
        <span className="label text-ok shrink-0">Done</span>
        <span className="text-foreground min-w-0 flex-1 truncate">Guard optional coupons in cart totals</span>
        <span className="stamp text-muted-foreground shrink-0">19 min</span>
      </div>
      <p className="stamp text-muted-foreground mt-1.5 truncate pl-[18px]">bisected to a41c9e2 · 2 files · +28 −1 · 1 question · started by webhook</p>
      <p className="text-ok mt-1 truncate pl-[18px] text-micro">
        <Check className="mr-1 inline size-3" strokeWidth={3} aria-hidden />
        Verified: typecheck + 213 tests pass
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t pt-2.5 pl-[18px]">
        <span className="text-foreground inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-micro font-medium">
          <GitPullRequest className="text-ok size-3" aria-hidden /> PR #2231 · fix/null-coupon
        </span>
        <span className="text-muted-foreground text-micro">Receipt posted on CHECKOUT-1942</span>
      </div>
    </div>
  );
}

function ChainCard({ t }: { t: number }) {
  const s: RunState = t < 19000 ? "triggered" : t < 19600 ? "booting" : t < 21000 ? "working" : "done";
  return (
    <div className="rounded-xl border border-dashed px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="text-muted-foreground size-3.5" aria-hidden />
        <span className="label text-muted-foreground">Chained · after triage</span>
        <span className="text-foreground min-w-0 flex-1 truncate font-medium">Changelog + release notes</span>
        <StatePill state={s} small />
      </div>
      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-[22px] font-mono text-micro">
        <span>new microVM fc-91d0</span>
        {t >= 19600 && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            Edit CHANGELOG.md <span className="text-ok">+3</span>
          </motion.span>
        )}
        {t >= 21000 && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-foreground inline-flex items-center gap-1">
            <GitPullRequest className="text-ok size-3" aria-hidden /> PR #2232
          </motion.span>
        )}
      </div>
    </div>
  );
}

function HistoryStrip() {
  const rows = [
    ["03:31", "Guard optional coupons in cart totals", "webhook", "1 question", "$0.84"],
    ["03:33", "Changelog + release notes", "chain", "no questions", "$0.06"],
  ];
  return (
    <div className="rounded-lg border">
      <div className="text-muted-foreground flex items-center gap-2 border-b px-3.5 py-1.5 text-micro">
        <History className="size-3.5" aria-hidden />
        <span className="font-medium">History</span>
        <span className="stamp ml-auto">tonight · 2 runs · 2 PRs · $0.90</span>
      </div>
      <ul className="text-micro">
        {rows.map((r) => (
          <li key={r[1]} className="flex items-center gap-2.5 px-3.5 py-1.5">
            <Check className="text-ok size-3 shrink-0" strokeWidth={3} aria-hidden />
            <span className="stamp text-muted-foreground shrink-0">{r[0]}</span>
            <span className="text-foreground min-w-0 flex-1 truncate">{r[1]}</span>
            <span className="stamp text-muted-foreground hidden shrink-0 sm:inline">{r[2]}</span>
            <span className="stamp text-muted-foreground hidden shrink-0 sm:inline">{r[3]}</span>
            <span className="stamp text-foreground shrink-0 tabular-nums">{r[4]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────── side panel ───────────── */

function Section({ label, focus, children, right }: { label: string; focus: boolean; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className={cn("relative border-b px-4 py-3.5 transition-colors duration-500", focus && "bg-muted/45")}>
      <span className={cn("bg-foreground absolute inset-y-3 left-0 w-[2px] rounded-full transition-opacity duration-500", focus ? "opacity-70" : "opacity-0")} aria-hidden />
      <div className="flex items-center justify-between gap-2">
        <p className="label text-muted-foreground">{label}</p>
        {right}
      </div>
      {children}
    </section>
  );
}

function SidePanel({ t, state }: { t: number; state: RunState }) {
  const done = PLAN.filter((p) => t >= p.done).length;
  const working = Math.max(0, Math.min(t, 10600) - 3000) + Math.max(0, Math.min(t, 17600) - 13700);
  const spend = t < 3000 ? 0 : 0.03 + working * 0.00007;
  const minutes = Math.round((Math.min(t, END) / END) * 19);
  const focus = t < 1600 ? "trigger" : t < 3000 ? "machine" : t < 10600 ? "plan" : t < 13700 ? "cost" : t < 18400 ? "plan" : "trigger";
  return (
    <aside className="hidden flex-col border-l md:flex" aria-label="Run details">
      <Section label="Trigger" focus={focus === "trigger"}>
        <p className="text-foreground mt-2 flex items-center gap-2 text-micro font-medium">
          {t >= 18400 ? <Link2 className="size-3.5" aria-hidden /> : <Webhook className="size-3.5" aria-hidden />}
          {t >= 18400 ? "Chain · after triage" : "Webhook · error monitor"}
        </p>
        <p className="stamp text-muted-foreground mt-1">{t >= 18400 ? "Changelog + release notes" : "Prod error spike → triage"}</p>
      </Section>
      <Section label="Plan" focus={focus === "plan"} right={<span className="stamp text-muted-foreground tabular-nums">{done}/{PLAN.length}</span>}>
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
      </Section>
      <Section
        label="Cost"
        focus={focus === "cost"}
        right={
          <span className="text-foreground inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-micro font-medium tabular-nums">
            <Timer className="size-3" aria-hidden /> {minutes} min
          </span>
        }
      >
        <p className="stamp text-muted-foreground mt-2 tabular-nums">${spend.toFixed(2)} · {Math.round(working / 40).toLocaleString("en-US")}k tokens</p>
        <p className="text-muted-foreground mt-1.5 text-micro leading-snug">Dollars only for a priced model; never a guess.</p>
      </Section>
      <Section label="Machine" focus={focus === "machine"}>
        <p className="text-foreground mt-2 flex items-center gap-2 text-micro font-medium">
          <span className={cn("size-2 rounded-full", state === "needs you" ? "bg-attention" : state === "done" ? "bg-sleep" : state === "triggered" ? "bg-muted-foreground/50" : "bg-live breathe")} aria-hidden />
          {state === "triggered" ? "Claiming a warm machine" : state === "booting" ? "Booting" : state === "needs you" ? "Waiting on you" : state === "done" ? "Sleeping · wakes on reply" : `Heartbeat ${1 + (Math.floor(t / 1000) % 3)}s ago`}
        </p>
        <p className="stamp text-muted-foreground mt-1">fc-7b2e · KVM · egress: 3 hosts</p>
        <p className="text-muted-foreground mt-2.5 flex items-start gap-1.5 text-micro leading-snug">
          <ShieldCheck className="mt-px size-3 shrink-0" aria-hidden /> PR-only: pushes to main are refused in the machine.
        </p>
      </Section>
    </aside>
  );
}

/* ───────────── the phone push ───────────── */

function Push({ t, reduced }: { t: number; reduced: boolean }) {
  const show = t >= 11400 && t < 13400;
  const tapped = t >= 12900;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="push"
          initial={reduced ? false : { opacity: 0, y: -18, scale: 0.97, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, scale: tapped ? 0.985 : 1, filter: "blur(0px)" }}
          exit={reduced ? undefined : { opacity: 0, y: -12, transition: { duration: 0.2 } }}
          transition={{ duration: 0.4, ease: EASE }}
          className="absolute top-14 right-3 left-3 z-10 sm:left-auto sm:w-[22rem]"
          aria-hidden
        >
          <div className="bg-popover/95 shadow-e5 rounded-2xl border px-3.5 py-3 backdrop-blur">
            <div className="text-muted-foreground flex items-center gap-2 text-micro">
              <span className="bg-primary text-primary-foreground grid size-5 place-items-center rounded-[6px]">
                <Logo className="size-3" />
              </span>
              <span className="font-medium">Agent Sandbox</span>
              <Smartphone className="ml-auto size-3" />
              <span>now</span>
            </div>
            <p className="text-foreground mt-1.5 flex items-center gap-1.5 text-meta font-semibold">
              <Pause className="text-attention-text size-3" strokeWidth={2.5} /> checkout-svc needs you
            </p>
            <p className="text-muted-foreground mt-0.5 text-micro">{Q}</p>
            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
              <span className={cn("rounded-lg px-2 py-1.5 text-center text-micro font-medium transition-colors duration-200", tapped ? "bg-attention text-attention-ink" : "bg-muted text-foreground")}>Patch forward</span>
              <span className="bg-muted text-foreground rounded-lg px-2 py-1.5 text-center text-micro font-medium">Revert v2.14</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
