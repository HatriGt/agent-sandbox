import * as React from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowStep } from "@/lib/viz";
import { VizFrame } from "./VizFrame";

const STATE_WORD: Record<FlowStep["state"], string> = { ok: "done", fail: "failed", active: "in progress", plain: "" };

/**
 * ```flow fence (`A -> B -> C`, one chain per line) → a pipeline of step chips joined by arrows.
 * State markers reuse the console's functional vocabulary: ✓ = ok (green), ✗ = failed (red),
 * … = in progress (live blue, breathing dot) — each with a glyph so state never rides on hue alone.
 *
 * Hover or focus a step to light the path that leads to it (and the same step in other chains);
 * click / Enter pins it and shows where it sits in the pipeline. Selection is kept by step name,
 * so it survives the chain growing while the block streams.
 */
export function FlowBlock({ chains, source }: { chains: FlowStep[][]; source: string }) {
  const [hover, setHover] = React.useState<string | null>(null);
  const [pin, setPin] = React.useState<string | null>(null);
  const focus = hover ?? pin;
  // Per chain: index of the focused step (−1 when the chain doesn't contain it).
  const at = chains.map((steps) => (focus === null ? -1 : steps.findIndex((s) => s.name === focus)));
  const pinned = React.useMemo(() => {
    if (pin === null) return null;
    for (const steps of chains) {
      const i = steps.findIndex((s) => s.name === pin);
      if (i >= 0) return { step: steps[i], i, steps };
    }
    return null;
  }, [chains, pin]);
  return (
    <VizFrame source={source}>
      <div className="flex flex-col gap-2 px-4 py-3" onMouseLeave={() => setHover(null)}>
        {chains.map((steps, ci) => (
          <div key={ci} className="flex flex-wrap items-center gap-y-1.5">
            {steps.map((s, i) => {
              const lit = focus === null || (at[ci] >= 0 && i <= at[ci]);
              return (
                <React.Fragment key={i}>
                  {i > 0 && (
                    <ArrowRight
                      className={cn("mx-1.5 size-3.5 shrink-0 transition-opacity duration-150 motion-reduce:transition-none", lit && focus !== null ? "text-muted-foreground" : "text-faint", !lit && "opacity-40")}
                      aria-hidden
                    />
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setHover(s.name)}
                    onFocus={() => setHover(s.name)}
                    onBlur={() => setHover(null)}
                    onClick={() => setPin((p) => (p === s.name ? null : s.name))}
                    aria-pressed={pin === s.name}
                    aria-label={`${s.name}${STATE_WORD[s.state] ? `, ${STATE_WORD[s.state]}` : ""} — step ${i + 1} of ${steps.length}`}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-micro font-medium outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none",
                      s.state === "ok" && "border-ok/40 text-ok",
                      s.state === "fail" && "border-destructive/40 text-destructive",
                      s.state === "active" && "border-live/40 text-live",
                      s.state === "plain" && "text-foreground",
                      !lit && "opacity-40",
                      focus === s.name && "bg-muted",
                      pin === s.name && "ring-1 ring-ring/50"
                    )}
                  >
                    {s.state === "ok" && <Check className="size-3" aria-hidden />}
                    {s.state === "fail" && <X className="size-3" aria-hidden />}
                    {s.state === "active" && <span className="bg-live size-1.5 animate-pulse rounded-full motion-reduce:animate-none" aria-hidden />}
                    {s.name}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        ))}
        {pinned && (
          <div className="text-muted-foreground enter border-t pt-2 text-micro" role="status" data-flow-note>
            <span className="text-foreground font-medium">{pinned.step.name}</span>
            {STATE_WORD[pinned.step.state] && ` · ${STATE_WORD[pinned.step.state]}`} · step {pinned.i + 1} of {pinned.steps.length}
            {pinned.i > 0 && <> · after {pinned.steps.slice(0, pinned.i).map((s) => s.name).join(" → ")}</>}
            {pinned.i < pinned.steps.length - 1 && <> · then {pinned.steps[pinned.i + 1].name}</>}
          </div>
        )}
      </div>
    </VizFrame>
  );
}
