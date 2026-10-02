import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import type { MemoryKind, MemoryNote } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { isOperatorKind, KIND_LABEL, KINDS, plural } from "./kinds";
import { noteHeadline } from "./noteText";

/**
 * Memory map: the operator at the centre, their preferences and rules orbiting close, and one
 * constellation per repo further out. Every star is a stored note — size from uses/pinned, brightness
 * from age (fresh notes glow, old ones fade), shape from kind. Inside a repo, notes gather by AREA —
 * the knowledge base's pages — and thin lines between areas are the links the agent recorded, so the
 * graph of how the product hangs together is visible. Replaced notes hang as faint ghosts off the
 * note that replaced them; a dotted outline marks a note whose code changed since (unverified); amber
 * marks only proposals waiting for the operator. Layout is pure arithmetic seeded by note id, so a
 * reload draws the same sky.
 */

const W = 880;
const H = 460;
const CX = W / 2;
const CY = H / 2;
const DAY = 86_400_000;
const MAX_CLUSTERS = 6;
const MAX_PER_CLUSTER = 48;
const MAX_AREAS = 8;
const MAX_YOU = 36;
const MAX_GHOSTS = 40;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const FONT = "var(--font-sans, system-ui)";

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};
export const sectionId = (repo: string) => `memory-${repo.replace(/[^\w-]/g, "-") || "global"}`;
export const areaId = (repo: string, area: string) => `${sectionId(repo)}-area-${area.replace(/[^\w-]/g, "-")}`;

type Star = { id: string; note: MemoryNote; x: number; y: number; r: number; glow: number; fresh: boolean; ghost?: boolean; parent?: string; area?: string };
type Agg = { key: string; x: number; y: number; count: number; label: string; target: string };
type Cluster = { key: string; label: string; x: number; y: number; ring: number; total: number; target: string; delay: number };
type Area = { key: string; repo: string; area: string; x: number; y: number; r: number; total: number; stale: number; links: string[]; target: string };
type Edge = { from: string; to: string };

const weight = (n: MemoryNote) => (n.pinned ? 4 : 0) + Math.min(6, n.uses ?? 0) + (n.status === "pending" ? 3 : 0);
const radius = (n: MemoryNote) => 3.6 + Math.min(4, (n.uses ?? 0) * 0.9) + (n.pinned ? 1.6 : 0);
/** 1 for today, easing to 0 by ~90 days. */
const freshness = (at: number, now: number) => Math.max(0, 1 - Math.sqrt(Math.max(0, now - at) / (90 * DAY)));

/** Sunflower spiral around a point; heavier notes sit nearer the core. */
function spiral(list: MemoryNote[], cx: number, cy: number, inner: number, step: number, now: number, sx: number, z: number, area?: string): Star[] {
  const order = [...list].sort((a, b) => weight(b) - weight(a) || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || hash(a.id) - hash(b.id));
  return order.map((n, i) => {
    const a = i * GOLDEN + hash(n.id) * 0.5;
    const d = inner + step * Math.sqrt(i + 0.6);
    return { id: n.id, note: n, x: cx + Math.cos(a) * d * sx, y: cy + Math.sin(a) * d, r: radius(n) * z, glow: freshness(n.at, now), fresh: now - n.at < 3 * DAY, area };
  });
}

function layout(notes: MemoryNote[]) {
  const now = Date.now();
  const live = notes.filter((n) => n.until == null);
  const you = live.filter((n) => isOperatorKind(n.kind));
  const groups = new Map<string, MemoryNote[]>();
  for (const n of live) if (!isOperatorKind(n.kind)) groups.set(n.repo ?? "", [...(groups.get(n.repo ?? "") ?? []), n]);
  let repos = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const overflow = repos.length > MAX_CLUSTERS ? repos.slice(MAX_CLUSTERS - 1) : [];
  if (overflow.length) repos = repos.slice(0, MAX_CLUSTERS - 1);

  // Few notes get bigger stars so a young memory still reads; dense skies shrink back to 1×.
  const z = live.length <= 12 ? 1.6 : live.length <= 40 ? 1.3 : 1;
  const stars: Star[] = [];
  const aggs: Agg[] = [];
  const clusters: Cluster[] = [];
  const areas: Area[] = [];

  const youShown = you.length > MAX_YOU ? [...you].sort((a, b) => weight(b) - weight(a) || b.at - a.at).slice(0, MAX_YOU) : you;
  stars.push(...spiral(youShown, CX, CY, 34 + 6 * (z - 1), 8.5 * z, now, 1.3, z));
  if (you.length > youShown.length) aggs.push({ key: "you+", x: CX, y: CY + 34 + 8.5 * Math.sqrt(MAX_YOU) + 16, count: you.length - youShown.length, label: "more about you", target: "memory-you" });

  const k = repos.length + (overflow.length ? 1 : 0);
  const place = (i: number) => {
    if (k === 1) return { x: CX + 290, y: CY };
    const a = -Math.PI * 0.78 + (i / k) * Math.PI * 2;
    return { x: CX + Math.cos(a) * 310, y: CY + Math.sin(a) * 150 };
  };
  // A big constellation (a repo with many areas) must stay inside the sky, label included.
  const clamp = (p: { x: number; y: number }, ring: number) => ({ x: Math.min(W - ring - 6, Math.max(ring + 6, p.x)), y: Math.min(H - ring - 6, Math.max(ring + 30, p.y)) });
  repos.forEach(([repo, list], i) => {
    const shown = list.length > MAX_PER_CLUSTER ? [...list].sort((p, q) => weight(q) - weight(p) || q.at - p.at).slice(0, MAX_PER_CLUSTER) : list;
    const target = sectionId(repo);
    // The knowledge base: notes with an area gather in sub-clusters around the repo's centre.
    const byArea = new Map<string, MemoryNote[]>();
    for (const n of shown) if (n.area) byArea.set(n.area, [...(byArea.get(n.area) ?? []), n]);
    let ring: number;
    let x: number;
    let y: number;
    if (byArea.size === 0) {
      const step = (shown.length > 24 ? 7 : 8.5) * z;
      ring = 12 * z + step * Math.sqrt(shown.length + 0.6) + 9;
      ({ x, y } = clamp(place(i), ring));
      stars.push(...spiral(shown, x, y, 12 * z, step, now, 1.15, z));
    } else {
      let pages = [...byArea.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
      const loose = shown.filter((n) => !n.area);
      if (pages.length > MAX_AREAS) {
        const rest = pages.slice(MAX_AREAS - 1).flatMap(([, l]) => l);
        pages = [...pages.slice(0, MAX_AREAS - 1), ["…", rest]];
      }
      if (loose.length) pages.push(["", loose]);
      const az = Math.min(z, 1.2);
      const step = 8 * az;
      const rad = pages.map(([, l]) => 6 * az + step * Math.sqrt(l.length + 0.6) + 6);
      const m = pages.length;
      // Sub-centres on a ring wide enough that neighbouring pages never overlap.
      let rho = 0;
      // The gap leaves room for each page's label beneath it.
      if (m > 1) for (let j = 0; j < m; j++) rho = Math.max(rho, (rad[j] + rad[(j + 1) % m] + 24) / (2 * Math.sin(Math.PI / m)));
      ring = rho + Math.max(...rad) + 16;
      ({ x, y } = clamp(place(i), ring));
      pages.forEach(([area, l], j) => {
        const ang = -Math.PI / 2 + (j / m) * Math.PI * 2 + hash(repo) * 0.6;
        const ax = m === 1 ? x : x + Math.cos(ang) * rho;
        const ay = m === 1 ? y : y + Math.sin(ang) * rho;
        stars.push(...spiral(l, ax, ay, 5 * az, step, now, 1.05, az, area || undefined));
        if (area) {
          const links = [...new Set(l.flatMap((n) => n.links ?? []))].filter((s) => s !== area);
          areas.push({ key: `${repo}|${area}`, repo, area, x: ax, y: ay, r: rad[j], total: l.length, stale: l.filter((n) => n.stale).length, links, target: area === "…" ? target : areaId(repo, area) });
        }
      });
    }
    clusters.push({ key: repo || "global", label: repo ? repo.split("/").pop()! : "any repo", x, y, ring, total: list.length, target, delay: 0.15 + i * 0.08 });
    if (list.length > shown.length) aggs.push({ key: `${repo}+`, x, y: y + ring + 2, count: list.length - shown.length, label: `more notes in ${repo || "any repo"}`, target });
  });
  if (overflow.length) {
    const { x, y } = place(k - 1);
    const total = overflow.reduce((s, [, l]) => s + l.length, 0);
    const target = sectionId(overflow[0][0]);
    clusters.push({ key: "more", label: `${overflow.length} more repos`, x, y, ring: 26, total, target, delay: 0.15 + (k - 1) * 0.08 });
    aggs.push({ key: "more+", x, y, count: total, label: `notes in ${plural(overflow.length, "smaller repo")}`, target });
  }

  // Links between areas: an edge whenever a page names another page of the same repo.
  const areaByKey = new Map(areas.map((a) => [a.key, a]));
  const edges: Edge[] = [];
  const seenEdge = new Set<string>();
  for (const a of areas) {
    for (const l of a.links) {
      const b = areaByKey.get(`${a.repo}|${l}`);
      if (!b) continue;
      const id = [a.key, b.key].sort().join("→");
      if (seenEdge.has(id)) continue;
      seenEdge.add(id);
      edges.push({ from: a.key, to: b.key });
    }
  }

  // Ghosts: replaced notes hang just off the note that replaced them (only when that note is drawn).
  const pos = new Map(stars.map((s) => [s.id, s]));
  const by = new Map(notes.filter((m) => m.supersedes).map((m) => [m.supersedes!, m.id]));
  const ghosts: Star[] = [];
  for (const n of notes) {
    if (n.until == null || ghosts.length >= MAX_GHOSTS) continue;
    const p = pos.get(by.get(n.id) ?? "");
    if (!p) continue;
    const a = hash(n.id) * Math.PI * 2;
    ghosts.push({ id: n.id, note: n, x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16, r: 3, glow: 0, fresh: false, ghost: true, parent: p.id });
  }
  const stale = live.filter((n) => n.stale).length;
  return { stars, ghosts, aggs, clusters, areas, edges, you: you.length, repoNotes: live.length - you.length, repoCount: groups.size, areaCount: new Set(live.filter((n) => n.area).map((n) => `${n.repo}|${n.area}`)).size, stale, now };
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

export function MemoryMap({ notes, onSelect, onSection }: { notes: MemoryNote[]; onSelect: (id: string) => void; onSection: (id: string) => void }) {
  const reduce = useReducedMotion();
  const L = React.useMemo(() => layout(notes), [notes]);
  const { stars, ghosts, aggs, clusters, areas, edges } = L;
  const [hot, setHot] = React.useState<string | null>(null);
  const [hotArea, setHotArea] = React.useState<string | null>(null);
  const all = React.useMemo(() => new Map([...stars, ...ghosts].map((s) => [s.id, s])), [stars, ghosts]);
  const h = hot ? all.get(hot) : undefined;
  const empty = stars.length === 0 && aggs.length === 0;
  const pending = notes.filter((n) => n.until == null && n.status === "pending").length;
  // The area under the pointer, or the one the hovered note belongs to: its links light up.
  const focusArea = hotArea ?? (h && h.area && h.note.repo != null ? `${h.note.repo}|${h.area}` : null);
  const linked = React.useMemo(() => {
    const s = new Set<string>();
    if (!focusArea) return s;
    for (const e of edges) {
      if (e.from === focusArea) s.add(e.to);
      if (e.to === focusArea) s.add(e.from);
    }
    return s;
  }, [edges, focusArea]);

  const summary = empty
    ? "Memory map: nothing remembered yet."
    : `Memory map: ${plural(L.you, "note")} about you; ${plural(L.repoNotes, "repo note")} across ${plural(L.repoCount, "repo")}` +
      `${L.areaCount ? ` in ${plural(L.areaCount, "area")}${edges.length ? ` with ${plural(edges.length, "link")}` : ""}` : ""}` +
      `${pending ? `; ${pending} waiting for you` : ""}${L.stale ? `; ${L.stale} unverified` : ""}${ghosts.length ? `; ${plural(ghosts.length, "replaced note")}` : ""}. Tab through notes; Enter jumps to one in the list.`;

  const enter = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, scale: 0.6 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const } };
  const label = (s: Star) =>
    `${s.ghost ? "Replaced " : ""}${KIND_LABEL[s.note.kind].toLowerCase()}${s.area ? ` in ${s.area}` : ""}${s.note.status === "pending" ? ", waiting for you" : ""}${s.note.stale ? ", unverified" : ""}: ${noteHeadline(s.note.text)}`;
  const activate = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") (e.preventDefault(), fn());
  };

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={summary} className="text-foreground block h-auto w-full select-none">
        <defs>
          <radialGradient id="mm-core">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.12} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="mm-glow">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.32} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* Orbits: quiet guides, not data. */}
        <g fill="none" stroke="currentColor" strokeWidth={1}>
          <ellipse cx={CX} cy={CY} rx={120} ry={92} strokeOpacity={0.2} strokeDasharray="2 5" />
          <ellipse cx={CX} cy={CY} rx={300} ry={145} strokeOpacity={0.16} strokeDasharray="1 7" />
          <ellipse cx={CX} cy={CY} rx={420} ry={212} strokeOpacity={0.1} strokeDasharray="1 9" />
        </g>
        <circle cx={CX} cy={CY} r={140} fill="url(#mm-core)" />

        {clusters.map((c) => (
          <motion.line
            key={`l-${c.key}`}
            x1={CX}
            y1={CY}
            x2={c.x}
            y2={c.y}
            stroke="currentColor"
            strokeOpacity={0.12}
            {...(reduce ? {} : { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 0.9, delay: c.delay } })}
          />
        ))}

        {clusters.map((c) => (
          <motion.g key={`c-${c.key}`} style={{ transformOrigin: `${c.x}px ${c.y}px`, transformBox: "view-box" }} {...enter(c.delay)}>
            <circle cx={c.x} cy={c.y} r={c.ring} fill="var(--card)" stroke="currentColor" strokeOpacity={0.12} strokeDasharray="3 4" />
            <circle cx={c.x} cy={c.y} r={c.ring} fill="currentColor" fillOpacity={0.025} />
            <g role="link" tabIndex={0} aria-label={`${c.label}: ${plural(c.total, "note")}. Jump to section`} className="mm-focus cursor-pointer" onClick={() => onSection(c.target)} onKeyDown={activate(() => onSection(c.target))}>
              <text x={c.x} y={c.y - c.ring - 18} textAnchor="middle" className="fill-foreground" style={{ font: `500 12.5px ${FONT}` }}>
                {c.label}
              </text>
              <text x={c.x} y={c.y - c.ring - 5} textAnchor="middle" className="fill-muted-foreground" style={{ font: `11px ${FONT}`, fontVariantNumeric: "tabular-nums" }}>
                {plural(c.total, "note")}
              </text>
            </g>
          </motion.g>
        ))}

        {/* The knowledge graph: one page per area, lines where pages name each other. */}
        {edges.map((e) => {
          const a = areas.find((x) => x.key === e.from)!;
          const b = areas.find((x) => x.key === e.to)!;
          const on = focusArea === e.from || focusArea === e.to;
          return (
            <motion.line
              key={`e-${e.from}-${e.to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="currentColor"
              strokeOpacity={on ? 0.6 : 0.22}
              strokeWidth={on ? 1.4 : 1}
              style={{ transition: "stroke-opacity 180ms, stroke-width 180ms" }}
              {...(reduce ? {} : { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 0.8, delay: 0.5 } })}
            />
          );
        })}
        {areas.map((a) => {
          const on = focusArea === a.key;
          const near = linked.has(a.key);
          return (
            <g key={`a-${a.key}`}>
              <circle cx={a.x} cy={a.y} r={a.r} fill="currentColor" fillOpacity={on ? 0.07 : near ? 0.05 : 0.02} stroke="currentColor" strokeOpacity={on ? 0.45 : near ? 0.3 : 0.14} strokeWidth={on ? 1.2 : 1} style={{ transition: "fill-opacity 180ms, stroke-opacity 180ms" }} />
              <g
                role="link"
                tabIndex={0}
                aria-label={`Area ${a.area}: ${plural(a.total, "note")}${a.links.length ? `, linked to ${a.links.join(", ")}` : ""}${a.stale ? `, ${a.stale} unverified` : ""}. Jump to its page`}
                className="mm-focus cursor-pointer"
                onMouseEnter={() => setHotArea(a.key)}
                onMouseLeave={() => setHotArea((v) => (v === a.key ? null : v))}
                onFocus={() => setHotArea(a.key)}
                onBlur={() => setHotArea((v) => (v === a.key ? null : v))}
                onClick={() => onSection(a.target)}
                onKeyDown={activate(() => onSection(a.target))}
              >
                <rect x={a.x - 40} y={a.y + a.r + 1} width={80} height={13} fill="var(--card)" fillOpacity={0.85} rx={3} />
                <text x={a.x} y={a.y + a.r + 11} textAnchor="middle" className={on || near ? "fill-foreground" : "fill-muted-foreground"} style={{ font: `${on ? 600 : 500} 10px ${FONT}`, transition: "fill 180ms" }}>
                  {a.area === "…" ? "more areas" : a.area.length > 18 ? `${a.area.slice(0, 17)}…` : a.area}
                </text>
              </g>
            </g>
          );
        })}

        {ghosts.map((g) => {
          const p = all.get(g.parent!)!;
          const on = hot === g.id || hot === g.parent;
          return <line key={`gl-${g.id}`} x1={g.x} y1={g.y} x2={p.x} y2={p.y} stroke="currentColor" strokeOpacity={on ? 0.55 : 0.2} strokeDasharray="2 2" />;
        })}

        {[...ghosts, ...stars].map((s, i, arr) => {
          const pend = s.note.status === "pending" && !s.ghost;
          const stale = !!s.note.stale && !s.ghost;
          const on = hot === s.id;
          const related = h && (h.parent === s.id || s.parent === hot);
          const inArea = focusArea != null && s.area != null && (`${s.note.repo}|${s.area}` === focusArea || linked.has(`${s.note.repo}|${s.area}`));
          const dimmed = (hot != null && !on && !related) || (hotArea != null && !inArea);
          const bright = 0.3 + 0.7 * s.glow;
          const hollow = s.note.kind === "fact" || !!s.ghost;
          const delay = 0.3 + hash(s.id) * 0.5 + (i / arr.length) * 0.5;
          return (
            <g
              key={s.id}
              transform={`translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})`}
              role="button"
              tabIndex={0}
              aria-label={label(s)}
              className="cursor-pointer focus-visible:outline-none"
              onMouseEnter={() => setHot(s.id)}
              onMouseLeave={() => setHot((v) => (v === s.id ? null : v))}
              onFocus={() => setHot(s.id)}
              onBlur={() => setHot((v) => (v === s.id ? null : v))}
              onClick={() => onSelect(s.id)}
              onKeyDown={activate(() => onSelect(s.id))}
            >
              <motion.g style={{ opacity: dimmed ? 0.3 : 1, transition: "opacity 180ms" }} {...(reduce ? {} : { initial: { scale: 0 }, animate: { scale: 1 }, transition: { type: "spring", stiffness: 260, damping: 18, delay } })}>
                <circle r={Math.max(8, s.r + 3)} fill="transparent" />
                {s.glow > 0.7 && !s.ghost && <circle r={s.r * 3.4} fill="url(#mm-glow)" className={reduce || !s.fresh ? undefined : "mm-shimmer"} style={{ animationDelay: `${(hash(s.id) * 4).toFixed(2)}s` }} />}
                {pend && <circle r={s.r + 4.5} fill="none" className="stroke-attention" strokeWidth={1.8} strokeDasharray="3 2" />}
                {stale && !pend && <circle r={s.r + 4} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.2} strokeDasharray="1.5 2" />}
                <Shape
                  kind={s.note.kind}
                  r={on ? s.r * 1.4 : s.r}
                  fill={hollow ? "var(--card)" : "currentColor"}
                  fillOpacity={hollow ? 1 : bright * SHADE[s.note.kind]}
                  stroke="currentColor"
                  strokeOpacity={s.ghost ? 0.3 : hollow ? Math.max(0.35, bright) : 0}
                  strokeWidth={1.3}
                  strokeDasharray={s.ghost ? "2 1.5" : undefined}
                />
                {on && <circle r={s.r * 1.4 + 4} fill="none" className="stroke-ring" strokeWidth={1.5} />}
              </motion.g>
            </g>
          );
        })}

        {aggs.map((a) => (
          <g key={a.key} role="link" tabIndex={0} aria-label={`${a.count} ${a.label}. Jump to section`} className="mm-focus cursor-pointer" onClick={() => onSection(a.target)} onKeyDown={activate(() => onSection(a.target))}>
            <rect x={a.x - 22} y={a.y - 9} width={44} height={18} rx={9} fill="var(--card)" stroke="currentColor" strokeOpacity={0.3} />
            <text x={a.x} y={a.y + 3.8} textAnchor="middle" className="fill-muted-foreground" style={{ font: `500 10.5px ${FONT}`, fontVariantNumeric: "tabular-nums" }}>
              +{a.count}
            </text>
          </g>
        ))}

        <motion.g style={{ transformOrigin: `${CX}px ${CY}px`, transformBox: "view-box" }} {...enter(0)}>
          <circle cx={CX} cy={CY} r={26} fill="none" stroke="currentColor" strokeOpacity={0.18} />
          <circle cx={CX} cy={CY} r={19} className="fill-foreground" />
          <text x={CX} y={CY + 4} textAnchor="middle" className="fill-background" style={{ font: `600 11.5px ${FONT}` }}>
            You
          </text>
        </motion.g>

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

      {h && (
        <div
          role="tooltip"
          className="bg-popover text-popover-foreground pointer-events-none absolute z-10 w-72 rounded-lg border px-3 py-2 shadow-lg"
          style={{ left: `${Math.min(85, Math.max(15, (h.x / W) * 100))}%`, top: `${(h.y / H) * 100}%`, transform: `translate(-50%, ${h.y > H * 0.55 ? "calc(-100% - 14px)" : "14px"})` }}
        >
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-micro">
            <KindMark kind={h.note.kind} />
            <span>
              {KIND_LABEL[h.note.kind]}
              {h.note.repo && !isOperatorKind(h.note.kind) && ` · ${h.note.repo}`}
              {h.area && ` · ${h.area}`} · {fmtAgo(Math.floor(h.note.at / 1000))}
              {h.ghost && " · replaced"}
            </span>
            {h.note.status === "pending" && !h.ghost && <span className="text-attention-text font-medium">needs you</span>}
            {h.note.stale && !h.ghost && <span className="text-muted-foreground">unverified</span>}
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
      )}
    </div>
  );
}
