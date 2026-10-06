import * as React from "react";
import { Check, Copy, Code2, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
import { LiveSlotBadge, LiveSlotContext, useLiveSlotTitle } from "./live-blocks";
import { VizFullscreen, VizFullscreenContext } from "./viz-fullscreen";

/** Fixed categorical slot → CSS var. Never cycles: callers cap series at 8 upstream. */
export function seriesColor(i: number): string {
  return `var(--viz-${Math.min(i, 7) + 1})`;
}

const SKELETON_TITLE: Record<string, string> = {
  chart: "Drawing chart", json: "Reading JSON", jsonc: "Reading JSON", stats: "Collecting metrics", timeline: "Building timeline",
  steps: "Listing steps", progress: "Measuring progress", tests: "Reading test results", log: "Reading log", flow: "Tracing flow",
  sequence: "Drawing sequence", findings: "Ranking findings", compare: "Weighing options", annotate: "Annotating code", layers: "Stacking layers",
};

/**
 * Placeholder for a visual fence that is streaming in but has nothing drawable yet. Same frame
 * and header as the finished block, so the swap to the real block is a fill-in, not a jump.
 */
export function VizSkeleton({ language }: { language: string }) {
  const tall = language === "chart" || language === "heatmap" || language === "graph" || language === "dag" || language === "sequence";
  return (
    <div className="bg-card not-prose enter my-3 overflow-hidden rounded-xl border" aria-busy="true" data-viz-skeleton={language}>
      <div className="flex h-8 items-center border-b px-3">
        <span className="shimmer-text text-micro font-medium">{SKELETON_TITLE[language] ?? "Drawing"}…</span>
      </div>
      <VizShimmer tall={tall} />
    </div>
  );
}

/** Shimmer body for a block still drawing: the skeleton's body, and mermaid's while it renders. */
export function VizShimmer({ tall }: { tall: boolean }) {
  return (
    <div className={cn("flex flex-col justify-end gap-2 px-4 py-3", tall ? "h-44" : "h-16")} aria-hidden>
      {tall ? (
        <div className="flex h-full items-end gap-1.5">
          {[40, 65, 50, 80, 35, 60].map((h, i) => (
            <span key={i} className="shimmer flex-1 rounded-t" style={{ height: `${h}%` }} />
          ))}
        </div>
      ) : (
        <>
          <span className="shimmer block h-3 w-2/3 rounded" />
          <span className="shimmer block h-3 w-1/3 rounded" />
        </>
      )}
    </div>
  );
}

/**
 * The shared card every visualizer sits in: hairline border (no shadow — one elevation cue per
 * surface), a quiet header with an optional title, copy-source, and a raw toggle that swaps the
 * rendered view for the original fence text. The raw view is the trust anchor: nothing the
 * beautifier draws is more authoritative than what the agent actually wrote. Maximize opens the
 * same body in a fullscreen dialog with zoom (viz-fullscreen.tsx); `ownsZoom` blocks draw their own.
 */
export function VizFrame({
  title,
  source,
  rawLanguage = "text",
  actions,
  children,
  className,
  ownsZoom,
}: {
  title?: string;
  /** Original fence text, powering both the copy action and the raw toggle. */
  source: string;
  rawLanguage?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** The body pans/zooms itself in fullscreen (reads VizFullscreenContext); skip the generic zoom. */
  ownsZoom?: boolean;
}) {
  const [raw, setRaw] = React.useState(false);
  // A live slot (a block the agent keeps re-emitting) names itself and shows its update age.
  const slot = React.useContext(LiveSlotContext);
  const slotTitle = useLiveSlotTitle();
  const [copied, setCopied] = React.useState(false);
  const [full, setFull] = React.useState(false);
  // Already inside a fullscreen dialog (a nested card): no second maximize.
  const inFullscreen = React.useContext(VizFullscreenContext);
  const quiet = "text-muted-foreground hover:text-foreground grid size-6 cursor-pointer place-items-center rounded-md opacity-60 group-hover/viz:opacity-100 focus-visible:opacity-100";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — the raw view still allows manual selection */
    }
  };
  return (
    <div className={cn("group/viz bg-card not-prose enter my-3 overflow-hidden rounded-xl border", className)} data-live-slot={slot ?? undefined}>
      <div className="flex h-8 items-center gap-1 border-b px-3">
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-micro font-medium">{title ?? slotTitle}</span>
        <LiveSlotBadge />
        {actions}
        {/* Utility controls stay quiet until the card is engaged — same reveal as code blocks. */}
        <button type="button" onClick={copy} aria-label="Copy source" className={quiet}>
          {copied ? <Check className="pop-in size-3.5 text-ok" /> : <Copy className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => setRaw((r) => !r)}
          aria-label={raw ? "Show visualization" : "Show raw text"}
          aria-pressed={raw}
          className={cn(
            "grid size-6 cursor-pointer place-items-center rounded-md",
            raw ? "text-foreground bg-muted opacity-100" : "text-muted-foreground hover:text-foreground opacity-60 group-hover/viz:opacity-100 focus-visible:opacity-100"
          )}
        >
          <Code2 className="size-3.5" />
        </button>
        {!inFullscreen && (
          <button type="button" onClick={() => setFull(true)} aria-label="Open fullscreen" className={quiet} data-viz-maximize>
            <Maximize2 className="size-3.5" />
          </button>
        )}
      </div>
      {/* Keyed wrapper: toggling raw ↔ rendered cross-fades instead of hard-swapping. */}
      {raw ? (
        <div key="raw" className="enter">
          <CodeBlock className="my-0 rounded-none border-0">
            <CodeBlockCode code={source} language={rawLanguage} />
          </CodeBlock>
        </div>
      ) : (
        <div key="viz" className="enter">{children}</div>
      )}
      {full && (
        <VizFullscreen open={full} onOpenChange={setFull} title={title ?? slotTitle ?? "Visualization"} ownsZoom={ownsZoom}>
          {children}
        </VizFullscreen>
      )}
    </div>
  );
}
