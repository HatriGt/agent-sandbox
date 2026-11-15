import * as React from "react";
import { Check, Copy, Code2, Maximize2, Search, SearchX, Shapes } from "lucide-react";
import { cn } from "@/lib/utils";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
import { LiveSlotBadge, LiveSlotContext, useLiveSlotTitle } from "./live-blocks";
import { IconSwap } from "./motion";
import { VizFullscreen, VizFullscreenContext, VizFullscreenGate, type VizFullscreenMode } from "./viz-fullscreen";

/**
 * A quiet 28px icon button for a block's header (copy, raw, maximize, fold-all, chart ⇄ table):
 * hidden until the card is hovered or focused on a fine pointer, 0.96 press, colour on hover.
 */
export const VIZ_ICON_BUTTON =
  "viz-ctl viz-press text-muted-foreground hover:text-foreground hover:bg-muted/70 grid size-7 shrink-0 cursor-pointer place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

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
 * When the last skeleton left the page. A frame that mounts within a beat of it is that skeleton's
 * block arriving: the frame is already on screen (same border, same header), so only its body
 * cross-fades in instead of the whole card rising again — a fill-in, not a jump.
 */
let skeletonGoneAt = -Infinity;
const fromSkeleton = () => performance.now() - skeletonGoneAt < 120;

/**
 * Placeholder for a visual fence that is streaming in but has nothing drawable yet. Same frame
 * and header as the finished block, so the swap to the real block is a fill-in, not a jump.
 */
export function VizSkeleton({ language }: { language: string }) {
  const tall = language === "chart" || language === "heatmap" || language === "graph" || language === "dag" || language === "sequence";
  React.useEffect(
    () => () => {
      skeletonGoneAt = performance.now();
    },
    []
  );
  return (
    <div className="bg-card not-prose viz-swap my-3 overflow-hidden rounded-xl border" aria-busy="true" data-viz-skeleton={language}>
      <div className="flex h-8 items-center border-b px-3">
        <span className="shimmer-text text-micro font-medium">{SKELETON_TITLE[language] ?? "Drawing"}…</span>
      </div>
      <VizShimmer tall={tall} />
    </div>
  );
}

/**
 * The filter row every searchable block shares (table, tree, log): hairline under the header, the
 * icon and ground stay faint until the input is focused, an optional counter on the right.
 */
export function VizSearch({
  value,
  onChange,
  placeholder,
  count,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** "12 of 40" style counter, shown on the right (polite live region). */
  count?: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("viz-search flex cursor-text items-center gap-2 px-3 py-1.5", className)}>
      <Search className="text-faint size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        placeholder={placeholder}
        aria-label={placeholder}
        className="text-foreground placeholder:text-faint min-w-0 flex-1 bg-transparent text-meta outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {count != null && (
        <span className="text-faint shrink-0 text-micro tabular-nums" aria-live="polite">
          {count}
        </span>
      )}
    </label>
  );
}

/** The one empty state of the family: a small round glyph, one quiet line, an optional way out. */
export function VizEmpty({ children, onClear }: { children: React.ReactNode; onClear?: () => void }) {
  return (
    <div className="viz-fade flex flex-col items-center gap-1.5 px-4 py-6 text-center" role="status">
      <span className="bg-muted text-faint grid size-7 place-items-center rounded-full" aria-hidden>
        <SearchX className="size-3.5" strokeWidth={1.75} />
      </span>
      <span className="text-muted-foreground text-micro text-pretty">{children}</span>
      {onClear && (
        <button type="button" onClick={onClear} className="viz-press text-foreground hover:bg-muted -mb-1 cursor-pointer rounded-md px-2 py-1 text-micro font-medium">
          Clear filter
        </button>
      )}
    </div>
  );
}

/** The footer strip a block tallies in ("2 high · 1 low", "407 KB in files"): hairline, micro, tabular. */
export const VIZ_FOOTER = "text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-1.5 text-micro tabular-nums";

/** A tally entry: a 6px dot in the tone's hue + the count + the word (never the hue alone). */
export function TallyItem({ hue, n, word }: { hue: string; n: React.ReactNode; word: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="size-1.5 rounded-full" style={{ background: hue }} />
      <span className="text-foreground font-medium">{n}</span> {word}
    </span>
  );
}

/** A block's "N things" header counter: number tabular, unit pluralised. */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
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
  fullscreen = ownsZoom ? "canvas" : "flow",
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
  /** `flow` (a document: fills the sheet, scrolls) or `canvas` (a picture: centred, pan + zoom). */
  fullscreen?: VizFullscreenMode;
}) {
  const [raw, setRaw] = React.useState(false);
  // Raw ⇄ visual only cross-fades once the reader has toggled; first paint is the frame's entrance.
  const [toggled, setToggled] = React.useState(false);
  // Arriving in place of a skeleton: the card is already there, so only the body fades in.
  const [filling] = React.useState(fromSkeleton);
  // A live slot (a block the agent keeps re-emitting) names itself and shows its update age.
  const slot = React.useContext(LiveSlotContext);
  const slotTitle = useLiveSlotTitle();
  const [copied, setCopied] = React.useState(false);
  const [full, setFull] = React.useState(false);
  const gate = React.useContext(VizFullscreenGate);
  React.useEffect(() => {
    if (full) gate?.(true);
    return () => {
      if (full) gate?.(false);
    };
  }, [full, gate]);
  // Already inside a fullscreen dialog (a nested card): no second maximize.
  const inFullscreen = React.useContext(VizFullscreenContext);
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
    <div className={cn("group/viz bg-card not-prose my-3 overflow-hidden rounded-xl border", !filling && "viz-frame-in", className)} data-live-slot={slot ?? undefined}>
      <div className="flex h-8 items-center gap-0.5 border-b pr-1 pl-3">
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-micro font-medium tabular-nums">{title ?? slotTitle}</span>
        <LiveSlotBadge />
        {actions}
        {/* Utility controls stay quiet until the card is engaged (index.css .viz-ctl). */}
        <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy source"} className={VIZ_ICON_BUTTON}>
          <IconSwap on={copied} offIcon={<Copy className="size-3.5" strokeWidth={1.75} />} onIcon={<Check className="text-ok size-3.5" strokeWidth={2.25} />} />
        </button>
        <button
          type="button"
          onClick={() => {
            setToggled(true);
            setRaw((r) => !r);
          }}
          aria-label={raw ? "Show visualization" : "Show raw text"}
          aria-pressed={raw}
          className={cn(VIZ_ICON_BUTTON, raw && "text-foreground bg-muted")}
        >
          <IconSwap on={raw} offIcon={<Code2 className="size-3.5" strokeWidth={1.75} />} onIcon={<Shapes className="size-3.5" strokeWidth={1.75} />} />
        </button>
        {!inFullscreen && (
          <button type="button" onClick={() => setFull(true)} aria-label="Open fullscreen" className={VIZ_ICON_BUTTON} data-viz-maximize>
            <Maximize2 className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>
      {/* Keyed wrapper: raw ⇄ rendered cross-fades through a 2px blur (the old view leaves at once). */}
      {raw ? (
        <div key="raw" className="viz-swap">
          <CodeBlock className="my-0 rounded-none border-0">
            <CodeBlockCode code={source} language={rawLanguage} />
          </CodeBlock>
        </div>
      ) : (
        <div key="viz" className={cn((toggled || filling) && "viz-swap")}>
          {children}
        </div>
      )}
      {full && (
        <VizFullscreen open={full} onOpenChange={setFull} title={title ?? slotTitle ?? "Visualization"} mode={fullscreen} ownsZoom={ownsZoom}>
          {children}
        </VizFullscreen>
      )}
    </div>
  );
}
