import * as React from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowStep } from "@/lib/viz";
import { VizFrame } from "./VizFrame";
import { useRowEntrance } from "./motion";
import { toneStyle } from "./tone";

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
  // Chips land left to right, one stagger across all chains (capped like every block).
  const flat = chains.flatMap((steps, ci) => steps.map((s, i) => `${ci}|${i}|${s.name}`));
  const entrance = useRowEntrance(flat);
  const stepCount = chains.reduce((n, c) => n + c.length, 0);
  return (
    <VizFrame title={chains.length > 1 ? `${chains.length} pipelines · ${stepCount} steps` : `${stepCount} ${stepCount === 1 ? "step" : "steps"}`} source={source} fullscreen="canvas">
      <div className="flex flex-col gap-2 px-4 py-3" onMouseLeave={() => setHover(null)}>
        {chains.map((steps, ci) => (
          <div key={ci} className="flex flex-wrap items-center gap-y-1.5">
            {steps.map((s, i) => {
              const lit = focus === null || (at[ci] >= 0 && i <= at[ci]);
              const e = entrance(`${ci}|${i}|${s.name}`);
              return (
                <span key={i} className={cn("inline-flex items-center", e.className)} style={e.style}>
                  {i > 0 && (
                    <ArrowRight
                      strokeWidth={1.75}
                      className={cn("mx-1.5 size-3.5 shrink-0 transition-[opacity,color] duration-150 ease-(--viz-ease)", lit && focus !== null ? "text-muted-foreground" : "text-faint", !lit && "opacity-40")}
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
                    // Hue-tinted chip (the family's pill recipe); hover/focus only shifts opacity and ground.
                    className={cn(
                      "viz-press inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-micro font-medium outline-none transition-[opacity,background-color,box-shadow,scale] duration-150 ease-(--viz-ease) focus-visible:ring-2 focus-visible:ring-ring/60",
                      s.state === "plain" ? "text-foreground border-line-strong border" : "viz-tone",
                      !lit && "opacity-40",
                      focus === s.name && s.state === "plain" && "bg-muted",
                      pin === s.name && "ring-1 ring-ring/50"
                    )}
                    style={s.state === "ok" ? toneStyle("ok") : s.state === "fail" ? toneStyle("fail") : s.state === "active" ? toneStyle("live") : undefined}
                  >
                    {s.state === "ok" && <Check className="viz-check size-3" strokeWidth={2.5} aria-hidden />}
                    {s.state === "fail" && <X className="viz-check size-3" strokeWidth={2.5} aria-hidden />}
                    {s.state === "active" && <span className="bg-live viz-pulse size-1.5 rounded-full" aria-hidden />}
                    {s.name}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
        {pinned && (
          <div className="text-muted-foreground viz-swap border-t pt-2 text-micro text-pretty" role="status" data-flow-note>
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
