/**
 * "Tries several approaches": one task, 2..3 attempts, one PR.
 *
 * An attempt group EXTENDS the two-harness compare (src/harness-runs.ts): it is a harness_compares
 * row with kind='attempts', and every attempt is an ordinary delegation linked through run_harness
 * (compare_id = group id, side = "1".."3"). So the compare view, the archive and the per-box links
 * are shared; what is new here is the controller's part:
 *
 *  - each attempt runs on its own branch (asb/try-<group>-<n>) and is told NOT to push or open a PR;
 *  - when every attempt has finished (or the group's deadline passes) the controller SCORES them:
 *    verify/test pass first, then fewer failing tests, smaller diff, lower cost;
 *  - a tie is not guessed: the group asks the user a question in the answer-choice format
 *    (src/answer-choice.ts `Options:` block) and waits for a pick;
 *  - the winner's branch is pushed and gets the PR; losers are torn down after an override window
 *    (so "pick this one instead" still has a box to push from); every attempt's archived outcome is
 *    kept in history and linked to its siblings through the group.
 *
 * Budgets are a TOTAL across attempts: the $ and token caps are split evenly (minutes are
 * wall-clock, so each attempt keeps the full figure). Fleet quotas are checked for ALL attempts up
 * front — a group that cannot get every slot is refused, never half-started on purpose.
 *
 * Pure parts (spec normalization, defaults, scoring, question text) are exported for tests; the
 * orchestrator takes its IO injected, like delegate-flow.ts.
 */
import crypto from "node:crypto";
import type { Db } from "./db.js";
import type { RunBudget } from "./budget.js";
import { questionChoices, type Choice } from "./answer-choice.js";

export const MIN_ATTEMPTS = 2;
export const MAX_ATTEMPTS = 3;
/** Without a budget, a group waits this long for its slowest attempt before scoring what finished. */
export const DEFAULT_DEADLINE_MIN = 120;
/** Grace after a decision during which a loser's box is kept so the user can override the pick. */
export const OVERRIDE_WINDOW_MS = Number(process.env.ATTEMPT_OVERRIDE_WINDOW_MIN || 30) * 60_000;

export interface AttemptSpec {
  agent?: string;
  model?: string;
  /** A saved provider id (src/providers.ts). */
  provider?: string;
  /** A saved harness id (src/harness.ts). */
  harness?: string;
}

export type GroupStatus = "running" | "deciding" | "needs-pick" | "decided" | "no-winner" | "failed";

export interface AttemptLink {
  index: number;
  box: string | null;
  spec: AttemptSpec;
  label: string;
  branch: string;
  /** Why this attempt did not start (launch refusal), if it didn't. */
  error?: string;
  tornDown?: boolean;
}

export interface AttemptGroup {
  id: string;
  owner: string;
  task: string;
  createdAt: number;
  deadlineAt: number;
  status: GroupStatus;
  attempts: AttemptLink[];
  winnerBox: string | null;
  decidedBy: "auto" | "user" | null;
  decidedAt: number | null;
  question: string | null;
  prUrls: string[];
  note: string | null;
}

/* ───────────────────────────── validation + defaults ───────────────────────────── */

const ID_RE = /^[\w.:\/@-]{1,120}$/;

/** Validate `attempts` (+ optional per-attempt specs). 1 / undefined = an ordinary delegation. */
export function normalizeAttempts(
  count: unknown,
  specs: unknown
): { ok: true; n: number; specs: AttemptSpec[] | undefined } | { ok: false; error: string } {
  if (count === undefined || count === null || count === "" || count === 1 || count === "1") return { ok: true, n: 1, specs: undefined };
  const n = Number(count);
  if (!Number.isInteger(n) || n < MIN_ATTEMPTS || n > MAX_ATTEMPTS) return { ok: false, error: `attempts must be 1, 2 or 3.` };
  if (specs === undefined || specs === null) return { ok: true, n, specs: undefined };
  if (!Array.isArray(specs) || specs.length !== n) return { ok: false, error: `attemptSpecs must list exactly ${n} attempts (or be omitted for the defaults).` };
  const out: AttemptSpec[] = [];
  for (const [i, raw] of specs.entries()) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const spec: AttemptSpec = {};
    for (const k of ["agent", "model", "provider", "harness"] as const) {
      const v = s[k];
      if (v === undefined || v === null || v === "") continue;
      if (typeof v !== "string" || !ID_RE.test(v.trim())) return { ok: false, error: `attemptSpecs[${i}].${k} is not a valid id.` };
      spec[k] = v.trim();
    }
    out.push(spec);
  }
  return { ok: true, n, specs: out };
}

export interface DefaultsContext {
  /** The driver the caller would get anyway (explicit pick or stored default). */
  baseAgent: string;
  /** An explicit model the caller already chose for the base attempt. */
  baseModel?: string;
  baseProvider?: string;
  /** Controller catalog model ids (Claude Code models). */
  catalog: string[];
  /** The caller's saved providers: which drivers each can feed, and its models. */
  providers: Array<{ id: string; drivers: string[]; models: string[] }>;
}

const specKey = (s: AttemptSpec) => `${s.agent ?? ""}|${s.provider ?? ""}|${s.model ?? ""}`;

/**
 * The default attempt line-up: same harness (driver) first with different models, then other
 * drivers the user has providers for. When there are not enough distinct setups the base repeats —
 * two samples of the same setup are still two independent tries.
 */
export function defaultAttemptSpecs(n: number, ctx: DefaultsContext): AttemptSpec[] {
  const base: AttemptSpec = { agent: ctx.baseAgent, ...(ctx.baseProvider ? { provider: ctx.baseProvider } : {}), ...(ctx.baseModel ? { model: ctx.baseModel } : {}) };
  const cands: AttemptSpec[] = [base];
  // Same driver, other models: the controller catalog feeds Claude Code; providers feed their drivers.
  if (ctx.baseAgent === "claude" && !ctx.baseProvider) for (const m of ctx.catalog) cands.push({ agent: "claude", model: m });
  for (const p of ctx.providers) if (p.drivers.includes(ctx.baseAgent)) for (const m of p.models) cands.push({ agent: ctx.baseAgent, provider: p.id, model: m });
  // Other drivers the user has providers for.
  for (const p of ctx.providers) for (const d of p.drivers) if (d !== ctx.baseAgent) for (const m of p.models.slice(0, 2)) cands.push({ agent: d, provider: p.id, model: m });
  const seen = new Set<string>();
  const out: AttemptSpec[] = [];
  for (const c of cands) {
    // A catalog entry equal to the base's default model is the base again.
    const k = specKey(c);
    if (seen.has(k) || (c !== base && !c.provider && !base.provider && c.agent === base.agent && c.model === base.model)) continue;
    seen.add(k);
    out.push(c);
    if (out.length === n) return out;
  }
  while (out.length < n) out.push({ ...base });
  return out;
}

/** A total budget split across n attempts: $ and tokens divide, minutes are wall-clock and stay. */
export function splitBudget(b: RunBudget | undefined, n: number): RunBudget | undefined {
  if (!b) return undefined;
  return {
    maxMinutes: b.maxMinutes,
    ...(b.maxUsd ? { maxUsd: Math.round((b.maxUsd / n) * 10_000) / 10_000 } : {}),
    ...(b.maxTokens ? { maxTokens: Math.max(1, Math.floor(b.maxTokens / n)) } : {}),
  };
}

export function branchFor(groupId: string, index: number): string {
  return `asb/try-${groupId.replace(/^att_/, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toLowerCase()}-${index}`;
}

/** Appended to each attempt's task: its branch, and why it must not push or open a PR. */
export function attemptBrief(index: number, n: number, branch: string): string {
  return (
    `\n\n---\nThis is attempt ${index} of ${n} at the same task: other attempts run in parallel in their own sandboxes and the ` +
    `controller keeps the best one. In every repository you change, work on a new git branch named \`${branch}\` ` +
    `(git checkout -b ${branch}) and commit your work there. Do NOT push and do NOT open a pull request — the ` +
    `controller pushes the winning attempt's branch and opens the PR itself.`
  );
}

export function specLabel(s: AttemptSpec, names: { agent?: (id: string) => string; provider?: (id: string) => string; harness?: (id: string) => string } = {}): string {
  const parts = [
    s.harness ? (names.harness?.(s.harness) ?? s.harness) : null,
    s.agent ? (names.agent?.(s.agent) ?? s.agent) : null,
    s.model ?? null,
    s.provider ? `via ${names.provider?.(s.provider) ?? s.provider}` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "default";
}

/* ───────────────────────────── scoring ───────────────────────────── */

export interface AttemptFacts {
  index: number;
  box: string | null;
  /** done = finished (any exit code); running = not finished; gone = never finished / vanished. */
  state: "done" | "failed" | "running" | "gone" | "timeout" | "not-started";
  exitCode: number | null;
  verified: boolean | null;
  tests: { passed: number; failed: number } | null;
  /** additions + deletions; null = unknown. */
  diffLines: number | null;
  files: number | null;
  costUsd: number | null;
  tokens: number | null;
  durationMs: number | null;
}

/**
 * Sort key, lower is better. Tiers: a finished clean run that changed something beats everything
 * else; within that, a verified/green-tested run beats an unchecked one beats a failing one; then
 * fewer failing tests, smaller diff, lower cost ($ when both are priced, else tokens).
 */
export function scoreKey(f: AttemptFacts, costBy: "usd" | "tokens"): number[] {
  const finishedClean = f.state === "done" && (f.exitCode ?? 0) === 0;
  const changed = f.diffLines === null || f.diffLines > 0;
  const viable = finishedClean && changed ? 0 : 1;
  const red = f.verified === false || (f.tests !== null && f.tests.failed > 0);
  const green = f.verified === true || (f.verified === null && f.tests !== null && f.tests.failed === 0 && f.tests.passed > 0);
  const pass = red ? 2 : green ? 0 : 1;
  const failing = f.tests?.failed ?? 0;
  const diff = f.diffLines ?? Number.MAX_SAFE_INTEGER;
  const cost = (costBy === "usd" ? f.costUsd : f.tokens) ?? Number.MAX_SAFE_INTEGER;
  return [viable, pass, failing, diff, cost];
}

const cmpKey = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

export type Decision =
  | { kind: "winner"; winner: AttemptFacts; ranked: AttemptFacts[]; reason: string }
  | { kind: "tie"; tied: AttemptFacts[]; ranked: AttemptFacts[]; reason: string }
  | { kind: "none"; ranked: AttemptFacts[]; reason: string };

export function decide(all: AttemptFacts[]): Decision {
  const costBy = all.filter((f) => f.box).every((f) => f.costUsd !== null) ? "usd" : "tokens";
  const ranked = [...all].sort((a, b) => cmpKey(scoreKey(a, costBy), scoreKey(b, costBy)) || a.index - b.index);
  const viable = ranked.filter((f) => f.box && scoreKey(f, costBy)[0] === 0);
  if (!viable.length) return { kind: "none", ranked, reason: "No attempt finished cleanly with changes." };
  const top = scoreKey(viable[0], costBy);
  const tied = viable.filter((f) => cmpKey(scoreKey(f, costBy), top) === 0);
  if (tied.length > 1) return { kind: "tie", tied, ranked, reason: `Attempts ${tied.map((t) => t.index).join(" and ")} tie on tests, diff size and cost.` };
  const w = viable[0];
  const second = viable[1];
  const why = !second ? "the only attempt that finished cleanly with changes" : whyBetter(scoreKey(w, costBy), scoreKey(second, costBy), costBy);
  return { kind: "winner", winner: w, ranked, reason: `Attempt ${w.index} won: ${why}.` };
}

function whyBetter(a: number[], b: number[], costBy: "usd" | "tokens"): string {
  const i = a.findIndex((v, k) => v !== b[k]);
  return ["it finished cleanly with changes", "its checks passed", "fewer failing tests", "smaller diff", costBy === "usd" ? "lower cost" : "fewer tokens"][i] ?? "best score";
}

/** The tie question, in the answer-choice `Options:` format (label | detail). */
export function tieQuestion(tied: AttemptFacts[], labels: Record<number, string>): string {
  const detail = (f: AttemptFacts) =>
    [labels[f.index], f.files !== null ? `${f.files} files` : null, f.diffLines !== null ? `${f.diffLines} lines` : null, f.tests ? `${f.tests.passed} passed / ${f.tests.failed} failed` : null]
      .filter(Boolean)
      .join(", ");
  return (
    `Attempts ${tied.map((t) => t.index).join(" and ")} scored the same (tests, diff size and cost). Which one should get the pull request?\n` +
    `Options:\n` +
    tied.map((f) => `- Attempt ${f.index} | ${detail(f)}`).join("\n")
  );
}

/** The choices of a group's tie question, mapped back to attempt indexes. */
export function tieChoices(question: string | null): Array<Choice & { index: number }> {
  return questionChoices(question ?? "").flatMap((c) => {
    const m = /^Attempt (\d)\b/.exec(c.label);
    return m ? [{ ...c, index: Number(m[1]) }] : [];
  });
}

/** Facts from an archived digest (its outcome card when present). */
export function factsFromDigest(index: number, box: string, d: Record<string, unknown> | undefined, fallback: AttemptFacts["state"]): AttemptFacts {
  const empty: AttemptFacts = { index, box, state: fallback, exitCode: null, verified: null, tests: null, diffLines: null, files: null, costUsd: null, tokens: null, durationMs: null };
  if (!d) return empty;
  const o = d.outcome as
    | {
        state?: string;
        result?: { diff?: { files: number; additions: number; deletions: number } | null };
        trust?: { tests?: { passed: number; failed: number } | null; exitCode?: number | null; verified?: { pass: boolean } | null };
        cost?: { durationMs?: number | null; tokens?: { input: number; output: number } | null; usd?: number | null };
      }
    | undefined;
  const dv = d.verified as { pass?: boolean } | undefined;
  const usage = d.usage as { inputTokens?: number; outputTokens?: number } | undefined;
  const files = Array.isArray(d.files) ? (d.files as unknown[]).length : null;
  const diff = o?.result?.diff ?? null;
  const tokens = o?.cost?.tokens ? o.cost.tokens.input + o.cost.tokens.output : usage ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) : null;
  const exitCode = o?.trust?.exitCode ?? (typeof d.exitCode === "number" ? d.exitCode : null);
  const state = String(o?.state ?? d.state ?? "");
  return {
    index,
    box,
    state: state === "failed" || (exitCode !== null && exitCode !== 0) ? "failed" : "done",
    exitCode,
    verified: o?.trust?.verified ? o.trust.verified.pass : typeof dv?.pass === "boolean" ? dv.pass : null,
    tests: o?.trust?.tests ? { passed: o.trust.tests.passed, failed: o.trust.tests.failed } : null,
    diffLines: diff ? diff.additions + diff.deletions : null,
    files: diff ? diff.files : files,
    costUsd: typeof o?.cost?.usd === "number" ? o.cost.usd : null,
    tokens,
    durationMs: o?.cost?.durationMs ?? null,
  };
}

/** Pull request URLs out of `gh pr create` output. */
export function prUrlsOf(out: string): string[] {
  return [...new Set([...out.matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g)].map((m) => m[0]))];
}

/**
 * The in-box script that turns the winner's work into a PR, per repository under /workspace: put
 * the work on the attempt branch (committing anything left uncommitted), push that branch, open
 * the PR. A repo with nothing ahead of its default branch is skipped. Output is echoed for the log.
 */
export function openPrScript(branch: string, title: string, body: string): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return [
    `BR=${q(branch)}; TITLE=${q(title)}; BODY=${q(body)}`,
    `for d in /workspace/*/; do`,
    `  [ -d "$d/.git" ] || continue; cd "$d" || continue`,
    `  cur=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)`,
    `  if [ "$cur" != "$BR" ]; then git rev-parse -q --verify "refs/heads/$BR" >/dev/null && git checkout -q "$BR" 2>&1 || git checkout -q -b "$BR" 2>&1; fi`,
    `  git add -A && { git diff --cached --quiet || git commit -q -m "$TITLE" 2>&1; }`,
    `  base=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null); base=\${base:-origin/main}`,
    `  [ -n "$(git rev-list "$base..HEAD" 2>/dev/null | head -n 1)" ] || { echo "@@SKIP $d nothing ahead of $base"; continue; }`,
    `  git push -q -u origin "HEAD:refs/heads/$BR" 2>&1 | tail -n 3`,
    `  gh pr create --head "$BR" --title "$TITLE" --body "$BODY" 2>&1 | tail -n 2`,
    `done`,
  ].join("\n");
}

/* ───────────────────────────── store (harness_compares, kind='attempts') ───────────────────────────── */

interface Stored {
  attempts: AttemptLink[];
  prUrls: string[];
}

export function createGroup(db: Db, owner: string, g: { task: string; deadlineAt: number; attempts: AttemptLink[] }, now = Date.now()): string {
  const id = "att_" + crypto.randomBytes(8).toString("base64url");
  db.prepare(
    `INSERT INTO harness_compares (id, owner, task, harness_a, harness_b, created_at, kind, status, attempts_json, deadline_at) VALUES (?, ?, ?, '', '', ?, 'attempts', 'running', ?, ?)`
  ).run(id, owner, g.task.slice(0, 20_000), now, JSON.stringify({ attempts: g.attempts, prUrls: [] } satisfies Stored), g.deadlineAt);
  return id;
}

function rowToGroup(r: Record<string, unknown>): AttemptGroup {
  let s: Stored = { attempts: [], prUrls: [] };
  try {
    s = { ...s, ...(JSON.parse(String(r.attempts_json ?? "{}")) as Stored) };
  } catch {
    /* a corrupt row shows as empty rather than failing the list */
  }
  return {
    id: String(r.id),
    owner: String(r.owner),
    task: String(r.task),
    createdAt: Number(r.created_at),
    deadlineAt: Number(r.deadline_at ?? 0),
    status: (r.status as GroupStatus) ?? "running",
    attempts: s.attempts,
    winnerBox: (r.winner_box as string | null) ?? null,
    decidedBy: (r.decided_by as "auto" | "user" | null) ?? null,
    decidedAt: r.decided_at == null ? null : Number(r.decided_at),
    question: (r.question as string | null) ?? null,
    prUrls: s.prUrls ?? [],
    note: (r.note as string | null) ?? null,
  };
}

export function getGroup(db: Db, owner: string, id: string): AttemptGroup | undefined {
  const r = db.prepare(`SELECT * FROM harness_compares WHERE id = ? AND owner = ? AND kind = 'attempts'`).get(id, owner) as Record<string, unknown> | undefined;
  return r ? rowToGroup(r) : undefined;
}

export function listGroups(db: Db, owner: string, limit = 20): AttemptGroup[] {
  return (db.prepare(`SELECT * FROM harness_compares WHERE owner = ? AND kind = 'attempts' ORDER BY created_at DESC LIMIT ?`).all(owner, Math.min(limit, 100)) as Array<Record<string, unknown>>).map(rowToGroup);
}

/** Groups the controller still has work on (scoring, or tearing down losers after the window). */
export function openGroups(db: Db): AttemptGroup[] {
  return (
    db.prepare(`SELECT * FROM harness_compares WHERE kind = 'attempts' AND status IN ('running','deciding','decided','no-winner') ORDER BY created_at DESC LIMIT 500`).all() as Array<Record<string, unknown>>
  )
    .map(rowToGroup)
    .filter((g) => g.status === "running" || g.status === "deciding" || g.attempts.some((a) => a.box && !a.tornDown && a.box !== g.winnerBox));
}

/** The group (and this box's index in it) a box belongs to — the sibling link history shows. */
export function groupOfBox(db: Db, owner: string, box: string): { group: AttemptGroup; index: number } | undefined {
  const r = db.prepare(`SELECT compare_id, side FROM run_harness WHERE box = ?`).get(box) as { compare_id: string | null; side: string | null } | undefined;
  if (!r?.compare_id?.startsWith("att_")) return undefined;
  const g = getGroup(db, owner, r.compare_id);
  return g ? { group: g, index: Number(r.side) } : undefined;
}

/** Atomic status transition; false when another path moved it first. */
export function transition(db: Db, id: string, from: GroupStatus[], to: GroupStatus, set: { winnerBox?: string | null; decidedBy?: "auto" | "user" | null; question?: string | null; note?: string | null; decidedAt?: number | null } = {}): boolean {
  const cols = ["status = ?"];
  const vals: unknown[] = [to];
  const add = (c: string, v: unknown) => {
    cols.push(`${c} = ?`);
    vals.push(v);
  };
  if ("winnerBox" in set) add("winner_box", set.winnerBox);
  if ("decidedBy" in set) add("decided_by", set.decidedBy);
  if ("question" in set) add("question", set.question);
  if ("note" in set) add("note", set.note);
  if ("decidedAt" in set) add("decided_at", set.decidedAt);
  return db.prepare(`UPDATE harness_compares SET ${cols.join(", ")} WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`).run(...vals, id, ...from).changes === 1;
}

export function saveLinks(db: Db, id: string, g: Pick<AttemptGroup, "attempts" | "prUrls">): void {
  db.prepare(`UPDATE harness_compares SET attempts_json = ? WHERE id = ?`).run(JSON.stringify({ attempts: g.attempts, prUrls: g.prUrls } satisfies Stored), id);
}

/* ───────────────────────────── orchestrator ───────────────────────────── */

export interface AttemptIo {
  db: Db;
  now?: () => number;
  /** Start ONE attempt as an ordinary delegation (the caller's validated path). */
  startOne(spec: AttemptSpec, task: string, budget: RunBudget | undefined, link: { groupId: string; index: number }): Promise<{ ok: true; box: string } | { ok: false; question: string }>;
  /** Archived digest for a box, if its finish was recorded. */
  archived(owner: string, box: string): Record<string, unknown> | undefined;
  /** Is the box still in the fleet? */
  exists(box: string): Promise<boolean>;
  /** Run a shell script in a box; stdout. */
  exec(box: string, script: string): Promise<string>;
  teardown(box: string): Promise<void>;
  log?(m: string): void;
}

export interface LaunchInput {
  owner: string;
  task: string;
  specs: AttemptSpec[];
  labels: string[];
  budget?: RunBudget;
  /** Called with the group id before any attempt starts (the caller keys its launch context by it). */
  onCreated?: (id: string) => void;
}

export function makeAttempts(io: AttemptIo) {
  const now = io.now ?? Date.now;
  const log = io.log ?? (() => {});
  const busy = new Set<string>();

  async function launch(inp: LaunchInput): Promise<{ ok: true; group: AttemptGroup } | { ok: false; question: string }> {
    const n = inp.specs.length;
    const each = splitBudget(inp.budget, n);
    const deadlineAt = now() + ((inp.budget?.maxMinutes ?? DEFAULT_DEADLINE_MIN) + 10) * 60_000;
    const placeholder = inp.specs.map((spec, i) => ({ index: i + 1, box: null, spec, label: inp.labels[i] ?? specLabel(spec), branch: "" }));
    const id = createGroup(io.db, inp.owner, { task: inp.task, deadlineAt, attempts: placeholder });
    inp.onCreated?.(id);
    const attempts: AttemptLink[] = placeholder.map((a) => ({ ...a, branch: branchFor(id, a.index) }));
    const started = await Promise.allSettled(attempts.map((a) => io.startOne(a.spec, inp.task + attemptBrief(a.index, n, a.branch), each, { groupId: id, index: a.index })));
    started.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value.ok) attempts[i].box = r.value.box;
      else attempts[i].error = r.status === "rejected" ? String((r.reason as Error)?.message ?? r.reason).slice(0, 400) : (r.value as { question: string }).question.slice(0, 400);
    });
    saveLinks(io.db, id, { attempts, prUrls: [] });
    if (!attempts.some((a) => a.box)) {
      transition(io.db, id, ["running"], "failed", { note: attempts[0]?.error ?? "No attempt started." });
      return { ok: false, question: `No attempt started: ${attempts.map((a) => a.error).filter(Boolean)[0] ?? "unknown error"}` };
    }
    return { ok: true, group: getGroup(io.db, inp.owner, id)! };
  }

  async function factsOf(g: AttemptGroup, final: boolean): Promise<AttemptFacts[]> {
    return Promise.all(
      g.attempts.map(async (a) => {
        if (!a.box) return factsFromDigest(a.index, "", undefined, "not-started");
        const d = io.archived(g.owner, a.box);
        if (d) return factsFromDigest(a.index, a.box, d, "done");
        const alive = await io.exists(a.box).catch(() => true);
        return factsFromDigest(a.index, a.box, undefined, !alive ? "gone" : final ? "timeout" : "running");
      })
    );
  }

  /** Push the winner's branch and open its PR; returns the URLs (or throws with the box output). */
  async function openPr(g: AttemptGroup, a: AttemptLink): Promise<string[]> {
    const title = `${g.task.split("\n")[0].trim().slice(0, 90) || "Agent change"}`;
    const body = `Opened by Agent Sandbox: attempt ${a.index} of ${g.attempts.length} (${a.label}) was picked for this task.`;
    const out = await io.exec(a.box!, openPrScript(a.branch, title, body));
    const urls = prUrlsOf(out);
    if (!urls.length) throw new Error(out.trim().slice(-400) || "no pull request was opened");
    return urls;
  }

  async function award(g: AttemptGroup, box: string, by: "auto" | "user", reason: string): Promise<AttemptGroup> {
    const a = g.attempts.find((x) => x.box === box)!;
    let prUrls: string[] = [];
    let note = reason;
    try {
      prUrls = await openPr(g, a);
    } catch (e) {
      note = `${reason} Could not open the PR: ${(e as Error).message.slice(0, 300)}`;
    }
    transition(io.db, g.id, ["deciding", "needs-pick", "decided", "no-winner"], "decided", { winnerBox: box, decidedBy: by, question: null, note, decidedAt: now() });
    saveLinks(io.db, g.id, { attempts: g.attempts, prUrls });
    return getGroup(io.db, g.owner, g.id)!;
  }

  /** Score a group whose attempts are all finished (or whose deadline passed). */
  async function evaluate(g: AttemptGroup): Promise<void> {
    if (g.status !== "running" || busy.has(g.id)) return;
    const final = now() >= g.deadlineAt;
    const facts = await factsOf(g, final);
    if (!final && facts.some((f) => f.state === "running")) return;
    if (!transition(io.db, g.id, ["running"], "deciding")) return;
    busy.add(g.id);
    try {
      const d = decide(facts);
      if (d.kind === "winner") await award(g, d.winner.box!, "auto", d.reason);
      else if (d.kind === "tie") {
        const labels = Object.fromEntries(g.attempts.map((a) => [a.index, a.label]));
        transition(io.db, g.id, ["deciding"], "needs-pick", { question: tieQuestion(d.tied, labels), note: d.reason });
      } else transition(io.db, g.id, ["deciding"], "no-winner", { note: d.reason, decidedAt: now() });
      // Attempts still running at the deadline lost by default: stop them now, they hold slots.
      for (const f of facts) if (f.state === "timeout" && f.box) await tearDown(g.id, g.owner, f.box);
    } catch (e) {
      log(`[attempts] ${g.id}: ${(e as Error).message.slice(0, 200)}`);
      transition(io.db, g.id, ["deciding"], "running");
    } finally {
      busy.delete(g.id);
    }
  }

  async function tearDown(id: string, owner: string, box: string): Promise<void> {
    await io.teardown(box).catch((e) => log(`[attempts] teardown ${box}: ${(e as Error).message.slice(0, 200)}`));
    const g = getGroup(io.db, owner, id);
    if (!g) return;
    for (const a of g.attempts) if (a.box === box) a.tornDown = true;
    saveLinks(io.db, id, g);
  }

  /**
   * One pass over open groups (called from the fleet sweep and after each archive): score groups
   * whose attempts all finished, and tear down losers once the override window has passed.
   */
  async function sweep(): Promise<void> {
    for (const g of openGroups(io.db)) {
      if (g.status === "running") await evaluate(g);
      else if ((g.status === "decided" || g.status === "no-winner") && g.decidedAt !== null && now() - g.decidedAt >= OVERRIDE_WINDOW_MS && !busy.has(g.id)) {
        for (const a of g.attempts) if (a.box && !a.tornDown && a.box !== g.winnerBox) await tearDown(g.id, g.owner, a.box);
      }
    }
  }

  /**
   * The user's pick: the tie answer, or "Pick this one instead" on a decided group. An override
   * closes the previous winner's PR (best-effort) and opens one from the new pick.
   */
  async function pick(owner: string, id: string, box: string): Promise<{ ok: true; group: AttemptGroup } | { ok: false; status: number; error: string }> {
    const g = getGroup(io.db, owner, id);
    if (!g) return { ok: false, status: 404, error: "No such attempt group." };
    const a = g.attempts.find((x) => x.box === box);
    if (!a) return { ok: false, status: 400, error: "That run is not an attempt of this group." };
    if (g.status === "running" || g.status === "deciding" || busy.has(id)) return { ok: false, status: 409, error: "The attempts are still being scored." };
    if (g.status === "failed") return { ok: false, status: 409, error: "No attempt of this group started." };
    if (g.winnerBox === box) return { ok: true, group: g };
    if (a.tornDown) return { ok: false, status: 410, error: "That attempt's sandbox was already torn down, so its branch cannot be pushed any more. Its record stays in history." };
    if (!io.archived(owner, box)) return { ok: false, status: 409, error: "That attempt did not finish, so there is nothing to open a PR from." };
    busy.add(id);
    try {
      if (g.winnerBox && g.prUrls.length) {
        const prev = g.winnerBox;
        const close = g.prUrls.map((u) => `gh pr close '${u}' --comment 'Superseded: attempt ${a.index} was picked instead.' 2>&1 | tail -n 1`).join("\n");
        await io.exec(prev, close).catch((e) => log(`[attempts] close PR on ${prev}: ${(e as Error).message.slice(0, 200)}`));
      }
      const updated = await award(g, box, "user", `Attempt ${a.index} picked by you.`);
      return { ok: true, group: updated };
    } finally {
      busy.delete(id);
    }
  }

  return { launch, evaluate, sweep, pick, factsOf };
}
