import type * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Step, TimelineEvent } from "@/lib/viz-extra";
import { count, VizFrame } from "./VizFrame";
import { toneStyle } from "./tone";
import { useRowEntrance } from "./motion";

/** ```timeline → vertical event rail: time in mono on the left, dot + connector, event text. */
export function TimelineBlock({ events, source }: { events: TimelineEvent[]; source: string }) {
  const entrance = useRowEntrance(events.map((_, i) => String(i)));
  return (
    <VizFrame title={count(events.length, "event")} source={source}>
      <div className="px-4 py-3">
        {events.map((e, i) => {
          const en = entrance(String(i));
          return (
            <div key={i} className={cn("flex gap-3", en.className)} style={en.style}>
              <span className="text-muted-foreground w-24 shrink-0 pt-0.5 text-right font-mono text-micro tabular-nums">{e.time}</span>
              <span className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full ring-4 ring-(--card)",
                    e.state === "ok" && "bg-ok",
                    e.state === "fail" && "bg-destructive",
                    e.state === "active" && "bg-live viz-pulse",
                    e.state === "plain" && "bg-faint"
                  )}
                />
                {/* The rail draws downward once, a beat after its row lands. */}
                {i < events.length - 1 && <span aria-hidden className={cn("bg-border mt-1 w-px flex-1", en.className && "viz-rail")} />}
              </span>
              <span className={cn("min-w-0 pb-3.5 text-meta", i === events.length - 1 && "pb-0")}>
                <span className="text-foreground text-pretty">{e.text}</span>
                {e.state === "fail" && <X className="viz-check text-destructive mb-0.5 ml-1 inline size-3" strokeWidth={2.5} aria-label="failed" />}
                {e.state === "ok" && <Check className="viz-check text-ok mb-0.5 ml-1 inline size-3" strokeWidth={2.5} aria-label="done" />}
                {e.state === "active" && <span className="text-live ml-1.5 text-micro">in progress</span>}
                {e.note && <span className="text-faint block text-micro text-pretty">{e.note}</span>}
              </span>
            </div>
          );
        })}
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
  const marked = steps.some((s) => s.state !== "plain");
  const done = steps.filter((s) => s.state === "done").length;
  return (
    <VizFrame title={marked ? `${done} of ${count(steps.length, "step")} done` : count(steps.length, "step")} source={source}>
      <div className="px-4 py-3">
        {steps.map((s, i) => {
          const en = entrance(String(i));
          return (
            <div key={i} className={cn("flex gap-3", en.className)} style={en.style}>
              <span className="flex flex-col items-center">
                <span
                  key={s.state}
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full text-micro font-semibold tabular-nums",
                    s.state === "done" && "viz-tone text-ok",
                    s.state === "fail" && "viz-tone",
                    s.state === "active" && "viz-tone viz-pulse",
                    s.state === "todo" && "text-faint border-line-strong border border-dashed",
                    s.state === "plain" && "border-line-strong text-foreground border"
                  )}
                  style={s.state === "done" ? toneStyle("ok") : s.state === "fail" ? toneStyle("fail") : s.state === "active" ? toneStyle("live") : undefined}
                >
                  {s.state === "done" ? (
                    <Check className="viz-check size-3" strokeWidth={2.75} aria-label="done" />
                  ) : s.state === "fail" ? (
                    <X className="viz-check size-3" strokeWidth={2.75} aria-label="failed" />
                  ) : (
                    i + 1
                  )}
                </span>
                {i < steps.length - 1 && <span aria-hidden className={cn("bg-border my-1 w-px flex-1", en.className && "viz-rail")} />}
              </span>
              <div className={cn("min-w-0 pb-3.5", i === steps.length - 1 && "pb-0")}>
                <div className={cn("text-meta text-pretty", s.state === "todo" ? "text-muted-foreground" : "text-foreground", s.state === "active" && "font-medium")}>
                  {s.title}
                  {s.state === "active" && <span className="text-live ml-1.5 text-micro font-normal">in progress</span>}
                </div>
                {s.detail &&
                  (s.detail.includes("\n") ? (
                    <ul className="text-muted-foreground m-0 mt-0.5 list-disc pl-4 text-micro leading-relaxed">
                      {s.detail.split("\n").map((d, k) => (
                        <li key={k}>{d}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-faint text-micro text-pretty">{s.detail}</div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </VizFrame>
  );
}
