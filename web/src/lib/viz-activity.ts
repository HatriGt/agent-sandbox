/**
 * Activity cards (docs/output-visualizers.md, "Activity cards"): the live-activity shapes a phone
 * shows for a thing that is happening right now — a countdown, a place in a queue, a trip with an
 * arrival time, a transfer from here to there, a scoreboard, a loop counter, a cycle of stages —
 * for the things an agent reports the same way: a build with minutes left, a PR in a merge queue,
 * a deploy rolling toward production, a thread moving between hosts, a benchmark of two branches,
 * a retry loop, a job's phases. Same contract as lib/viz.ts: `key: value` lines, null for anything
 * not confidently understood, bounded input, no throws.
 */

export type ActivityKind = "timer" | "queue" | "journey" | "transfer" | "versus" | "ring" | "stages";

/** Fence languages that draw an activity card, with their aliases. */
export const ACTIVITY_LANGS: Record<string, ActivityKind> = {
  timer: "timer",
  countdown: "timer",
  queue: "queue",
  journey: "journey",
  trip: "journey",
  delivery: "journey",
  transfer: "transfer",
  flight: "transfer",
  migration: "transfer",
  versus: "versus",
  match: "versus",
  scoreboard: "versus",
  ring: "ring",
  counter: "ring",
  stages: "stages",
  phases: "stages",
  cycle: "stages",
};

/** The hue a card wears: what the machine is doing (DESIGN.md principle 2), never decoration. */
export type ActivityTone = "live" | "ok" | "fail";

export interface Footer {
  key: string;
  value: string;
}

interface Base {
  /** The eyebrow and the card's live-slot name (`title:`). */
  title?: string;
  /** The headline (`status:`, or the first line when it has no colon). */
  status?: string;
  note?: string;
  tone: ActivityTone;
  /** Every `key: value` the kind did not claim, in order: the footer facts. */
  footer: Footer[];
}

export interface TimerActivity extends Base {
  kind: "timer";
  /** The hero figure: the time left, else the time elapsed. */
  hero: string;
  heroLabel: "left" | "elapsed";
  /** Share of the total that has passed, when both are known. */
  frac: number | null;
  expired: boolean;
  /** The whole span as written (`4:00`), shown beside the hero on the bullet row. */
  total?: string;
  started?: string;
  ends?: string;
}

export interface QueueActivity extends Base {
  kind: "queue";
  /** As written: `#12`, `12`, `next`. */
  positionText: string;
  position: number | null;
  of: number | null;
  ahead: number | null;
  wait?: string;
  /** What the queue ends at ("Host stand", "Merge"). */
  end?: string;
  /** How far along the line the marker sits, when the length is known. */
  frac: number | null;
}

export interface Stop {
  label: string;
  frac: number;
}

export interface JourneyActivity extends Base {
  kind: "journey";
  from?: string;
  to?: string;
  frac: number | null;
  stops: Stop[];
  /** The hero: time or distance to go (`2 min`, `1.35 km`). */
  remaining?: string;
  departed?: string;
  arrives?: string;
  /** Who or what is carrying it (`Dani · Red scooter`, `freestyle-a`). */
  by?: string;
}

export interface TransferActivity extends Base {
  kind: "transfer";
  from: string;
  to: string;
  frac: number | null;
  /** A short chip beside the eyebrow (`Gate C14`, `rsync`). */
  tag?: string;
  departed?: string;
  arrives?: string;
  remaining?: string;
}

export interface Side {
  name: string;
  score: string;
}

export interface VersusActivity extends Base {
  kind: "versus";
  home: Side;
  away: Side;
  live: boolean;
  /** The latest event, chipped beside the live mark (`GOAL`, `regression`). */
  event?: string;
  clock?: string;
}

export interface RingActivity extends Base {
  kind: "ring";
  value: string;
  n: number | null;
  max: number | null;
  /** Share of the ring to fill, when max is known. */
  frac: number | null;
  time?: string;
}

export interface Stage {
  label: string;
  state: "done" | "active" | "todo";
  /** How far the active stage has come, when the agent said. */
  frac: number | null;
}

export interface StagesActivity extends Base {
  kind: "stages";
  stages: Stage[];
  remaining?: string;
}

export type Activity = TimerActivity | QueueActivity | JourneyActivity | TransferActivity | VersusActivity | RingActivity | StagesActivity;

// ---------------------------------------------------------------- small readers

/** `2:48`, `1:02:05`, `6h 14m`, `2m 30s`, `90s`, `4 min`, `1.5 h` → seconds. Null for anything else. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  const clock = t.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (clock) {
    const [, a, b, c] = clock;
    return c === undefined ? Number(a) * 60 + Number(b) : Number(a) * 3600 + Number(b) * 60 + Number(c);
  }
  const unit: Record<string, number> = { h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, s: 1, sec: 1, secs: 1, second: 1, seconds: 1 };
  let total = 0;
  let any = false;
  const re = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
  let m: RegExpExecArray | null;
  let consumed = "";
  while ((m = re.exec(t))) {
    const mult = unit[m[2]];
    if (mult === undefined) return null;
    total += Number(m[1]) * mult;
    any = true;
    consumed += m[0];
  }
  // Every non-space character must belong to a part: "4 min left" is not a duration.
  if (!any || consumed.replace(/\s/g, "") !== t.replace(/\s/g, "")) return null;
  return total;
}

/** `62%`, `3/5`, `3 of 5`, `0.62` → 0..1. Null for anything else. */
export function parseFraction(text: string): number | null {
  const t = text.trim();
  const pct = t.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pct) return clamp(Number(pct[1]) / 100);
  const ratio = t.match(/^(\d+(?:\.\d+)?)\s*(?:\/|of)\s*(\d+(?:\.\d+)?)$/i);
  if (ratio && Number(ratio[2]) > 0) return clamp(Number(ratio[1]) / Number(ratio[2]));
  const unit = t.match(/^(0(?:\.\d+)?|1(?:\.0+)?)$/);
  if (unit) return clamp(Number(unit[1]));
  return null;
}

const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

const OK_WORDS = /^(done|complete|completed|finished|final|landed|arrived|delivered|merged|ready|ok|passed|success)\b/i;
const FAIL_WORDS = /^(failed|failure|error|expired|cancelled|canceled|aborted|time'?s up|timed out|lost|rejected)\b/i;

/** The tone a status word implies; `live` when it says nothing about an end. */
function toneOf(...words: (string | undefined)[]): ActivityTone {
  for (const w of words) {
    if (!w) continue;
    if (OK_WORDS.test(w)) return "ok";
    if (FAIL_WORDS.test(w)) return "fail";
  }
  return "live";
}

interface Fields {
  status?: string;
  map: Map<string, string>;
  /** Keys in the order written; the footer keeps that order. */
  order: string[];
}

/**
 * `key: value` per line; a first line with no colon is the headline. Keys are lower-cased, so
 * `Left: 2:48` and `left: 2:48` are one key; the value keeps everything after the first colon
 * (times carry colons). A body over 24 lines or with a colon-less line past the first → null.
 */
function readFields(src: string): Fields | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 24) return null;
  const f: Fields = { map: new Map(), order: [] };
  lines.forEach((line, i) => {
    const idx = line.indexOf(":");
    if (idx <= 0 || idx > 24 || /^https?:/i.test(line)) {
      if (i === 0 && line.length <= 80) f.status = line;
      else f.map.set("\0bad", line);
      return;
    }
    const key = line.slice(0, idx).trim().toLowerCase().replace(/[-_]+/g, " ");
    const value = line.slice(idx + 1).trim();
    if (!key || !value) return;
    if (!f.map.has(key)) f.order.push(key);
    f.map.set(key, value);
  });
  if (f.map.has("\0bad")) return null;
  return f;
}

/** Take the first present key out of the fields, so what is left becomes the footer. */
function take(f: Fields, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = f.map.get(k);
    if (v !== undefined) {
      f.map.delete(k);
      return v;
    }
  }
  return undefined;
}

function base(f: Fields, tone: ActivityTone): Omit<Base, "tone"> & { tone: ActivityTone } {
  const title = take(f, "title", "name", "label");
  const note = take(f, "note");
  const footer = f.order.filter((k) => f.map.has(k)).map((k) => ({ key: k, value: f.map.get(k)! }));
  return { title, status: f.status, note, tone, footer };
}

// ---------------------------------------------------------------- kinds

function timer(f: Fields): TimerActivity | null {
  const status = take(f, "status", "state", "doing");
  f.status = status ?? f.status;
  const left = take(f, "left", "remaining", "time left");
  const elapsed = take(f, "elapsed", "running", "running for");
  const total = take(f, "total", "of", "duration", "limit");
  const started = take(f, "started", "since", "from");
  const ends = take(f, "ends", "until", "due", "deadline", "to");
  if (!left && !elapsed && !total) return null;
  const leftS = left ? parseDuration(left) : null;
  const elapsedS = elapsed ? parseDuration(elapsed) : null;
  const totalS = total ? parseDuration(total) : null;
  const expired = leftS === 0 || /^(0|0:00|0s|none|up)$/i.test(left ?? "");
  let frac: number | null = null;
  if (totalS && leftS !== null) frac = clamp(1 - leftS / totalS);
  else if (totalS && elapsedS !== null) frac = clamp(elapsedS / totalS);
  const hero = left ?? elapsed ?? total!;
  const tone = expired ? "fail" : toneOf(f.status);
  return { kind: "timer", ...base(f, tone), hero, heroLabel: left ? "left" : "elapsed", frac: expired ? 1 : frac, expired, total: total ?? undefined, started, ends };
}

function queue(f: Fields): QueueActivity | null {
  const status = take(f, "status", "state");
  f.status = status ?? f.status;
  const pos = take(f, "position", "place", "number", "spot");
  if (!pos) return null;
  const ofText = take(f, "of", "total", "length");
  const aheadText = take(f, "ahead");
  const wait = take(f, "wait", "eta", "estimated wait", "est wait", "est. wait");
  const end = take(f, "end", "goal", "to");
  const next = /^(next|you're next|now|first)$/i.test(pos);
  const position = next ? 1 : Number(pos.replace(/^#/, "")) || null;
  if (!next && position === null) return null;
  const of = ofText ? Number(ofText) || null : null;
  const aheadN = aheadText ? Number(aheadText) : position !== null ? position - 1 : NaN;
  const ahead = Number.isFinite(aheadN) ? aheadN : null;
  // The marker's place on the line: the head of the queue is the right end.
  let frac: number | null = null;
  if (position !== null && of && of >= position) frac = clamp(1 - (position - 1) / of);
  else if (position === 1) frac = 0.92;
  let tone = toneOf(f.status);
  if (tone === "live" && f.status && /ready|seated|your turn/i.test(f.status)) tone = "ok";
  // Through the queue: the marker rests on the head of the line.
  if (tone === "ok") frac = 1;
  return { kind: "queue", ...base(f, tone), positionText: next ? "next" : `#${position}`, position, of, ahead, wait, end, frac };
}

function journey(f: Fields): JourneyActivity | null {
  const status = take(f, "status", "state");
  f.status = status ?? f.status;
  const from = take(f, "from", "origin", "start");
  const to = take(f, "to", "destination", "end");
  const progress = take(f, "progress", "at", "done");
  const stopsText = take(f, "stops", "via", "route");
  const remaining = take(f, "remaining", "left", "to go");
  const departed = take(f, "departed", "left at", "started");
  const arrives = take(f, "arrives", "eta", "arrival", "lands", "due");
  const by = take(f, "by", "courier", "carrier", "driver", "host");
  const stopsRaw = stopsText ? stopsText.split(/\s*(?:,|\||->|→)\s*/).filter(Boolean) : [];
  if (stopsRaw.length === 1) return null;
  const stops: Stop[] = stopsRaw.map((label, i) => ({ label, frac: stopsRaw.length > 1 ? i / (stopsRaw.length - 1) : 0 }));
  let frac: number | null = progress ? parseFraction(progress) : null;
  if (frac === null && progress) {
    // `progress: Checkout` names a stop.
    const idx = stops.findIndex((s) => s.label.toLowerCase() === progress.toLowerCase());
    if (idx >= 0) frac = stops[idx].frac;
    else return null;
  }
  if (!from && !to && stops.length === 0 && frac === null) return null;
  const tone = toneOf(f.status);
  return { kind: "journey", ...base(f, frac !== null && frac >= 1 && tone === "live" ? "ok" : tone), from: from ?? stops[0]?.label, to: to ?? stops[stops.length - 1]?.label, frac, stops, remaining, departed, arrives, by };
}

function transfer(f: Fields): TransferActivity | null {
  const status = take(f, "status", "state");
  f.status = status ?? f.status;
  const from = take(f, "from", "origin", "source");
  const to = take(f, "to", "destination", "target");
  if (!from || !to) return null;
  const progress = take(f, "progress", "done", "at");
  const tag = take(f, "tag", "gate", "via", "channel");
  const departed = take(f, "departed", "started", "left");
  const arrives = take(f, "arrives", "lands", "eta", "arrival", "due");
  const remaining = take(f, "remaining", "time left", "left in");
  const frac = progress ? parseFraction(progress) : null;
  if (progress && frac === null) return null;
  const tone = toneOf(f.status);
  return { kind: "transfer", ...base(f, frac !== null && frac >= 1 && tone === "live" ? "ok" : tone), from, to, frac, tag, departed, arrives, remaining };
}

/** `Harbor 3 - 2 Ridge` → both sides; `Harbor 3` alone → one side. */
function side(text: string): Side | null {
  const m = text.trim().match(/^(.*?)\s+(\d+(?:[.,]\d+)?(?:\s*[a-z%]+)?)$/i) ?? text.trim().match(/^(\d+(?:[.,]\d+)?(?:\s*[a-z%]+)?)\s+(.*)$/i);
  if (!m) return null;
  const numFirst = /^\d/.test(m[1]);
  return numFirst ? { name: m[2], score: m[1] } : { name: m[1], score: m[2] };
}

function versus(f: Fields): VersusActivity | null {
  const status = take(f, "status", "state");
  f.status = status ?? f.status;
  let home: Side | null = null;
  let away: Side | null = null;
  const score = take(f, "score", "result");
  if (score) {
    const m = score.match(/^(.*?)\s+(\d+(?:[.,]\d+)?[a-z%]*)\s*[-–—:]\s*(\d+(?:[.,]\d+)?[a-z%]*)\s+(.*)$/i);
    if (!m) return null;
    home = { name: m[1], score: m[2] };
    away = { name: m[4], score: m[3] };
  } else {
    // `home: Harbor 3`, or the key as the name when the value is bare: `before: 410ms` / `after: 182ms`.
    const pick = (...keys: string[]): Side | null => {
      for (const k of keys) {
        const v = f.map.get(k);
        if (v === undefined) continue;
        f.map.delete(k);
        return side(v) ?? (/^\d[\d.,]*\s*[a-z%]*$/i.test(v.trim()) ? { name: k, score: v.trim() } : null);
      }
      return null;
    };
    home = pick("home", "a", "left", "before");
    away = pick("away", "b", "right", "after");
    if (!home || !away) return null;
  }
  const event = take(f, "event", "latest", "last");
  const clock = take(f, "clock", "time", "minute", "elapsed", "round");
  const tone = toneOf(f.status);
  const live = tone === "live";
  return { kind: "versus", ...base(f, tone), home, away, live, event, clock };
}

function ring(f: Fields): RingActivity | null {
  const status = take(f, "status", "state", "detail");
  f.status = status ?? f.status;
  const value = take(f, "value", "count", "n", "reps", "iteration", "attempt", "round");
  if (!value) return null;
  const maxText = take(f, "max", "of", "total", "target");
  const time = take(f, "time", "elapsed", "took", "duration");
  const n = Number(value.replace(/[^\d.-]/g, ""));
  const max = maxText ? Number(maxText.replace(/[^\d.]/g, "")) : NaN;
  const frac = Number.isFinite(n) && Number.isFinite(max) && max > 0 ? clamp(n / max) : null;
  const tone = toneOf(f.status);
  return { kind: "ring", ...base(f, frac !== null && frac >= 1 && tone === "live" ? "ok" : tone), value, n: Number.isFinite(n) ? n : null, max: Number.isFinite(max) ? max : null, frac, time };
}

const STAGE_RE = /^(.*?)(?:\s*\((\d+(?:\.\d+)?)\s*%\))?\s*([✓✔✗✘…]|\.\.\.)?$/;

function stages(f: Fields): StagesActivity | null {
  const status = take(f, "status", "state", "doing");
  f.status = status ?? f.status;
  const list = take(f, "stages", "phases", "steps", "cycle");
  if (!list) return null;
  const current = take(f, "current", "now", "active", "stage", "phase");
  const progress = take(f, "progress");
  const remaining = take(f, "remaining", "left", "eta");
  const parts = list.split(/\s*(?:,|\||->|→)\s*/).filter(Boolean);
  if (parts.length < 2 || parts.length > 12) return null;
  let out: Stage[] = [];
  let marked = false;
  for (const p of parts) {
    const m = p.match(STAGE_RE)!;
    const label = m[1].trim();
    if (!label) return null;
    const mark = m[3];
    const pct = m[2] ? clamp(Number(m[2]) / 100) : null;
    let state: Stage["state"] = "todo";
    if (mark && /[✓✔]/.test(mark)) state = "done";
    else if (mark || pct !== null) state = "active";
    if (state !== "todo") marked = true;
    out.push({ label, state, frac: state === "active" ? pct : null });
  }
  if (!marked && current) {
    const idx = out.findIndex((s) => s.label.toLowerCase() === current.toLowerCase());
    if (idx < 0) return null;
    out = out.map((s, i) => ({ ...s, state: i < idx ? "done" : i === idx ? "active" : "todo" }));
    marked = true;
  }
  const active = out.find((s) => s.state === "active");
  if (active && progress) active.frac = parseFraction(progress);
  const allDone = out.every((s) => s.state === "done");
  const tone = toneOf(f.status);
  if (!f.status && active) f.status = active.label;
  return { kind: "stages", ...base(f, allDone && tone === "live" ? "ok" : tone), stages: out, remaining };
}

/** The activity a fence describes, or null when the language is no activity or the body is not one. */
export function parseActivity(language: string, src: string): Activity | null {
  const kind = ACTIVITY_LANGS[language];
  if (!kind) return null;
  const f = readFields(src);
  if (!f) return null;
  switch (kind) {
    case "timer":
      return timer(f);
    case "queue":
      return queue(f);
    case "journey":
      return journey(f);
    case "transfer":
      return transfer(f);
    case "versus":
      return versus(f);
    case "ring":
      return ring(f);
    case "stages":
      return stages(f);
  }
}

/** The `title:` line of an activity fence: its live-slot name (lib/viz-identity.ts). */
export function activityTitle(language: string, body: string): string | undefined {
  if (!ACTIVITY_LANGS[language]) return undefined;
  return body.match(/^\s*(?:[-*•]\s*)?(?:title|name|label)\s*:\s*(.+?)\s*$/im)?.[1];
}
