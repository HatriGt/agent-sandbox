import { CircleDot, Pause, Check, X, Circle, MoonStar, Hourglass, type LucideProps } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { doneLabel, isFailedExit } from "@/lib/format";
import type { DisplayState } from "@/lib/lifecycle";

/**
 * Run state, the loudest signal in the console.
 *
 * Each state pairs a functional hue with a drawn icon AND a word, so meaning survives colour-blindness
 * and bright sunlight: working → live blue, breathing · needs you → ink pause on paper · done → green check ·
 * failed → red cross · idle → hollow grey circle · sleeping → violet moon (an idle-stopped microVM
 * whose workspace and session survive; a reply wakes it).
 *
 *   · `StateStamp` — inline text: icon + word, for list rows, tables and the palette.
 *   · `StatePill`  — a tinted pill for the thread header, where the state anchors the whole view.
 */
type Tone = { icon: React.ComponentType<LucideProps>; word: (exit?: number) => string; text: string; pill: string };

const TONE: Record<DisplayState | "failed" | "stalled", Tone> = {
  // Running, but no action for the stall window: the failed hue with its own glyph (src/stall.ts).
  stalled: { icon: Hourglass, word: () => "stalled", text: "text-destructive", pill: "bg-destructive/10 text-destructive ring-destructive/20" },
  running: { icon: CircleDot, word: () => "working", text: "text-live", pill: "bg-live/10 text-live ring-live/20" },
  waiting: {
    icon: Pause,
    word: () => "needs you",
    text: "text-attention-text",
    pill: "bg-card text-attention-text ring-attention/60 shadow-e1",
  },
  done: { icon: Check, word: (e) => doneLabel(e), text: "text-ok", pill: "bg-ok/10 text-ok ring-ok/20" },
  failed: {
    icon: X,
    word: (e) => doneLabel(e),
    text: "text-destructive",
    pill: "bg-destructive/10 text-destructive ring-destructive/20",
  },
  idle: { icon: Circle, word: () => "idle", text: "text-muted-foreground", pill: "bg-muted text-muted-foreground ring-border" },
  sleeping: {
    icon: MoonStar,
    word: () => "sleeping",
    text: "text-sleep",
    pill: "bg-sleep/10 text-sleep ring-sleep/20",
  },
};

function toneOf(state: DisplayState, exitCode?: number, stalled?: boolean): Tone {
  if (stalled && state === "running") return TONE.stalled;
  return state === "done" && isFailedExit(exitCode) ? TONE.failed : TONE[state];
}

export function StateStamp({
  state,
  exitCode,
  stalled,
  className,
}: {
  state: DisplayState;
  exitCode?: number;
  stalled?: boolean;
  className?: string;
}) {
  const t = toneOf(state, exitCode, stalled);
  const Icon = t.icon;
  return (
    <span className={cn("label inline-flex items-center gap-1.5 font-medium", t.text, className)}>
      <span key={`${state}-${exitCode ?? ""}-${stalled ? "s" : ""}`} className="pop-in inline-flex items-center gap-1.5">
        <Icon className={cn("size-3 shrink-0", state === "running" && !stalled && "breathe")} aria-hidden strokeWidth={2.5} />
        {t.word(exitCode)}
      </span>
    </span>
  );
}

export function StatePill({
  state,
  exitCode,
  stalled,
  className,
}: {
  state: DisplayState;
  exitCode?: number;
  stalled?: boolean;
  className?: string;
}) {
  const t = toneOf(state, exitCode, stalled);
  const Icon = t.icon;
  // The pill crossfades when the state flips (working → needs you → done → sleeping) instead of
  // snapping: a state change is an event worth a beat, and the beat makes it legible.
  // The outer pill owns `layout` so its width glides between words (working → needs you) while the
  // keyed content crossfades inside; colours ease via CSS so the tone change never snaps.
  return (
    <motion.span
      layout
      transition={{ layout: { type: "spring", stiffness: 500, damping: 40 } }}
      style={{ borderRadius: 9999 }}
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-micro font-semibold ring-1 ring-inset transition-colors duration-200",
        t.pill,
        className
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={`${state}-${exitCode ?? ""}-${stalled ? "s" : ""}`}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <Icon className={cn("size-3 shrink-0", state === "running" && !stalled && "breathe")} aria-hidden strokeWidth={2.5} />
          {t.word(exitCode)}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}
