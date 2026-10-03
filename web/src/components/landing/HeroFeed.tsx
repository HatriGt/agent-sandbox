import * as React from "react";
import { CalendarClock, Check, CircleDot, GitPullRequest, Link2, Pause, Webhook } from "lucide-react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * The hero's compact, looping automations feed: events arrive, runs start themselves, one stops to ask,
 * the rest finish with receipts. One clock, pauses offscreen; reduced motion shows the settled frame.
 * Illustrative, like the scenario below it.
 */

const LOOP = 15_000;
const EASE = [0.22, 1, 0.36, 1] as const;

type S = "working" | "needs you" | "done";
type Row = {
  at: number;
  kind: "webhook" | "schedule" | "github" | "chain";
  source: string;
  title: string;
  steps: Array<[number, S, string]>; // [at, state, detail]
};

const ROWS: Row[] = [
  { at: 0, kind: "schedule", source: "cron 03:00", title: "Nightly dependency bumps", steps: [[0, "working", "3 packages"], [2600, "done", "PR #88 · tests pass"]] },
  { at: 1400, kind: "webhook", source: "error monitor", title: "TypeError spike in cart totals", steps: [[1400, "working", "bisecting…"], [5200, "needs you", "patch or revert?"], [8200, "working", "patching"], [10400, "done", "PR #2231 · receipt"]] },
  { at: 3600, kind: "github", source: "issue labelled", title: "Flaky upload retry test", steps: [[3600, "working", "reproducing"], [7600, "done", "PR #412 · receipt"]] },
  { at: 6400, kind: "github", source: "PR opened", title: "Review #2229 · pricing API", steps: [[6400, "working", "reading diff"], [9400, "done", "review posted"]] },
  { at: 10900, kind: "chain", source: "after triage", title: "Changelog + release notes", steps: [[10900, "working", "new microVM"], [13200, "done", "PR #2232"]] },
];

/** Earlier tonight: settled rows under the live ones, so the feed is never empty at the top of a loop. */
const EARLIER: Row[] = [
  { at: -1, kind: "github", source: "/agent comment", title: "Add retries to webhook sender", steps: [[0, "done", "PR #2226 · receipt"]] },
  { at: -2, kind: "schedule", source: "cron 02:00", title: "Weekly flaky-test sweep", steps: [[0, "done", "2 fixed · PR #2224"]] },
];

const KIND_ICON = { webhook: Webhook, schedule: CalendarClock, github: GitPullRequest, chain: Link2 } as const;
const KIND_LABEL = { webhook: "webhook", schedule: "schedule", github: "GitHub", chain: "chain" } as const;

const PILL: Record<S, string> = {
  working: "bg-live/10 text-live ring-live/20",
  "needs you": "bg-attention/20 text-attention-text ring-attention/40",
  done: "bg-ok/10 text-ok ring-ok/20",
};

export function HeroFeed({ className }: { className?: string }) {
  const reduced = !!useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { amount: 0.2 });
  const [t, setT] = React.useState(reduced ? LOOP - 1 : 0);
  React.useEffect(() => {
    if (reduced) {
      setT(LOOP - 1);
      return;
    }
    if (!visible) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(now - last, 120);
      last = now;
      setT((p) => (p + dt >= LOOP ? 0 : p + dt));
    }, 100);
    return () => window.clearInterval(id);
  }, [reduced, visible]);

  const rows = [...ROWS.filter((r) => t >= r.at).reverse(), ...EARLIER]; // newest on top
  const asking = rows.some((r) => stepAt(r, t)[1] === "needs you");
  const receipts = rows.filter((r) => r.at >= 0).filter((r) => stepAt(r, t)[1] === "done").length;

  return (
    <div ref={ref} className={cn("bg-card shadow-e5 overflow-hidden rounded-xl border", className)} role="img" aria-label="Illustrative automations feed: a schedule, an error webhook, two GitHub events and a chained run each start a run on their own. One stops to ask a question, the rest finish with pull requests and receipts.">
      <div className="flex h-11 items-center gap-2 border-b px-4">
        <span className="bg-ok size-1.5 rounded-full" aria-hidden />
        <span className="text-meta font-semibold">Autopilot</span>
        <span className="text-muted-foreground text-micro">· listening</span>
        <span className="stamp text-muted-foreground ml-auto tabular-nums">
          {receipts} new {receipts === 1 ? "receipt" : "receipts"}
        </span>
      </div>
      <ul className="relative flex h-[19.5rem] flex-col overflow-hidden sm:h-[21.5rem]" aria-hidden style={{ maskImage: "linear-gradient(to bottom, #000 80%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, #000 80%, transparent)" }}>
        <AnimatePresence initial={false}>
          {rows.map((r) => {
            const [, s, detail] = stepAt(r, t);
            const Icon = KIND_ICON[r.kind];
            return (
              <motion.li
                key={r.at}
                layout={reduced ? false : "position"}
                initial={reduced ? false : { opacity: 0, y: -14, filter: "blur(3px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.45, ease: EASE }}
                className={cn("relative border-b px-4 py-3 transition-colors duration-500", s === "needs you" && "bg-attention/[0.06]")}
              >
                {s === "needs you" && <span className="bg-attention absolute inset-y-0 left-0 w-[3px]" />}
                <div className="text-muted-foreground flex items-center gap-1.5 text-micro">
                  <Icon className="size-3.5 shrink-0" />
                  <span className="font-medium">{KIND_LABEL[r.kind]}</span>
                  <span className="stamp truncate">· {r.source}</span>
                </div>
                <div className="mt-1 flex items-center gap-2.5">
                  <span className="text-foreground min-w-0 flex-1 truncate text-meta font-medium">{r.title}</span>
                  <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold ring-1 ring-inset transition-colors duration-300", PILL[s])}>
                    {s === "working" && <CircleDot className="breathe size-2.5" strokeWidth={2.5} />}
                    {s === "needs you" && <Pause className="size-2.5" strokeWidth={2.5} />}
                    {s === "done" && <Check className="size-2.5" strokeWidth={3} />}
                    {s}
                  </span>
                </div>
                <p className={cn("stamp mt-0.5 truncate", s === "needs you" ? "text-attention-text" : "text-muted-foreground")}>{detail}</p>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      <div className="text-muted-foreground flex h-10 items-center gap-2 border-t px-4 text-micro">
        <span className={cn("size-1.5 rounded-full transition-colors duration-300", asking ? "bg-attention" : "bg-muted-foreground/40")} aria-hidden />
        {asking ? <span className="text-attention-text font-medium">1 run is asking you · push sent</span> : <span>Nothing needs you.</span>}
        <span className="stamp ml-auto hidden sm:inline">each in its own microVM</span>
      </div>
    </div>
  );
}

function stepAt(r: Row, t: number) {
  return r.steps.reduce((acc, s) => (t >= s[0] ? s : acc), r.steps[0]);
}
