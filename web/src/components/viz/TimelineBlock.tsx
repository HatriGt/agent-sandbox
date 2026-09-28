import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Step, TimelineEvent } from "@/lib/viz-extra";
import { VizFrame } from "./VizFrame";

/** ```timeline → vertical event rail: time in mono on the left, dot + connector, event text. */
export function TimelineBlock({ events, source }: { events: TimelineEvent[]; source: string }) {
  return (
    <VizFrame source={source}>
      <div className="px-4 py-3">
        {events.map((e, i) => (
          <div key={i} className="flex gap-3">
            <span className="text-muted-foreground w-24 shrink-0 pt-0.5 text-right font-mono text-micro tabular-nums">{e.time}</span>
            <span className="flex flex-col items-center">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  e.state === "ok" && "bg-ok",
                  e.state === "fail" && "bg-destructive",
                  e.state === "active" && "bg-live animate-pulse",
                  e.state === "plain" && "bg-faint"
                )}
              />
              {i < events.length - 1 && <span aria-hidden className="bg-border w-px flex-1" />}
            </span>
            <span className={cn("min-w-0 pb-3 text-meta", i === events.length - 1 && "pb-0")}>
              <span className="text-foreground">{e.text}</span>
              {e.state === "fail" && <X className="text-destructive mb-0.5 ml-1 inline size-3" aria-label="failed" />}
              {e.state === "ok" && <Check className="text-ok mb-0.5 ml-1 inline size-3" aria-label="done" />}
              {e.note && <span className="text-faint block text-micro">{e.note}</span>}
            </span>
          </div>
        ))}
      </div>
    </VizFrame>
  );
}

/** ```steps → the vertical wizard: numbered circles, connector line, done/active/failed states. */
export function StepsBlock({ steps, source }: { steps: Step[]; source: string }) {
  return (
    <VizFrame source={source}>
      <div className="px-4 py-3">
        {steps.map((s, i) => (
          <div key={i} className="flex gap-3">
            <span className="flex flex-col items-center">
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border text-micro font-semibold tabular-nums",
                  s.state === "done" && "border-ok/50 text-ok",
                  s.state === "fail" && "border-destructive/50 text-destructive",
                  s.state === "active" && "border-live text-live",
                  s.state === "todo" && "text-faint"
                )}
              >
                {s.state === "done" ? <Check className="size-3" aria-label="done" /> : s.state === "fail" ? <X className="size-3" aria-label="failed" /> : i + 1}
              </span>
              {i < steps.length - 1 && <span aria-hidden className="bg-border my-0.5 w-px flex-1" />}
            </span>
            <div className={cn("min-w-0 pb-3", i === steps.length - 1 && "pb-0")}>
              <div className={cn("text-meta", s.state === "todo" ? "text-muted-foreground" : "text-foreground", s.state === "active" && "font-medium")}>
                {s.title}
                {s.state === "active" && <span className="text-live ml-1.5 text-micro">in progress</span>}
              </div>
              {s.detail && <div className="text-faint text-micro">{s.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </VizFrame>
  );
}
