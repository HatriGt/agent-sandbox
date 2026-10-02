import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import type { MemoryKind, MemoryNote } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { isOperatorKind, KIND_LABEL, KINDS, plural } from "./kinds";
import { noteHeadline } from "./noteText";

/**
 * Memory map: the operator at the centre, their preferences and rules orbiting close, and one
 * constellation per repo further out. Every star is a stored note — size from uses/pinned, brightness
 * from age (fresh notes glow, old ones fade), shape from kind. Replaced notes hang as faint ghosts off
 * the note that replaced them; amber marks only proposals waiting for the operator. Layout is pure
 * arithmetic seeded by note id, so a reload draws the same sky.
 */

const W = 880;
const H = 440;
const CX = W / 2;
const CY = H / 2;
const DAY = 86_400_000;
const MAX_CLUSTERS = 6;
const MAX_PER_CLUSTER = 48;
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

type Star = { id: string; note: MemoryNote; x: number; y: number; r: number; glow: number; fresh: boolean; ghost?: boolean; parent?: string };
type Agg = { key: string; x: number; y: number; count: number; label: string; target: string };
type Cluster = { key: string; label: string; x: number; y: number; ring: number; total: number; target: string; delay: number };

const weight = (n: MemoryNote) => (n.pinned ? 4 : 0) + Math.min(6, n.uses ?? 0) + (n.status === "pending" ? 3 : 0);
const radius = (n: MemoryNote) => 3.6 + Math.min(4, (n.uses ?? 0) * 0.9) + (n.pinned ? 1.6 : 0);
/** 1 for today, easing to 0 by ~90 days. */
const freshness = (at: number, now: number) => Math.max(0, 1 - Math.sqrt(Math.max(0, now - at) / (90 * DAY)));

/** Sunflower spiral around a point; heavier notes sit nearer the core. */
function spiral(list: MemoryNote[], cx: number, cy: number, inner: number, step: number, now: number, sx: number, z: number): Star[] {
  const order = [...list].sort((a, b) => weight(b) - weight(a) || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || hash(a.id) - hash(b.id));
  return order.map((n, i) => {
    const a = i * GOLDEN + hash(n.id) * 0.5;
    const d = inner + step * Math.sqrt(i + 0.6);
    return { id: n.id, note: n, x: cx + Math.cos(a) * d * sx, y: cy + Math.sin(a) * d, r: radius(n) * z, glow: freshness(n.at, now), fresh: now - n.at < 3 * DAY };
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

  const youShown = you.length > MAX_YOU ? [...you].sort((a, b) => weight(b) - weight(a) || b.at - a.at).slice(0, MAX_YOU) : you;
  stars.push(...spiral(youShown, CX, CY, 34 + 6 * (z - 1), 8.5 * z, now, 1.3, z));
  if (you.length > youShown.length) aggs.push({ key: "you+", x: CX, y: CY + 34 + 8.5 * Math.sqrt(MAX_YOU) + 16, count: you.length - youShown.length, label: "more about you", target: "memory-you" });

  const k = repos.length + (overflow.length ? 1 : 0);
  const place = (i: number) => {
    if (k === 1) return { x: CX + 290, y: CY };
    const a = -Math.PI * 0.78 + (i / k) * Math.PI * 2;
    return { x: CX + Math.cos(a) * 300, y: CY + Math.sin(a) * 140 };
  };
  repos.forEach(([repo, list], i) => {
    const { x, y } = place(i);
    const shown = list.length > MAX_PER_CLUSTER ? [...list].sort((p, q) => weight(q) - weight(p) || q.at - p.at).slice(0, MAX_PER_CLUSTER) : list;
    const step = (shown.length > 24 ? 7 : 8.5) * z;
    stars.push(...spiral(shown, x, y, 12 * z, step, now, 1.15, z));
    const ring = 12 * z + step * Math.sqrt(shown.length + 0.6) + 9;
    const target = sectionId(repo);
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
  return { stars, ghosts, aggs, clusters, you: you.length, repoNotes: live.length - you.length, repoCount: groups.size, now };
}

/** Kind shape centred on 0,0. Shapes, not hues, tell kinds apart. */
function Shape({ kind, r, ...rest }: { kind: MemoryKind; r: number } & React.SVGProps<SVGElement>) {
  const p = rest as React.SVGProps<SVGPathElement>;
  switch (kind) {
    case "preference":
      return <circle r={r} {...(rest as React.SVGProps<SVGCircleElement>)} />;
    case "rule":
      return <path d={`M0 ${-r * 1.25}L${r * 1.25} 0L0 ${r * 1.25}L${-r * 1.25} 0Z`} {...p} />;
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
const SHADE: Record<MemoryKind, number> = { preference: 1, rule: 1, playbook: 0.92, lesson: 0.78, decision: 0.66, fact: 0 };

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
  const { stars, ghosts, aggs, clusters } = L;
  const [hot, setHot] = React.useState<string | null>(null);
  const all = React.useMemo(() => new Map([...stars, ...ghosts].map((s) => [s.id, s])), [stars, ghosts]);
  const h = hot ? all.get(hot) : undefined;
  const empty = stars.length === 0 && aggs.length === 0;
  const pending = notes.filter((n) => n.until == null && n.status === "pending").length;

  const summary = empty
    ? "Memory map: nothing remembered yet."
    : `Memory map: ${plural(L.you, "note")} about you; ${plural(L.repoNotes, "repo note")} across ${plural(L.repoCount, "repo")}` +
      `${pending ? `; ${pending} waiting for you` : ""}${ghosts.length ? `; ${plural(ghosts.length, "replaced note")}` : ""}. Tab through notes; Enter jumps to one in the list.`;

  const enter = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, scale: 0.6 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const } };
  const label = (s: Star) => `${s.ghost ? "Replaced " : ""}${KIND_LABEL[s.note.kind].toLowerCase()}${s.note.status === "pending" ? ", waiting for you" : ""}: ${noteHeadline(s.note.text)}`;
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
          <ellipse cx={CX} cy={CY} rx={300} ry={140} strokeOpacity={0.16} strokeDasharray="1 7" />
          <ellipse cx={CX} cy={CY} rx={420} ry={205} strokeOpacity={0.1} strokeDasharray="1 9" />
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

        {ghosts.map((g) => {
          const p = all.get(g.parent!)!;
          const on = hot === g.id || hot === g.parent;
          return <line key={`gl-${g.id}`} x1={g.x} y1={g.y} x2={p.x} y2={p.y} stroke="currentColor" strokeOpacity={on ? 0.55 : 0.2} strokeDasharray="2 2" />;
        })}

        {[...ghosts, ...stars].map((s, i, arr) => {
          const pend = s.note.status === "pending" && !s.ghost;
          const on = hot === s.id;
          const related = h && (h.parent === s.id || s.parent === hot);
          const dimmed = hot != null && !on && !related;
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
              {h.note.repo && !isOperatorKind(h.note.kind) && ` · ${h.note.repo}`} · {fmtAgo(Math.floor(h.note.at / 1000))}
              {h.ghost && " · replaced"}
            </span>
            {h.note.status === "pending" && !h.ghost && <span className="text-attention-text font-medium">needs you</span>}
          </p>
          <p className="text-foreground mt-0.5 line-clamp-4 text-meta leading-snug font-medium">{noteHeadline(h.note.text)}</p>
          {((h.note.uses ?? 0) > 0 || h.note.pinned) && (
            <p className="text-faint mt-0.5 text-micro">{[h.note.pinned && "pinned", (h.note.uses ?? 0) > 0 && `used ${h.note.uses}×`].filter(Boolean).join(" · ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
