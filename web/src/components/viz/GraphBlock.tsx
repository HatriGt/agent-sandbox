import * as React from "react";
import type { Dag } from "@/lib/viz-extra";
import { VizFrame, VizShimmer } from "./VizFrame";
import { VizFullscreenContext } from "./viz-fullscreen";

// xyflow + dagre are a separate chunk: the transcript pays for them only when a graph renders.
const GraphCanvas = React.lazy(() => import("./GraphCanvas"));

/**
 * ```graph / ```dag / mermaid flowchart → an xyflow canvas laid out by dagre (GraphCanvas.tsx).
 * The canvas owns its zoom: in the fullscreen dialog it becomes interactive instead of being
 * wrapped in the generic CSS zoom.
 */
export function GraphBlock({ dag, source }: { dag: Dag; source: string }) {
  return (
    <VizFrame title={`${dag.nodes.length} nodes`} source={source} ownsZoom>
      <GraphBody dag={dag} />
    </VizFrame>
  );
}

function GraphBody({ dag }: { dag: Dag }) {
  const fullscreen = React.useContext(VizFullscreenContext);
  return (
    <React.Suspense fallback={<VizShimmer tall />}>
      <GraphCanvas dag={dag} fullscreen={fullscreen} />
    </React.Suspense>
  );
}
