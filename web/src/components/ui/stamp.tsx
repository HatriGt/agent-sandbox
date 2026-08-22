import { cn } from "@/lib/utils";
import type { RunState } from "@/lib/api";

/**
 * State as a machine stamp, not a pill badge. Mono, tracked out, with a leading glyph — reads like
 * a status line on an instrument. Colour never carries the meaning alone; the word is always there.
 */
const TONE: Record<RunState, { cls: string; glyph: string }> = {
  running: { cls: "text-live", glyph: "●" },
  waiting: { cls: "text-signal", glyph: "❚❚" },
  done: { cls: "text-ink-faint", glyph: "■" },
  idle: { cls: "text-ink-faint", glyph: "○" },
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
  const label =
    state === "waiting"
      ? "needs you"
      : state === "done"
        ? `exit ${exitCode ?? "?"}`
        : state;
  return (
    <span className={cn("stamp inline-flex items-center gap-1.5", t.cls, className)}>
      <span aria-hidden className={cn("text-[8px] leading-none", state === "running" && "breathe")}>
        {t.glyph}
      </span>
      {label}
    </span>
  );
}
