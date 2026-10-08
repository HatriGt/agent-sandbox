import type * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Step, TimelineEvent } from "@/lib/viz-extra";
import { VizFrame } from "./VizFrame";
import { useRowEntrance } from "./motion";

/** ```timeline → vertical event rail: time in mono on the left, dot + connector, event text. */
export function TimelineBlock({ events, source }: { events: TimelineEvent[]; source: string }) {
  const entrance = useRowEntrance(events.map((_, i) => String(i)));
  return (
    <VizFrame source={source}>
      <div className="px-4 py-3">
        {events.map((e, i) => (
          <div key={i} className={cn("flex gap-3", entrance(String(i)).className)} style={entrance(String(i)).style}>
            <span className="text-muted-foreground w-24 shrink-0 pt-0.5 text-right font-mono text-micro tabular-nums">{e.time}</span>
            <span className="flex flex-col items-center">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  e.state === "ok" && "bg-ok",
                  e.state === "fail" && "bg-destructive",
                  e.state === "active" && "bg-live viz-pulse",
                  e.state === "plain" && "bg-faint"
                )}
              />
              {i < events.length - 1 && <span aria-hidden className="bg-border w-px flex-1" />}
            </span>
            <span className={cn("min-w-0 pb-3 text-meta", i === events.length - 1 && "pb-0")}>
              <span className="text-foreground">{e.text}</span>
              {e.state === "fail" && <X className="viz-mark text-destructive mb-0.5 ml-1 inline size-3" aria-label="failed" />}
              {e.state === "ok" && <Check className="viz-mark text-ok mb-0.5 ml-1 inline size-3" aria-label="done" />}
              {e.note && <span className="text-faint block text-micro">{e.note}</span>}
            </span>
          </div>
        ))}
      </div>
    </VizFrame>
  );
}

/** A step whose title may carry rendered markdown (inline code chips) when it came from an `<ol>`. */
type StepView = Omit<Step, "title"> & { title: React.ReactNode };

/**
 * ```steps → the vertical wizard: numbered circles, connector line, done/active/failed states.
 * A `plain` list (no marks anywhere) is a procedure: full-contrast titles and foreground numbers,
 * because nothing is pending — it describes what happens, in order.
 */
export function StepsBlock({ steps, source }: { steps: StepView[]; source: string }) {
  const entrance = useRowEntrance(steps.map((_, i) => String(i)));
  return (
    <VizFrame source={source}>
      <div className="px-4 py-3">
        {steps.map((s, i) => (
          <div key={i} className={cn("flex gap-3", entrance(String(i)).className)} style={entrance(String(i)).style}>
            <span className="flex flex-col items-center">
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border text-micro font-semibold tabular-nums",
                  s.state === "done" && "border-ok/50 text-ok",
                  s.state === "fail" && "border-destructive/50 text-destructive",
                  s.state === "active" && "border-live text-live viz-pulse",
                  s.state === "todo" && "text-faint",
                  s.state === "plain" && "border-border text-foreground"
                )}
              >
                {s.state === "done" ? <Check className="viz-mark size-3" aria-label="done" /> : s.state === "fail" ? <X className="viz-mark size-3" aria-label="failed" /> : i + 1}
              </span>
              {i < steps.length - 1 && <span aria-hidden className="bg-border my-0.5 w-px flex-1" />}
            </span>
            <div className={cn("min-w-0 pb-3", i === steps.length - 1 && "pb-0")}>
              <div className={cn("text-meta", s.state === "todo" ? "text-muted-foreground" : "text-foreground", s.state === "active" && "font-medium")}>
                {s.title}
                {s.state === "active" && <span className="text-live ml-1.5 text-micro">in progress</span>}
              </div>
              {s.detail &&
                (s.detail.includes("\n") ? (
                  <ul className="text-muted-foreground m-0 mt-0.5 list-disc pl-4 text-micro leading-relaxed">
                    {s.detail.split("\n").map((d, k) => (
                      <li key={k}>{d}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-faint text-micro">{s.detail}</div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </VizFrame>
  );
}
