/**
 * Live blocks: a visual fence the agent re-emits later in the same run, with the SAME identity,
 * is one block that updates in place — not a stack of snapshots (docs/output-visualizers.md,
 * "Live updates"). Pure logic here; the React side is components/viz/live-blocks.tsx.
 *
 * Identity = fence language + a name the agent gave it:
 *  · an explicit info-string id:   ```stats id=traffic   (or title="Backend traffic")
 *  · a chart's JSON "title"
 *  · a heading / bold-only line directly above the fence ("### Backend traffic", "**Calls**")
 * An untitled block never merges: two anonymous stats blocks are two different things.
 *
 * Placement: the LATEST complete version renders at the FIRST occurrence (the live slot); every
 * later occurrence collapses to a one-line "updated" row. The slot never moves, so the mounted
 * component receives new props (numbers roll) instead of remounting somewhere else, and a new
 * version adds one short row at the bottom instead of a whole block — which keeps the scroll-hold
 * behaviour (stop at the start of a new reply) honest.
 */

/** A complete fence line: three-or-more backticks/tildes plus an optional info string. */
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const ATTR = (name: string) => new RegExp(`(?:^|\\s)${name}=(?:"([^"]+)"|'([^']+)'|(\\S+))`);

export interface Fence {
  /** Ordinal among the top-level fences of the text. */
  index: number;
  /** Language, without any `__open` / `__live` tag. */
  lang: string;
  /** Info string after the language (`id=traffic`). */
  meta: string;
  body: string;
  /** A real closing marker (a stabilizer's virtual close of an `__open` fence does not count). */
  closed: boolean;
  open: boolean;
  /** Line span [start, end] inclusive (end = closing line, or last line when unclosed). */
  start: number;
  end: number;
  /** Heading / bold line just above the fence, if any. */
  heading?: string;
}

/** Top-level fences of a markdown text, CommonMark-style (only a same-marker, ≥ length fence closes). */
export function scanFences(md: string): Fence[] {
  const lines = md.split("\n");
  const out: Fence[] = [];
  let cur: { marker: string; len: number; start: number; info: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FENCE_RE);
    if (!m) continue;
    if (!cur) {
      cur = { marker: m[1][0], len: m[1].length, start: i, info: m[2].trim() };
    } else if (m[1][0] === cur.marker && m[1].length >= cur.len && !m[2].trim()) {
      out.push(makeFence(out.length, lines, cur, i, true));
      cur = null;
    }
  }
  if (cur) out.push(makeFence(out.length, lines, cur, lines.length - 1, false));
  return out;
}

function makeFence(index: number, lines: string[], f: { start: number; info: string }, end: number, closed: boolean): Fence {
  const [first = "", ...rest] = f.info.split(/\s+/);
  let lang = first;
  let open = false;
  if (lang.endsWith("__open")) (open = true), (lang = lang.slice(0, -6));
  lang = lang.replace(/__live\d+$/, "");
  const body = lines.slice(f.start + 1, closed ? end : end + 1).join("\n");
  return { index, lang, meta: rest.join(" "), body, closed: closed && !open, open: open || !closed, start: f.start, end, heading: headingAbove(lines, f.start) };
}

function headingAbove(lines: string[], at: number): string | undefined {
  let i = at - 1;
  if (i >= 0 && !lines[i].trim()) i--;
  if (i < 0) return undefined;
  const l = lines[i].trim();
  const h = l.match(/^#{1,6}\s+(.+?)\s*#*$/) ?? l.match(/^(?:\*\*|__)(.+?)(?:\*\*|__):?$/);
  return h ? h[1].trim() : undefined;
}

/** `Backend traffic (10:02)` and `backend traffic:` name the same block. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_`]/g, "")
    .replace(/\s*[([][^)\]]*\d[^)\]]*[)\]]\s*/g, " ")
    .replace(/[:.\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(meta: string, name: string): string | undefined {
  const m = meta.match(ATTR(name));
  return m ? m[1] ?? m[2] ?? m[3] : undefined;
}

/** The name the agent gave a fence (meta id / title, chart title, heading above), if any. */
export function fenceName(f: Pick<Fence, "lang" | "meta" | "body" | "heading">): { key: string; title: string } | null {
  const id = attr(f.meta, "id");
  const metaTitle = attr(f.meta, "title");
  if (id) return { key: "id:" + id.toLowerCase(), title: metaTitle ?? id };
  const chartTitle = f.lang === "chart" ? f.body.match(/"title"\s*:\s*"((?:[^"\\]|\\.)+)"/)?.[1] : undefined;
  const name = metaTitle ?? chartTitle ?? f.heading;
  if (!name) return null;
  const key = normalizeName(name);
  return key ? { key: "t:" + key, title: name } : null;
}

/** `stats|t:backend traffic` — null for an untitled fence (never merges). */
export function fenceIdentity(f: Pick<Fence, "lang" | "meta" | "body" | "heading">): string | null {
  if (!f.lang) return null;
  const n = fenceName(f);
  return n ? `${f.lang}|${n.key}` : null;
}

export interface SayInput {
  /** Stable key of the say item (Thread uses its group index). */
  key: string;
  text: string;
  at?: number;
  /** True for an operator message — it ends the run, so nothing merges across it. */
  boundary?: boolean;
}

export interface LiveVersion {
  say: string;
  fence: number;
  at?: number;
  body: string;
  closed: boolean;
}

export interface LiveSlot {
  /** Slot number, unique in the registry. */
  n: number;
  id: string;
  lang: string;
  title: string;
  /** Which run (operator-message-delimited segment) the slot lives in. */
  run: number;
  /** Every occurrence in order; [0] is the slot's own position. */
  versions: LiveVersion[];
  /** Index into versions of the latest COMPLETE version (what the slot shows). */
  latest: number;
}

export type SlotRole = { kind: "live"; slot: number } | { kind: "copy"; slot: number; version: number };

export interface LiveRegistry {
  slots: LiveSlot[];
  /** `${sayKey}:${fenceIndex}` → role. */
  roles: Map<string, SlotRole>;
  /** Index of the newest run — only its slots can still be live. */
  lastRun: number;
}

export const EMPTY_REGISTRY: LiveRegistry = { slots: [], roles: new Map(), lastRun: 0 };

/** Group every identified fence of a thread into live slots, run by run. */
export function buildLiveRegistry(says: SayInput[]): LiveRegistry {
  const slots: LiveSlot[] = [];
  const roles = new Map<string, SlotRole>();
  let run = new Map<string, LiveSlot>();
  let runNo = 0;
  for (const s of says) {
    if (s.boundary) {
      run = new Map();
      runNo++;
      continue;
    }
    for (const f of scanFences(s.text)) {
      const id = fenceIdentity(f);
      if (!id) continue;
      const v: LiveVersion = { say: s.key, fence: f.index, at: s.at, body: f.body, closed: f.closed };
      const slot = run.get(id);
      if (!slot) {
        const n = slots.length;
        const fresh: LiveSlot = { n, id, lang: f.lang, title: fenceName(f)!.title, run: runNo, versions: [v], latest: 0 };
        slots.push(fresh);
        run.set(id, fresh);
        roles.set(`${s.key}:${f.index}`, { kind: "live", slot: n });
      } else {
        slot.versions.push(v);
        // A version still being written never replaces a complete one: no half-typed number is drawn.
        if (v.closed) slot.latest = slot.versions.length - 1;
        roles.set(`${s.key}:${f.index}`, { kind: "copy", slot: slot.n, version: slot.versions.length - 1 });
      }
    }
  }
  return { slots, roles, lastRun: runNo };
}

/** Complete versions of a slot (the count the "Updated N×" row reports). */
export const completeVersions = (s: LiveSlot) => s.versions.filter((v, i) => v.closed || i === 0).length;

/** Language tag of a live slot's fence: `stats__live3`. */
export const liveTag = (lang: string, n: number) => `${lang}__live${n}`;
/** Fence language of a collapsed copy; its body is `<slot> <version>`. */
export const COPY_LANG = "vizwas";

/** `stats__live3` → { language: "stats", slot: 3 }. */
export function splitLiveTag(language: string): { language: string; slot: number | null } {
  const m = language.match(/^(\w*?)__live(\d+)$/);
  return m ? { language: m[1] || "plaintext", slot: Number(m[2]) } : { language, slot: null };
}

/**
 * Rewrite one say's (possibly stabilised, mid-reveal) markdown for its live slots: a slot's fence
 * carries the slot's latest complete body and a `__live<n>` tag; a later copy becomes a `vizwas`
 * fence the renderer draws as a quiet row. Fence ordinals of a revealed prefix match the full
 * text's, so roles computed from the full text apply to the slice.
 */
export function rewriteLiveBlocks(md: string, sayKey: string, reg: LiveRegistry): string {
  if (!reg.slots.length) return md;
  const fences = scanFences(md);
  if (!fences.some((f) => reg.roles.has(`${sayKey}:${f.index}`))) return md;
  const lines = md.split("\n");
  // Bottom-up so earlier line numbers stay valid.
  for (const f of [...fences].reverse()) {
    const role = reg.roles.get(`${sayKey}:${f.index}`);
    if (!role) continue;
    const slot = reg.slots[role.slot];
    if (!slot) continue;
    const fenceLine = lines[f.start];
    const marker = fenceLine.match(FENCE_RE)![1];
    const indent = fenceLine.match(/^\s*/)![0];
    const closeLine = f.end > f.start && FENCE_RE.test(lines[f.end]) ? f.end : null;
    if (role.kind === "live") {
      // The slot shows its own (possibly still-streaming) body until a complete later version exists.
      const useLatest = slot.latest > 0;
      // Keep the stabiliser's verdict: only a fence it tagged `__open` is still arriving.
      const wasOpen = /^\S*__open(?:\s|$)/.test(fenceLine.replace(FENCE_RE, "$2").trim());
      const tag = liveTag(f.lang, slot.n) + (wasOpen && !useLatest ? "__open" : "");
      const head = `${indent}${marker}${tag}${f.meta ? " " + f.meta : ""}`;
      const body = useLatest ? slot.versions[slot.latest].body.split("\n") : lines.slice(f.start + 1, closeLine ?? f.end + 1);
      const close = closeLine !== null ? [lines[closeLine]] : useLatest ? [indent + marker] : [];
      lines.splice(f.start, f.end - f.start + 1, head, ...body, ...close);
    } else {
      // The heading that named the block goes with it — the row already carries the title.
      let from = f.start;
      if (f.heading && normalizeName(f.heading) === normalizeName(slot.title)) {
        from = f.start - 1;
        if (from > 0 && !lines[from].trim()) from--;
      }
      lines.splice(from, f.end - from + 1, `${indent}${marker}${COPY_LANG}`, `${slot.n} ${role.version}`, `${indent}${marker}`);
    }
  }
  return lines.join("\n");
}
