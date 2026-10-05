import * as React from "react";
import { cn } from "@/lib/utils";
import type { Dag } from "@/lib/viz-extra";
import { VizFrame } from "./VizFrame";

/** Node width grows with the longest name so a call chain's identifiers stay legible; ≈ 6.4px per char at 11px sans. */
const MIN_NODE_W = 120;
const MAX_NODE_W = 180;
const CHAR_W = 6.4;

/**
 * ```graph → a small layered DAG. Nodes are placed by topological layer (left→right), edges are
 * curves; ≤ 24 nodes by the parser's bound. Node fill is neutral — identity is the label, not a
 * hue — and edges are hairlines so the structure, not the chrome, is what reads. Shapes carry
 * meaning the way flowcharts do: decisions are diamonds, start/end nodes are pills; edge labels
 * (`yes` / `no`) sit on a card-coloured chip at the edge midpoint.
 */
export function GraphBlock({ dag, source }: { dag: Dag; source: string }) {
  const layout = React.useMemo(() => {
    const maxLayer = Math.max(...dag.layers);
    const byLayer: number[][] = Array.from({ length: maxLayer + 1 }, () => []);
    dag.nodes.forEach((_, i) => byLayer[dag.layers[i]].push(i));
    const tallest = Math.max(...byLayer.map((l) => l.length));
    const longest = Math.max(...dag.nodes.map((n) => n.length));
    const nodeW = Math.min(MAX_NODE_W, Math.max(MIN_NODE_W, Math.round(longest * CHAR_W + 24)));
    // Diamonds need more height to fit their text; everything shares one row height for alignment.
    const nodeH = dag.kinds?.includes("decision") ? 36 : 28;
    const gapX = dag.labels ? 72 : 56;
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
    // How many characters fit the node at this width; the full name lives in <title>.
    const fit = Math.max(8, Math.floor((nodeW - 20) / CHAR_W));
    return { pos, W, H, nodeW, nodeH, fit };
  }, [dag]);

  const { pos, W, H, nodeW, nodeH, fit } = layout;
  // Focus is kept by node name, so it survives the graph growing while the block streams.
  const [hover, setHover] = React.useState<string | null>(null);
  const [pin, setPin] = React.useState<string | null>(null);
  const focusName = hover ?? pin;
  const focus = focusName === null ? -1 : dag.nodes.indexOf(focusName);
  const reach = React.useMemo(() => (focus < 0 ? null : { up: walk(dag, focus, "up"), down: walk(dag, focus, "down") }), [dag, focus]);
  const lit = (i: number) => !reach || i === focus || reach.up.has(i) || reach.down.has(i);
  const edgeLit = (a: number, b: number) =>
    !!reach && ((reach.up.has(a) || a === focus) && (reach.up.has(b) || b === focus) ? true : (reach.down.has(b) || b === focus) && (reach.down.has(a) || a === focus));
  const pinIdx = pin === null ? -1 : dag.nodes.indexOf(pin);
  const pinned = pinIdx < 0 ? null : {
    name: pin!,
    deps: dag.edges.filter(([, b]) => b === pinIdx).map(([a]) => dag.nodes[a]),
    users: dag.edges.filter(([a]) => a === pinIdx).map(([, b]) => dag.nodes[b]),
    up: walk(dag, pinIdx, "up").size,
    down: walk(dag, pinIdx, "down").size,
  };
  const fade = "transition-opacity duration-150 motion-reduce:transition-none";
  return (
    <VizFrame title={`${dag.nodes.length} nodes`} source={source}>
      <div className="overflow-x-auto px-4 py-3" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="group" aria-label="dependency graph — focus a node to trace its path">
          {dag.edges.map(([a, b], k) => {
            const x1 = pos[a].x + nodeW;
            const y1 = pos[a].y + nodeH / 2;
            const x2 = pos[b].x;
            const y2 = pos[b].y + nodeH / 2;
            const mx = (x1 + x2) / 2;
            const on = edgeLit(a, b);
            const stroke = on ? "var(--foreground)" : "var(--line-strong)";
            const label = dag.labels?.[k];
            const labelW = label ? Math.min(label.length, 14) * 5.6 + 10 : 0;
            return (
              <g key={`${dag.nodes[a]}>${dag.nodes[b]}`} opacity={reach && !on ? 0.3 : 1} className={fade} aria-hidden>
                <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={stroke} strokeWidth={on ? 1.75 : 1.25} />
                <path d={`M${x2 - 5},${y2 - 3.5} L${x2},${y2} L${x2 - 5},${y2 + 3.5}`} fill="none" stroke={stroke} strokeWidth={on ? 1.75 : 1.25} strokeLinecap="round" />
                {label && (
                  // The bezier's midpoint (t = 0.5) is (mx, mean y): the chip sits on the line, not beside it.
                  <g data-graph-edge-label={label}>
                    <rect x={mx - labelW / 2} y={(y1 + y2) / 2 - 7} width={labelW} height={14} rx={4} fill="var(--card)" stroke="var(--border)" strokeWidth={1} />
                    <text x={mx} y={(y1 + y2) / 2 + 3} textAnchor="middle" className="fill-muted-foreground" fontSize={9.5} fontFamily="var(--font-sans)">
                      {label.length > 14 ? label.slice(0, 13) + "…" : label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
          {dag.nodes.map((name, i) => {
            const kind = dag.kinds?.[i] ?? "step";
            const { x, y } = pos[i];
            const shape = {
              fill: i === focus ? "var(--card)" : "var(--muted)",
              stroke: i === focus ? "var(--foreground)" : "var(--border)",
              strokeWidth: pin === name ? 1.75 : 1,
              className: "gshape",
            };
            // A diamond's text row is roughly half the box width; pills and boxes use the whole width.
            const room = kind === "decision" ? Math.max(6, Math.floor(fit * 0.55)) : fit;
            return (
              <g
                key={name}
                tabIndex={0}
                role="button"
                aria-pressed={pin === name}
                aria-label={kind === "step" ? name : `${name} (${kind === "decision" ? "decision" : "start or end"})`}
                data-graph-node={name}
                data-graph-kind={kind}
                opacity={lit(i) ? 1 : 0.35}
                className={cn("cursor-pointer outline-none [&:focus-visible>.gshape]:stroke-[var(--ring)]", fade)}
                onMouseEnter={() => setHover(name)}
                onFocus={() => setHover(name)}
                onBlur={() => setHover(null)}
                onClick={() => setPin((p) => (p === name ? null : name))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPin((p) => (p === name ? null : name));
                  } else if (e.key === "Escape") setPin(null);
                }}
              >
                <title>{name}</title>
                {kind === "decision" ? (
                  <polygon points={`${x + nodeW / 2},${y} ${x + nodeW},${y + nodeH / 2} ${x + nodeW / 2},${y + nodeH} ${x},${y + nodeH / 2}`} strokeLinejoin="round" {...shape} />
                ) : (
                  <rect x={x} y={y} width={nodeW} height={nodeH} rx={kind === "terminal" ? nodeH / 2 : 8} {...shape} />
                )}
                <text x={x + nodeW / 2} y={y + nodeH / 2 + 3.5} textAnchor="middle" className="fill-foreground" fontSize={11} fontFamily="var(--font-sans)">
                  {name.length > room ? name.slice(0, room - 1) + "…" : name}
                </text>
              </g>
            );
          })}
        </svg>
        {pinned && (
          <div className="text-muted-foreground enter mt-2 border-t pt-2 text-micro" role="status" data-graph-note>
            <span className="text-foreground font-medium">{pinned.name}</span>
            {pinned.deps.length ? ` · after ${pinned.deps.join(", ")}` : " · a root"}
            {pinned.users.length ? ` · before ${pinned.users.join(", ")}` : " · a leaf"}
            {` · ${pinned.up} upstream, ${pinned.down} downstream`}
          </div>
        )}
      </div>
    </VizFrame>
  );
}

/** Every node reachable from `start` following edges up (to dependencies) or down (to dependents). */
function walk(dag: Dag, start: number, dir: "up" | "down"): Set<number> {
  const seen = new Set<number>();
  const stack = [start];
  while (stack.length) {
    const n = stack.pop()!;
    for (const [a, b] of dag.edges) {
      const next = dir === "down" ? (a === n ? b : -1) : b === n ? a : -1;
      if (next >= 0 && !seen.has(next) && next !== start) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}
