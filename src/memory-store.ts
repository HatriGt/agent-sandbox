/**
 * Memory across runs — durable facts an agent learned on earlier runs for this operator and repo.
 *
 * A box is thrown away with its run; without this every run starts from zero and relearns the
 * same conventions, decisions and environment quirks. The store is one encrypted user_blobs row
 * per owner (kind "memory", same as skills/MCP): global notes plus notes per GitHub repo slug.
 * Writes are deterministic — no extra LLM call: the system prompt asks the agent to end a run with
 * `<!-- remember: <one fact per line> -->`, parsed at the finish edge (src/http.ts, beside the
 * setup sentinel), plus the questions the operator answered that run. Reads: msb.ts installMemory
 * drops the relevant notes as ~/.claude/MEMORY.md (and ~/.omp/MEMORY.md) before every turn.
 * Pure parsing/shaping here; IO at the bottom, mirroring skill-store.
 */
import { hasUserStoreBackend, loadBlob, saveBlob, ownerKey } from "./user-store.js";

export interface MemoryNote {
  id: string;
  text: string;
  /** Epoch ms when the note was written. */
  at: number;
  /** The run (box id) that produced it. */
  source: string;
  /** GitHub slug (owner/name, lowercase) when the note belongs to one repo; absent = global. */
  repo?: string;
  /** Pinned notes are never evicted by the caps. */
  pinned?: boolean;
}

export interface MemoryStore {
  /** Off switch for the whole feature (dashboard setting): nothing is written or installed. */
  enabled: boolean;
  global: MemoryNote[];
  repos: Record<string, MemoryNote[]>;
}

export const MEMORY_LIMITS = {
  maxGlobal: 60,
  maxPerRepo: 30,
  /** Characters per note — a "durable fact", not a report. */
  maxNoteChars: 400,
  /** Facts taken from a single run's sentinel. */
  maxPerRun: 20,
} as const;

/** The marker the prompt asks for. Multi-line body, one fact per line; several blocks allowed. */
const REMEMBER_RE = /<!--\s*remember:\s*([\s\S]*?)-->/g;

export function emptyMemoryStore(): MemoryStore {
  return { enabled: true, global: [], repos: {} };
}

export function parseMemoryStore(raw: string): MemoryStore {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      const notes = (v: unknown): MemoryNote[] => (Array.isArray(v) ? v.filter((n) => n && typeof n.text === "string" && typeof n.id === "string") : []);
      const repos: Record<string, MemoryNote[]> = {};
      if (obj.repos && typeof obj.repos === "object") for (const [k, v] of Object.entries(obj.repos)) repos[k] = notes(v);
      return { enabled: obj.enabled !== false, global: notes(obj.global), repos };
    }
  } catch {
    /* fall through */
  }
  return emptyMemoryStore();
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

/**
 * The facts an agent asked us to remember, from the run's log. One per line, trimmed, leading
 * list markers dropped, empties ignored, de-duplicated by normalised text. Over-long lines are
 * clipped rather than dropped: a fact that ran on is still a fact.
 */
export function parseRemember(log: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of log.matchAll(REMEMBER_RE)) {
    for (const raw of m[1].split(/\r?\n/)) {
      const text = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
      if (!text) continue;
      const key = normalizeNoteText(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(text.slice(0, MEMORY_LIMITS.maxNoteChars));
      if (out.length >= MEMORY_LIMITS.maxPerRun) return out;
    }
  }
  return out;
}

/** An answered question as a durable fact: what was asked, what the operator chose. */
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

/**
 * Add facts to a list (global or one repo): skip what is already known (normalised), append the
 * rest, then evict the OLDEST UNPINNED notes past the cap. Returns the number actually added.
 */
export function addNotes(list: MemoryNote[], facts: string[], meta: { source: string; repo?: string; now?: number }, cap: number): number {
  const now = meta.now ?? Date.now();
  const known = new Set(list.map((n) => normalizeNoteText(n.text)));
  let added = 0;
  for (const text of facts) {
    const key = normalizeNoteText(text);
    if (!key || known.has(key)) continue;
    known.add(key);
    const note: MemoryNote = { id: newNoteId(now), text, at: now, source: meta.source };
    if (meta.repo) note.repo = meta.repo;
    list.push(note);
    added++;
  }
  evict(list, cap);
  return added;
}

function evict(list: MemoryNote[], cap: number): void {
  while (list.length > cap) {
    const i = list.findIndex((n) => !n.pinned);
    if (i < 0) return; // everything pinned: the operator asked for all of it
    list.splice(i, 1);
  }
}

/** Repo keys are the setup-store slug: owner/name, lowercase. */
export function memoryRepoKey(slug: string): string {
  return slug.trim().toLowerCase();
}

/**
 * Store what one finished run produced: sentinel facts into the attached repo's notes (global when
 * the box had no or several repos), answered questions likewise. Returns the count stored.
 */
export function rememberRun(store: MemoryStore, i: { box: string; log: string; questions?: Array<{ question: string; answer?: string }>; repos: string[]; now?: number }): number {
  if (!store.enabled) return 0;
  const facts = parseRemember(i.log);
  for (const q of i.questions ?? []) {
    const t = questionNoteText(q);
    if (t) facts.push(t);
  }
  if (!facts.length) return 0;
  const repo = i.repos.length === 1 ? memoryRepoKey(i.repos[0]) : undefined;
  if (repo) {
    const list = (store.repos[repo] ??= []);
    return addNotes(list, facts, { source: i.box, repo, now: i.now }, MEMORY_LIMITS.maxPerRepo);
  }
  return addNotes(store.global, facts, { source: i.box, now: i.now }, MEMORY_LIMITS.maxGlobal);
}

/** Every note, newest first, for the dashboard. */
export function viewMemory(store: MemoryStore): MemoryNote[] {
  const all = [...store.global, ...Object.values(store.repos).flat()];
  return all.sort((a, b) => b.at - a.at);
}

function findNote(store: MemoryStore, id: string): { list: MemoryNote[]; index: number } | null {
  const lists = [store.global, ...Object.values(store.repos)];
  for (const list of lists) {
    const index = list.findIndex((n) => n.id === id);
    if (index >= 0) return { list, index };
  }
  return null;
}

/** Edit text and/or pin state. Throws a human message on bad input. */
export function updateNote(store: MemoryStore, id: string, patch: { text?: unknown; pinned?: unknown }): MemoryNote {
  const hit = findNote(store, id);
  if (!hit) throw new Error("That note no longer exists.");
  const note = hit.list[hit.index];
  if (patch.text !== undefined) {
    const text = String(patch.text).replace(/\s+/g, " ").trim();
    if (!text) throw new Error("A note cannot be empty — delete it instead.");
    if (text.length > MEMORY_LIMITS.maxNoteChars) throw new Error(`A note is at most ${MEMORY_LIMITS.maxNoteChars} characters.`);
    note.text = text;
  }
  if (patch.pinned !== undefined) {
    if (patch.pinned) note.pinned = true;
    else delete note.pinned;
  }
  return note;
}

export function deleteNote(store: MemoryStore, id: string): boolean {
  const hit = findNote(store, id);
  if (!hit) return false;
  hit.list.splice(hit.index, 1);
  return true;
}

/**
 * The MEMORY.md a box receives: global notes plus the notes of the repos checked out in it. Null
 * when there is nothing to say (the installer then removes a stale file). Pinned first within a
 * section, otherwise oldest first so the file reads chronologically.
 */
export function renderMemoryMd(store: MemoryStore, repos: string[]): string | null {
  if (!store.enabled) return null;
  const sections: string[] = [];
  const lines = (list: MemoryNote[]) =>
    [...list]
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.at - b.at)
      .map((n) => `- ${n.text}`)
      .join("\n");
  if (store.global.length) sections.push(`## For this operator (any repo)\n\n${lines(store.global)}`);
  for (const r of repos) {
    const list = store.repos[memoryRepoKey(r)];
    if (list?.length) sections.push(`## ${r}\n\n${lines(list)}`);
  }
  if (!sections.length) return null;
  return (
    "# Memory from earlier runs\n\n" +
    "Notes earlier runs left for this operator and these repos. They may be stale — verify before relying on one. " +
    "Add to them by ending a run with `<!-- remember: <one durable fact per line> -->`.\n\n" +
    sections.join("\n\n") +
    "\n"
  );
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
