import * as React from "react";
import { useReducedMotion } from "@/lib/motion-pref";
import { Crosshair, Minus, Pause, Play, Plus } from "lucide-react";
import type { MemoryKind, MemoryNote } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isOperatorKind, KIND_LABEL, plural } from "./kinds";
import { noteHeadline } from "./noteText";

/**
 * The memory graph in three dimensions: the operator at the origin, their preferences and rules on
 * a close shell, one repo per node further out, each repo's AREAS (the knowledge base's pages) on a
 * shell around it, and every note on a small shell around its area. Lines are the structure
 * (you → repo → area → note) and, drawn stronger, the links the agent recorded between areas — the
 * graph of how the product hangs together. Every mark is a stored note; nothing is made up.
 *
 * Navigation: drag to orbit, wheel or the buttons to zoom, arrow keys to orbit, +/- to zoom, Enter on
 * a repo or area to centre on it (the camera orbits that node), 0 to reset. The sky turns slowly on
 * its own unless the operator prefers reduced motion or is interacting. Depth is shown by size and
 * ink: near marks are big and bright, far ones small and faint. Pure SVG, projected each frame.
 */

const W = 880;
const H = 520;
const CX = W / 2;
const CY = H / 2;
const FOCAL = 1150;
const DAY = 86_400_000;
const MAX_REPOS = 6;
const MAX_AREAS = 8;
const MAX_PER_AREA = 10;
const MAX_UNFILED = 14;
const MAX_YOU = 24;
const FONT = "var(--font-sans, system-ui)";
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export const sectionId = (repo: string) => `memory-${repo.replace(/[^\w-]/g, "-") || "global"}`;
export const areaId = (repo: string, area: string) => `${sectionId(repo)}-area-${area.replace(/[^\w-]/g, "-")}`;

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
};
const freshness = (at: number, now: number) => Math.max(0, 1 - Math.sqrt(Math.max(0, now - at) / (90 * DAY)));

type V3 = { x: number; y: number; z: number };
type Node =
  | { kind: "you"; key: string; p: V3; label: string; total: number; target: string }
  | { kind: "repo"; key: string; p: V3; label: string; total: number; areas: number; target: string }
  | { kind: "area"; key: string; p: V3; repo: string; area: string; label: string; total: number; stale: number; links: string[]; target: string }
  | { kind: "more"; key: string; p: V3; count: number; label: string; target: string }
  | { kind: "note"; key: string; p: V3; note: MemoryNote; area?: string; areaKey?: string; r: number; glow: number };
type Edge = { from: string; to: string; link?: boolean };

/** Evenly spread points on a sphere (Fibonacci lattice), spun by a seed so two shells never align. */
function shell(count: number, radius: number, seed: number, flat = 0.8): V3[] {
  const out: V3[] = [];
  const spin = seed * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const y = count === 1 ? 0 : 1 - (2 * (i + 0.5)) / count;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const t = i * GOLDEN + spin;
    out.push({ x: Math.cos(t) * rr * radius, y: y * radius * flat, z: Math.sin(t) * rr * radius });
  }
  return out;
}
/** Points on a flat ring — repos sit on a plane around the operator so their shells never stack. */
function ring(count: number, radius: number, seed: number): V3[] {
  return Array.from({ length: count }, (_, i) => {
    const t = seed * Math.PI * 2 + (i / Math.max(1, count)) * Math.PI * 2;
    return { x: Math.cos(t) * radius, y: ((i % 2) - 0.5) * 36, z: Math.sin(t) * radius };
  });
}
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

function build(notes: MemoryNote[]) {
  const now = Date.now();
  const live = notes.filter((n) => n.until == null);
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const radius = (n: MemoryNote) => 3.4 + Math.min(3, (n.uses ?? 0) * 0.8) + (n.pinned ? 1.4 : 0);
  const noteNode = (n: MemoryNote, p: V3, area?: string, areaKey?: string): Node => ({ kind: "note", key: n.id, p, note: n, area, areaKey, r: radius(n), glow: freshness(n.at, now) });

  const you = live.filter((n) => isOperatorKind(n.kind)).sort((a, b) => b.at - a.at);
  nodes.push({ kind: "you", key: "you", p: { x: 0, y: 0, z: 0 }, label: "You", total: you.length, target: "memory-you" });
  const youShown = you.slice(0, MAX_YOU);
  shell(youShown.length, 72, 0.13).forEach((p, i) => {
    nodes.push(noteNode(youShown[i], p));
    edges.push({ from: "you", to: youShown[i].id });
  });
  if (you.length > youShown.length) nodes.push({ kind: "more", key: "more-you", p: { x: 0, y: 92, z: 0 }, count: you.length - youShown.length, label: "more about you", target: "memory-you" });

  const byRepo = new Map<string, MemoryNote[]>();
  for (const n of live) if (!isOperatorKind(n.kind)) byRepo.set(n.repo ?? "", [...(byRepo.get(n.repo ?? "") ?? []), n]);
  const repos = [...byRepo.entries()].sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b)).slice(0, MAX_REPOS);
  const repoRadius = repos.length <= 1 ? 240 : repos.length <= 3 ? 300 : 340;
  ring(repos.length, repoRadius, 0.37).forEach((rp, ri) => {
    const [repo, list] = repos[ri];
    const rkey = `repo:${repo}`;
    const byArea = new Map<string, MemoryNote[]>();
    for (const n of list) byArea.set(n.area ?? "", [...(byArea.get(n.area ?? "") ?? []), n]);
    const areas = [...byArea.entries()].filter(([a]) => a).sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b));
    const shownAreas = areas.slice(0, MAX_AREAS);
    nodes.push({ kind: "repo", key: rkey, p: rp, label: repo || "Any repo", total: list.length, areas: areas.length, target: sectionId(repo) });
    edges.push({ from: "you", to: rkey });

    const unfiled = (byArea.get("") ?? []).sort((a, b) => b.at - a.at);
    const unfiledShown = unfiled.slice(0, MAX_UNFILED);
    shell(unfiledShown.length, 44, hash(repo)).forEach((p, i) => {
      nodes.push(noteNode(unfiledShown[i], add(rp, p)));
      edges.push({ from: rkey, to: unfiledShown[i].id });
    });
    if (unfiled.length > unfiledShown.length) nodes.push({ kind: "more", key: `more-${rkey}`, p: add(rp, { x: 0, y: 58, z: 0 }), count: unfiled.length - unfiledShown.length, label: "more notes", target: sectionId(repo) });

    const areaR = shownAreas.length <= 3 ? 100 : 135;
    shell(shownAreas.length, areaR, hash(repo) + 0.5, 0.9).forEach((ap, ai) => {
      const [area, anotes] = shownAreas[ai];
      const akey = `${repo}|${area}`;
      const p = add(rp, ap);
      const links = [...new Set(anotes.flatMap((n) => n.links ?? []))].filter((l) => l !== area);
      nodes.push({ kind: "area", key: akey, p, repo, area, label: area, total: anotes.length, stale: anotes.filter((n) => n.stale).length, links, target: areaId(repo, area) });
      edges.push({ from: rkey, to: akey });
      const order = [...anotes].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at);
      const shown = order.slice(0, MAX_PER_AREA);
      shell(shown.length, 30, hash(akey)).forEach((np, ni) => {
        nodes.push(noteNode(shown[ni], add(p, np), area, akey));
        edges.push({ from: akey, to: shown[ni].id });
      });
      if (order.length > shown.length) nodes.push({ kind: "more", key: `more-${akey}`, p: add(p, { x: 0, y: 44, z: 0 }), count: order.length - shown.length, label: `more in ${area}`, target: areaId(repo, area) });
    });
    if (areas.length > shownAreas.length) nodes.push({ kind: "more", key: `more-areas-${rkey}`, p: add(rp, { x: 0, y: -(areaR + 30), z: 0 }), count: areas.length - shownAreas.length, label: "more areas", target: sectionId(repo) });
  });
  // The knowledge graph proper: an area that names another, within the same repo.
  const areaKeys = new Set(nodes.filter((n) => n.kind === "area").map((n) => n.key));
  const seen = new Set<string>();
  for (const n of nodes) {
    if (n.kind !== "area") continue;
    for (const l of n.links) {
      const to = `${n.repo}|${l}`;
      const id = [n.key, to].sort().join("→");
      if (areaKeys.has(to) && !seen.has(id)) {
        seen.add(id);
        edges.push({ from: n.key, to, link: true });
      }
    }
  }
  const areaCount = new Set(live.filter((n) => n.area).map((n) => `${n.repo}|${n.area}`)).size;
  return { nodes, edges, you: you.length, repoNotes: live.length - you.length, repoCount: byRepo.size, areaCount, links: edges.filter((e) => e.link).length, stale: live.filter((n) => n.stale).length, replaced: notes.length - live.length, now };
}

/** Kind shape centred on 0,0. Shapes, not hues, tell kinds apart. */
function Shape({ kind, r, ...rest }: { kind: MemoryKind; r: number } & React.SVGProps<SVGElement>) {
  const p = rest as React.SVGProps<SVGPathElement>;
  switch (kind) {
    case "preference":
      return <circle r={r} {...(rest as React.SVGProps<SVGCircleElement>)} />;
    case "rule":
      return <path d={`M0 ${-r * 1.25}L${r * 1.25} 0L0 ${r * 1.25}L${-r * 1.25} 0Z`} {...p} />;
    case "domain": {
      const pts = Array.from({ length: 5 }, (_, i) => `${(Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 5) * r * 1.2).toFixed(2)},${(Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 5) * r * 1.2).toFixed(2)}`).join(" ");
      return <polygon points={pts} {...(rest as React.SVGProps<SVGPolygonElement>)} />;
    }
    case "playbook":
      return <rect x={-r * 0.95} y={-r * 0.95} width={r * 1.9} height={r * 1.9} rx={r * 0.35} {...(rest as React.SVGProps<SVGRectElement>)} />;
    case "lesson":
      return <path d={`M0 ${-r * 1.2}L${r * 1.1} ${r * 0.75}L${-r * 1.1} ${r * 0.75}Z`} {...p} />;
    case "decision": {
      const pts = Array.from({ length: 6 }, (_, i) => `${(Math.cos((i * Math.PI) / 3) * r * 1.1).toFixed(2)},${(Math.sin((i * Math.PI) / 3) * r * 1.1).toFixed(2)}`).join(" ");
      return <polygon points={pts} {...(rest as React.SVGProps<SVGPolygonElement>)} />;
    }
    case "fact":
      return <circle r={r * 0.85} {...(rest as React.SVGProps<SVGCircleElement>)} />;
  }
}
/** Shade per kind on top of brightness; facts are drawn hollow. */
const SHADE: Record<MemoryKind, number> = { preference: 1, rule: 1, domain: 0.96, playbook: 0.9, lesson: 0.78, decision: 0.66, fact: 0 };

export function KindMark({ kind, size = 10 }: { kind: MemoryKind; size?: number }) {
  return (
    <svg viewBox="-7 -7 14 14" width={size} height={size} aria-hidden className="text-foreground shrink-0 overflow-visible">
      <Shape kind={kind} r={4.4} fill={kind === "fact" ? "none" : "currentColor"} fillOpacity={SHADE[kind] * 0.85} stroke="currentColor" strokeOpacity={kind === "fact" ? 0.85 : 0} strokeWidth={1.4} />
    </svg>
  );
}

type Camera = { yaw: number; pitch: number; zoom: number; focus: string | null };
const HOME: Camera = { yaw: -0.55, pitch: 0.34, zoom: 1, focus: null };
const clampPitch = (p: number) => Math.max(-1.25, Math.min(1.25, p));
const clampZoom = (z: number) => Math.max(0.45, Math.min(3.2, z));

type Projected = { sx: number; sy: number; s: number; depth: number };

export function MemoryGraph({ notes, onSelect, onSection }: { notes: MemoryNote[]; onSelect: (id: string) => void; onSection: (id: string) => void }) {
  const reduce = useReducedMotion();
  const G = React.useMemo(() => build(notes), [notes]);
  const byKey = React.useMemo(() => new Map(G.nodes.map((n) => [n.key, n])), [G]);
  const [cam, setCam] = React.useState<Camera>(HOME);
  const [spinning, setSpinning] = React.useState(!reduce);
  const [hot, setHot] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const empty = G.nodes.length <= 1;

  // Slow turn while nobody is touching it. One state write per frame at ~30 fps keeps it cheap.
  React.useEffect(() => {
    if (!spinning || reduce || busy || hot || empty) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      if (t - last > 33) {
        last = t;
        setCam((c) => ({ ...c, yaw: c.yaw + 0.0035 }));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spinning, reduce, busy, hot, empty]);

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  React.useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCam((c) => ({ ...c, zoom: clampZoom(c.zoom * (e.deltaY > 0 ? 0.9 : 1.1)) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const origin = (cam.focus && byKey.get(cam.focus)?.p) || { x: 0, y: 0, z: 0 };
  const project = React.useMemo(() => {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    return (p: V3): Projected => {
      const x0 = p.x - origin.x, y0 = p.y - origin.y, z0 = p.z - origin.z;
      const x1 = x0 * cy - z0 * sy;
      const z1 = x0 * sy + z0 * cy;
      const y2 = y0 * cp - z1 * sp;
      const z2 = y0 * sp + z1 * cp;
      const s = (FOCAL / (FOCAL + z2)) * cam.zoom;
      return { sx: CX + x1 * s, sy: CY + y2 * s, s, depth: z2 };
    };
  }, [cam.yaw, cam.pitch, cam.zoom, origin.x, origin.y, origin.z]);

  const placed = React.useMemo(() => {
    const m = new Map<string, Projected>();
    for (const n of G.nodes) m.set(n.key, project(n.p));
    return m;
  }, [G, project]);
  const order = React.useMemo(() => [...G.nodes].sort((a, b) => placed.get(b.key)!.depth - placed.get(a.key)!.depth), [G, placed]);
  const h = hot ? byKey.get(hot) : undefined;
  const focusArea = h ? (h.kind === "area" ? h.key : h.kind === "note" ? h.areaKey ?? null : null) : null;
  const linked = React.useMemo(() => {
    const s = new Set<string>();
    if (!focusArea) return s;
    for (const e of G.edges) {
      if (!e.link) continue;
      if (e.from === focusArea) s.add(e.to);
      if (e.to === focusArea) s.add(e.from);
    }
    return s;
  }, [G, focusArea]);

  const pending = notes.filter((n) => n.until == null && n.status === "pending").length;
  const summary = empty
    ? "Memory graph: nothing remembered yet."
    : `Memory graph: ${plural(G.you, "note")} about you; ${plural(G.repoNotes, "repo note")} across ${plural(G.repoCount, "repo")}` +
      `${G.areaCount ? ` in ${plural(G.areaCount, "area")}${G.links ? ` with ${plural(G.links, "link")}` : ""}` : ""}` +
      `${pending ? `; ${pending} waiting for you` : ""}${G.stale ? `; ${G.stale} unverified` : ""}. Drag to orbit, wheel to zoom, arrow keys to turn, Enter centres on a repo or area.`;

  const ink = (depth: number) => Math.max(0.28, Math.min(1, 1 - depth / 900));
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    setBusy(true);
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    const k = 0.0055 * (880 / (svgRef.current?.clientWidth || 880));
    setCam((c) => ({ ...c, yaw: c.yaw + dx * k, pitch: clampPitch(c.pitch + dy * k) }));
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    setBusy(false);
    try {
      (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };
  const clickGuard = (fn: () => void) => () => {
    if (!drag.current?.moved) fn();
  };
  const centreOn = (key: string | null) => setCam((c) => ({ ...c, focus: key, zoom: key ? Math.max(c.zoom, 1.7) : 1 }));
  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const step = 0.08;
    const map: Record<string, () => void> = {
      ArrowLeft: () => setCam((c) => ({ ...c, yaw: c.yaw - step })),
      ArrowRight: () => setCam((c) => ({ ...c, yaw: c.yaw + step })),
      ArrowUp: () => setCam((c) => ({ ...c, pitch: clampPitch(c.pitch - step) })),
      ArrowDown: () => setCam((c) => ({ ...c, pitch: clampPitch(c.pitch + step) })),
      "+": () => setCam((c) => ({ ...c, zoom: clampZoom(c.zoom * 1.15) })),
      "=": () => setCam((c) => ({ ...c, zoom: clampZoom(c.zoom * 1.15) })),
      "-": () => setCam((c) => ({ ...c, zoom: clampZoom(c.zoom / 1.15) })),
      "0": () => setCam(HOME),
    };
    const fn = map[e.key];
    if (fn && e.target === e.currentTarget) (e.preventDefault(), fn());
  };
  const activate = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") (e.preventDefault(), e.stopPropagation(), fn());
  };
  const label = (n: Extract<Node, { kind: "note" }>) =>
    `${KIND_LABEL[n.note.kind].toLowerCase()}${n.area ? ` in ${n.area}` : ""}${n.note.status === "pending" ? ", waiting for you" : ""}${n.note.stale ? ", unverified" : ""}: ${noteHeadline(n.note.text)}`;
  const focusLabel = cam.focus ? (byKey.get(cam.focus) as Extract<Node, { kind: "repo" | "area" }> | undefined)?.label : undefined;

  return (
    <div className="group/graph relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        tabIndex={0}
        aria-label={summary}
        className={cn("text-foreground focus-visible:ring-ring block h-auto w-full touch-none select-none rounded-lg focus-visible:ring-2 focus-visible:outline-none", busy ? "cursor-grabbing" : "cursor-grab")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKey}
      >
        <defs>
          <radialGradient id="mg-glow">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.3} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* A faint ground disc gives the eye a horizon to read depth against. */}
        {!empty && (() => {
          const ring = Array.from({ length: 48 }, (_, i) => {
            const t = (i / 48) * Math.PI * 2;
            const q = project({ x: Math.cos(t) * 400, y: 70, z: Math.sin(t) * 400 });
            return `${i ? "L" : "M"}${q.sx.toFixed(1)} ${q.sy.toFixed(1)}`;
          }).join("");
          return <path d={`${ring}Z`} fill="currentColor" fillOpacity={0.025} stroke="currentColor" strokeOpacity={0.12} strokeDasharray="2 6" />;
        })()}

        {/* Structure first, links on top, then every node far-to-near so near marks overdraw. */}
        {G.edges.map((e) => {
          const a = placed.get(e.from)!, b = placed.get(e.to)!;
          const on = e.link && (focusArea === e.from || focusArea === e.to);
          const o = ink((a.depth + b.depth) / 2);
          return (
            <line
              key={`${e.from}→${e.to}`}
              x1={a.sx}
              y1={a.sy}
              x2={b.sx}
              y2={b.sy}
              stroke="currentColor"
              strokeOpacity={e.link ? (on ? 0.75 : 0.32) * o : (byKey.get(e.to)?.kind === "note" ? 0.07 : 0.14) * o}
              strokeWidth={e.link ? (on ? 1.8 : 1.2) * Math.sqrt(a.s) : 0.8}
              strokeDasharray={e.link ? undefined : byKey.get(e.to)?.kind === "note" ? undefined : "3 4"}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        {order.map((n) => {
          const q0 = placed.get(n.key)!;
          // Marks and text scale with depth, within bounds: the nearest repo must not fill the sky.
          const q = { ...q0, s: Math.max(0.7, Math.min(1.35, q0.s)) };
          const o = ink(q.depth);
          const on = hot === n.key;
          if (n.kind === "you") {
            const r = 18 * q.s;
            return (
              <g key={n.key} transform={`translate(${q.sx.toFixed(1)} ${q.sy.toFixed(1)})`} role="link" tabIndex={0} aria-label={`You: ${plural(n.total, "note")}. Jump to section`} className="mm-focus cursor-pointer" onClick={clickGuard(() => onSection(n.target))} onKeyDown={activate(() => onSection(n.target))}>
                <circle r={r + 6 * q.s} fill="none" stroke="currentColor" strokeOpacity={0.18 * o} />
                <circle r={r} className="fill-foreground" fillOpacity={o} />
                <text y={4 * q.s} textAnchor="middle" className="fill-background" style={{ font: `600 ${(11.5 * q.s).toFixed(1)}px ${FONT}` }}>
                  You
                </text>
              </g>
            );
          }
          if (n.kind === "repo") {
            const r = 9 * q.s;
            const focused = cam.focus === n.key;
            return (
              <g
                key={n.key}
                transform={`translate(${q.sx.toFixed(1)} ${q.sy.toFixed(1)})`}
                role="link"
                tabIndex={0}
                aria-label={`${n.label}: ${plural(n.total, "note")}${n.areas ? `, ${plural(n.areas, "area")}` : ""}. Enter jumps to its knowledge base`}
                className="mm-focus cursor-pointer"
                onMouseEnter={() => setHot(n.key)}
                onMouseLeave={() => setHot((v) => (v === n.key ? null : v))}
                onFocus={() => setHot(n.key)}
                onBlur={() => setHot((v) => (v === n.key ? null : v))}
                onClick={clickGuard(() => onSection(n.target))}
                onDoubleClick={() => centreOn(n.key)}
                onKeyDown={activate(() => onSection(n.target))}
              >
                <circle r={r + 5 * q.s} fill="var(--card)" fillOpacity={0.9} stroke="currentColor" strokeOpacity={(focused || on ? 0.6 : 0.3) * o} strokeWidth={focused ? 1.6 : 1} strokeDasharray={focused ? undefined : "3 3"} />
                <circle r={r} fill="currentColor" fillOpacity={0.9 * o} />
                <rect x={-60 * q.s} y={r + 7 * q.s} width={120 * q.s} height={15 * q.s} rx={3} fill="var(--card)" fillOpacity={0.85} />
                <text y={r + 18 * q.s} textAnchor="middle" className="fill-foreground" fillOpacity={o} style={{ font: `600 ${(12 * q.s).toFixed(1)}px ${FONT}` }}>
                  {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
                </text>
                <text y={r + 30 * q.s} textAnchor="middle" className="fill-muted-foreground" fillOpacity={o} style={{ font: `${(10.5 * q.s).toFixed(1)}px ${FONT}`, fontVariantNumeric: "tabular-nums" }}>
                  {plural(n.total, "note")}
                  {n.areas ? ` · ${plural(n.areas, "area")}` : ""}
                </text>
              </g>
            );
          }
          if (n.kind === "area") {
            const near = linked.has(n.key);
            const focused = cam.focus === n.key;
            const r = 36 * q.s;
            return (
              <g
                key={n.key}
                transform={`translate(${q.sx.toFixed(1)} ${q.sy.toFixed(1)})`}
                role="link"
                tabIndex={0}
                aria-label={`Area ${n.area} of ${n.repo}: ${plural(n.total, "note")}${n.links.length ? `, linked to ${n.links.join(", ")}` : ""}${n.stale ? `, ${n.stale} unverified` : ""}. Enter opens its page`}
                className="mm-focus cursor-pointer"
                onMouseEnter={() => setHot(n.key)}
                onMouseLeave={() => setHot((v) => (v === n.key ? null : v))}
                onFocus={() => setHot(n.key)}
                onBlur={() => setHot((v) => (v === n.key ? null : v))}
                onClick={clickGuard(() => onSection(n.target))}
                onDoubleClick={() => centreOn(n.key)}
                onKeyDown={activate(() => onSection(n.target))}
              >
                <circle r={r} fill="currentColor" fillOpacity={(on || focused ? 0.08 : near ? 0.055 : 0.025) * o} stroke="currentColor" strokeOpacity={(on || focused ? 0.5 : near ? 0.35 : 0.16) * o} strokeWidth={focused ? 1.4 : 1} vectorEffect="non-scaling-stroke" />
                <rect x={-44 * q.s} y={r + 2 * q.s} width={88 * q.s} height={13 * q.s} rx={3} fill="var(--card)" fillOpacity={0.85} />
                <text y={r + 12 * q.s} textAnchor="middle" className={on || near || focused ? "fill-foreground" : "fill-muted-foreground"} fillOpacity={o} style={{ font: `${on ? 600 : 500} ${(10.5 * q.s).toFixed(1)}px ${FONT}` }}>
                  {n.area.length > 18 ? `${n.area.slice(0, 17)}…` : n.area}
                  {n.stale ? ` · ${n.stale}?` : ""}
                </text>
              </g>
            );
          }
          if (n.kind === "more") {
            return (
              <g key={n.key} transform={`translate(${q.sx.toFixed(1)} ${q.sy.toFixed(1)})`} role="link" tabIndex={0} aria-label={`${n.count} ${n.label}. Jump to section`} className="mm-focus cursor-pointer" onClick={clickGuard(() => onSection(n.target))} onKeyDown={activate(() => onSection(n.target))}>
                <rect x={-20 * q.s} y={-8 * q.s} width={40 * q.s} height={16 * q.s} rx={8 * q.s} fill="var(--card)" stroke="currentColor" strokeOpacity={0.3 * o} />
                <text y={3.5 * q.s} textAnchor="middle" className="fill-muted-foreground" fillOpacity={o} style={{ font: `500 ${(10 * q.s).toFixed(1)}px ${FONT}`, fontVariantNumeric: "tabular-nums" }}>
                  +{n.count}
                </text>
              </g>
            );
          }
          const pend = n.note.status === "pending";
          const stale = !!n.note.stale;
          const inArea = focusArea != null && n.areaKey != null && (n.areaKey === focusArea || linked.has(n.areaKey));
          const dimmed = (hot != null && !on && h?.kind === "note") || (focusArea != null && !inArea && h?.kind !== "note");
          const bright = (0.3 + 0.7 * n.glow) * o;
          const hollow = n.note.kind === "fact";
          const r = n.r * q.s;
          return (
            <g
              key={n.key}
              transform={`translate(${q.sx.toFixed(1)} ${q.sy.toFixed(1)})`}
              role="button"
              tabIndex={0}
              aria-label={label(n)}
              className="cursor-pointer focus-visible:outline-none"
              style={{ opacity: dimmed ? 0.35 : 1, transition: reduce ? undefined : "opacity 180ms" }}
              onMouseEnter={() => setHot(n.key)}
              onMouseLeave={() => setHot((v) => (v === n.key ? null : v))}
              onFocus={() => setHot(n.key)}
              onBlur={() => setHot((v) => (v === n.key ? null : v))}
              onClick={clickGuard(() => onSelect(n.note.id))}
              onKeyDown={activate(() => onSelect(n.note.id))}
            >
              <circle r={Math.max(8, r + 3)} fill="transparent" />
              {n.glow > 0.7 && <circle r={r * 3.2} fill="url(#mg-glow)" />}
              {pend && <circle r={r + 4.5 * q.s} fill="none" className="stroke-attention" strokeWidth={1.8} strokeDasharray="3 2" />}
              {stale && !pend && <circle r={r + 4 * q.s} fill="none" stroke="currentColor" strokeOpacity={0.55 * o} strokeWidth={1.2} strokeDasharray="1.5 2" />}
              <Shape kind={n.note.kind} r={on ? r * 1.4 : r} fill={hollow ? "var(--card)" : "currentColor"} fillOpacity={hollow ? 1 : bright * SHADE[n.note.kind]} stroke="currentColor" strokeOpacity={hollow ? Math.max(0.35, bright) : 0} strokeWidth={1.3} />
              {on && <circle r={r * 1.4 + 4} fill="none" className="stroke-ring" strokeWidth={1.5} />}
            </g>
          );
        })}

        {empty && (
          <g className="fill-muted-foreground" style={{ font: `12px ${FONT}` }} textAnchor="middle">
            <text x={CX} y={CY - 104}>your preferences and rules will orbit here</text>
            <text x={CX + 300} y={CY - 150} opacity={0.7}>
              each repo you run
            </text>
            <text x={CX + 300} y={CY - 135} opacity={0.7}>
              becomes a constellation
            </text>
            <text x={CX - 300} y={CY + 110} opacity={0.7}>
              its areas link up
            </text>
            <text x={CX - 300} y={CY + 125} opacity={0.7}>
              into a knowledge base
            </text>
            {[0, 1, 2].map((i) => (
              <circle key={i} cx={[CX + 300, CX - 300, CX][i]} cy={[CY - 140 + 40, CY + 60, CY + 140][i]} r={22} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeDasharray="3 4" />
            ))}
          </g>
        )}
      </svg>

      {!empty && (
        <div className="absolute top-2 right-2 flex items-center gap-1" role="toolbar" aria-label="Graph view">
          {focusLabel && (
            <button type="button" onClick={() => centreOn(null)} className="bg-card/90 text-muted-foreground hover:text-foreground focus-visible:ring-ring mr-1 inline-flex h-7 items-center gap-1 rounded-md border px-2 text-micro focus-visible:ring-2 focus-visible:outline-none" title="Back to the whole graph">
              <Crosshair className="size-3.5" aria-hidden />
              {focusLabel}
              <span aria-hidden>×</span>
            </button>
          )}
          <GraphButton label="Zoom in" onClick={() => setCam((c) => ({ ...c, zoom: clampZoom(c.zoom * 1.25) }))}>
            <Plus className="size-3.5" aria-hidden />
          </GraphButton>
          <GraphButton label="Zoom out" onClick={() => setCam((c) => ({ ...c, zoom: clampZoom(c.zoom / 1.25) }))}>
            <Minus className="size-3.5" aria-hidden />
          </GraphButton>
          {!reduce && (
            <GraphButton label={spinning ? "Stop turning" : "Turn slowly"} pressed={spinning} onClick={() => setSpinning((v) => !v)}>
              {spinning ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            </GraphButton>
          )}
          <GraphButton label="Reset view" onClick={() => setCam(HOME)}>
            <span className="text-micro font-medium tabular-nums">0</span>
          </GraphButton>
        </div>
      )}
      {!empty && <p className="text-faint pointer-events-none absolute bottom-1.5 left-3 text-micro opacity-0 transition-opacity group-hover/graph:opacity-100 group-focus-within/graph:opacity-100 motion-reduce:transition-none">drag to orbit · wheel to zoom · double-click a repo or area to centre on it</p>}

      {h && h.kind === "note" && (() => {
        const q = placed.get(h.key)!;
        return (
          <div
            role="tooltip"
            className="bg-popover text-popover-foreground pointer-events-none absolute z-10 w-72 rounded-lg border px-3 py-2 shadow-lg"
            style={{ left: `${Math.min(85, Math.max(15, (q.sx / W) * 100))}%`, top: `${Math.min(95, Math.max(5, (q.sy / H) * 100))}%`, transform: `translate(-50%, ${q.sy > H * 0.55 ? "calc(-100% - 14px)" : "14px"})` }}
          >
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-micro">
              <KindMark kind={h.note.kind} />
              <span>
                {KIND_LABEL[h.note.kind]}
                {h.note.repo && !isOperatorKind(h.note.kind) && ` · ${h.note.repo}`}
                {h.area && ` · ${h.area}`} · {fmtAgo(Math.floor(h.note.at / 1000))}
              </span>
              {h.note.status === "pending" && <span className="text-attention-text font-medium">needs you</span>}
              {h.note.stale && <span className="text-muted-foreground">unverified</span>}
            </p>
            <p className="text-foreground mt-0.5 line-clamp-4 text-meta leading-snug font-medium">{noteHeadline(h.note.text)}</p>
            {(h.note.paths?.length || h.note.links?.length || (h.note.uses ?? 0) > 0 || h.note.pinned) && (
              <p className="text-faint mt-0.5 text-micro break-all">
                {[h.note.pinned && "pinned", (h.note.uses ?? 0) > 0 && `used ${h.note.uses}×`, h.note.paths?.length && `code: ${h.note.paths.join(", ")}`, h.note.links?.length && `related: ${h.note.links.join(", ")}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function GraphButton({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn("bg-card/90 text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-7 items-center justify-center rounded-md border focus-visible:ring-2 focus-visible:outline-none", pressed && "text-foreground")}
    >
      {children}
    </button>
  );
}
