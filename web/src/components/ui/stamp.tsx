import { cn } from "@/lib/utils";
import { doneLabel, isFailedExit } from "@/lib/format";
import type { RunState } from "@/lib/api";

/**
 * State as a machine stamp — functional colour, the loudest signal in the console. Each state pairs a
 * hue with a distinct glyph + word so meaning survives colourblindness (never colour alone):
 *   working → azure pulse · needs-you → amber (the one thing with a deadline) · done → slate · error → red.
 */
const TONE: Record<RunState, { cls: string; glyph: string; word: (exit?: number) => string }> = {
  running: { cls: "text-azure-text", glyph: "●", word: () => "working" },
  waiting: { cls: "text-[var(--attention-text)]", glyph: "❚❚", word: () => "needs you" },
  // Success is just "done" — surfacing "exit 0" reads like an error code to a non-engineer. Only a
  // non-zero (or unknown) exit earns the code, which is then also coloured red below.
  done: { cls: "text-ash", glyph: "■", word: (e) => doneLabel(e) },
  idle: { cls: "text-ash", glyph: "○", word: () => "idle" },
};

export function StateStamp({
  state,
  exitCode,
  className,
}: {
  state: RunState;
  exitCode?: number;
  className?: string;
}) {
  const t = TONE[state];
  // A non-zero exit is a failure — surface it in red rather than neutral slate.
  const cls = state === "done" && isFailedExit(exitCode) ? "text-[var(--danger)]" : t.cls;
  return (
    <span className={cn("stamp inline-flex items-center gap-1.5", cls, className)}>
      <span aria-hidden className={cn("text-[8px] leading-none", state === "running" && "breathe")}>
        {t.glyph}
      </span>
      {t.word(exitCode)}
    </span>
  );
}
