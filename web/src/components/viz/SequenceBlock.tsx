import * as React from "react";
import { cn } from "@/lib/utils";
import type { Sequence } from "@/lib/viz-extra";
import { VizFrame } from "./VizFrame";

const LANE_W = 150;
const HEAD_H = 28;
const ROW_H = 30;
const NOTE_H = 24;
const PAD_X = 12;
const PAD_TOP = 8;
const CHAR_W = 6;

/**
 * ```sequence → a UML-ish sequence diagram. Actors across the top, hairline lifelines, one row
 * per message with an arrowhead toward the callee; replies (`-->`) are dashed. Notes are small
 * card chips on a lane, `loop` / `alt` / `opt` blocks a labelled bracket around their rows.
 * Hovering a message lifts its row and dims the rest, so a 30-message exchange can be read one
 * step at a time. Headers are not repeated at the bottom: the lifelines already say who is who.
 */
export function SequenceBlock({ sequence, source }: { sequence: Sequence; source: string }) {
  const { actors, items } = sequence;
  const [hover, setHover] = React.useState<number | null>(null);

  // Row layout: messages and notes each take a row; blocks are drawn around their rows and add
  // headroom for the label above the first enclosed row.
  const layout = React.useMemo(() => {
    const rowY: number[] = new Array(items.length).fill(0);
    let y = PAD_TOP + HEAD_H + 12;
    for (const [i, it] of items.entries()) {
      if (it.kind === "block") continue;
      // A row that opens a block (any block starts here) needs space for the label.
      if (items.some((b) => b.kind === "block" && b.start === i)) y += 16;
      rowY[i] = y;
      y += it.kind === "note" ? NOTE_H + 8 : ROW_H;
    }
    const W = actors.length * LANE_W + PAD_X * 2;
    const H = y + 6;
    return { rowY, W, H };
  }, [items, actors.length]);

  const { rowY, W, H } = layout;
  const laneX = (i: number) => PAD_X + i * LANE_W + LANE_W / 2;
  const msgs = items.filter((i) => i.kind === "msg").length;
  const fade = "transition-opacity duration-150 motion-reduce:transition-none";
  const dim = (i: number) => hover !== null && hover !== i;
  // Blocks nest by containment; outer ones draw a touch wider than inner ones.
  const blocks = items.filter((i): i is Extract<typeof i, { kind: "block" }> => i.kind === "block");
  const depthOf = (b: (typeof blocks)[number]) => blocks.filter((o) => o !== b && o.start <= b.start && o.end >= b.end).length;

  return (
    <VizFrame title={`${actors.length} participants · ${msgs} message${msgs === 1 ? "" : "s"}`} source={source}>
      <div className="overflow-x-auto px-4 py-3" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="group" aria-label="sequence diagram — hover a message to isolate it">
          {/* lifelines + headers */}
          {actors.map((a, i) => (
            <g key={a} data-seq-actor={a}>
              <line x1={laneX(i)} y1={PAD_TOP + HEAD_H} x2={laneX(i)} y2={H - 4} stroke="var(--border)" strokeWidth={1} aria-hidden />
              <rect x={laneX(i) - LANE_W / 2 + 10} y={PAD_TOP} width={LANE_W - 20} height={HEAD_H} rx={8} fill="var(--muted)" stroke="var(--border)" strokeWidth={1} />
              <text x={laneX(i)} y={PAD_TOP + HEAD_H / 2 + 3.5} textAnchor="middle" className="fill-foreground" fontSize={11} fontWeight={500} fontFamily="var(--font-sans)">
                <title>{a}</title>
                {a.length > 20 ? a.slice(0, 19) + "…" : a}
              </text>
            </g>
          ))}
          {/* blocks (behind messages) */}
          {blocks.map((b, k) => {
            const inset = depthOf(b) * 6;
            const top = rowY[b.start] - 16 - 4 + inset;
            const last = items[b.end];
            const bottom = rowY[b.end] + (last.kind === "note" ? NOTE_H + 2 : ROW_H - 10) - inset;
            const x = PAD_X + 4 + inset;
            const w = W - PAD_X * 2 - 8 - inset * 2;
            const labelW = Math.min(b.label.length, 24) * CHAR_W + 12;
            return (
              <g key={k} data-seq-block={b.label} aria-hidden>
                <rect x={x} y={top} width={w} height={bottom - top} rx={6} fill="none" stroke="var(--line-strong)" strokeWidth={1} strokeDasharray="3 3" />
                <rect x={x} y={top} width={labelW} height={14} rx={3} fill="var(--card)" stroke="var(--line-strong)" strokeWidth={1} />
                <text x={x + 6} y={top + 10} className="fill-muted-foreground" fontSize={9.5} fontWeight={600} fontFamily="var(--font-mono)">
                  {b.label.length > 24 ? b.label.slice(0, 23) + "…" : b.label}
                </text>
              </g>
            );
          })}
          {/* messages and notes */}
          {items.map((it, i) => {
            if (it.kind === "block") return null;
            const y = rowY[i];
            if (it.kind === "note") {
              const cx = laneX(it.actor);
              const w = Math.min(LANE_W - 16, it.text.length * CHAR_W + 16);
              return (
                <g key={i} className={fade} opacity={dim(i) ? 0.3 : 1} data-seq-note>
                  <rect x={cx - w / 2} y={y} width={w} height={NOTE_H} rx={5} fill="var(--card)" stroke="var(--border)" strokeWidth={1} />
                  <text x={cx} y={y + NOTE_H / 2 + 3.5} textAnchor="middle" className="fill-muted-foreground" fontSize={10} fontStyle="italic" fontFamily="var(--font-sans)">
                    <title>{it.text}</title>
                    {it.text.length > 22 ? it.text.slice(0, 21) + "…" : it.text}
                  </text>
                </g>
              );
            }
            const x1 = laneX(it.from);
            const x2 = laneX(it.to);
            const lit = hover === i;
            const stroke = lit ? "var(--foreground)" : "var(--line-strong)";
            const self = it.from === it.to;
            const ly = y + ROW_H / 2 + 2;
            const label = `${actors[it.from]} ${it.reply ? "replies to" : "calls"} ${actors[it.to]}: ${it.text}`;
            const sw = lit ? 1.75 : 1.25;
            const dash = it.reply ? "4 3" : undefined;
            const dir = x2 > x1 ? 1 : -1;
            return (
              <g
                key={i}
                className={cn(fade, "outline-none")}
                opacity={dim(i) ? 0.3 : 1}
                tabIndex={0}
                role="listitem"
                aria-label={label}
                data-seq-msg={i}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <title>{label}</title>
                {/* a wide invisible hit target so the row is easy to catch */}
                <rect x={PAD_X} y={y} width={W - PAD_X * 2} height={ROW_H} fill="transparent" />
                {self ? (
                  <>
                    <path d={`M${x1},${ly - 6} H${x1 + 28} V${ly + 8} H${x1 + 2}`} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
                    <path d={`M${x1 + 7},${ly + 4.5} L${x1 + 2},${ly + 8} L${x1 + 7},${ly + 11.5}`} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
                  </>
                ) : (
                  <>
                    <line x1={x1} y1={ly} x2={x2} y2={ly} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
                    <path d={`M${x2 - dir * 5},${ly - 3.5} L${x2},${ly} L${x2 - dir * 5},${ly + 3.5}`} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
                  </>
                )}
                <text
                  x={self ? x1 + 34 : (x1 + x2) / 2}
                  y={ly - 5}
                  textAnchor={self ? "start" : "middle"}
                  className={lit ? "fill-foreground" : "fill-muted-foreground"}
                  fontSize={10.5}
                  fontFamily="var(--font-sans)"
                >
                  {it.text.length > 30 ? it.text.slice(0, 29) + "…" : it.text}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </VizFrame>
  );
}
