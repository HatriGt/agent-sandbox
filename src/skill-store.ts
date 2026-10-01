/**
 * Skills — reusable instruction packs the sandbox agent can invoke, configured on the dashboard.
 *
 * A skill is the same thing Claude Code calls a skill: a folder with a SKILL.md whose frontmatter
 * (name + description) tells the model when to reach for it and whose body is the playbook. Here
 * they are stored per owner (encrypted user_blobs row, same as MCP servers), edited as plain
 * markdown on the dashboard, and written into the box at ~/.claude/skills/<name>/SKILL.md before
 * every run/resume — so the in-box `claude` discovers them natively (we run with
 * `--setting-sources user`, which loads exactly that directory) and the agent can be steered with
 * `/name` from chat or trigger them itself from the description. Pure parsing/shaping here; IO at
 * the bottom, mirroring mcp-store.
 */
import { hasUserStoreBackend, loadBlob, saveBlob, ownerKey } from "./user-store.js";
import type { Config } from "./config.js";
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";

/** A supporting file that ships beside SKILL.md (scripts, docs, config a multi-file skill needs). */
export interface SkillFile {
  /** Relative path under the skill folder, e.g. "scripts/run.mjs" or "docs/api.md". */
  path: string;
  /** UTF-8 text content. Text only — binary files are rejected at import time. */
  content: string;
}

export interface SkillDef {
  /** kebab-case identifier: the folder name in the box and the `/name` chat trigger. */
  name: string;
  /** One or two sentences: WHEN to use it. This is what makes the model pick it up unprompted. */
  description: string;
  /** The SKILL.md body — the instructions themselves. */
  content: string;
  /** Supporting files beside SKILL.md. Absent/empty for a plain single-file skill. */
  files?: SkillFile[];
  enabled: boolean;
  addedAt: number;
  updatedAt: number;
}

export interface SkillStore {
  skills: Record<string, SkillDef>;
}

/** Claude Code's own constraint for skill folder names, so what we write is what it loads. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;
export const SKILL_LIMITS = {
  maxSkills: 50,
  maxDescription: 1024,
  maxContent: 65_536,
  /** Supporting files per skill. */
  maxFiles: 200,
  /** Bytes per supporting file. */
  maxFileBytes: 512_000,
  /** Bytes per skill (SKILL.md + all supporting files). */
  maxSkillBytes: 2_000_000,
  /** Bytes for one owner's whole serialized store — it is loaded and cloned per request. */
  maxStoreBytes: 8_000_000,
} as const;

/** One path segment: letters/digits/._@- (covers ".env.qa", ".gitignore"), nothing exotic. */
const SEGMENT_RE = /^[\w.@-]{1,100}$/;

/**
 * Reject anything a supporting-file path could smuggle: traversal, absolute paths, control chars,
 * silly depth. These paths end up inside a tar we extract in the box, so this is the gate.
 */
export function validateSkillFilePath(path: string): void {
  if (!path || path.length > 240) throw new Error(`Invalid file path (empty or over 240 chars).`);
  if (path.startsWith("/") || /[\0-\x1f\\]/.test(path)) throw new Error(`Invalid file path "${path}".`);
  const segments = path.split("/");
  if (segments.length > 8) throw new Error(`File path "${path}" is nested too deep (max 8 levels).`);
  for (const seg of segments) {
    if (seg === "." || seg === ".." || !SEGMENT_RE.test(seg)) throw new Error(`Invalid file path "${path}".`);
  }
  if (path.toLowerCase() === "skill.md") throw new Error(`A supporting file cannot be named SKILL.md.`);
}

/** Total bytes a skill occupies (UTF-8), for limits and the dashboard. */
export function skillByteSize(s: Pick<SkillDef, "content" | "files">): number {
  let n = Buffer.byteLength(s.content, "utf8");
  for (const f of s.files ?? []) n += Buffer.byteLength(f.content, "utf8");
  return n;
}

export function parseSkillStore(raw: string): SkillStore {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && obj.skills && typeof obj.skills === "object") return { skills: { ...obj.skills } };
  } catch {
    /* fall through */
  }
  return { skills: {} };
}

export function serializeSkillStore(store: SkillStore): string {
  return JSON.stringify(store, null, 2);
}

/** Validate + normalise one skill (form input). Throws a human message on bad input. */
export function normalizeSkill(input: Partial<SkillDef> & { name: string }, now = Date.now()): SkillDef {
  const name = (input.name ?? "").trim();
  if (!NAME_RE.test(name)) throw new Error(`Skill name "${name}" must be kebab-case: lowercase letters, digits and dashes, up to 50 chars (e.g. review-pr).`);
  const description = (input.description ?? "").trim();
  if (!description) throw new Error(`Skill "${name}" needs a description — it is how the agent decides when to use it.`);
  if (description.length > SKILL_LIMITS.maxDescription) throw new Error(`Skill "${name}": description is over ${SKILL_LIMITS.maxDescription} characters.`);
  const content = (input.content ?? "").replace(/\r\n/g, "\n").trim();
  if (!content) throw new Error(`Skill "${name}" needs instructions (the markdown body).`);
  if (content.length > SKILL_LIMITS.maxContent) throw new Error(`Skill "${name}": instructions are over ${Math.floor(SKILL_LIMITS.maxContent / 1024)} KB.`);
  const files = normalizeSkillFiles(name, input.files);
  const def: SkillDef = {
    name,
    description,
    content,
    enabled: input.enabled ?? true,
    addedAt: input.addedAt ?? now,
    updatedAt: now,
  };
  if (files.length) def.files = files;
  if (skillByteSize({ content, files }) > SKILL_LIMITS.maxSkillBytes)
    throw new Error(`Skill "${name}" is over ${Math.floor(SKILL_LIMITS.maxSkillBytes / 1_000_000)} MB in total.`);
  return def;
}

/** Validate + normalise the supporting files of one skill. Throws a human message on bad input. */
function normalizeSkillFiles(skillName: string, input: unknown): SkillFile[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error(`Skill "${skillName}": files must be a list.`);
  if (input.length > SKILL_LIMITS.maxFiles) throw new Error(`Skill "${skillName}": too many files (max ${SKILL_LIMITS.maxFiles}).`);
  const seen = new Set<string>();
  const out: SkillFile[] = [];
  for (const raw of input) {
    const path = typeof (raw as SkillFile)?.path === "string" ? (raw as SkillFile).path.trim() : "";
    const content = typeof (raw as SkillFile)?.content === "string" ? (raw as SkillFile).content.replace(/\r\n/g, "\n") : null;
    validateSkillFilePath(path);
    if (content === null || content.includes("\0")) throw new Error(`Skill "${skillName}": ${path} is not a text file.`);
    if (Buffer.byteLength(content, "utf8") > SKILL_LIMITS.maxFileBytes)
      throw new Error(`Skill "${skillName}": ${path} is over ${Math.floor(SKILL_LIMITS.maxFileBytes / 1024)} KB.`);
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error(`Skill "${skillName}": duplicate file path ${path}.`);
    seen.add(key);
    // Assert now that the in-box path fits a ustar header — install must never fail on a stored skill.
    if (!ustarSplit(`${skillName}/${path}`)) throw new Error(`Skill "${skillName}": ${path} is too long to install.`);
    out.push({ path, content });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The SKILL.md Claude Code reads: YAML frontmatter (name/description) + the body. */
export function toSkillMd(s: SkillDef): string {
  // JSON string escaping is valid YAML for a double-quoted scalar, so the description can hold
  // quotes/colons/newlines without breaking the frontmatter.
  return `---\nname: ${s.name}\ndescription: ${JSON.stringify(s.description)}\n---\n\n${s.content}\n`;
}

export function enabledSkills(store: SkillStore): SkillDef[] {
  return Object.values(store.skills)
    .filter((s) => s.enabled)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The skills a box installs. With no per-box selection (the default) that is the enabled set; a
 * run started on a harness (src/harness.ts) installs exactly the harness's named skills instead,
 * enabled or not — imported harness skills are stored disabled precisely so they reach no other run.
 */
export function skillsForBox(store: SkillStore, selection: string[] | undefined): SkillDef[] {
  if (!selection) return enabledSkills(store);
  const want = new Set(selection);
  return Object.values(store.skills)
    .filter((s) => want.has(s.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Per-box skill selection. The in-memory map is the fast path; the controller registers a durable
 * backend (a DB row per box) so a resume after a restart keeps the harness's selection.
 */
const boxSelections = new Map<string, string[]>();
let selectionBackend: { get(box: string): string[] | undefined; set(box: string, names: string[]): void } | null = null;
export function registerSkillSelectionBackend(b: typeof selectionBackend): void {
  selectionBackend = b;
}
export function setBoxSkillSelection(box: string, names: string[]): void {
  boxSelections.set(box, [...names]);
  try {
    selectionBackend?.set(box, names);
  } catch {
    /* the in-memory copy still covers this process */
  }
}
export function boxSkillSelection(box: string): string[] | undefined {
  const m = boxSelections.get(box);
  if (m) return m;
  try {
    const d = selectionBackend?.get(box);
    if (d) boxSelections.set(box, d);
    return d;
  } catch {
    return undefined;
  }
}

/** What the dashboard sees — nothing to mask, just a stable order. */
export function viewSkills(store: SkillStore): SkillDef[] {
  return Object.values(store.skills).sort((a, b) => a.name.localeCompare(b.name));
}

/* ───────────────────────────── tar (install payload) ───────────────────────────── */

/**
 * Split a path into ustar name (≤100) / prefix (≤155) fields at a slash boundary.
 * Returns null when the path cannot be represented — callers reject those up front.
 */
export function ustarSplit(path: string): { name: string; prefix: string } | null {
  if (path.length <= 100) return { name: path, prefix: "" };
  // Longest suffix ≤ 100 chars that starts right after a slash.
  for (let i = path.length - 101; i < path.length; i++) {
    if (i >= 0 && path[i] === "/") {
      const prefix = path.slice(0, i);
      const name = path.slice(i + 1);
      if (name.length >= 1 && name.length <= 100 && prefix.length <= 155) return { name, prefix };
    }
  }
  return null;
}

function ustarHeader(path: string, size: number, mtimeSec: number): Buffer {
  const split = ustarSplit(path);
  if (!split) throw new Error(`path too long for tar: ${path}`);
  const h = Buffer.alloc(512);
  const put = (s: string, off: number, len: number) => h.write(s.slice(0, len), off, "utf8");
  put(split.name, 0, 100);
  put("0000644\0", 100, 8); // mode
  put("0000000\0", 108, 8); // uid
  put("0000000\0", 116, 8); // gid
  put(size.toString(8).padStart(11, "0") + "\0", 124, 12);
  put(Math.max(0, mtimeSec).toString(8).padStart(11, "0") + "\0", 136, 12);
  put("        ", 148, 8); // chksum placeholder: spaces while summing
  put("0", 156, 1); // typeflag: regular file
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(split.prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}

/**
 * The enabled skills as a base64 tar of `<name>/SKILL.md` + `<name>/<file>` entries — what
 * installSkills streams into the box over stdin (`base64 -d | tar -x`). Pure, so it's testable;
 * base64 because the payload crosses ssh → msb exec → sh unmangled that way.
 */
export function buildSkillsTarBase64(skills: SkillDef[], index?: string): string {
  const blocks: Buffer[] = [];
  const add = (path: string, text: string, mtimeMs: number) => {
    const body = Buffer.from(text, "utf8");
    blocks.push(ustarHeader(path, body.length, Math.floor(mtimeMs / 1000)));
    blocks.push(body);
    const pad = (512 - (body.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  };
  for (const s of skills) {
    add(`${s.name}/SKILL.md`, toSkillMd(s), s.updatedAt);
    for (const f of s.files ?? []) {
      // Stored skills were validated at write time; re-assert so a tampered blob can't traverse.
      validateSkillFilePath(f.path);
      add(`${s.name}/${f.path}`, f.content, s.updatedAt);
    }
  }
  // The skills index (src/skill-match.ts skillsIndex) at the tree root: no SKILL.md beside it, so
  // Claude Code's loader ignores it; the run wrapper appends it to every driver's system prompt.
  if (index) add("INDEX.md", `${index}\n`, Date.now());
  blocks.push(Buffer.alloc(1024)); // end-of-archive
  return Buffer.concat(blocks).toString("base64");
}

/* ───────────────────────────── IO ───────────────────────────── */

const STORE_PATH = '"$HOME/.agent-sandbox/skills.json"';
const CACHE_TTL_MS = 60_000;
const BLOB_KIND = "skills";
const perOwner = new Map<string, { store: SkillStore; at: number }>();
let cachedFile: { store: SkillStore; at: number } | null = null;

/** The calling principal's skills (database row per owner; VPS file for the stdio entry). */
export async function loadSkillStore(cfg: Config): Promise<SkillStore> {
  if (hasUserStoreBackend()) {
    const owner = ownerKey();
    const c = perOwner.get(owner);
    if (c && Date.now() - c.at < CACHE_TTL_MS) return structuredClone(c.store);
    const store = parseSkillStore(loadBlob(BLOB_KIND, owner) ?? "");
    perOwner.set(owner, { store: structuredClone(store), at: Date.now() });
    return store;
  }
  if (cachedFile && Date.now() - cachedFile.at < CACHE_TTL_MS) return structuredClone(cachedFile.store);
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `cat ${STORE_PATH} 2>/dev/null || true`], { check: false });
  const store = parseSkillStore(r.stdout ?? "");
  cachedFile = { store: structuredClone(store), at: Date.now() };
  return store;
}

export async function saveSkillStore(cfg: Config, store: SkillStore): Promise<void> {
  if (Object.keys(store.skills).length > SKILL_LIMITS.maxSkills) throw new Error(`Too many skills (max ${SKILL_LIMITS.maxSkills}).`);
  const json = serializeSkillStore(store);
  if (Buffer.byteLength(json, "utf8") > SKILL_LIMITS.maxStoreBytes)
    throw new Error(`Skills store is over ${Math.floor(SKILL_LIMITS.maxStoreBytes / 1_000_000)} MB in total — remove a large skill first.`);
  if (hasUserStoreBackend()) {
    const owner = ownerKey();
    saveBlob(BLOB_KIND, json, owner);
    perOwner.set(owner, { store: structuredClone(store), at: Date.now() });
    return;
  }
  const remote =
    `mkdir -p "$HOME/.agent-sandbox" && chmod 700 "$HOME/.agent-sandbox" && ` +
    `printf '%s' ${shellQuote(json)} > ${STORE_PATH}.tmp && chmod 600 ${STORE_PATH}.tmp && mv ${STORE_PATH}.tmp ${STORE_PATH}`;
  await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, remote]);
  cachedFile = { store: structuredClone(store), at: Date.now() };
}
