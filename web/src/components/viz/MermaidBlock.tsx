import * as React from "react";
import type { Mermaid } from "mermaid";
import type { Sequence } from "@/lib/viz-extra";
import { sequenceToMermaid } from "@/lib/viz-mermaid";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
import { VizFrame, VizShimmer } from "./VizFrame";
import { SequenceFallback } from "./SequenceFallback";

/**
 * Mermaid-drawn diagrams: ```sequence (serialized from our parsed Sequence) and raw ```mermaid
 * fences that are not flowcharts (flowcharts go to the xyflow GraphBlock). mermaid itself is a
 * dynamic import, so it lands in its own chunk and only loads when a diagram is on screen.
 */

let mermaidLoad: Promise<Mermaid> | null = null;
// mermaid.initialize is global; renders are chained so two diagrams never interleave themes.
let queue: Promise<unknown> = Promise.resolve();
let seq = 0;

/** A CSS colour token resolved to `#rrggbb` (mermaid's colour maths cannot read oklch). */
function tokenHex(name: string, ctx: CanvasRenderingContext2D): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = value || "#000";
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function themeVariables() {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const t = (n: string) => tokenHex(n, ctx);
  const card = t("--card");
  const muted = t("--muted");
  const fg = t("--foreground");
  const mutedFg = t("--muted-foreground");
  const border = t("--border");
  const strong = t("--line-strong");
  return {
    darkMode: document.documentElement.classList.contains("dark"),
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || "Inter Variable, sans-serif",
    fontSize: "14px",
    background: card,
    primaryColor: card,
    primaryBorderColor: strong,
    primaryTextColor: fg,
    secondaryColor: muted,
    tertiaryColor: muted,
    lineColor: mutedFg,
    textColor: fg,
    mainBkg: card,
    nodeBorder: strong,
    clusterBkg: muted,
    clusterBorder: border,
    edgeLabelBackground: card,
    // sequence
    actorBkg: muted,
    actorBorder: strong,
    actorTextColor: fg,
    actorLineColor: border,
    signalColor: mutedFg,
    signalTextColor: fg,
    labelBoxBkgColor: card,
    labelBoxBorderColor: strong,
    labelTextColor: fg,
    loopTextColor: mutedFg,
    noteBkgColor: muted,
    noteBorderColor: border,
    noteTextColor: fg,
    activationBkgColor: muted,
    activationBorderColor: strong,
  };
}

async function renderSvg(text: string): Promise<string> {
  mermaidLoad ??= import("mermaid").then((m) => m.default);
  const mermaid = await mermaidLoad;
  const job = queue.then(async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: themeVariables(),
      sequence: { actorMargin: 64, messageMargin: 40, boxMargin: 12, noteMargin: 12, mirrorActors: false, useMaxWidth: true },
      flowchart: { useMaxWidth: true },
    });
    const { svg } = await mermaid.render(`asb-mermaid-${++seq}`, text);
    return svg;
  });
  queue = job.catch(() => undefined);
  return job;
}

/** Bumps whenever the app flips `.dark` on <html> (App.tsx owns the class), so diagrams re-theme. */
function useThemeKey(): string {
  const [key, setKey] = React.useState(() => document.documentElement.className);
  React.useEffect(() => {
    const mo = new MutationObserver(() => setKey(document.documentElement.className));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return key.includes("dark") ? "dark" : "light";
}

/** Renders mermaid text; `fallback` replaces it on any load/parse/render error. */
function MermaidSvg({ text, label, fallback }: { text: string; label: string; fallback: React.ReactNode }) {
  const theme = useThemeKey();
  const ref = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  React.useEffect(() => {
    let live = true;
    renderSvg(text).then(
      (svg) => {
        if (!live || !ref.current) return;
        // Sanctioned innerHTML sink (with code highlighting): mermaid's output under
        // securityLevel "strict" is DOMPurify-sanitized and labels were stripped upstream.
        ref.current.innerHTML = svg;
        setState("ready");
      },
      () => live && setState("error")
    );
    return () => {
      live = false;
    };
  }, [text, theme]);
  if (state === "error") return <>{fallback}</>;
  return (
    <>
      {state === "loading" && <VizShimmer tall />}
      <div
        ref={ref}
        role="img"
        aria-label={label}
        data-mermaid={state}
        className={state === "ready" ? "mermaid-diagram px-4 py-4" : "hidden"}
      />
    </>
  );
}

/** ```sequence / mermaid sequenceDiagram → mermaid; the hand SVG is the fallback. */
export function SequenceBlock({ sequence, source }: { sequence: Sequence; source: string }) {
  const msgs = sequence.items.filter((i) => i.kind === "msg").length;
  const text = React.useMemo(() => sequenceToMermaid(sequence), [sequence]);
  return (
    <VizFrame title={`${sequence.actors.length} participants · ${msgs} message${msgs === 1 ? "" : "s"}`} source={source}>
      <MermaidSvg text={text} label={`sequence diagram between ${sequence.actors.join(", ")}`} fallback={<SequenceFallback sequence={sequence} />} />
    </VizFrame>
  );
}

/** Mermaid diagram kinds drawn by mermaid itself (flowcharts that parse go to GraphBlock). */
const KINDS: Record<string, string> = {
  sequenceDiagram: "sequence diagram",
  stateDiagram: "state diagram",
  "stateDiagram-v2": "state diagram",
  classDiagram: "class diagram",
  erDiagram: "entity relationship diagram",
  gantt: "gantt chart",
  journey: "user journey",
  pie: "pie chart",
  mindmap: "mind map",
  timeline: "timeline",
  flowchart: "flowchart",
  graph: "flowchart",
};

/** The diagram kind a raw mermaid fence declares on its first statement, or null. */
export function mermaidKind(src: string): string | null {
  const first = src
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("%%"));
  const word = first?.split(/\s+/)[0];
  return word && Object.hasOwn(KINDS, word) ? KINDS[word] : null;
}

/** Raw ```mermaid fence → mermaid SVG; a render error shows the source as code. */
export function MermaidBlock({ source, kind }: { source: string; kind: string }) {
  return (
    <VizFrame title={kind} source={source}>
      <MermaidSvg
        text={source}
        label={kind}
        fallback={
          <CodeBlock className="my-0 rounded-none border-0">
            <CodeBlockCode code={source} language="text" />
          </CodeBlock>
        }
      />
    </VizFrame>
  );
}
