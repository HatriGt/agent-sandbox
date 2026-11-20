import * as React from "react";
import { cn } from "@/lib/utils";
import { cellNumber } from "@/lib/viz";
import type { Activity, ActivityTone, JourneyActivity, QueueActivity, RingActivity, StagesActivity, TimerActivity, TransferActivity, VersusActivity } from "@/lib/viz-activity";
import { VizFrame } from "./VizFrame";
import { useLiveSlotTitle } from "./live-blocks";
import { Odometer, RollNumber, useRowEntrance, type Entrance } from "./motion";

/**
 * Activity cards (docs/output-visualizers.md, "Activity cards"): a thing that is happening right
 * now, drawn as one of amicro's Mono Charts (DESIGN.md, "Round: activity cards in the transcript").
 * One flat sheet (VizFrame `sheet`): a mono eyebrow with the title, then the head (a 24px bold
 * figure with its unit in mono, the state as a tiny mono chip whose dot is the machine's hue, and
 * a segmented toggle when the fence gave more than one reading), then the chart on a recessed
 * stage, drawn in one hue in opacity tiers: bullet rows with the label above a 12px track (timer,
 * journey with its stops as markers, transfer, the pipeline's stages), a pyramid of two pills with
 * the label inside (scoreboard), one tall pill per place (queue), a wide beaded donut with a
 * two-line centre (counter). Hovering a point opens the tooltip card for it; hovering a pyramid
 * pill, a stage row or a bead also takes the head's figure over. Every reading is computed from
 * the fence; nothing is added, nothing ticks, nothing counts up from zero.
 */
export function ActivityBlock({ activity, source }: { activity: Activity; source: string }) {
  switch (activity.kind) {
    case "timer":
      return <TimerCard a={activity} source={source} />;
    case "queue":
      return <QueueCard a={activity} source={source} />;
    case "journey":
      return <JourneyCard a={activity} source={source} />;
    case "transfer":
      return <TransferCard a={activity} source={source} />;
    case "versus":
      return <VersusCard a={activity} source={source} />;
    case "ring":
      return <RingCard a={activity} source={source} />;
    case "stages":
      return <StagesCard a={activity} source={source} />;
  }
}

// ---------------------------------------------------------------- shared

/** The chart's ink, one hue per state (index.css `--viz-ink-*`: tuned for a fill, not for text). */
const HUE: Record<ActivityTone, string> = { live: "var(--viz-ink-live)", ok: "var(--viz-ink-ok)", fail: "var(--viz-ink-fail)" };
/** The hue at a tier (the reference's 100 / 72 / 45 / 22 % steps): a second series is the same ink, paler. */
const tier = (tone: ActivityTone, p: number) => (p >= 100 ? HUE[tone] : `color-mix(in oklab, ${HUE[tone]} ${p}%, transparent)`);
const KIND_WORD: Record<Activity["kind"], string> = { timer: "Timer", queue: "Queue", journey: "Journey", transfer: "Transfer", versus: "Scoreboard", ring: "Counter", stages: "Stages" };
const pct = (f: number) => `${Math.round(f * 100)}%`;
const clamp01 = (f: number) => Math.min(1, Math.max(0, f));
/** What is not yet filled is neutral ink, never a tint of the hue. */
const TRACK = "bg-foreground/10";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** `2:48` → [`2:48`, ``]; `6 min` → [`6`, `min`]; `1.35 km` → [`1.35`, `km`]; `30%` stays whole. */
function splitUnit(text: string): [string, string] {
  const m = text.trim().match(/^([#+\-−]?\d[\d.,:]*)\s*([a-zA-Z°]{1,6})$/);
  return m ? [m[1], m[2]] : [text.trim(), ""];
}

/** One reading of the card's subject: the figure, its unit, and the short mono label on the toggle. */
type Reading = { key: string; figure: string; unit?: string };

/** A hovered point's claim on the head: the figure and unit shown while the pointer rests there. */
type Peek = { figure: string; unit?: string } | null;
const PeekContext = React.createContext<(p: Peek) => void>(() => {});

const ROWS = ["head", "chart", "foot"] as const;
const RowEntrance = React.createContext<(key: string) => Entrance>(() => ({ className: "" }));

/** The sheet: 26rem so it reads as a card and not a banner; rows rise in once on first paint. */
function Card({ a, source, children }: { a: Activity; source: string; children: (peek: Peek) => React.ReactNode }) {
  const slotTitle = useLiveSlotTitle();
  const entrance = useRowEntrance(ROWS);
  const [peek, setPeek] = React.useState<Peek>(null);
  return (
    <VizFrame title={a.title ?? slotTitle ?? KIND_WORD[a.kind]} source={source} className="max-w-[26rem]" sheet>
      <RowEntrance.Provider value={entrance}>
        <PeekContext.Provider value={setPeek}>
          <div className="px-4 pb-4" data-activity={a.kind} data-tone={a.tone}>
            {children(peek)}
          </div>
        </PeekContext.Provider>
      </RowEntrance.Provider>
    </VizFrame>
  );
}

function Row({ name, className, children }: { name: (typeof ROWS)[number]; className?: string; children: React.ReactNode }) {
  const e = React.useContext(RowEntrance)(name);
  return (
    <div className={cn(className, e.className)} style={e.style}>
      {children}
    </div>
  );
}

/** The tiny mono chip (the reference's `42-Day Streak`): hairline, 5% ground, a 6px dot for the state. */
function Chip({ tone, children, className }: { tone?: ActivityTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("border-foreground/10 bg-foreground/5 inline-flex h-[18px] max-w-full items-center gap-1 rounded-full border px-1.5 font-mono text-[10px] whitespace-nowrap tabular-nums", tone ? "text-foreground/80" : "text-muted-foreground", className)}>
      {tone && <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone === "live" && "viz-pulse")} style={{ background: HUE[tone] }} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * The segmented toggle (the reference's `1H 24H 7D`): one mono segment per reading the fence gave,
 * the chosen one raised in ink with the paper's text. It only ever switches between numbers the
 * agent wrote.
 */
function Segments({ options, value, onChange }: { options: Reading[]; value: string; onChange: (k: string) => void }) {
  return (
    <div role="tablist" className="border-foreground/10 bg-foreground/5 inline-flex shrink-0 items-center rounded-lg border p-0.5 font-mono text-[10px] font-medium" data-segments>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={o.key === value}
          onClick={() => onChange(o.key)}
          className={cn("h-4 max-w-[5.5rem] cursor-pointer truncate rounded-md px-2 leading-none whitespace-nowrap transition-[background-color,color] duration-150", o.key === value ? "bg-foreground text-background font-semibold" : "text-muted-foreground hover:text-foreground")}
        >
          {o.key}
        </button>
      ))}
    </div>
  );
}

/**
 * The head: the figure (24px bold, tight, tabular; digits roll on a re-emit, a toggle or a hover)
 * with its unit in mono, the state chip, any tag chips; on the right the toggle when there is more
 * than one reading, else a chip. A hovered pill, row or bead takes the figure over while the
 * pointer rests there (`peek`), the way the reference's pyramid shows the hovered level.
 */
function Head({ readings, tone, state, chips = [], right, peek, chosen, onChoose }: { readings: Reading[]; tone: ActivityTone; state?: string; chips?: (string | false | null | undefined)[]; right?: string; peek: Peek; chosen: string; onChoose: (k: string) => void }) {
  const r = readings.find((x) => x.key === chosen) ?? readings[0];
  const figure = peek?.figure ?? r.figure;
  const unit = peek ? peek.unit : r.unit;
  return (
    <Row name="head" className="flex h-7 items-center justify-between gap-3 px-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex shrink-0 items-baseline gap-1.5">
          <Odometer text={figure} className="text-foreground text-2xl leading-none font-bold tracking-tight tabular-nums" />
          {unit && <span className="text-muted-foreground font-mono text-micro whitespace-nowrap">{unit}</span>}
        </span>
        {state && (
          <Chip tone={tone} className="min-w-0">
            {state}
          </Chip>
        )}
        {chips.filter((c): c is string => !!c).map((c) => (
          <Chip key={c} className="min-w-0">
            {c}
          </Chip>
        ))}
      </div>
      {readings.length > 1 ? <Segments options={readings} value={chosen} onChange={onChoose} /> : right ? <Chip className="shrink-0">{right}</Chip> : null}
    </Row>
  );
}

/** Which reading the toggle shows; the first by default. */
function useChosen(readings: Reading[]): [string, (k: string) => void] {
  const [chosen, setChosen] = React.useState(readings[0]?.key ?? "");
  return [readings.some((r) => r.key === chosen) ? chosen : (readings[0]?.key ?? ""), setChosen];
}

/** The recessed stage the chart sits on (index.css .viz-stage): 14px radius, 12px padding. */
function Stage({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <Row name="chart" className={cn("viz-stage relative mt-2.5 p-3", className)}>
      {children}
    </Row>
  );
}

/** Mono labels at the two ends of a chart (`09:27` … `09:31`, `11 ahead` … `Merge`). */
function Axis({ left, right, className }: { left?: React.ReactNode; right?: React.ReactNode; className?: string }) {
  if (!left && !right) return null;
  return (
    <div className={cn("text-faint flex items-baseline justify-between gap-3 font-mono text-[10px] tabular-nums", className)}>
      <span className="min-w-0 truncate">{left}</span>
      <span className="min-w-0 shrink-0 truncate">{right}</span>
    </div>
  );
}

/** Every `key: value` the kind did not claim, one mono line under the stage. */
function Foot({ a, extra = [] }: { a: Activity; extra?: (string | false | null | undefined)[] }) {
  const parts = [...extra.filter((x): x is string => !!x), ...a.footer.map((f) => `${f.key} ${f.value}`), ...(a.note ? [a.note] : [])];
  if (parts.length === 0) return null;
  return (
    <Row name="foot" className="text-faint mt-2.5 truncate px-0.5 font-mono text-[10px] tabular-nums">
      {parts.join("  ·  ")}
    </Row>
  );
}

// ---------------------------------------------------------------- tooltip

type TipRow = { label: string; value: string; dot?: string };
type TipContent = { title: string; rows: TipRow[] };

/**
 * The tooltip card (the reference's chart tooltip): a title, a hairline, then rows of muted label
 * and bold value, a dot before a row that stands for the hue. Above the point, kept inside a wide
 * chart; or beside the pointer (to its left past 60% of the width), vertically centred, for the
 * pills, rows and beads whose hover also drives the head.
 */
function Tip({ x, w, title, rows, beside = false }: { x: number; w: number; title: string; rows: TipRow[]; beside?: boolean }) {
  const flip = beside && x > w * 0.6;
  const left = beside ? (flip ? x - 12 : x + 12) : w >= 128 ? Math.min(Math.max(x, 64), w - 64) : x;
  return (
    <div
      aria-hidden
      className={cn("viz-readout viz-tile pointer-events-none absolute z-10 min-w-[8.5rem] rounded-lg px-2.5 py-1.5 text-[11px] shadow-e2 transition-[left] duration-75", beside ? cn("top-1/2 -translate-y-1/2", flip && "-translate-x-full") : "bottom-full mb-2 -translate-x-1/2")}
      style={{ left }}
    >
      <div className="text-muted-foreground border-foreground/8 mb-1 border-b pb-1 font-mono whitespace-nowrap">{title}</div>
      <div className="flex flex-col gap-0.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground flex items-center gap-1.5 font-mono whitespace-nowrap">
              {r.dot && <span className="size-1.5 shrink-0 rounded-full" style={{ background: r.dot }} />}
              {r.label}
            </span>
            <span className="text-foreground font-mono font-semibold whitespace-nowrap tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A pointer's place along a row, 0..1, and its x in px; null when the pointer is elsewhere. */
function useHover<T extends HTMLElement>(): [React.RefObject<T | null>, { x: number; frac: number; w: number } | null, React.HTMLAttributes<T>] {
  const ref = React.useRef<T>(null);
  const [at, setAt] = React.useState<{ x: number; frac: number; w: number } | null>(null);
  const handlers: React.HTMLAttributes<T> = {
    onPointerMove: (ev) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = Math.min(r.width, Math.max(0, ev.clientX - r.left));
      setAt({ x, frac: r.width ? x / r.width : 0, w: r.width });
    },
    onPointerLeave: () => setAt(null),
  };
  return [ref, at, handlers];
}

// ---------------------------------------------------------------- charts

type Marker = { label: string; frac: number };

/**
 * A bullet row (the reference's bullet chart): the label and the reading on one mono line, then a
 * 12px track in 10% ink with the fill in the hue, grown once on first paint and tweened after.
 * Markers cut it as 4px ink pills (a journey's stops, labelled under); the one reached last is
 * ink, the rest faint. Hovering opens the tooltip for the marker under the pointer (which grows),
 * else for the scale there.
 */
function Bullet({ label, value, target, frac, tone, shade = 100, markers = [], tip, index = 1, className }: { label: React.ReactNode; value?: React.ReactNode; target?: React.ReactNode; frac: number | null; tone: ActivityTone; shade?: number; markers?: Marker[]; tip: (f: number) => TipContent; index?: number; className?: string }) {
  const [ref, at, handlers] = useHover<HTMLDivElement>();
  const f = frac === null ? 0 : clamp01(frac);
  const reached = markers.filter((m) => m.frac <= f + 1e-6);
  const current = reached[reached.length - 1];
  const nearest = at && markers.length > 0 ? markers.reduce((best, m) => (Math.abs(m.frac - at.frac) < Math.abs(best.frac - at.frac) ? m : best)) : null;
  const near = nearest && at && Math.abs(nearest.frac - at.frac) * at.w <= 14 ? nearest : null;
  const t: TipContent | null = at ? (near ? { title: near.label, rows: [{ label: "state", value: near.frac <= f + 1e-6 ? "reached" : "ahead", dot: near.frac <= f + 1e-6 ? HUE[tone] : undefined }, { label: "at", value: pct(near.frac) }] } : tip(at.frac)) : null;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-3 font-mono text-micro">
        <span className="text-foreground min-w-0 truncate font-medium">{label}</span>
        {(value || target) && (
          <span className="text-muted-foreground shrink-0 tabular-nums">
            {value}
            {target && <span className="opacity-60"> / {target}</span>}
          </span>
        )}
      </div>
      <div className={cn("relative", markers.length > 1 && "pb-4")}>
        <div ref={ref} {...handlers} className="relative -my-1.5 cursor-crosshair py-1.5" role="progressbar" aria-valuenow={frac === null ? undefined : Math.round(f * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn("relative h-3 overflow-hidden rounded-full", TRACK)}>
            <div className={cn("viz-tween-w viz-grow-x absolute inset-y-0 left-0 rounded-full", frac === null && "opacity-40")} style={{ background: tier(tone, shade), width: `${(frac === null ? 0.5 : f) * 100}%`, "--i": index } as React.CSSProperties} />
          </div>
          {markers.map((m) => (
            <span
              key={m.label + m.frac}
              aria-hidden
              className={cn("bg-foreground absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm transition-[opacity,scale] duration-200", m.frac <= f + 1e-6 ? "opacity-100" : "opacity-35", near === m && "scale-y-125")}
              style={{ left: `${m.frac * 100}%` }}
            />
          ))}
          {at && t && <Tip x={at.x} w={at.w} title={t.title} rows={t.rows} />}
        </div>
        {markers.length > 1 && (
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-3.5">
            {markers.map((m, i) => (
              <span
                key={m.label + m.frac}
                className={cn("absolute top-0 max-w-[40%] truncate font-mono text-[10px] transition-colors duration-200", current === m || near === m ? "text-foreground" : "text-faint", i === 0 ? "" : i === markers.length - 1 ? "-translate-x-full" : "-translate-x-1/2")}
                style={{ left: `${m.frac * 100}%` }}
              >
                {m.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Tall pills (the reference's rounded bar chart): one per place in the line, the passed ones in
 * the hue, the reader's own place in ink, the rest in 10% ink. A fill that grows lights its new
 * pills one after another (14 ms apart). The pill under the pointer opens the tooltip for its
 * place while the others step back a little.
 */
function Pills({ n, filled, tone, tip }: { n: number; filled: number; tone: ActivityTone; tip: (i: number) => TipContent }) {
  const [ref, at, handlers] = useHover<HTMLDivElement>();
  const prev = React.useRef(filled);
  const from = prev.current;
  React.useEffect(() => {
    prev.current = filled;
  }, [filled]);
  const hot = at ? Math.min(n - 1, Math.floor(at.frac * n)) : -1;
  const t = hot >= 0 ? tip(hot) : null;
  return (
    <div ref={ref} {...handlers} className="relative flex h-14 cursor-crosshair items-end gap-[3px]" role="progressbar" aria-valuenow={filled} aria-valuemin={0} aria-valuemax={n}>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn("viz-grow-y h-full min-w-0 flex-1 origin-bottom rounded-full transition-[background-color,opacity,scale] duration-200", i > filled && TRACK, i === filled && "bg-foreground", i === hot && "scale-y-105", hot >= 0 && i !== hot && "opacity-75")}
          style={{ ...(i < filled ? { background: HUE[tone] } : undefined), transitionDelay: i >= from && i < filled ? `${(i - from) * 14}ms` : undefined, "--i": Math.min(i, 40) + 1 } as React.CSSProperties}
        />
      ))}
      {at && t && <Tip x={at.x} w={at.w} title={t.title} rows={t.rows} />}
    </div>
  );
}

/**
 * The rounded donut (the reference's donut ring): a 10px ring split into one bead per attempt
 * when the count is known, else one arc; done beads in the hue, the next one paler, the rest in
 * 10% ink. The reading sits in the middle on two lines, bold mono over a spaced uppercase word.
 * A hovered bead thickens, opens its tooltip above the ring and takes the head's figure over.
 */
function Donut({ n, filled, frac, tone, centre, word, tip }: { n: number | null; filled: number; frac: number | null; tone: ActivityTone; centre: string; word: string; tip: (i: number) => TipContent & { peek: Peek } }) {
  const R = 30;
  const C = 2 * Math.PI * R;
  const segs = n && n >= 2 && n <= 24 ? n : null;
  const gap = 5;
  const seg = segs ? (C - gap * segs) / segs : null;
  const f = frac === null ? 0 : clamp01(frac);
  const [hot, setHot] = React.useState(-1);
  const setPeek = React.useContext(PeekContext);
  const t = hot >= 0 ? tip(hot) : null;
  const enter = (i: number) => {
    setHot(i);
    setPeek(tip(i).peek);
  };
  const leave = () => {
    setHot(-1);
    setPeek(null);
  };
  const stroke = (i: number) => (i < filled ? HUE[tone] : i === filled ? tier(tone, 40) : "color-mix(in oklab, var(--foreground) 10%, transparent)");
  return (
    <div className="relative mx-auto size-[148px]">
      <svg viewBox="0 0 80 80" className="size-full -rotate-90 overflow-visible" aria-hidden>
        {segs && seg !== null ? (
          Array.from({ length: segs }, (_, i) => (
            <circle
              key={i}
              cx="40"
              cy="40"
              r={R}
              fill="none"
              strokeWidth={hot === i ? 12 : 10}
              strokeLinecap="round"
              className="cursor-pointer transition-[stroke,stroke-width,opacity] duration-200"
              stroke={stroke(i)}
              opacity={hot >= 0 && hot !== i && i < filled ? 0.7 : 1}
              strokeDasharray={`${Math.max(0, seg - 10)} ${C - Math.max(0, seg - 10)}`}
              strokeDashoffset={-(i * (seg + gap)) - 5}
              style={{ transitionDelay: i < filled ? `${i * 60}ms` : undefined }}
              onPointerEnter={() => enter(i)}
              onPointerLeave={leave}
            />
          ))
        ) : (
          <>
            <circle cx="40" cy="40" r={R} fill="none" strokeWidth="10" stroke="color-mix(in oklab, var(--foreground) 10%, transparent)" />
            <circle cx="40" cy="40" r={R} fill="none" strokeWidth="10" strokeLinecap="round" stroke={HUE[tone]} className="transition-[stroke-dashoffset] duration-300" strokeDasharray={C} strokeDashoffset={C * (1 - f)} />
          </>
        )}
      </svg>
      <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className="text-foreground font-mono text-lg leading-none font-bold tracking-tight tabular-nums">{centre}</span>
        <span className="text-muted-foreground font-mono text-[9px] tracking-wider uppercase">{word}</span>
      </span>
      {t && <Tip x={74} w={148} title={t.title} rows={t.rows} />}
    </div>
  );
}

/**
 * The pyramid (the reference's tier pyramid stack): one centred pill per side, its width the
 * side's share of the larger score (never under a third, so the label fits), the leader in the
 * hue and the other the same ink at 45%, the label inside left and the score inside right in
 * bold mono. A hovered pill lifts (1.03, a shadow), opens its tooltip beside the pointer, and the
 * head shows its score.
 */
function Pyramid({ rows, tone }: { rows: { label: string; value: string; frac: number | null; lead: boolean; tip: TipRow[]; peek: Peek }[]; tone: ActivityTone }) {
  const [hot, setHot] = React.useState(-1);
  const [at, setAt] = React.useState({ x: 0, w: 0 });
  const setPeek = React.useContext(PeekContext);
  return (
    <div className="flex flex-col items-center gap-2 py-1">
      {rows.map((r, i) => {
        const shade = r.lead ? 100 : 45;
        return (
          <div
            key={r.label + i}
            role="listitem"
            className={cn("viz-grow-x relative flex h-8 origin-center cursor-default items-center justify-between rounded-xl px-3 transition-[scale,box-shadow] duration-200", hot === i && "z-10 scale-[1.03] shadow-e2")}
            style={{ width: `${Math.max(34, (r.frac ?? 0.5) * 94)}%`, background: tier(tone, shade), "--i": i + 1 } as React.CSSProperties}
            onPointerEnter={() => {
              setHot(i);
              setPeek(r.peek);
            }}
            onPointerMove={(ev) => {
              const b = ev.currentTarget.getBoundingClientRect();
              setAt({ x: ev.clientX - b.left, w: b.width });
            }}
            onPointerLeave={() => {
              setHot(-1);
              setPeek(null);
            }}
          >
            <span className={cn("truncate font-mono text-[10px] font-bold tracking-tight", shade > 60 ? "text-background" : "text-foreground")}>{r.label}</span>
            <span className={cn("ml-2 shrink-0 font-mono text-[10px] tabular-nums", shade > 60 ? "text-background/80" : "text-foreground/80")}>
              <RollNumber text={r.value} />
            </span>
            {hot === i && <Tip x={at.x} w={at.w} title={r.label} rows={r.tip} beside />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Stacked bullet rows for a pipeline's stages: done stages in the hue at 60%, the active one at
 * full, the rest an empty track. A hovered row is lit, opens its tooltip beside the pointer, and
 * the head shows its reading.
 */
function StageRows({ rows, tone }: { rows: { label: string; value: string; frac: number | null; shade: number; tip: TipRow[]; peek: Peek }[]; tone: ActivityTone }) {
  const [hot, setHot] = React.useState(-1);
  const [at, setAt] = React.useState({ x: 0, w: 0 });
  const setPeek = React.useContext(PeekContext);
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <div
          key={r.label + i}
          role="listitem"
          className={cn("relative -mx-1.5 rounded-lg px-1.5 py-1 transition-[background-color] duration-150", hot === i && "bg-foreground/5")}
          onPointerEnter={() => {
            setHot(i);
            setPeek(r.peek);
          }}
          onPointerMove={(ev) => {
            const b = ev.currentTarget.getBoundingClientRect();
            setAt({ x: ev.clientX - b.left, w: b.width });
          }}
          onPointerLeave={() => {
            setHot(-1);
            setPeek(null);
          }}
        >
          <div className="flex items-center justify-between gap-3 font-mono text-micro">
            <span className={cn("min-w-0 truncate font-medium transition-colors duration-200", r.shade > 0 || hot === i ? "text-foreground" : "text-faint")}>{r.label}</span>
            <span className={cn("shrink-0 tabular-nums", r.shade === 100 || hot === i ? "text-foreground" : "text-muted-foreground")}>
              <RollNumber text={r.value} />
            </span>
          </div>
          <div className={cn("relative mt-1 h-2.5 overflow-hidden rounded-full", TRACK)}>
            {r.shade > 0 && <div className="viz-tween-w viz-grow-x absolute inset-y-0 left-0 rounded-full" style={{ background: tier(tone, r.shade), width: `${(r.frac ?? 1) * 100}%`, "--i": i + 1 } as React.CSSProperties} />}
          </div>
          {hot === i && <Tip x={at.x} w={at.w} title={r.label} rows={r.tip} beside />}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- timer

function TimerCard({ a, source }: { a: TimerActivity; source: string }) {
  const [num, unit] = splitUnit(a.hero);
  const state = a.status ?? (a.expired ? "Time's up" : a.heroLabel === "left" ? "Running" : "Elapsed");
  const readings: Reading[] = [{ key: a.expired ? "over" : a.heroLabel, figure: num, unit: [unit, a.expired ? "over" : a.heroLabel].filter(Boolean).join(" ") }];
  if (a.frac !== null && !a.expired) readings.push({ key: "done", figure: pct(a.frac), unit: "done" });
  const [chosen, choose] = useChosen(readings);
  return (
    <Card a={a} source={source}>
      {(peek) => (
        <>
          <Head readings={readings} tone={a.tone} state={state} peek={peek} chosen={chosen} onChoose={choose} right={a.expired && a.frac !== null ? "100% done" : undefined} />
          <Stage>
            <Bullet
              label={a.expired ? "Elapsed" : cap(a.heroLabel)}
              value={a.hero}
              target={a.total ?? undefined}
              frac={a.expired ? 1 : a.frac}
              tone={a.tone}
              tip={(f) => ({ title: `${pct(f)} of the way`, rows: [{ label: "done", value: a.expired ? "100%" : a.frac === null ? "—" : pct(a.frac), dot: HUE[a.tone] }, ...(a.ends ? [{ label: a.expired ? "ended" : "ends", value: a.ends }] : [])] })}
            />
            <Axis className="mt-2" left={a.started} right={a.ends && (a.expired ? `ended ${a.ends}` : a.ends)} />
          </Stage>
          <Foot a={a} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- queue

function QueueCard({ a, source }: { a: QueueActivity; source: string }) {
  const next = a.position === 1;
  const status = a.status ?? (a.tone === "ok" ? "Ready" : next ? "You're next" : "In line");
  const n = a.of && a.of >= 2 && a.of <= 64 ? a.of : null;
  const f = a.frac === null ? 0 : clamp01(a.frac);
  const filled = n ? Math.round(f * n) : 0;
  const readings: Reading[] = [{ key: "place", figure: next ? "1" : a.positionText, unit: a.of !== null ? `of ${a.of}` : next ? "next" : "in line" }];
  if (a.ahead !== null && a.ahead > 0) readings.push({ key: "ahead", figure: String(a.ahead), unit: "ahead" });
  if (a.wait) {
    const [wn, wu] = splitUnit(a.wait);
    readings.push({ key: "wait", figure: wn, unit: [wu, "to wait"].filter(Boolean).join(" ") });
  }
  const [chosen, choose] = useChosen(readings);
  const place = (i: number): TipContent => ({ title: `place ${i + 1} of ${n}`, rows: [{ label: "state", value: i < filled ? "passed" : i === filled ? "you" : "ahead", dot: i < filled ? HUE[a.tone] : undefined }, ...(a.end ? [{ label: "ends at", value: a.end }] : [])] });
  return (
    <Card a={a} source={source}>
      {(peek) => (
        <>
          <Head readings={readings} tone={a.tone} state={status} peek={peek} chosen={chosen} onChoose={choose} />
          {(a.frac !== null || a.end) && (
            <Stage>
              {n ? (
                <Pills n={n} filled={filled} tone={a.tone} tip={place} />
              ) : (
                <Bullet label="Place" value={a.positionText} target={a.of ?? undefined} frac={a.frac} tone={a.tone} tip={(fr) => ({ title: `${pct(fr)} of the line`, rows: [{ label: "you", value: a.frac === null ? "—" : pct(a.frac), dot: HUE[a.tone] }] })} />
              )}
              <Axis className="mt-2" left={a.ahead !== null && a.ahead > 0 ? `${a.ahead} ahead` : a.tone === "ok" ? "done" : "front"} right={a.end} />
            </Stage>
          )}
          <Foot a={a} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- journey

function JourneyCard({ a, source }: { a: JourneyActivity; source: string }) {
  const reached = a.stops.filter((s) => a.frac !== null && s.frac <= a.frac + 1e-6);
  const at = reached[reached.length - 1]?.label;
  const status = a.status ?? (a.tone === "ok" ? "Arrived" : "On the way");
  const readings: Reading[] = [];
  if (a.remaining) {
    const [num, unit] = splitUnit(a.remaining);
    readings.push({ key: "to go", figure: num, unit: `${unit} to go`.trim() });
  }
  if (a.frac !== null) readings.push({ key: "%", figure: pct(a.frac), unit: "of the way" });
  if (readings.length === 0) readings.push({ key: "at", figure: at ?? "—", unit: at ? "now" : undefined });
  const [chosen, choose] = useChosen(readings);
  const markers = a.stops.length > 1 ? a.stops : a.from && a.to ? [{ label: a.from, frac: 0 }, { label: a.to, frac: 1 }] : [];
  const ends = markers.length > 1 ? `${markers[0].label} → ${markers[markers.length - 1].label}` : "Route";
  return (
    <Card a={a} source={source}>
      {(peek) => (
        <>
          <Head readings={readings} tone={a.tone} state={status} peek={peek} chosen={chosen} onChoose={choose} right={at} />
          <Stage>
            <Bullet
              label={ends}
              value={a.frac !== null ? pct(a.frac) : a.remaining}
              frac={a.frac}
              tone={a.tone}
              markers={markers}
              tip={(f) => ({ title: `${pct(f)} of the way`, rows: [{ label: "now at", value: a.frac === null ? "—" : pct(a.frac), dot: HUE[a.tone] }, ...(a.arrives ? [{ label: "arrives", value: a.arrives }] : [])] })}
            />
            <Axis className={markers.length > 1 ? "mt-1" : "mt-2"} left={a.departed} right={a.arrives} />
          </Stage>
          <Foot a={a} extra={[readings.length > 1 && at ? `at ${at}` : undefined, a.by]} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- transfer

function TransferCard({ a, source }: { a: TransferActivity; source: string }) {
  const status = a.status ?? (a.tone === "ok" ? "Arrived" : "In flight");
  const readings: Reading[] = [];
  if (a.frac !== null) readings.push({ key: "%", figure: pct(a.frac), unit: "done" });
  if (a.remaining) {
    const [num, unit] = splitUnit(a.remaining);
    readings.push({ key: "left", figure: num, unit: `${unit} to go`.trim() });
  }
  if (readings.length === 0) readings.push({ key: "to", figure: a.to, unit: `from ${a.from}` });
  const [chosen, choose] = useChosen(readings);
  return (
    <Card a={a} source={source}>
      {(peek) => (
        <>
          <Head readings={readings} tone={a.tone} state={status} peek={peek} chosen={chosen} onChoose={choose} right={a.tag} />
          <Stage>
            <Bullet
              label={`${a.from} → ${a.to}`}
              value={a.frac !== null ? pct(a.frac) : a.remaining}
              frac={a.frac}
              tone={a.tone}
              tip={(f) => ({ title: `${pct(f)} of the way`, rows: [{ label: "copied", value: a.frac === null ? "—" : pct(a.frac), dot: HUE[a.tone] }, { label: "from", value: a.from }, { label: "to", value: a.to }] })}
            />
            <Axis className="mt-2" left={a.departed} right={a.arrives ?? a.remaining} />
          </Stage>
          <Foot a={a} extra={[readings.length > 1 ? a.tag : undefined]} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- versus

function VersusCard({ a, source }: { a: VersusActivity; source: string }) {
  const h = cellNumber(a.home.score);
  const w = cellNumber(a.away.score);
  const numeric = h !== null && w !== null;
  const max = numeric ? Math.max(Math.abs(h), Math.abs(w)) : 0;
  const delta = numeric ? Math.abs(h - w) : null;
  const lead = numeric && h !== w ? (h > w ? a.home.name : a.away.name) : null;
  const state = [a.live ? "Live" : a.status, a.event].filter(Boolean).join(" · ");
  const readings: Reading[] =
    delta !== null
      ? [
          { key: "gap", figure: String(+delta.toFixed(2)), unit: lead ? "apart" : "apart · level" },
          { key: a.home.name, figure: a.home.score, unit: a.home.name },
          { key: a.away.name, figure: a.away.score, unit: a.away.name },
        ]
      : [{ key: "score", figure: `${a.home.score} – ${a.away.score}` }];
  const [chosen, choose] = useChosen(readings);
  const side = (s: { name: string; score: string }, n: number | null) => ({
    label: s.name,
    value: s.score,
    frac: numeric && max > 0 && n !== null ? Math.abs(n) / max : null,
    lead: lead === null || lead === s.name,
    tip: [{ label: "score", value: s.score, dot: HUE[a.tone] }, ...(delta !== null && lead ? [{ label: lead === s.name ? "ahead by" : "behind by", value: String(+delta.toFixed(2)) }] : []), ...(a.clock ? [{ label: "clock", value: a.clock }] : [])],
    peek: { figure: s.score, unit: s.name },
  });
  return (
    <Card a={a} source={source}>
      {(peek) => (
        <>
          <Head readings={readings} tone={a.tone} state={state || undefined} peek={peek} chosen={chosen} onChoose={choose} right={a.clock} />
          <Stage>
            <Pyramid tone={a.tone} rows={[side(a.home, h), side(a.away, w)]} />
          </Stage>
          <Foot a={a} extra={[readings.length > 1 && a.clock ? `clock ${a.clock}` : undefined]} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- ring

function RingCard({ a, source }: { a: RingActivity; source: string }) {
  const filled = a.n ?? 0;
  const readings: Reading[] = [{ key: "count", figure: a.value, unit: a.max !== null ? `of ${a.max}` : undefined }];
  if (a.frac !== null) readings.push({ key: "%", figure: pct(a.frac), unit: "of the loop" });
  if (a.time) readings.push({ key: "time", figure: a.time, unit: "elapsed" });
  const [chosen, choose] = useChosen(readings);
  return (
    <Card a={a} source={source}>
      {(peek) => (
        <>
          <Head readings={readings} tone={a.tone} state={a.status} peek={peek} chosen={chosen} onChoose={choose} />
          <Stage className="py-4">
            <Donut
              n={a.max}
              filled={filled}
              frac={a.frac}
              tone={a.tone}
              centre={a.frac !== null ? pct(a.frac) : a.value}
              word={a.max !== null ? `${a.value} of ${a.max}` : a.tone === "ok" ? "done" : "so far"}
              tip={(i) => {
                const st = i < filled ? "done" : i === filled ? "next" : "pending";
                return { title: `${i + 1} of ${a.max}`, rows: [{ label: "state", value: st, dot: i < filled ? HUE[a.tone] : undefined }], peek: { figure: String(i + 1), unit: st } };
              }}
            />
          </Stage>
          <Foot a={a} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- stages

function StagesCard({ a, source }: { a: StagesActivity; source: string }) {
  const done = a.stages.filter((s) => s.state === "done").length;
  const active = a.stages.find((s) => s.state === "active");
  const status = a.status ?? (a.tone === "ok" ? "Done" : active ? active.label : a.tone === "fail" ? "Failed" : "Waiting");
  const readings: Reading[] = [];
  if (a.remaining) {
    const [num, unit] = splitUnit(a.remaining);
    readings.push({ key: "left", figure: num, unit: `${unit} left`.trim() });
  }
  readings.push({ key: "done", figure: String(done), unit: `of ${a.stages.length} done` });
  const [chosen, choose] = useChosen(readings);
  const value = (s: StagesActivity["stages"][number]) => (s.state === "done" ? "done" : s.state === "active" ? (s.frac !== null ? pct(s.frac) : "now") : "—");
  const word = (s: StagesActivity["stages"][number]) => (s.state === "todo" ? "waiting" : s.state);
  return (
    <Card a={a} source={source}>
      {(peek) => (
        <>
          <Head readings={readings} tone={a.tone} state={status} peek={peek} chosen={chosen} onChoose={choose} />
          <Stage>
            <StageRows
              tone={a.tone}
              rows={a.stages.map((s, i) => ({
                label: s.label,
                value: value(s),
                frac: s.state === "done" ? 1 : s.state === "active" ? s.frac : 0,
                shade: s.state === "active" ? 100 : s.state === "done" ? 60 : 0,
                tip: [{ label: "state", value: word(s), dot: s.state === "todo" ? undefined : HUE[a.tone] }, ...(s.state === "active" && s.frac !== null ? [{ label: "progress", value: pct(s.frac) }] : []), { label: "stage", value: `${i + 1} of ${a.stages.length}` }],
                peek: { figure: s.state === "active" && s.frac !== null ? pct(s.frac) : String(i + 1), unit: s.state === "active" && s.frac !== null ? s.label : `${s.label} · ${word(s)}` },
              }))}
            />
          </Stage>
          <Foot a={a} />
        </>
      )}
    </Card>
  );
}
