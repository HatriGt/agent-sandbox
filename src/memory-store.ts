/**
 * Memory across runs — typed, scoped, self-managed notes an agent learned on earlier runs for this
 * operator and repo (docs/memory.md).
 *
 * A box is thrown away with its run; without this every run starts from zero and relearns the
 * same conventions, decisions and environment quirks. The store is one encrypted user_blobs row
 * per owner (kind "memory", same as skills/MCP): operator-scope notes (`global`) plus notes per
 * GitHub repo slug (`repos`). Writes are deterministic — no extra LLM call: the system prompt asks
 * the agent to write `<!-- remember: <kind> | <text> [| why: …] [| replaces: "…"] -->` the moment
 * something durable happens; the controller harvests the log incrementally while the run is live
 * (src/memory-harvest.ts, driven from the fleet tick in src/http.ts) and once more at the finish
 * edge (answered questions are left to the agent to record as decisions). Reads: msb.ts installMemory drops a relevance-
 * filtered MEMORY.md (Core + For this task) and a full MEMORY-all.md archive into ~/.claude and
 * ~/.omp before every turn; the in-box `memory` tool searches them and appends new notes.
 *
 * Kinds and their write policy:
 *   preference / rule  → operator scope, kept at once (soft "Remembered" toast with Undo)
 *   fact / decision    → repo scope (operator when the box has no or several repos), kept silently
 *   lesson / playbook  → repo scope, PROPOSED: pending until the operator keeps/edits/forgets it
 *                        or the harvest tick auto-keeps it after PENDING_AUTO_KEEP_MS
 * Nothing is ever deleted by a newer note: `replaces:` marks the old one `until` (superseded), it
 * leaves MEMORY.md and the caps but stays in the store as history ("Earlier" on the page).
 *
 * Pure parsing/shaping here; IO at the bottom, mirroring skill-store. V1 stores (untyped notes)
 * load transparently: every note becomes a kept `fact` in the scope of the list it sat in.
 */
import { hasUserStoreBackend, loadBlob, saveBlob, ownerKey } from "./user-store.js";
import { MEMORY_KINDS, REMEMBER_FIELD_RE, REMEMBER_KIND_RE, REMEMBER_RE, type MemoryKind } from "./drivers/sentinels.js";
import { keyStems, scoreSkill } from "./skill-match.js";

export { MEMORY_KINDS, type MemoryKind };
export type MemoryScope = "operator" | "repo";
export type MemoryStatus = "pending" | "kept";

export interface MemoryNote {
  id: string;
  kind: MemoryKind;
  scope: MemoryScope;
  /** pending = proposed, awaiting the toast / auto-keep; kept = confirmed (by the operator or time). */
  status: MemoryStatus;
  text: string;
  /** Rationale for a decision/lesson: "tried X, failed because Y". */
  why?: string;
  /** Epoch ms when the note was written. */
  at: number;
  /** The run (box id) that produced it; "operator" for notes typed/imported on the dashboard. */
  source: string;
  /** GitHub slug (owner/name, lowercase) when the note belongs to one repo; absent = operator scope. */
  repo?: string;
  /** Pinned notes are never evicted by the caps and always ride in MEMORY.md's Core section. */
  pinned?: boolean;
  /** The older note this one replaced (that note carries `until`). */
  supersedes?: string;
  /** Set when a newer note superseded this one: it leaves MEMORY.md and the caps, stays as history. */
  until?: number;
  /** Playbooks: how often a task matched it (promote-to-skill signal) and when last. */
  uses?: number;
  lastUsed?: number;
  /**
   * Knowledge-base fields (repo-scoped kinds). `area` is the page a note belongs to — a slug like
   * `billing/invoicing` (see areaKey); `paths` anchor it to the code that implements it; `links`
   * name related areas. A note whose anchored code changed in a later run carries `stale` until the
   * agent reaffirms/replaces it or the operator marks it verified.
   */
  area?: string;
  paths?: string[];
  links?: string[];
  stale?: { at: number; box: string; paths: string[] };
}

export interface MemoryStore {
  /** Off switch for the whole feature (dashboard setting): nothing is written or installed. */
  enabled: boolean;
  /** Operator-scope notes (preferences, rules, and anything from a box without exactly one repo). */
  global: MemoryNote[];
  /** Repo-scope notes by slug. */
  repos: Record<string, MemoryNote[]>;
  /** Keys of notes the operator forgot: a re-harvest of an old run's log must not bring them back. */
  forgotten?: string[];
}

/** A note as parsed from the sentinel grammar, before it has an id/scope/status. */
export interface ParsedNote {
  kind: MemoryKind;
  text: string;
  why?: string;
  /** The old note's text (quotes stripped) this one replaces. */
  replaces?: string;
  area?: string;
  paths?: string[];
  links?: string[];
}

export const MEMORY_LIMITS = {
  /** Active (non-superseded) notes per kind within one list (operator or one repo). */
  perKind: { preference: 40, rule: 40, domain: 80, fact: 30, decision: 30, lesson: 30, playbook: 15 } as Record<MemoryKind, number>,
  /** Superseded notes kept as history per list; the oldest go first. */
  maxSuperseded: 60,
  /** Characters per note — a "durable fact", not a report. */
  maxNoteChars: 400,
  /** A domain note is a rule or a flow — a little longer than a fact, still not an essay. */
  maxDomainChars: 600,
  /** A playbook is a title line plus steps. */
  maxPlaybookChars: 1200,
  maxWhyChars: 300,
  /** Notes taken from one parse of a log. */
  maxPerRun: 20,
  /** "For this task" slice of MEMORY.md. */
  relevantMax: 25,
  /** scoreSkill points a note needs to count as relevant to the task (else the newest win). */
  relevanceThreshold: 2,
  /** Knowledge base: areas shown in full for a task, notes per shown area, index rows. */
  relevantAreas: 3,
  areaPageMax: 25,
  indexMax: 40,
  /** Anchors and links per note. */
  maxPaths: 6,
  maxLinks: 6,
  maxPathChars: 120,
  /** Stem overlap (0..1) at which a new same-kind note in the same area revises an existing one. */
  revisionOverlap: 0.6,
} as const;

/** A pending (proposed) note nobody acted on is kept after this long — the toast is a veto, not a gate. */
export const PENDING_AUTO_KEEP_MS = 10 * 60_000;
/** How long a box's freshly produced notes ride in its WatchSnapshot (`memoryNew`) for the thread's toasts. */
export const MEMORY_NEW_WINDOW_MS = 15 * 60_000;

/** The kinds the operator must confirm (toast); everything else is kept on arrival. */
export const PROPOSED_KINDS: ReadonlySet<MemoryKind> = new Set<MemoryKind>(["lesson", "playbook"]);
/** The kinds that always describe the operator, whatever repo the run touched. */
export const OPERATOR_KINDS: ReadonlySet<MemoryKind> = new Set<MemoryKind>(["preference", "rule"]);

export function isMemoryKind(k: unknown): k is MemoryKind {
  return typeof k === "string" && (MEMORY_KINDS as readonly string[]).includes(k);
}

export function emptyMemoryStore(): MemoryStore {
  return { enabled: true, global: [], repos: {} };
}

/**
 * Parse a stored blob. Tolerates garbage and MIGRATES v1 notes (no kind/scope/status): they become
 * kept facts in the scope of the list they sat in, keeping id/at/source/pinned, so a v2 controller
 * reading a v1 row changes nothing the operator would notice until the first typed note arrives.
 */
export function parseMemoryStore(raw: string): MemoryStore {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      const notes = (v: unknown, scope: MemoryScope): MemoryNote[] =>
        Array.isArray(v) ? v.filter((n) => n && typeof n.text === "string" && typeof n.id === "string").map((n) => migrateNote(n, scope)) : [];
      const repos: Record<string, MemoryNote[]> = {};
      if (obj.repos && typeof obj.repos === "object") for (const [k, v] of Object.entries(obj.repos)) repos[k] = notes(v, "repo");
      const forgotten = Array.isArray(obj.forgotten) ? obj.forgotten.filter((k: unknown): k is string => typeof k === "string") : [];
      return { enabled: obj.enabled !== false, global: notes(obj.global, "operator"), repos, ...(forgotten.length ? { forgotten } : {}) };
    }
  } catch {
    /* fall through */
  }
  return emptyMemoryStore();
}

function migrateNote(n: Record<string, unknown>, scope: MemoryScope): MemoryNote {
  const out: MemoryNote = {
    id: String(n.id),
    kind: isMemoryKind(n.kind) ? n.kind : "fact",
    scope: n.scope === "operator" || n.scope === "repo" ? n.scope : scope,
    status: n.status === "pending" ? "pending" : "kept",
    text: tidyNoteText(String(n.text), isMemoryKind(n.kind) ? n.kind : "fact"),
    at: typeof n.at === "number" ? n.at : 0,
    source: typeof n.source === "string" ? n.source : "",
  };
  if (typeof n.why === "string" && n.why) out.why = n.why;
  const asked = ASKED_RE.exec(String(n.text).trim());
  if (asked) {
    out.text = tidyNoteText(`Decided: ${asked[2].trim()}`, out.kind);
    out.why ??= tidyNoteText(`Asked: ${asked[1].trim()}`, "fact");
  }
  if (typeof n.repo === "string" && n.repo) out.repo = n.repo;
  if (n.pinned) out.pinned = true;
  if (typeof n.supersedes === "string") out.supersedes = n.supersedes;
  if (typeof n.until === "number") out.until = n.until;
  if (typeof n.uses === "number") out.uses = n.uses;
  if (typeof n.lastUsed === "number") out.lastUsed = n.lastUsed;
  if (typeof n.area === "string" && areaKey(n.area)) out.area = areaKey(n.area);
  const paths = pathList(n.paths);
  if (paths.length) out.paths = paths;
  const links = linkList(n.links);
  if (links.length) out.links = links;
  const st = n.stale as Record<string, unknown> | undefined;
  if (st && typeof st === "object" && typeof st.at === "number") out.stale = { at: st.at, box: typeof st.box === "string" ? st.box : "", paths: pathList(st.paths) };
  return out;
}

/* ─────────────────────────── knowledge base: areas, paths, links ─────────────────────────── */

/**
 * An area slug: lowercase `[a-z0-9-]` segments joined by `/`, at most two levels
 * (`billing/invoicing`, `auth`). Anything else is tidied into that shape; empty when nothing is left.
 */
export function areaKey(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .toLowerCase()
    .replace(/[\\]+/g, "/")
    .split("/")
    .map((seg) => seg.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .slice(0, 2)
    .join("/")
    .slice(0, 60);
}

/** Comma/whitespace-separated anchors (or an array) → clean repo-relative paths, capped. */
export function pathList(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  const out: string[] = [];
  for (const p of parts) {
    const c = p.trim().replace(/^\.?\//, "").replace(/^["'`]+|["'`]+$/g, "").slice(0, MEMORY_LIMITS.maxPathChars);
    if (c && !out.includes(c)) out.push(c);
    if (out.length >= MEMORY_LIMITS.maxPaths) break;
  }
  return out;
}

/** Comma-separated related areas (or an array) → slugs, capped. */
export function linkList(raw: unknown, self?: string): string[] {
  const parts = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/\s*,\s*/) : [];
  const out: string[] = [];
  for (const p of parts) {
    const k = areaKey(p);
    if (k && k !== self && !out.includes(k)) out.push(k);
    if (out.length >= MEMORY_LIMITS.maxLinks) break;
  }
  return out;
}

/**
 * Does a changed file fall under an anchor? Anchors are repo-relative files, directories (a prefix)
 * or globs (`*` within a segment, `**` across segments).
 */
export function pathMatches(anchor: string, file: string): boolean {
  const a = anchor.replace(/\/+$/, "");
  const f = file.replace(/^\.?\//, "");
  if (!a.includes("*")) return f === a || f.startsWith(a + "/");
  const re = new RegExp("^" + a.split("**").map((part) => part.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*") + "$");
  return re.test(f);
}

export function serializeMemoryStore(store: MemoryStore): string {
  return JSON.stringify(store, null, 2);
}

/** Case/whitespace/punctuation-insensitive key, so "Use pnpm." and "use pnpm" are one fact. */
export function normalizeNoteText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_"'.,;:!?()[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The dedupe key of a note: kind plus normalised text (the same sentence as a lesson and a fact are two notes). */
export function noteKey(n: { kind: MemoryKind; text: string }): string {
  return `${n.kind}|${normalizeNoteText(n.text)}`;
}

/** A note is active when nothing superseded it. Only active notes count for caps, MEMORY.md and dedupe. */
export const isActive = (n: MemoryNote): boolean => n.until === undefined;

const clipText = (kind: MemoryKind, text: string): string => text.slice(0, maxCharsFor(kind));
/**
 * A note as the operator should read it: one clean statement, not a log line. Whitespace collapsed,
 * filler lead-ins ("Remember that", "Note:") dropped, first letter capitalised (unless it opens with
 * code or a path), a full stop added. A playbook tidies its title line and keeps its steps as written.
 */
export function tidyNoteText(text: string, kind: MemoryKind): string {
  const [head, ...steps] = kind === "playbook" ? text.replace(/\r\n/g, "\n").split("\n") : [text];
  let t = head
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:(?:please\s+)?remember(?:\s+that)?|note(?:\s+that)?|fyi|important)\s*[:,-]?\s+/i, "")
    .replace(/^[-*•]\s+/, "");
  if (/^[a-z]/.test(t) && !/^[a-z0-9_.-]+[/(]/.test(t)) t = t[0].toUpperCase() + t.slice(1);
  if (kind === "playbook") t = t.replace(/[.:]+$/, "");
  else if (/[\p{L}\p{N})`'"\]]$/u.test(t)) t += ".";
  return [t, ...steps.map((l) => l.trim()).filter(Boolean)].join("\n");
}

/** v1 answered-question notes ("asked Q → operator chose A") read as the decision, with the question as why. */
const ASKED_RE = /^asked\s+([\s\S]+?)\s*→\s*operator chose\s+([\s\S]+)$/i;

const stripQuotes = (s: string): string => s.replace(/^["“'‘]+/, "").replace(/["”'’]+$/, "").trim();

/**
 * One note line into its fields. The leading `<kind> |` is optional (untagged = fact, the v1
 * grammar); `| why:` and `| replaces:` are split off wherever they appear after the text, so a
 * text that itself contains `|` survives. Returns null for an empty text.
 */
export function parseNoteLine(line: string): ParsedNote | null {
  let rest = line.trim();
  let kind: MemoryKind = "fact";
  const km = REMEMBER_KIND_RE.exec(rest);
  if (km) {
    kind = km[1].toLowerCase() as MemoryKind;
    rest = rest.slice(km[0].length);
  }
  const parts = rest.split(REMEMBER_FIELD_RE);
  const text = parts[0].trim();
  if (!text) return null;
  const note: ParsedNote = { kind, text: clipText(kind, tidyNoteText(text, kind)) };
  for (const p of parts.slice(1)) {
    const m = /^(why|replaces|area|paths|links)\s*:\s*([\s\S]*)$/i.exec(p.trim());
    if (!m) continue;
    const v = m[2].trim();
    if (!v) continue;
    const field = m[1].toLowerCase();
    if (field === "why") note.why = tidyNoteText(v, "fact").slice(0, MEMORY_LIMITS.maxWhyChars);
    else if (field === "replaces") note.replaces = stripQuotes(v).slice(0, MEMORY_LIMITS.maxNoteChars);
    else if (field === "area") {
      const a = areaKey(stripQuotes(v));
      if (a) note.area = a;
    } else if (field === "paths") {
      const ps = pathList(stripQuotes(v));
      if (ps.length) note.paths = ps;
    } else {
      const ls = linkList(stripQuotes(v));
      if (ls.length) note.links = ls;
    }
  }
  if (note.links && note.area) note.links = note.links.filter((l) => l !== note.area);
  // Preferences and rules describe the operator, not a part of the app.
  if (OPERATOR_KINDS.has(kind)) {
    delete note.area;
    delete note.paths;
    delete note.links;
  }
  return note;
}

/** Max characters of a note's text by kind. */
export function maxCharsFor(kind: MemoryKind): number {
  return kind === "playbook" ? MEMORY_LIMITS.maxPlaybookChars : kind === "domain" ? MEMORY_LIMITS.maxDomainChars : MEMORY_LIMITS.maxNoteChars;
}

/**
 * Drop the operator's own turns before parsing: a pasted message containing the marker is quoted
 * data, not a note the agent chose to keep. The follow-up echo defangs ⟦ (U+200B before it), so
 * both the clean and the defanged bubble delimiters are matched.
 */
const YOU_BLOCK_RE = /​?⟦you⟧[\s\S]*?​?⟦\/you⟧/g;

/**
 * Every note the log asks us to remember, in order. One per line inside each block; a playbook's
 * indented follow-on lines are its steps and join it with newlines. Leading list markers are
 * dropped, empties ignored, duplicates (same kind + normalised text) collapsed, over-long texts
 * clipped rather than dropped — a fact that ran on is still a fact.
 */
export function parseRememberNotes(log: string): ParsedNote[] {
  const out: ParsedNote[] = [];
  const seen = new Set<string>();
  const push = (raw: string[]): boolean => {
    const note = parseNoteLine(raw.join("\n"));
    if (!note) return false;
    const key = noteKey(note);
    if (seen.has(key)) return false;
    seen.add(key);
    out.push(note);
    return out.length >= MEMORY_LIMITS.maxPerRun;
  };
  for (const m of log.replace(YOU_BLOCK_RE, "").matchAll(REMEMBER_RE)) {
    let current: string[] | null = null;
    for (const raw of m[1].split(/\r?\n/)) {
      if (!raw.trim()) continue;
      // Indented continuation under a playbook: a step, not a new note.
      const indented = /^\s{2,}/.test(raw) && !REMEMBER_KIND_RE.test(raw.trim());
      if (indented && current && REMEMBER_KIND_RE.exec(current[0])?.[1].toLowerCase() === "playbook") {
        current.push(raw.replace(/^\s+/, "").replace(/^(?:[-*•]|\d+[.)])\s*/, "- "));
        continue;
      }
      if (current && push(current)) return out;
      current = [raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()];
    }
    if (current && push(current)) return out;
  }
  return out;
}

/** The v1 view — note texts only — kept for callers that only want the sentences. */
export function parseRemember(log: string): string[] {
  return parseRememberNotes(log).map((n) => n.text);
}

/** An answered question as a decision: what was asked, what the operator chose. */
export function questionNoteText(q: { question: string; answer?: string }): string | null {
  const question = q.question.replace(/\s+/g, " ").trim();
  const answer = (q.answer ?? "").replace(/\s+/g, " ").trim();
  if (!question || !answer) return null;
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return `asked ${clip(question, 160)} → operator chose ${clip(answer, 160)}`;
}

let seq = 0;
export function newNoteId(now = Date.now()): string {
  seq = (seq + 1) % 1000;
  return `${now.toString(36)}${seq.toString(36).padStart(2, "0")}`;
}

/** Repo keys are the setup-store slug: owner/name, lowercase. */
export function memoryRepoKey(slug: string): string {
  return slug.trim().toLowerCase();
}

/** Where a note of this kind files: preferences/rules describe the operator; the rest the repo when there is exactly one. */
export function scopeFor(kind: MemoryKind, repos: string[]): { scope: MemoryScope; repo?: string } {
  if (!OPERATOR_KINDS.has(kind) && repos.length === 1) return { scope: "repo", repo: memoryRepoKey(repos[0]) };
  return { scope: "operator" };
}

/** The list a scope resolves to, created on demand for a repo. */
function listFor(store: MemoryStore, s: { scope: MemoryScope; repo?: string }): MemoryNote[] {
  if (s.scope === "repo" && s.repo) return (store.repos[s.repo] ??= []);
  return store.global;
}

/**
 * Resolve a `replaces:` quote against a list: the active note whose normalised text equals it, or
 * (for a quote of some length) the one whose text contains it — the agent quotes from MEMORY.md,
 * which may show a clipped line.
 */
export function findReplaced(list: MemoryNote[], replaces: string, area?: string): MemoryNote | undefined {
  const key = normalizeNoteText(replaces);
  if (!key) return undefined;
  const active = list.filter(isActive);
  const within = (pool: MemoryNote[]) => pool.find((n) => normalizeNoteText(n.text) === key) ?? (key.length >= 12 ? pool.find((n) => normalizeNoteText(n.text).includes(key)) : undefined);
  // The same area first: two areas may legitimately hold near-identical sentences.
  return (area ? within(active.filter((n) => n.area === area)) : undefined) ?? within(active);
}

/** Stems shared between two texts over the smaller stem set — 1 when one text's words are all in the other. */
export function textOverlap(a: string, b: string): number {
  const sa = new Set(keyStems(a));
  const sb = new Set(keyStems(b));
  const small = sa.size <= sb.size ? sa : sb;
  const big = small === sa ? sb : sa;
  if (small.size < 3) return 0;
  let hit = 0;
  for (const s of small) if (big.has(s)) hit++;
  return hit / small.size;
}

/**
 * The active note of the same kind in the same area that a new one most plausibly revises: the
 * best stem overlap at or above MEMORY_LIMITS.revisionOverlap. Undefined when the note is new
 * knowledge rather than a rewrite.
 */
export function findRevised(list: MemoryNote[], p: ParsedNote): MemoryNote | undefined {
  if (!p.area || OPERATOR_KINDS.has(p.kind)) return undefined;
  let best: { n: MemoryNote; s: number } | undefined;
  for (const n of list) {
    if (!isActive(n) || n.kind !== p.kind || n.area !== p.area) continue;
    const s = textOverlap(n.text, p.text);
    if (s >= MEMORY_LIMITS.revisionOverlap && (!best || s > best.s)) best = { n, s };
  }
  return best?.n;
}

/** Carry a note's anchors/links onto its successor (union, capped), so a rewrite keeps its coupling. */
function inheritKb(from: { area?: string; paths?: string[]; links?: string[] }, to: MemoryNote): void {
  if (!to.area && from.area) to.area = from.area;
  const paths = pathList([...(to.paths ?? []), ...(from.paths ?? [])]);
  if (paths.length) to.paths = paths;
  const links = linkList([...(to.links ?? []), ...(from.links ?? [])], to.area);
  if (links.length) to.links = links;
}

/**
 * Add parsed notes to a list, in order:
 *   · a note already active there (same kind + text) is REAFFIRMED — `at`/`source` refreshed, new
 *     anchors/links merged, the stale flag cleared — never duplicated;
 *   · `replaces:` resolves to the old note (same area first) and supersedes it;
 *   · without `replaces:`, a same-kind note in the same area that reads as a rewrite of an existing
 *     one (findRevised) supersedes it as a PENDING revision the operator may veto;
 *   · everything else is appended; then the per-kind caps apply.
 * Returns the notes ADDED (with their ids); a reaffirmation is silent.
 */
export function addParsedNotes(
  list: MemoryNote[],
  notes: ParsedNote[],
  meta: { source: string; scope: MemoryScope; repo?: string; now?: number; status?: (kind: MemoryKind) => MemoryStatus }
): MemoryNote[] {
  const now = meta.now ?? Date.now();
  const byKey = new Map(list.filter(isActive).map((n) => [noteKey(n), n] as const));
  const added: MemoryNote[] = [];
  for (const p of notes) {
    const key = noteKey(p);
    if (!normalizeNoteText(p.text)) continue;
    const same = byKey.get(key);
    if (same) {
      // Reaffirmed: the agent wrote it again (often quoting itself via replaces: to clear a stale flag).
      same.at = now;
      same.source = meta.source;
      if (p.why) same.why = p.why;
      if (p.area) same.area = p.area;
      inheritKb(p, same);
      delete same.stale;
      continue;
    }
    const note: MemoryNote = {
      id: newNoteId(now),
      kind: p.kind,
      scope: meta.scope,
      status: meta.status ? meta.status(p.kind) : PROPOSED_KINDS.has(p.kind) ? "pending" : "kept",
      text: p.text,
      at: now,
      source: meta.source,
    };
    if (p.why) note.why = p.why;
    if (meta.repo) note.repo = meta.repo;
    if (p.area) note.area = p.area;
    if (p.paths?.length) note.paths = p.paths;
    if (p.links?.length) note.links = p.links;
    const old = p.replaces ? findReplaced(list, p.replaces, p.area) : findRevised(list, p);
    if (old && old.id !== note.id) {
      old.until = now;
      note.supersedes = old.id;
      inheritKb(old, note);
      byKey.delete(noteKey(old));
      // An inferred rewrite is a proposal: the toast reads "Updated · area" and Forget restores the old note.
      if (!p.replaces && !meta.status) {
        note.status = "pending";
        note.why ??= `Revises: ${old.text.split("\n")[0]}`;
      }
    }
    byKey.set(key, note);
    list.push(note);
    added.push(note);
  }
  evict(list);
  return added;
}

/**
 * Drift: flag the active notes of a repo whose anchored paths cover a file this run changed —
 * unless the run itself wrote/reaffirmed the note. Returns the notes flagged by THIS call.
 */
export function markStaleByPaths(store: MemoryStore, repo: string, files: string[], meta: { box: string; now?: number }): MemoryNote[] {
  const list = store.repos[memoryRepoKey(repo)];
  if (!list || !files.length) return [];
  const now = meta.now ?? Date.now();
  const out: MemoryNote[] = [];
  for (const n of list) {
    if (!isActive(n) || !n.paths?.length || n.stale || n.source === meta.box) continue;
    const hit = files.filter((f) => n.paths!.some((a) => pathMatches(a, f)));
    if (!hit.length) continue;
    n.stale = { at: now, box: meta.box, paths: hit.slice(0, MEMORY_LIMITS.maxPaths) };
    out.push(n);
  }
  return out;
}

/**
 * v1 shape: plain sentences become kept facts. `cap` overrides the fact cap (tests exercise the
 * eviction with small numbers). Returns the number actually added.
 */
export function addNotes(list: MemoryNote[], facts: string[], meta: { source: string; repo?: string; now?: number }, cap?: number): number {
  const scope: MemoryScope = meta.repo ? "repo" : "operator";
  const n = addParsedNotes(list, facts.map((text) => ({ kind: "fact" as const, text })), { ...meta, scope, status: () => "kept" }).length;
  if (cap !== undefined) evict(list, { fact: cap });
  return n;
}

/**
 * Caps: per kind, the OLDEST UNPINNED active notes go first; superseded history is capped on its
 * own. Everything pinned means nothing of that kind is evicted — the operator asked for all of it.
 */
function evict(list: MemoryNote[], caps: Partial<Record<MemoryKind, number>> = MEMORY_LIMITS.perKind): void {
  for (const kind of MEMORY_KINDS) {
    const cap = caps[kind] ?? MEMORY_LIMITS.perKind[kind];
    for (;;) {
      const active = list.filter((n) => isActive(n) && n.kind === kind);
      if (active.length <= cap) break;
      const victim = active.find((n) => !n.pinned);
      if (!victim) break;
      list.splice(list.indexOf(victim), 1);
    }
  }
  const gone = list.filter((n) => !isActive(n));
  for (const n of gone.slice(0, Math.max(0, gone.length - MEMORY_LIMITS.maxSuperseded))) list.splice(list.indexOf(n), 1);
}

export interface RememberInput {
  box: string;
  log: string;
  questions?: Array<{ question: string; answer?: string }>;
  repos: string[];
  now?: number;
  /** Notes (by key) this box already produced — skipped, so an incremental harvest is idempotent. */
  seen?: Set<string>;
}

/**
 * Store what a run produced so far: parsed notes filed by their kind's scope, minus any the operator
 * forgot. Keys in `seen` are skipped and the new ones added to it. Returns the notes
 * actually stored (empty when memory is off).
 */
export function rememberRunNotes(store: MemoryStore, i: RememberInput): MemoryNote[] {
  if (!store.enabled) return [];
  // Answered questions are NOT saved on their own: most ("which of these PRs?") only matter to the
  // run that asked. A choice that should outlast it is the agent's to record as a decision.
  const parsed = parseRememberNotes(i.log);
  const forgotten = new Set(store.forgotten ?? []);
  const fresh = parsed.filter((p) => !i.seen?.has(noteKey(p)) && !forgotten.has(noteKey(p)));
  if (!fresh.length) return [];
  const added: MemoryNote[] = [];
  for (const scope of [
    { scope: "operator" as const },
    ...(i.repos.length === 1 ? [{ scope: "repo" as const, repo: memoryRepoKey(i.repos[0]) }] : []),
  ]) {
    const mine = fresh.filter((p) => scopeFor(p.kind, i.repos).scope === scope.scope);
    if (!mine.length) continue;
    added.push(...addParsedNotes(listFor(store, scope), mine, { source: i.box, now: i.now, ...scope }));
  }
  if (i.seen) for (const p of fresh) i.seen.add(noteKey(p));
  return added;
}

/** v1 entry point: the count stored. */
export function rememberRun(store: MemoryStore, i: RememberInput): number {
  return rememberRunNotes(store, i).length;
}

/** Auto-keep proposals nobody acted on within the window. Returns the notes flipped. */
export function autoKeepPending(store: MemoryStore, now = Date.now(), ageMs = PENDING_AUTO_KEEP_MS): MemoryNote[] {
  const out: MemoryNote[] = [];
  for (const n of allNotes(store)) {
    if (n.status === "pending" && now - n.at >= ageMs) {
      n.status = "kept";
      out.push(n);
    }
  }
  return out;
}

function allNotes(store: MemoryStore): MemoryNote[] {
  return [...store.global, ...Object.values(store.repos).flat()];
}

/** Every note (superseded ones included — they carry `until`), newest first, for the dashboard. */
export function viewMemory(store: MemoryStore): MemoryNote[] {
  return allNotes(store).sort((a, b) => b.at - a.at);
}

function findNote(store: MemoryStore, id: string): { list: MemoryNote[]; index: number } | null {
  const lists = [store.global, ...Object.values(store.repos)];
  for (const list of lists) {
    const index = list.findIndex((n) => n.id === id);
    if (index >= 0) return { list, index };
  }
  return null;
}

export function getNote(store: MemoryStore, id: string): MemoryNote | undefined {
  const hit = findNote(store, id);
  return hit ? hit.list[hit.index] : undefined;
}

/** Edit text / why / pin state, or confirm a proposal (`status: "kept"`). Throws a human message on bad input. */
export function updateNote(
  store: MemoryStore,
  id: string,
  patch: { text?: unknown; why?: unknown; pinned?: unknown; status?: unknown; area?: unknown; paths?: unknown; links?: unknown; verified?: unknown }
): MemoryNote {
  const hit = findNote(store, id);
  if (!hit) throw new Error("That note no longer exists.");
  const note = hit.list[hit.index];
  if (patch.text !== undefined) {
    const text = note.kind === "playbook" ? String(patch.text).replace(/\r\n/g, "\n").trim() : String(patch.text).replace(/\s+/g, " ").trim();
    if (!text) throw new Error("A note cannot be empty — delete it instead.");
    const max = maxCharsFor(note.kind);
    if (text.length > max) throw new Error(`A ${note.kind} is at most ${max} characters.`);
    note.text = text;
  }
  if (!OPERATOR_KINDS.has(note.kind)) {
    if (patch.area !== undefined) {
      const a = areaKey(patch.area);
      if (a) note.area = a;
      else delete note.area;
    }
    if (patch.paths !== undefined) {
      const ps = pathList(patch.paths);
      if (ps.length) note.paths = ps;
      else delete note.paths;
    }
    if (patch.links !== undefined) {
      const ls = linkList(patch.links, note.area);
      if (ls.length) note.links = ls;
      else delete note.links;
    }
  }
  // The operator read it and says it still holds (or just rewrote it): the drift flag is answered.
  if (patch.verified || patch.text !== undefined) delete note.stale;
  if (patch.why !== undefined) {
    const why = String(patch.why ?? "").replace(/\s+/g, " ").trim();
    if (why.length > MEMORY_LIMITS.maxWhyChars) throw new Error(`A rationale is at most ${MEMORY_LIMITS.maxWhyChars} characters.`);
    if (why) note.why = why;
    else delete note.why;
  }
  if (patch.pinned !== undefined) {
    if (patch.pinned) note.pinned = true;
    else delete note.pinned;
  }
  if (patch.status !== undefined) {
    if (patch.status !== "kept") throw new Error('A note can only be confirmed (status "kept") — forget it to drop it.');
    note.status = "kept";
  }
  return note;
}

export function deleteNote(store: MemoryStore, id: string): boolean {
  const hit = findNote(store, id);
  if (!hit) return false;
  const [gone] = hit.list.splice(hit.index, 1);
  store.forgotten = [...(store.forgotten ?? []).filter((k) => k !== noteKey(gone)), noteKey(gone)].slice(-500);
  // Vetoing a proposed rewrite must not lose the knowledge it rewrote: the old note comes back.
  if (gone.status === "pending" && gone.supersedes) {
    const old = hit.list.find((n) => n.id === gone.supersedes);
    if (old && old.until !== undefined && !hit.list.some((n) => n.supersedes === old.id && isActive(n))) delete old.until;
  }
  return true;
}

/**
 * A note the operator types or imports: validated, filed by the kind's scope (a repo is honoured
 * only for repo-scoped kinds), kept at once. Throws a human message on bad input.
 */
export function addManualNote(
  store: MemoryStore,
  input: { kind: unknown; text: unknown; why?: unknown; repo?: unknown; area?: unknown; paths?: unknown; links?: unknown },
  now = Date.now(),
  source = "operator"
): MemoryNote {
  if (!isMemoryKind(input.kind)) throw new Error(`kind must be one of ${MEMORY_KINDS.join(", ")}.`);
  const kind = input.kind;
  const text = tidyNoteText(kind === "playbook" ? String(input.text ?? "").replace(/\r\n/g, "\n").trim() : String(input.text ?? "").replace(/\s+/g, " ").trim(), kind);
  if (!text) throw new Error("A note needs some text.");
  const max = maxCharsFor(kind);
  if (text.length > max) throw new Error(`A ${kind} is at most ${max} characters.`);
  const why = tidyNoteText(String(input.why ?? ""), "fact");
  if (why.length > MEMORY_LIMITS.maxWhyChars) throw new Error(`A rationale is at most ${MEMORY_LIMITS.maxWhyChars} characters.`);
  const repo = typeof input.repo === "string" && input.repo.trim() ? memoryRepoKey(input.repo) : undefined;
  if (repo && !/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error("repo must be an owner/name slug.");
  const scope = scopeFor(kind, repo ? [repo] : []);
  const list = listFor(store, scope);
  // Typing a note back in is the operator un-forgetting it.
  if (store.forgotten) store.forgotten = store.forgotten.filter((k) => k !== noteKey({ kind, text }));
  const existing = list.find((n) => isActive(n) && noteKey(n) === noteKey({ kind, text }));
  if (existing) return existing;
  const kb = OPERATOR_KINDS.has(kind) ? {} : { area: areaKey(input.area) || undefined, paths: pathList(input.paths), links: linkList(input.links, areaKey(input.area) || undefined) };
  const parsed: ParsedNote = { kind, text, ...(why ? { why } : {}) };
  if (kb.area) parsed.area = kb.area;
  if (kb.paths?.length) parsed.paths = kb.paths;
  if (kb.links?.length) parsed.links = kb.links;
  const [note] = addParsedNotes(list, [parsed], { source, now, status: () => "kept", ...scope });
  if (!note) throw new Error("That note is already known.");
  return note;
}

/* ─────────────────────────── retrieval ─────────────────────────── */

/** The first line of a playbook is its title; the rest are steps. */
export function playbookTitle(text: string): string {
  return text.split(/\r?\n/)[0].replace(/^#+\s*/, "").trim();
}

export interface MemorySelection {
  /** Preferences, rules and pinned notes — always in the box. */
  core: MemoryNote[];
  /** Facts/decisions/lessons/playbooks for the box's repos, relevant to the task (else the newest). */
  relevant: MemoryNote[];
  /** Playbooks the task matched, for uses++ and the first-turn hint. */
  matchedPlaybooks: MemoryNote[];
  /** True when `relevant` was chosen by score rather than recency. */
  byRelevance: boolean;
  /** Knowledge base: every area of the box's repos (the index) and the ones shown in full for this task. */
  areas: AreaSummary[];
  areaPages: AreaSummary[];
}

/** One knowledge-base area (page) of a repo, with its active notes. */
export interface AreaSummary {
  repo: string;
  area: string;
  notes: MemoryNote[];
  kinds: Partial<Record<MemoryKind, number>>;
  paths: string[];
  links: string[];
  stale: number;
  /** Newest `at` among its notes. */
  updated: number;
}

/** Group a repo's active notes by area, biggest first. Notes without an area are not in the KB index. */
export function areaIndex(store: MemoryStore, repos: string[]): AreaSummary[] {
  const out: AreaSummary[] = [];
  const seen = new Set<string>();
  for (const r of repos) {
    const key = memoryRepoKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    const by = new Map<string, MemoryNote[]>();
    for (const n of store.repos[key] ?? []) if (isActive(n) && n.area) by.set(n.area, [...(by.get(n.area) ?? []), n]);
    for (const [area, notes] of by) {
      const paths = pathList(notes.flatMap((n) => n.paths ?? []));
      const links = linkList(notes.flatMap((n) => n.links ?? []), area);
      out.push({ repo: key, area, notes: notes.sort((a, b) => a.at - b.at), kinds: countKinds(notes), paths, links, stale: notes.filter((n) => n.stale).length, updated: Math.max(...notes.map((n) => n.at)) });
    }
  }
  return out.sort((a, b) => b.notes.length - a.notes.length || a.area.localeCompare(b.area));
}

/**
 * How much a task is about an area: its notes' scores (each capped, so one long note cannot carry a
 * page), the area's own name in the task, and any anchored path the task names.
 */
export function scoreArea(task: string, a: AreaSummary): number {
  const t = task.toLowerCase();
  let s = 0;
  for (const n of a.notes) s += Math.min(6, scoreNote(task, n));
  const stems = new Set(keyStems(task));
  for (const seg of a.area.split(/[/-]/)) if (seg.length >= 3 && stems.has(keyStems(seg)[0] ?? "")) s += 3;
  for (const p of a.paths) if (p.length >= 4 && t.includes(p.toLowerCase().replace(/\*+/g, "").replace(/\/$/, ""))) s += 4;
  return s;
}

/** The lists a box sees: operator notes plus the notes of the repos checked out in it. */
function visibleNotes(store: MemoryStore, repos: string[]): MemoryNote[] {
  const seen = new Set<string>();
  const out: MemoryNote[] = [...store.global];
  for (const r of repos) {
    const key = memoryRepoKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(...(store.repos[key] ?? []));
  }
  return out.filter(isActive);
}

/** Score a note against the task with the skill matcher: a playbook's title is its "name", the text its description. */
export function scoreNote(task: string, n: MemoryNote): number {
  const name = n.kind === "playbook" ? playbookTitle(n.text) : "";
  return scoreSkill(task, { name, description: `${n.text} ${n.why ?? ""}` });
}

/**
 * What goes into MEMORY.md for a box. Core is unconditional; "For this task" is the top
 * `relevantMax` notes scoring at or above the threshold against the task, or — when nothing or no
 * task is given — the newest `relevantMax`. Pinned notes sit in Core and are not repeated.
 */
export function selectMemory(store: MemoryStore, repos: string[], task?: string): MemorySelection {
  const visible = visibleNotes(store, repos);
  const core = visible.filter((n) => OPERATOR_KINDS.has(n.kind) || n.pinned).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.at - b.at);
  // Area notes are served as pages; "For this task" is for the notes nobody filed under an area.
  const rest = visible.filter((n) => !OPERATOR_KINDS.has(n.kind) && !n.pinned && !n.area);
  const areas = areaIndex(store, repos);
  let areaPages: AreaSummary[] = [];
  if (areas.length) {
    const scoredAreas = task?.trim() ? areas.map((a) => ({ a, s: scoreArea(task, a) })).filter((x) => x.s >= MEMORY_LIMITS.relevanceThreshold) : [];
    areaPages = scoredAreas.length
      ? scoredAreas.sort((x, y) => y.s - x.s || y.a.updated - x.a.updated).slice(0, MEMORY_LIMITS.relevantAreas).map((x) => x.a)
      : [...areas].sort((x, y) => y.updated - x.updated).slice(0, 1);
  }
  let relevant: MemoryNote[];
  let byRelevance = false;
  const scored = task?.trim() ? rest.map((n) => ({ n, s: scoreNote(task, n) })).filter((x) => x.s >= MEMORY_LIMITS.relevanceThreshold) : [];
  if (scored.length) {
    byRelevance = true;
    relevant = scored.sort((a, b) => b.s - a.s || b.n.at - a.n.at).slice(0, MEMORY_LIMITS.relevantMax).map((x) => x.n);
  } else {
    relevant = [...rest].sort((a, b) => b.at - a.at).slice(0, MEMORY_LIMITS.relevantMax);
  }
  // Chronological inside the section so the file reads as a history.
  relevant.sort((a, b) => a.at - b.at);
  const matchedPlaybooks = byRelevance ? [...relevant, ...areaPages.flatMap((a) => a.notes)].filter((n) => n.kind === "playbook") : [];
  return { core, relevant, matchedPlaybooks, byRelevance, areas, areaPages };
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The `{paths: …} {links: …}` and drift suffix of a knowledge-base note line. */
function kbSuffix(n: MemoryNote): string {
  let s = "";
  if (n.paths?.length) s += ` {paths: ${n.paths.join(", ")}}`;
  if (n.links?.length) s += ` {links: ${n.links.join(", ")}}`;
  if (n.stale) s += ` ⚠ unverified since ${isoDay(n.stale.at)} (changed: ${n.stale.paths.join(", ")}) — reaffirm it with replaces: "${n.text.split("\n")[0].slice(0, 80)}" or replace it`;
  return s;
}

/** `- [kind · area] text (repo) {paths} {links} | why: …`, a playbook's steps indented beneath its title. */
function noteLine(n: MemoryNote, showRepo: boolean): string {
  const kind = n.pinned && !OPERATOR_KINDS.has(n.kind) ? `pinned ${n.kind}` : n.kind;
  const tag = n.area ? `${kind} · ${n.area}` : kind;
  const repo = showRepo && n.repo ? ` (${n.repo})` : "";
  const why = n.why ? ` | why: ${n.why}` : "";
  if (n.kind === "playbook") {
    const [title, ...steps] = n.text.split(/\r?\n/);
    const body = steps.filter((s) => s.trim()).map((s) => `    ${s.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, "- ")}`);
    return [`- [${tag}] ${title.trim()}${repo}${kbSuffix(n)}${why}`, ...body].join("\n");
  }
  return `- [${tag}] ${n.text.replace(/\s*\n\s*/g, " ")}${repo}${kbSuffix(n)}${why}`;
}

/** One index row of the knowledge base: `- billing/invoicing · 6 notes (4 domain, 2 decision) · paths … · links … · 1 unverified`. */
function areaIndexLine(a: AreaSummary, showRepo: boolean): string {
  const kinds = MEMORY_KINDS.filter((k) => a.kinds[k]).map((k) => `${a.kinds[k]} ${k}`).join(", ");
  const parts = [`${a.area}${showRepo ? ` (${a.repo})` : ""}`, `${a.notes.length} note${a.notes.length === 1 ? "" : "s"} (${kinds})`];
  if (a.paths.length) parts.push(`paths ${a.paths.slice(0, 3).join(", ")}${a.paths.length > 3 ? ", …" : ""}`);
  if (a.links.length) parts.push(`links ${a.links.join(", ")}`);
  if (a.stale) parts.push(`${a.stale} unverified`);
  return `- ${parts.join(" · ")}`;
}

/** The order notes read in on an area page: what the product does first, then why, then the rest. */
const PAGE_ORDER: MemoryKind[] = ["domain", "decision", "lesson", "fact", "playbook", "preference", "rule"];

/** A knowledge-base page: the area's notes grouped by kind, domain first, capped. */
export function renderAreaPage(a: AreaSummary, showRepo: boolean, max = MEMORY_LIMITS.areaPageMax): string {
  const ordered = [...a.notes].sort((x, y) => PAGE_ORDER.indexOf(x.kind) - PAGE_ORDER.indexOf(y.kind) || x.at - y.at);
  const lines = ordered.slice(0, max).map((n) => noteLine(n, showRepo));
  if (ordered.length > max) lines.push(`- … ${ordered.length - max} more — \`memory area ${a.area}\``);
  const head = [`### ${a.area}${showRepo ? ` (${a.repo})` : ""}`];
  if (a.paths.length) head.push(`Code: ${a.paths.join(", ")}`);
  if (a.links.length) head.push(`Related: ${a.links.join(", ")}`);
  return `${head.join("\n")}\n\n${lines.join("\n")}`;
}

/**
 * The MEMORY.md a box receives: Core + For this task + how to add. Null when there is nothing to
 * say (the installer then removes a stale file).
 */
export function renderMemoryMd(store: MemoryStore, repos: string[], task?: string): string | null {
  if (!store.enabled) return null;
  const sel = selectMemory(store, repos, task);
  if (!sel.core.length && !sel.relevant.length && !sel.areas.length) return null;
  const showRepo = repos.length !== 1;
  const sections: string[] = [];
  if (sel.core.length) sections.push(`## Core\n\n${sel.core.map((n) => noteLine(n, showRepo)).join("\n")}`);
  if (sel.areas.length) {
    const idx = sel.areas.slice(0, MEMORY_LIMITS.indexMax).map((a) => areaIndexLine(a, showRepo));
    if (sel.areas.length > MEMORY_LIMITS.indexMax) idx.push(`- … ${sel.areas.length - MEMORY_LIMITS.indexMax} more areas — \`memory areas\``);
    const repoName = repos.length === 1 ? ` — ${memoryRepoKey(repos[0])}` : "";
    const pages = sel.areaPages.map((a) => renderAreaPage(a, showRepo)).join("\n\n");
    sections.push(
      `## Knowledge base${repoName}\n\n` +
        "How this product works, by area — what earlier runs learned about its entities, flows, rules and owners. " +
        "Read an area before working in it: `memory area <slug>` prints it with its related areas. " +
        "When you learn something that changes a note, write the same kind with `replaces:` quoting it; new knowledge gets `area:` (an existing area when one fits), `paths:` and `links:`. " +
        "A note marked unverified describes code that changed since — confirm it (reaffirm) or replace it when you work there.\n\n" +
        `${idx.join("\n")}` +
        (pages ? `\n\n${sel.areaPages.length === sel.areas.length ? "" : "Areas this task is about:\n\n"}${pages}` : "")
    );
  }
  if (sel.relevant.length) {
    const head = sel.byRelevance ? "## For this task" : "## Recent";
    const scope = repos.length ? `${repos.join(", ")} and this operator` : "this operator";
    sections.push(`${head}\n\n${sel.byRelevance ? `Notes about ${scope} that match the task` : `The newest notes about ${scope}`} — the rest are in MEMORY-all.md (\`memory search <words>\`).\n\n${sel.relevant.map((n) => noteLine(n, showRepo)).join("\n")}`);
  }
  return (
    "# Memory from earlier runs\n\n" +
    "What earlier runs learned for this operator and these repos. Notes may be stale — verify before relying on one. " +
    "`memory search <words>` searches everything; add a note with `memory add <kind> \"<text>\" [--area part/subpart] [--paths a,b] [--links area,…] [--why …] [--replaces \"<old text>\"]` " +
    "or a line `<!-- remember: <kind> | <text> [| area: …] [| paths: …] [| links: …] [| why: …] [| replaces: \"<old text>\"] -->`.\n\n" +
    sections.join("\n\n") +
    "\n"
  );
}

/**
 * MEMORY-all.md: every active note the box may see, one per line (a playbook's steps joined with
 * ` · ` so `memory search` matches whole notes), grouped by scope and kind. Null when empty.
 */
export function renderMemoryArchive(store: MemoryStore, repos: string[]): string | null {
  if (!store.enabled) return null;
  const visible = visibleNotes(store, repos);
  if (!visible.length) return null;
  const line = (n: MemoryNote): string => {
    const text = n.kind === "playbook" ? n.text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join(" · ") : n.text.replace(/\s*\n\s*/g, " ");
    return `- [${n.area ? `${n.kind} · ${n.area}` : n.kind}] ${text}${n.repo ? ` (${n.repo})` : ""}${kbSuffix(n)}${n.why ? ` | why: ${n.why}` : ""}`;
  };
  const groups: string[] = [];
  const byScope = (scope: string, notes: MemoryNote[]) => {
    const lines: string[] = [];
    for (const kind of MEMORY_KINDS) {
      const ofKind = notes.filter((n) => n.kind === kind).sort((a, b) => a.at - b.at);
      if (ofKind.length) lines.push(...ofKind.map(line));
    }
    if (lines.length) groups.push(`## ${scope}\n\n${lines.join("\n")}`);
  };
  byScope("operator", visible.filter((n) => n.scope === "operator"));
  for (const r of repos) byScope(memoryRepoKey(r), visible.filter((n) => n.repo === memoryRepoKey(r)));
  const idx = areaIndex(store, repos);
  const kb = idx.length ? `## Areas\n\n${idx.map((a) => areaIndexLine(a, repos.length !== 1)).join("\n")}\n\n` : "";
  return `# Memory archive\n\nEvery note for this operator and these repos; MEMORY.md is the relevant slice. Searched by \`memory search\`; \`memory area <slug>\` prints one area.\n\n${kb}${groups.join("\n\n")}\n`;
}

/** Bump the use counters of the playbooks a task matched. Returns true when anything changed. */
export function markPlaybooksUsed(notes: MemoryNote[], now = Date.now()): boolean {
  for (const n of notes) {
    n.uses = (n.uses ?? 0) + 1;
    n.lastUsed = now;
  }
  return notes.length > 0;
}

/** The first-turn one-liner for matched playbooks (same channel as the skill hint). Empty when none. */
export function playbookHint(notes: MemoryNote[]): string {
  if (!notes.length) return "";
  const titles = notes.slice(0, 3).map((n) => playbookTitle(n.text));
  return notes.length === 1 ? `A playbook exists for this: ${titles[0]} — see MEMORY.md.` : `Playbooks exist for this: ${titles.join("; ")} — see MEMORY.md.`;
}

/* ───────────────────────── promote / export / import ───────────────────────── */

/** A playbook as a skill draft: slug from the title, the steps as the SKILL.md body. */
export function playbookToSkill(n: MemoryNote): { name: string; description: string; content: string } {
  if (n.kind !== "playbook") throw new Error("Only a playbook can be promoted to a skill.");
  const [rawTitle, ...steps] = n.text.split(/\r?\n/);
  const title = playbookTitle(rawTitle) || "playbook";
  const name =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z0-9]+/, "")
      .slice(0, 50)
      .replace(/-+$/, "") || "playbook";
  const body = steps.map((s) => s.trim()).filter(Boolean);
  const content = [`# ${title}`, "", ...(body.length ? body.map((s) => (/^(?:[-*•]|\d+[.)])\s/.test(s) ? s : `- ${s}`)) : [title]), ...(n.why ? ["", `Why: ${n.why}`] : [])].join("\n");
  return { name, description: `Playbook from memory: ${title}`, content };
}

/**
 * One Markdown file of every kept note, grouped like the page (`## operator`, then `## <repo>`),
 * each `- [kind] text [| why: …]`; a playbook's steps indented beneath. Round-trips through
 * parseMemoryMarkdown.
 */
export function exportMemoryMarkdown(store: MemoryStore): string {
  const line = (n: MemoryNote): string => {
    const fields =
      (n.area ? ` | area: ${n.area}` : "") +
      (n.paths?.length ? ` | paths: ${n.paths.join(", ")}` : "") +
      (n.links?.length ? ` | links: ${n.links.join(", ")}` : "") +
      (n.why ? ` | why: ${n.why}` : "");
    if (n.kind === "playbook") {
      const [title, ...steps] = n.text.split(/\r?\n/);
      return [`- [playbook] ${title.trim()}${fields}`, ...steps.filter((s) => s.trim()).map((s) => `  ${s.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, "- ")}`)].join("\n");
    }
    return `- [${n.kind}] ${n.text.replace(/\s*\n\s*/g, " ")}${fields}`;
  };
  const section = (title: string, notes: MemoryNote[]): string | null => {
    const kept = notes.filter((n) => isActive(n) && n.status === "kept").sort((a, b) => MEMORY_KINDS.indexOf(a.kind) - MEMORY_KINDS.indexOf(b.kind) || a.at - b.at);
    return kept.length ? `## ${title}\n\n${kept.map(line).join("\n")}` : null;
  };
  const parts = [section("operator", store.global), ...Object.keys(store.repos).sort().map((r) => section(r, store.repos[r]))].filter((s): s is string => !!s);
  return `# Memory export\n\n${parts.join("\n\n")}\n`;
}

/** Parsed import rows: the heading decides the scope (`operator`, or an owner/name slug). */
export function parseMemoryMarkdown(markdown: string): Array<ParsedNote & { repo?: string }> {
  const out: Array<ParsedNote & { repo?: string }> = [];
  let repo: string | undefined;
  let current: (ParsedNote & { repo?: string }) | null = null;
  const flush = () => {
    if (current) out.push(current);
    current = null;
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(raw);
    if (h) {
      flush();
      const title = h[1].trim().replace(/^repo\s+/i, "");
      repo = /^[^/\s]+\/[^/\s]+$/.test(title) ? memoryRepoKey(title) : undefined;
      continue;
    }
    const row = /^-\s+\[(\w+)\]\s+(.+)$/.exec(raw);
    if (row) {
      flush();
      if (!isMemoryKind(row[1].toLowerCase())) continue;
      const parsed = parseNoteLine(`${row[1].toLowerCase()} | ${row[2]}`);
      if (parsed) current = repo ? { ...parsed, repo } : parsed;
      continue;
    }
    if (current?.kind === "playbook" && /^\s{2,}\S/.test(raw)) {
      current.text = `${current.text}\n${raw.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, "- ")}`.slice(0, MEMORY_LIMITS.maxPlaybookChars);
      continue;
    }
    if (!raw.trim()) flush();
  }
  flush();
  return out;
}

/** Import rows as kept notes (source "import"); duplicates are skipped. Returns how many were added. */
export function importMemoryMarkdown(store: MemoryStore, markdown: string, now = Date.now()): number {
  let n = 0;
  for (const row of parseMemoryMarkdown(markdown)) {
    const before = allNotes(store).length;
    try {
      addManualNote(store, { kind: row.kind, text: row.text, why: row.why, repo: row.repo, area: row.area, paths: row.paths, links: row.links }, now, "import");
    } catch {
      continue; // one bad row never fails the file
    }
    if (allNotes(store).length > before) n++;
  }
  return n;
}

/** Tally by kind, for the digest's "Remembered 2 lessons, 1 playbook". */
export function countKinds(notes: Array<{ kind: MemoryKind }>): Partial<Record<MemoryKind, number>> {
  const out: Partial<Record<MemoryKind, number>> = {};
  for (const n of notes) out[n.kind] = (out[n.kind] ?? 0) + 1;
  return out;
}

/* ───────────────────────────── IO ───────────────────────────── */

const BLOB_KIND = "memory";

/**
 * The owner's memory. Database row per owner; the stdio entry (no user store) has no memory —
 * an empty, enabled store, and saves are dropped — rather than a second file-backed path.
 */
export function loadMemoryStore(owner = ownerKey()): MemoryStore {
  if (!hasUserStoreBackend()) return emptyMemoryStore();
  return parseMemoryStore(loadBlob(BLOB_KIND, owner) ?? "");
}

export function saveMemoryStore(store: MemoryStore, owner = ownerKey()): void {
  if (!hasUserStoreBackend()) return;
  saveBlob(BLOB_KIND, serializeMemoryStore(store), owner);
}
