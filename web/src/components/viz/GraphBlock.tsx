import * as React from "react";
import type { Dag } from "@/lib/viz-extra";
import { VizFrame } from "./VizFrame";

/**
 * ```graph → a small layered DAG. Nodes are placed by topological layer (left→right), edges are
 * curves; ≤ 24 nodes by the parser's bound. Node fill is neutral — identity is the label, not a
 * hue — and edges are hairlines so the structure, not the chrome, is what reads.
 */
export function GraphBlock({ dag, source }: { dag: Dag; source: string }) {
  const layout = React.useMemo(() => {
    const maxLayer = Math.max(...dag.layers);
    const byLayer: number[][] = Array.from({ length: maxLayer + 1 }, () => []);
    dag.nodes.forEach((_, i) => byLayer[dag.layers[i]].push(i));
    const tallest = Math.max(...byLayer.map((l) => l.length));
    const nodeW = 120;
    const nodeH = 28;
    const gapX = 56;
    const gapY = 14;
    const W = (maxLayer + 1) * nodeW + maxLayer * gapX + 16;
    const H = tallest * nodeH + (tallest - 1) * gapY + 16;
    const pos = new Array<{ x: number; y: number }>(dag.nodes.length);
    byLayer.forEach((ids, layer) => {
      const columnH = ids.length * nodeH + (ids.length - 1) * gapY;
      ids.forEach((id, row) => {
        pos[id] = {
          x: 8 + layer * (nodeW + gapX),
          y: (H - columnH) / 2 + row * (nodeH + gapY),
        };
      });
    });
    return { pos, W, H, nodeW, nodeH };
  }, [dag]);

  const { pos, W, H, nodeW, nodeH } = layout;
  return (
    <VizFrame title={`${dag.nodes.length} nodes`} source={source}>
      <div className="overflow-x-auto px-4 py-3">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="max-w-full" role="img" aria-label="dependency graph">
          {dag.edges.map(([a, b], i) => {
            const x1 = pos[a].x + nodeW;
            const y1 = pos[a].y + nodeH / 2;
            const x2 = pos[b].x;
            const y2 = pos[b].y + nodeH / 2;
            const mx = (x1 + x2) / 2;
            return (
              <g key={i}>
                <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="var(--line-strong)" strokeWidth={1.25} />
                <path d={`M${x2 - 5},${y2 - 3.5} L${x2},${y2} L${x2 - 5},${y2 + 3.5}`} fill="none" stroke="var(--line-strong)" strokeWidth={1.25} strokeLinecap="round" />
              </g>
            );
          })}
          {dag.nodes.map((name, i) => (
            <g key={i}>
              <rect x={pos[i].x} y={pos[i].y} width={nodeW} height={nodeH} rx={8} fill="var(--muted)" stroke="var(--border)" />
              <text x={pos[i].x + nodeW / 2} y={pos[i].y + nodeH / 2 + 3.5} textAnchor="middle" className="fill-foreground" fontSize={11} fontFamily="var(--font-sans)">
                {name.length > 16 ? name.slice(0, 15) + "…" : name}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </VizFrame>
  );
}
