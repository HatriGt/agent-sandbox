/**
 * The Autopilot grid's structured columns for one automation: what it does (Action), to what
 * (Target), where that lands (Into), the conditions it checks first (Only if) and the means
 * (How). The agent may give them in the schedule/automate marker (`target:` / `into:` / `if:` /
 * `how:`) and the editor edits them; anything missing is read out of the row's title, one-line
 * summary and task text, so a row from before the fields (or from an agent that skipped them)
 * still spreads across the columns instead of sitting as one paragraph.
 *
 * Derivation is deliberately plain: a verb list for the action, PR/issue numbers for the target,
 * "into/to <Branch>" for the landing branch, a phrase list for the guards and the merge flags or
 * the first backticked command for the means. Anything it cannot read stays empty; a wrong guess
 * would be worse than a dash.
 */

export interface TaskFacts {
  /** One verb, capitalised: Merge, Force-merge, Review, Check, Report. */
  action?: string;
  /** What it acts on: "PR #290", "PRs #282, #164, #2889", "each PR", "CI on main". */
  target?: string;
  /** The branch the work lands on: "Production", "main". */
  into?: string;
  /** Conditions checked first, " · " joined: "checks green · mergeable · not draft". */
  only?: string;
  /** The means, " · " joined: "admin override · merge commit", "gh run list". */
  how?: string;
}

export const FACT_KEYS = ["action", "target", "into", "only", "how"] as const;
export const FACT_MAX: Record<keyof TaskFacts, number> = { action: 24, target: 80, into: 60, only: 120, how: 80 };

const ONE_LINE = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The given (agent / editor) facts, cleaned: one line each, capped, empty ones dropped; undefined when nothing is left. */
export function normalizeFacts(v: unknown): TaskFacts | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const out: TaskFacts = {};
  for (const k of FACT_KEYS) {
    const s = ONE_LINE(o[k], FACT_MAX[k]);
    if (s) out[k] = k === "action" ? capVerb(s) : s;
  }
  return Object.keys(out).length ? out : undefined;
}

/* ───────────────────────────── action ───────────────────────────── */

// Base forms; the match also takes the third person ("Merges", "Fixes", "Summarises").
const VERBS = [
  "force-merge", "force merge", "merge", "review", "check", "report", "run", "re-run", "rerun", "fix", "deploy", "redeploy", "release", "roll back", "rollback", "revert", "rebase",
  "open", "close", "update", "upgrade", "bump", "sync", "send", "notify", "email", "post", "reply", "answer", "test", "build", "lint", "format", "publish", "ship",
  "delete", "remove", "prune", "clean", "clean up", "archive", "back up", "backup", "rotate", "renew", "restart", "stop", "start", "pause", "resume", "enable", "disable", "reset",
  "summarise", "summarize", "digest", "scan", "audit", "triage", "label", "tag", "comment", "approve", "request", "ask", "remind", "verify", "validate", "monitor", "watch", "poll",
  "create", "generate", "draft", "write", "refresh", "rebuild", "install", "migrate", "move", "copy", "rename", "export", "import", "collect", "compute", "calculate", "count", "list",
  "find", "search", "look", "investigate", "debug", "diagnose", "profile", "benchmark", "measure", "compare", "follow up", "cut", "promote", "cherry-pick", "backport", "retry", "confirm",
];
const VERB_RE = new RegExp(`^(?:${VERBS.map((v) => v.replace(/[-\s]/g, "[- ]")).join("|")})(?:e?s|d|ed)?\\b`, "i");

/** "merges" → "Merge", "force merge" → "Force-merge", "Summarises" → "Summarise". */
function capVerb(raw: string): string {
  const v = raw.trim().replace(/\s+/g, " ");
  const m = VERB_RE.exec(v);
  let base = v;
  if (m) {
    const hit = m[0].toLowerCase();
    base = VERBS.find((b) => hit.replace(/[- ]/g, " ") === b.replace(/[- ]/g, " ") || hit.replace(/[- ]/g, " ").replace(/e?s$|e?d$/, "") === b.replace(/[- ]/g, " ").replace(/e$/, "")) ?? hit;
  }
  base = base.replace(/^force /, "force-").replace(/^(roll) (back)$/, "$1 $2");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function actionOf(heads: string[]): string | undefined {
  for (const h of heads) {
    const m = VERB_RE.exec(h.trim());
    if (m) return capVerb(m[0]);
  }
  return undefined;
}

/* ───────────────────────────── target ───────────────────────────── */

const PREP_RE = /\s+(?:in|on|into|onto|to|with|at|after|once|by|via|from|for|using|under|against|across|over|when|if|and then|then|again|so)\b|[,;:.(]|\s+-\s+/i;

/** The words after the verb up to the first preposition, with a leading article dropped; at most four words. */
function objectOf(head: string): string | undefined {
  const m = VERB_RE.exec(head.trim());
  if (!m) return undefined;
  let rest = head.trim().slice(m[0].length).trim();
  const cut = PREP_RE.exec(rest);
  if (cut) rest = rest.slice(0, cut.index);
  rest = rest.replace(/^(?:the|a|an|its|their|this|that|every|each|all)\s+/i, "").trim();
  const words = rest.split(/\s+/).filter(Boolean);
  if (!words.length || words[0].length < 2) return undefined;
  return words.slice(0, 4).join(" ");
}

function targetOf(texts: string[], kind: string): string | undefined {
  const all = texts.join(" ");
  // Templated rows act on whatever fired them.
  if (/\{\{\s*pr\./.test(all)) return "each PR";
  if (/\{\{\s*issue\./.test(all)) return "each issue";
  if (/\{\{\s*(?:run|workflow)\./.test(all)) return "each run";
  for (const t of texts) {
    const prs = numbersOf(t, /(?:pull requests?|PRs?)\s*#?(\d+)|(?<=[\w.-]+\/[\w.-]+)#(\d+)|(?<!\w)#(\d+)/gi);
    if (prs.length) return listOf("PR", prs);
    const issues = numbersOf(t, /issues?\s*#?(\d+)/gi);
    if (issues.length) return listOf("issue", issues);
  }
  if (kind === "watch" || kind === "github") return undefined;
  for (const t of texts) {
    const o = objectOf(t);
    if (o) return o;
  }
  return undefined;
}

function numbersOf(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const n = m[1] ?? m[2] ?? m[3];
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

const listOf = (noun: string, ns: string[]) => (ns.length === 1 ? `${noun} #${ns[0]}` : ns.length <= 3 ? `${noun}s ${ns.map((n) => `#${n}`).join(", ")}` : `${ns.length} ${noun}s`);

/* ───────────────────────────── into ───────────────────────────── */

const LANDING_ACTIONS = /^(?:force-merge|merge|push|deploy|redeploy|promote|rebase|cherry-pick|backport|release|ship|revert|roll back)$/i;
const BRANCH_RE = /\b(?:into|onto|to)\s+(?:its\s+)?(?:the\s+)?(?:base\s+)?(?:branch\s+)?(?:`([\w./-]+)`|([A-Z][\w.-]*|main|master|develop|dev|staging|prod|production|release)\b)(?:\s+branch)?|--base[= ]+(\S+)/g;
const NOT_BRANCH = new Set(["GitHub", "Slack", "QA", "Dubai", "UTC", "CI", "PR", "PRs", "Jira", "Production.", "The"]);

function intoOf(texts: string[], action: string | undefined): string | undefined {
  if (!action || !LANDING_ACTIONS.test(action)) return undefined;
  for (const t of texts) {
    for (const m of t.matchAll(BRANCH_RE)) {
      const b = m[1] ?? m[2] ?? m[3];
      if (b && !NOT_BRANCH.has(b)) return b;
    }
  }
  return undefined;
}

/* ───────────────────────────── only if ───────────────────────────── */

const GUARDS: [string, RegExp][] = [
  ["checks green", /\b(?:checks?|CI|tests?|builds?|pipelines?)\b[^.;]{0,30}\b(?:green|pass(?:es|ing)?|succeed\w*)\b|\bgreen on each\b|\ball checks pass/i],
  ["still open", /\bstill open\b|\bis (?:still )?open\b/i],
  ["mergeable", /\bmergeable\b/i],
  ["not draft", /\bnot (?:a )?draft\b/i],
  ["no conflicts", /\bconflicts?\b/i],
  ["approved", /\b(?:has been|is|once|after)\s+approved\b|\bhas (?:an )?approv/i],
  ["pre-authorised", /\b(?:explicitly )?authori[sz]ed\b|\bnot (?:to )?ask again\b|\bwithout asking\b|\bdo not ask\b/i],
];

function onlyOf(texts: string[]): string | undefined {
  const all = texts.join(" ");
  const hits = GUARDS.filter(([, re]) => re.test(all)).map(([label]) => label);
  return hits.length ? hits.join(" · ") : undefined;
}

/* ───────────────────────────── how ───────────────────────────── */

const MEANS: [string, RegExp][] = [
  ["admin override", /--admin\b|\badmin override\b|\bbypass(?:es|ing)? (?:the )?branch protection\b/i],
  ["merge commit", /--merge\b|\bmerge commit\b/i],
  ["squash", /--squash\b|\bsquash(?:ed|es)?\b/i],
  ["rebase merge", /--rebase\b/i],
  ["delete branch", /--delete-branch\b|\bdelete the branch\b/i],
  ["keep branch", /\bkeep(?:s|ing)? the branch\b/i],
];
const CMD_RE = /`((?:gh|git|npm|npx|pnpm|yarn|cf|kubectl|docker|cds|mbt|curl|date|node|python|make|cargo|go|aws|az|gcloud|terraform|helm|psql|sqlite3|bash|sh|ssh)\b[^`\n]{0,120})`/;

function howOf(texts: string[]): string | undefined {
  const all = texts.join(" ");
  const hits = MEANS.filter(([, re]) => re.test(all)).map(([label]) => label);
  if (hits.length) return hits.join(" · ");
  const cmd = CMD_RE.exec(all);
  if (!cmd) return undefined;
  const words = cmd[1].trim().split(/\s+/);
  // Keep the verb-ish head of the command: "gh pr merge", "date -u", "gh run list".
  const keep = words.slice(0, words[0] === "gh" || words[0] === "git" || words[0] === "cf" || words[0] === "kubectl" ? 3 : 2).filter((w) => !/^(?:\d|-?-?[a-z-]+=|<|\$|\{)/.test(w) || w.startsWith("-"));
  return keep.join(" ").slice(0, FACT_MAX.how);
}

/* ───────────────────────────── derive + merge ───────────────────────────── */

export interface FactSource {
  name: string;
  taskTemplate: string;
  summary?: string;
  kind: string;
}

/** The facts read out of the row's text. A clean row title ("Deal Reviewer") yields the task's verb. */
export function deriveFacts(t: FactSource): TaskFacts {
  const task = t.taskTemplate.replace(/\s+/g, " ").trim();
  const firstSentence = task.split(/(?<=[.!?])\s+(?=[A-Z`])/)[0] ?? task;
  // The title first: the agent picked its verb on purpose; the summary and the task fill in for a title with none ("Deal Reviewer").
  const heads = [t.name, t.summary ?? "", firstSentence].filter(Boolean);
  const texts = [t.summary ?? "", t.name, task].filter(Boolean);
  const action = actionOf(heads);
  const out: TaskFacts = {};
  if (action) out.action = action;
  const target = targetOf([...heads, task], t.kind);
  if (target) out.target = target.slice(0, FACT_MAX.target);
  const into = intoOf(texts, action);
  if (into) out.into = into.slice(0, FACT_MAX.into);
  const only = onlyOf(texts);
  if (only) out.only = only.slice(0, FACT_MAX.only);
  const how = howOf(texts);
  if (how) out.how = how;
  return out;
}

/** What the grid shows: the given facts win field by field; the derived ones fill the rest. */
export function briefOf(t: FactSource & { facts?: TaskFacts }): TaskFacts {
  const d = deriveFacts(t);
  const g = t.facts ?? {};
  const out: TaskFacts = {};
  for (const k of FACT_KEYS) {
    const v = g[k] ?? d[k];
    if (v) out[k] = v;
  }
  return out;
}
