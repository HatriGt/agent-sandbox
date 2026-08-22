import { cn } from "@/lib/utils";
import type { RunState } from "@/lib/api";

/**
 * State as a machine stamp. Monochrome plus the one accent: only "needs you" earns azure, because
 * it is the only state that requires a person. The others separate by glyph and word, never by a
 * second hue (DESIGN.md).
 */
const TONE: Record<RunState, { cls: string; glyph: string; word: (exit?: number) => string }> = {
  running: { cls: "text-ink", glyph: "●", word: () => "working" },
  waiting: { cls: "text-azure-text", glyph: "❚❚", word: () => "needs you" },
  done: { cls: "text-ash", glyph: "■", word: (e) => `exit ${e ?? "?"}` },
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
  return (
    <span className={cn("stamp inline-flex items-center gap-1.5", t.cls, className)}>
      <span aria-hidden className={cn("text-[8px] leading-none", state === "running" && "breathe")}>
        {t.glyph}
      </span>
      {t.word(exitCode)}
    </span>
  );
}
