import * as React from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowStep } from "@/lib/viz";
import { VizFrame } from "./VizFrame";

/**
 * ```flow fence (`A -> B -> C`, one chain per line) → a pipeline of step chips joined by arrows.
 * State markers reuse the console's functional vocabulary: ✓ = ok (green), ✗ = failed (red),
 * … = in progress (live blue, breathing dot) — each with a glyph so state never rides on hue alone.
 */
export function FlowBlock({ chains, source }: { chains: FlowStep[][]; source: string }) {
  return (
    <VizFrame source={source}>
      <div className="flex flex-col gap-2 px-4 py-3">
        {chains.map((steps, ci) => (
          <div key={ci} className="flex flex-wrap items-center gap-y-1.5">
            {steps.map((s, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ArrowRight className="text-faint mx-1.5 size-3.5 shrink-0" aria-hidden />}
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-micro font-medium",
                    s.state === "ok" && "border-ok/40 text-ok",
                    s.state === "fail" && "border-destructive/40 text-destructive",
                    s.state === "active" && "border-live/40 text-live",
                    s.state === "plain" && "text-foreground"
                  )}
                >
                  {s.state === "ok" && <Check className="size-3" aria-label="done" />}
                  {s.state === "fail" && <X className="size-3" aria-label="failed" />}
                  {s.state === "active" && <span className="bg-live size-1.5 animate-pulse rounded-full" aria-label="in progress" />}
                  {s.name}
                </span>
              </React.Fragment>
            ))}
          </div>
        ))}
      </div>
    </VizFrame>
  );
}
