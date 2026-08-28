import { CircleDot, Pause, Check, X, Circle, MoonStar, type LucideProps } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { doneLabel, isFailedExit } from "@/lib/format";
import type { DisplayState } from "@/lib/lifecycle";

/**
 * Run state, the loudest signal in the console.
 *
 * Each state pairs a functional hue with a drawn icon AND a word, so meaning survives colour-blindness
 * and bright sunlight: working → live blue, breathing · needs you → amber pause · done → green check ·
 * failed → red cross · idle → hollow grey circle · sleeping → violet moon (an idle-stopped microVM
 * whose workspace and session survive; a reply wakes it).
 *
 *   · `StateStamp` — inline text: icon + word, for list rows, tables and the palette.
 *   · `StatePill`  — a tinted pill for the thread header, where the state anchors the whole view.
 */
type Tone = { icon: React.ComponentType<LucideProps>; word: (exit?: number) => string; text: string; pill: string };

const TONE: Record<DisplayState | "failed", Tone> = {
  running: { icon: CircleDot, word: () => "working", text: "text-live", pill: "bg-live/10 text-live ring-live/20" },
  waiting: {
    icon: Pause,
    word: () => "needs you",
    text: "text-attention-text",
    pill: "bg-attention/20 text-attention-text ring-attention/40",
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

function toneOf(state: DisplayState, exitCode?: number): Tone {
  return state === "done" && isFailedExit(exitCode) ? TONE.failed : TONE[state];
}

export function StateStamp({
  state,
  exitCode,
  className,
}: {
  state: DisplayState;
  exitCode?: number;
  className?: string;
}) {
  const t = toneOf(state, exitCode);
  const Icon = t.icon;
  return (
    <span className={cn("label inline-flex items-center gap-1.5 font-medium", t.text, className)}>
      <Icon className={cn("size-3 shrink-0", state === "running" && "breathe")} aria-hidden strokeWidth={2.5} />
      {t.word(exitCode)}
    </span>
  );
}

export function StatePill({
  state,
  exitCode,
  className,
}: {
  state: DisplayState;
  exitCode?: number;
  className?: string;
}) {
  const t = toneOf(state, exitCode);
  const Icon = t.icon;
  // The pill crossfades when the state flips (working → needs you → done → sleeping) instead of
  // snapping: a state change is an event worth a beat, and the beat makes it legible.
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={`${state}-${exitCode ?? ""}`}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.92 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-micro font-semibold ring-1 ring-inset",
          t.pill,
          className
        )}
      >
        <Icon className={cn("size-3 shrink-0", state === "running" && "breathe")} aria-hidden strokeWidth={2.5} />
        {t.word(exitCode)}
      </motion.span>
    </AnimatePresence>
  );
}
