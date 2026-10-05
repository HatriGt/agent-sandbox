import * as React from "react";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { cn } from "@/lib/utils";
import type { Dag, DagKind } from "@/lib/viz-extra";

/**
 * The xyflow canvas behind GraphBlock (lazy chunk: xyflow + dagre load only when a graph is on
 * screen). dagre lays the DAG out left→right (top→bottom when it is deep and narrow); nodes are
 * custom cards — step = rounded card, decision = diamond, terminal = pill — and edges are
 * smoothstep with arrowheads and a card-coloured label chip. Inline the canvas is static so the
 * transcript scrolls through it; fullscreen it pans/zooms with controls (and a minimap > 10 nodes).
 * Hover or focus a node to light its upstream/downstream reach; click pins it.
 */

const CHAR_W = 7;
const NODE_H = 36;
const DIAMOND_H = 64;

type NodeData = { name: string; kind: DagKind; state: "focus" | "lit" | "dim"; pinned: boolean; dir: "LR" | "TB" };
type EdgeData = { label?: string; state: "on" | "off" | "dim" };

function nodeSize(name: string, kind: DagKind): { w: number; h: number } {
  const text = Math.min(name.length, 32) * CHAR_W;
  if (kind === "decision") {
    const side = Math.max(DIAMOND_H, Math.min(140, text * 0.75 + 36));
    return { w: side * 1.5, h: side };
  }
  return { w: Math.max(96, Math.min(260, text + 32)), h: NODE_H };
}

function layout(dag: Dag) {
  const depth = Math.max(...dag.layers) + 1;
  const width = Math.max(...Array.from({ length: depth }, (_, l) => dag.layers.filter((x) => x === l).length));
  const dir: "LR" | "TB" = depth >= 6 && width <= 2 ? "TB" : "LR";
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: dir, nodesep: 28, ranksep: dag.labels ? 72 : 56, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  const sizes = dag.nodes.map((n, i) => nodeSize(n, dag.kinds?.[i] ?? "step"));
  dag.nodes.forEach((_, i) => g.setNode(String(i), { width: sizes[i].w, height: sizes[i].h }));
  dag.edges.forEach(([a, b], k) => g.setEdge(String(a), String(b), dag.labels?.[k] ? { width: dag.labels[k]!.length * 6 + 16, height: 18 } : {}));
  dagre.layout(g);
  const pos = dag.nodes.map((_, i) => {
    const n = g.node(String(i));
    return { x: n.x - sizes[i].w / 2, y: n.y - sizes[i].h / 2 };
  });
  const graph = g.graph();
  return { dir, pos, sizes, width: graph.width ?? 0, height: graph.height ?? 0 };
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

function GraphNode({ data }: NodeProps<Node<NodeData>>) {
  const { name, kind, state, pinned, dir } = data;
  const [target, source] = dir === "LR" ? [Position.Left, Position.Right] : [Position.Top, Position.Bottom];
  const tone = cn(
    "transition-[opacity,border-color,background-color] duration-150 motion-reduce:transition-none",
    state === "dim" && "opacity-35",
    state === "focus" ? "border-foreground bg-card" : "border-line-strong bg-card",
    pinned && "ring-foreground/25 ring-2"
  );
  const handle = "!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";
  return (
    <div
      className="group/node relative grid size-full cursor-pointer place-items-center outline-none"
      data-graph-node={name}
      data-graph-kind={kind}
      title={name}
    >
      <Handle type="target" position={target} className={handle} isConnectable={false} />
      {kind === "decision" ? (
        <>
          <svg className={cn("absolute inset-0 size-full overflow-visible", state === "dim" && "opacity-35", "transition-opacity duration-150")} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <polygon
              points="50,1 99,50 50,99 1,50"
              vectorEffect="non-scaling-stroke"
              fill="var(--card)"
              stroke={state === "focus" ? "var(--foreground)" : "var(--line-strong)"}
              strokeWidth={pinned ? 2 : 1}
              strokeLinejoin="round"
            />
          </svg>
          <span className={cn("text-foreground relative max-w-[62%] text-center text-meta leading-tight font-medium break-words", state === "dim" && "opacity-35")}>{name}</span>
        </>
      ) : (
        <span
          className={cn(
            "text-foreground flex size-full items-center justify-center border px-3 text-meta font-medium shadow-e1",
            kind === "terminal" ? "rounded-full" : "rounded-lg",
            tone
          )}
        >
          <span className="truncate">{name}</span>
        </span>
      )}
      <Handle type="source" position={source} className={handle} isConnectable={false} />
    </div>
  );
}

function GraphEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps<Edge<EdgeData>>) {
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 });
  const state = data?.state ?? "off";
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: state === "on" ? "var(--foreground)" : "var(--muted-foreground)",
          strokeWidth: state === "on" ? 2 : 1.25,
          opacity: state === "dim" ? 0.25 : state === "on" ? 1 : 0.7,
          transition: "opacity 150ms, stroke 150ms",
        }}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <span
            className={cn(
              "bg-card text-muted-foreground nodrag nopan pointer-events-none absolute rounded-md border px-1.5 py-px text-micro font-medium",
              state === "dim" && "opacity-30"
            )}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
            data-graph-edge-label={data.label}
          >
            {data.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { graph: GraphNode };
const edgeTypes = { graph: GraphEdge };

export default function GraphCanvas({ dag, fullscreen }: { dag: Dag; fullscreen: boolean }) {
  const lay = React.useMemo(() => layout(dag), [dag]);
  // Focus is kept by node name, so it survives the graph growing while the block streams.
  const [hover, setHover] = React.useState<string | null>(null);
  const [pin, setPin] = React.useState<string | null>(null);
  const focusName = hover ?? pin;
  const focus = focusName === null ? -1 : dag.nodes.indexOf(focusName);
  const reach = React.useMemo(() => (focus < 0 ? null : { up: walk(dag, focus, "up"), down: walk(dag, focus, "down") }), [dag, focus]);

  const nodes = React.useMemo<Node<NodeData>[]>(
    () =>
      dag.nodes.map((name, i) => ({
        id: String(i),
        type: "graph",
        position: lay.pos[i],
        width: lay.sizes[i].w,
        height: lay.sizes[i].h,
        data: {
          name,
          kind: dag.kinds?.[i] ?? "step",
          dir: lay.dir,
          pinned: pin === name,
          state: i === focus ? "focus" : !reach || reach.up.has(i) || reach.down.has(i) ? "lit" : "dim",
        },
        ariaLabel: (dag.kinds?.[i] ?? "step") === "step" ? name : `${name} (${dag.kinds![i] === "decision" ? "decision" : "start or end"})`,
        draggable: false,
        connectable: false,
        selectable: true,
      })),
    [dag, lay, focus, reach, pin]
  );
  const edges = React.useMemo<Edge<EdgeData>[]>(
    () =>
      dag.edges.map(([a, b], k) => {
        const inUp = (n: number) => n === focus || !!reach?.up.has(n);
        const inDown = (n: number) => n === focus || !!reach?.down.has(n);
        const on = !!reach && ((inUp(a) && inUp(b)) || (inDown(a) && inDown(b)));
        return {
          id: `${a}>${b}#${k}`,
          source: String(a),
          target: String(b),
          type: "graph",
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: on ? "var(--foreground)" : "var(--muted-foreground)" },
          data: { label: dag.labels?.[k], state: on ? "on" : reach ? "dim" : "off" },
          focusable: false,
        };
      }),
    [dag, focus, reach]
  );

  const pinIdx = pin === null ? -1 : dag.nodes.indexOf(pin);
  const pinned =
    pinIdx < 0
      ? null
      : {
          name: pin!,
          deps: dag.edges.filter(([, b]) => b === pinIdx).map(([a]) => dag.nodes[a]),
          users: dag.edges.filter(([a]) => a === pinIdx).map(([, b]) => dag.nodes[b]),
          up: walk(dag, pinIdx, "up").size,
          down: walk(dag, pinIdx, "down").size,
        };
  // Inline height follows the layout so a 3-node chain is not a tall empty box.
  const height = Math.min(420, Math.max(160, lay.height + 24));

  return (
    <div className={cn("flex flex-col", fullscreen && "size-full")}>
      <div className="asb-flow" style={fullscreen ? { flex: 1, minHeight: 0 } : { height }} onMouseLeave={() => setHover(null)}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          style={{ width: "100%", height: "100%" }}
          fitViewOptions={{ padding: fullscreen ? 0.15 : 0.08, maxZoom: fullscreen ? 1.5 : 1.1 }}
          minZoom={0.1}
          maxZoom={4}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          edgesFocusable={false}
          panOnDrag={fullscreen}
          panOnScroll={false}
          zoomOnScroll={fullscreen}
          zoomOnPinch={fullscreen}
          zoomOnDoubleClick={fullscreen}
          preventScrolling={fullscreen}
          onNodeMouseEnter={(_, n) => setHover(n.data.name)}
          onNodeMouseLeave={() => setHover(null)}
          onNodeClick={(_, n) => setPin((p) => (p === n.data.name ? null : n.data.name))}
          onPaneClick={() => setPin(null)}
          aria-label="dependency graph — focus a node to trace its path"
        >
          {fullscreen && <Background gap={20} size={1} />}
          {fullscreen && <Controls showInteractive={false} position="bottom-left" />}
          {fullscreen && dag.nodes.length > 10 && <MiniMap pannable zoomable position="bottom-right" />}
        </ReactFlow>
      </div>
      {pinned && (
        <div className="text-muted-foreground enter border-t px-4 py-2 text-micro" role="status" data-graph-note>
          <span className="text-foreground font-medium">{pinned.name}</span>
          {pinned.deps.length ? ` · after ${pinned.deps.join(", ")}` : " · a root"}
          {pinned.users.length ? ` · before ${pinned.users.join(", ")}` : " · a leaf"}
          {` · ${pinned.up} upstream, ${pinned.down} downstream`}
        </div>
      )}
    </div>
  );
}
