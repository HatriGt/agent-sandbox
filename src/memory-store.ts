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
import { scoreSkill } from "./skill-match.js";

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
}

export const MEMORY_LIMITS = {
  /** Active (non-superseded) notes per kind within one list (operator or one repo). */
  perKind: { preference: 40, rule: 40, fact: 30, decision: 30, lesson: 30, playbook: 15 } as Record<MemoryKind, number>,
  /** Superseded notes kept as history per list; the oldest go first. */
  maxSuperseded: 60,
  /** Characters per note — a "durable fact", not a report. */
  maxNoteChars: 400,
  /** A playbook is a title line plus steps. */
  maxPlaybookChars: 1200,
  maxWhyChars: 300,
  /** Notes taken from one parse of a log. */
  maxPerRun: 20,
  /** "For this task" slice of MEMORY.md. */
  relevantMax: 25,
  /** scoreSkill points a note needs to count as relevant to the task (else the newest win). */
  relevanceThreshold: 2,
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
  return out;
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

const clipText = (kind: MemoryKind, text: string): string => text.slice(0, kind === "playbook" ? MEMORY_LIMITS.maxPlaybookChars : MEMORY_LIMITS.maxNoteChars);
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
    const m = /^(why|replaces)\s*:\s*([\s\S]*)$/i.exec(p.trim());
    if (!m) continue;
    const v = m[2].trim();
    if (!v) continue;
    if (m[1].toLowerCase() === "why") note.why = tidyNoteText(v, "fact").slice(0, MEMORY_LIMITS.maxWhyChars);
    else note.replaces = stripQuotes(v).slice(0, MEMORY_LIMITS.maxNoteChars);
  }
  return note;
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
export function findReplaced(list: MemoryNote[], replaces: string): MemoryNote | undefined {
  const key = normalizeNoteText(replaces);
  if (!key) return undefined;
  const active = list.filter(isActive);
  return active.find((n) => normalizeNoteText(n.text) === key) ?? (key.length >= 12 ? active.find((n) => normalizeNoteText(n.text).includes(key)) : undefined);
}

/**
 * Add parsed notes to a list: skip what is already active there (same kind + normalised text),
 * resolve `replaces:` and supersede the old note, append the rest, then apply the per-kind caps.
 * Returns the notes actually added (with their ids).
 */
export function addParsedNotes(
  list: MemoryNote[],
  notes: ParsedNote[],
  meta: { source: string; scope: MemoryScope; repo?: string; now?: number; status?: (kind: MemoryKind) => MemoryStatus }
): MemoryNote[] {
  const now = meta.now ?? Date.now();
  const known = new Set(list.filter(isActive).map(noteKey));
  const added: MemoryNote[] = [];
  for (const p of notes) {
    const key = noteKey(p);
    if (!normalizeNoteText(p.text) || known.has(key)) continue;
    known.add(key);
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
    if (p.replaces) {
      const old = findReplaced(list, p.replaces);
      if (old && old.id !== note.id) {
        old.until = now;
        note.supersedes = old.id;
        known.delete(noteKey(old));
      }
    }
    list.push(note);
    added.push(note);
  }
  evict(list);
  return added;
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
export function updateNote(store: MemoryStore, id: string, patch: { text?: unknown; why?: unknown; pinned?: unknown; status?: unknown }): MemoryNote {
  const hit = findNote(store, id);
  if (!hit) throw new Error("That note no longer exists.");
  const note = hit.list[hit.index];
  if (patch.text !== undefined) {
    const text = note.kind === "playbook" ? String(patch.text).replace(/\r\n/g, "\n").trim() : String(patch.text).replace(/\s+/g, " ").trim();
    if (!text) throw new Error("A note cannot be empty — delete it instead.");
    const max = note.kind === "playbook" ? MEMORY_LIMITS.maxPlaybookChars : MEMORY_LIMITS.maxNoteChars;
    if (text.length > max) throw new Error(`A ${note.kind} is at most ${max} characters.`);
    note.text = text;
  }
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
  return true;
}

/**
 * A note the operator types or imports: validated, filed by the kind's scope (a repo is honoured
 * only for repo-scoped kinds), kept at once. Throws a human message on bad input.
 */
export function addManualNote(store: MemoryStore, input: { kind: unknown; text: unknown; why?: unknown; repo?: unknown }, now = Date.now(), source = "operator"): MemoryNote {
  if (!isMemoryKind(input.kind)) throw new Error(`kind must be one of ${MEMORY_KINDS.join(", ")}.`);
  const kind = input.kind;
  const text = tidyNoteText(kind === "playbook" ? String(input.text ?? "").replace(/\r\n/g, "\n").trim() : String(input.text ?? "").replace(/\s+/g, " ").trim(), kind);
  if (!text) throw new Error("A note needs some text.");
  const max = kind === "playbook" ? MEMORY_LIMITS.maxPlaybookChars : MEMORY_LIMITS.maxNoteChars;
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
  const [note] = addParsedNotes(list, [{ kind, text, ...(why ? { why } : {}) }], { source, now, status: () => "kept", ...scope });
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
  const rest = visible.filter((n) => !OPERATOR_KINDS.has(n.kind) && !n.pinned);
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
  const matchedPlaybooks = byRelevance ? relevant.filter((n) => n.kind === "playbook") : [];
  return { core, relevant, matchedPlaybooks, byRelevance };
}

/** `- [kind] text (repo) | why: …`, a playbook's steps indented beneath its title. */
function noteLine(n: MemoryNote, showRepo: boolean): string {
  const tag = n.pinned && !OPERATOR_KINDS.has(n.kind) ? `pinned ${n.kind}` : n.kind;
  const repo = showRepo && n.repo ? ` (${n.repo})` : "";
  const why = n.why ? ` | why: ${n.why}` : "";
  if (n.kind === "playbook") {
    const [title, ...steps] = n.text.split(/\r?\n/);
    const body = steps.filter((s) => s.trim()).map((s) => `    ${s.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, "- ")}`);
    return [`- [${tag}] ${title.trim()}${repo}${why}`, ...body].join("\n");
  }
  return `- [${tag}] ${n.text.replace(/\s*\n\s*/g, " ")}${repo}${why}`;
}

/**
 * The MEMORY.md a box receives: Core + For this task + how to add. Null when there is nothing to
 * say (the installer then removes a stale file).
 */
export function renderMemoryMd(store: MemoryStore, repos: string[], task?: string): string | null {
  if (!store.enabled) return null;
  const sel = selectMemory(store, repos, task);
  if (!sel.core.length && !sel.relevant.length) return null;
  const showRepo = repos.length !== 1;
  const sections: string[] = [];
  if (sel.core.length) sections.push(`## Core\n\n${sel.core.map((n) => noteLine(n, showRepo)).join("\n")}`);
  if (sel.relevant.length) {
    const head = sel.byRelevance ? "## For this task" : "## Recent";
    const scope = repos.length ? `${repos.join(", ")} and this operator` : "this operator";
    sections.push(`${head}\n\n${sel.byRelevance ? `Notes about ${scope} that match the task` : `The newest notes about ${scope}`} — the rest are in MEMORY-all.md (\`memory search <words>\`).\n\n${sel.relevant.map((n) => noteLine(n, showRepo)).join("\n")}`);
  }
  return (
    "# Memory from earlier runs\n\n" +
    "What earlier runs learned for this operator and these repos. Notes may be stale — verify before relying on one. " +
    "`memory search <words>` searches everything; add a note with `memory add <kind> \"<text>\" [--why …] [--replaces \"<old text>\"]` " +
    "or a line `<!-- remember: <kind> | <text> [| why: …] [| replaces: \"<old text>\"] -->`.\n\n" +
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
    return `- [${n.kind}] ${text}${n.repo ? ` (${n.repo})` : ""}${n.why ? ` | why: ${n.why}` : ""}`;
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
  return `# Memory archive\n\nEvery note for this operator and these repos; MEMORY.md is the relevant slice. Searched by \`memory search\`.\n\n${groups.join("\n\n")}\n`;
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
    const why = n.why ? ` | why: ${n.why}` : "";
    if (n.kind === "playbook") {
      const [title, ...steps] = n.text.split(/\r?\n/);
      return [`- [playbook] ${title.trim()}${why}`, ...steps.filter((s) => s.trim()).map((s) => `  ${s.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, "- ")}`)].join("\n");
    }
    return `- [${n.kind}] ${n.text.replace(/\s*\n\s*/g, " ")}${why}`;
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
      addManualNote(store, { kind: row.kind, text: row.text, why: row.why, repo: row.repo }, now, "import");
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
