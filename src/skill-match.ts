/**
 * Skill discovery for EVERY driver, not just Claude Code.
 *
 * Claude Code only auto-invokes a skill when the model happens to connect the task to the SKILL.md
 * frontmatter description, and the other drivers (codex, opencode, omp) never look at
 * /root/.claude/skills at all. So the controller does two things itself, both pure and tested here:
 *
 *  1. skillsIndex — a short "name — description (path)" list written into the box at install time
 *     (SKILLS_INDEX) and appended to $AGENT_SYS_PROMPT by the run wrapper on every turn, like the
 *     harness rules (msb.ts agentSh).
 *  2. skillTurnHint — per turn: explicit `/name` tokens from the composer always win ("The user asked
 *     you to run skill X …"); otherwise, on the FIRST turn only, matchSkills scores the task against
 *     each skill's name, description keywords and quoted trigger phrases and names the top few.
 */

/** Where installSkills puts the skills in the box (`--setting-sources user` loads this tree). */
export const SKILLS_DIR = "/root/.claude/skills";
/** The index file the run wrapper appends to the system prompt each turn. */
export const SKILLS_INDEX = `${SKILLS_DIR}/INDEX.md`;

export interface SkillLike {
  name: string;
  description: string;
}

export interface SkillPick {
  name: string;
  /** explicit = the user typed/picked `/name`; auto = the controller's matcher suggested it. */
  how: "explicit" | "auto";
}

export const INDEX_MAX_ENTRIES = 40;
const INDEX_DESC_CHARS = 160;
export const MATCH_MAX = 3;
export const MATCH_THRESHOLD = 3;

export const skillMdPath = (name: string): string => `${SKILLS_DIR}/${name}/SKILL.md`;

/** Words that carry no signal about WHICH playbook applies (incl. generic task verbs). */
const STOP = new Set(
  (
    "a an the and or but of to in on at by for from with without into onto as is are was be been it its this that these those " +
    "i me my we our you your they them he she his her please can could would should will just also then than so if else " +
    "use used using when whenever asked ask task given any some all each every one two not no do does done make get " +
    "write add run new want need help thing stuff something code file files project repo repository change changes " +
    "about after before over under up out via e g eg etc end"
  ).split(/\s+/)
);

/** Crude, deterministic stemmer: enough that "failing"≈"fail", "tests"≈"test", "upgraded"≈"upgrade". */
export function stem(word: string): string {
  let w = word.toLowerCase();
  for (const suf of ["ing", "ed", "es", "s", "e"]) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

const words = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
export const keyStems = (text: string): string[] => words(text).filter((w) => w.length >= 2 && !STOP.has(w)).map(stem);
/** The text as a space-joined stem string, padded so phrase lookups match whole words only. */
const stemLine = (text: string): string => ` ${words(text).map(stem).join(" ")} `;

/** Trigger phrases a description spells out: double-quoted strings ("fix bug", "flaky"). */
export function triggerPhrases(description: string): string[] {
  const out: string[] = [];
  // Double/curly quotes only: single quotes collide with apostrophes ("don't … it's").
  for (const m of description.matchAll(/["“]([^"”\n]{2,60})["”]/g)) out.push(m[1].trim());
  return out.filter(Boolean);
}

/**
 * Score one skill against the task. Name parts weigh 3, quoted trigger phrases 4, other description
 * keywords 1; each distinct stem counts once, so a long description cannot win on volume alone.
 */
export function scoreSkill(task: string, skill: SkillLike): number {
  const taskStems = new Set(keyStems(task));
  const taskLine = stemLine(task);
  if (!taskStems.size) return 0;
  let score = 0;
  const counted = new Set<string>();
  for (const s of keyStems(skill.name.replace(/-/g, " "))) {
    if (!counted.has(s) && taskStems.has(s)) score += 3;
    counted.add(s);
  }
  for (const p of triggerPhrases(skill.description)) {
    const line = stemLine(p).trim();
    if (line && taskLine.includes(` ${line} `)) {
      score += 4;
      for (const s of line.split(" ")) counted.add(s);
    }
  }
  for (const s of keyStems(skill.description)) {
    if (!counted.has(s) && taskStems.has(s)) score += 1;
    counted.add(s);
  }
  return score;
}

/** The skills whose score clears the threshold, best first (ties by name), at most MATCH_MAX. */
export function matchSkills(
  task: string,
  skills: SkillLike[],
  opts: { threshold?: number; max?: number } = {}
): Array<{ name: string; score: number }> {
  const threshold = opts.threshold ?? MATCH_THRESHOLD;
  return skills
    .map((s) => ({ name: s.name, score: scoreSkill(task, s) }))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, opts.max ?? MATCH_MAX);
}

/** `/name` tokens (start of text or after whitespace) that name an installed skill, in order. */
export function explicitSkills(task: string, skills: SkillLike[]): string[] {
  const known = new Set(skills.map((s) => s.name));
  const out: string[] = [];
  for (const m of task.matchAll(/(?:^|\s)\/([a-z0-9][a-z0-9-]{0,49})(?=$|[\s.,:;!?)])/g)) {
    if (known.has(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** The index appended to every turn's system prompt. Empty when there are no skills. */
export function skillsIndex(skills: SkillLike[]): string {
  if (!skills.length) return "";
  const shown = skills.slice(0, INDEX_MAX_ENTRIES);
  const lines = shown.map((s) => {
    const d = s.description.replace(/\s+/g, " ").trim();
    const desc = d.length > INDEX_DESC_CHARS ? `${d.slice(0, INDEX_DESC_CHARS - 1)}…` : d;
    return `- ${s.name} — ${desc} (${skillMdPath(s.name)})`;
  });
  if (skills.length > shown.length) lines.push(`- …and ${skills.length - shown.length} more under ${SKILLS_DIR}/`);
  return (
    "Skills available (read the SKILL.md and follow it when the task matches its description; " +
    `mention which skill you used in your first message):\n${lines.join("\n")}`
  );
}

/**
 * The per-turn skill line and what it picked. Explicit `/name` always wins and is honoured on any
 * turn; auto-matching runs on the first turn only and never alongside an explicit pick.
 */
export function skillTurnHint(task: string, skills: SkillLike[], firstTurn: boolean): { hint: string; picks: SkillPick[] } {
  const explicit = explicitSkills(task, skills);
  if (explicit.length) {
    return {
      hint: explicit.map((n) => `The user asked you to run skill ${n}: read ${skillMdPath(n)} and follow it.`).join(" "),
      picks: explicit.map((name) => ({ name, how: "explicit" as const })),
    };
  }
  if (!firstTurn) return { hint: "", picks: [] };
  const auto = matchSkills(task, skills).map((m) => m.name);
  if (!auto.length) return { hint: "", picks: [] };
  return {
    hint: `Likely relevant skills for this task: ${auto.join(", ")} — read them before starting (${auto.map(skillMdPath).join(", ")}).`,
    picks: auto.map((name) => ({ name, how: "auto" as const })),
  };
}

/** Merge a new turn's picks into a run's record: explicit overrides auto for the same skill. */
export function mergePicks(prev: SkillPick[], next: SkillPick[]): SkillPick[] {
  const out = [...prev];
  for (const p of next) {
    const i = out.findIndex((o) => o.name === p.name);
    if (i < 0) out.push(p);
    else if (p.how === "explicit") out[i] = p;
  }
  return out;
}

/* Durable record of a box's picks (registered by the controller with a DB backend). */
const picksMem = new Map<string, SkillPick[]>();
let picksBackend: { get(box: string): SkillPick[] | undefined; set(box: string, picks: SkillPick[]): void } | null = null;
export function registerSkillPickBackend(b: typeof picksBackend): void {
  picksBackend = b;
}
export function recordSkillPicks(box: string, picks: SkillPick[]): void {
  if (!picks.length) return;
  const merged = mergePicks(skillPicksOf(box) ?? [], picks);
  picksMem.set(box, merged);
  try {
    picksBackend?.set(box, merged);
  } catch {
    /* the in-memory copy still covers this process */
  }
}
export function skillPicksOf(box: string): SkillPick[] | undefined {
  const m = picksMem.get(box);
  if (m) return m;
  try {
    const d = picksBackend?.get(box);
    if (d) picksMem.set(box, d);
    return d;
  } catch {
    return undefined;
  }
}
