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

export interface SkillDef {
  /** kebab-case identifier: the folder name in the box and the `/name` chat trigger. */
  name: string;
  /** One or two sentences: WHEN to use it. This is what makes the model pick it up unprompted. */
  description: string;
  /** The SKILL.md body — the instructions themselves. */
  content: string;
  enabled: boolean;
  addedAt: number;
  updatedAt: number;
}

export interface SkillStore {
  skills: Record<string, SkillDef>;
}

/** Claude Code's own constraint for skill folder names, so what we write is what it loads. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;
export const SKILL_LIMITS = { maxSkills: 50, maxDescription: 1024, maxContent: 65_536 } as const;

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
  return {
    name,
    description,
    content,
    enabled: input.enabled ?? true,
    addedAt: input.addedAt ?? now,
    updatedAt: now,
  };
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

/** What the dashboard sees — nothing to mask, just a stable order. */
export function viewSkills(store: SkillStore): SkillDef[] {
  return Object.values(store.skills).sort((a, b) => a.name.localeCompare(b.name));
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
