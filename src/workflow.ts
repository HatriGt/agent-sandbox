/**
 * Workflows — a task as a SHORT SCRIPT of steps instead of one prompt. PURE: no I/O, no clock reads
 * except through arguments, so every rule here is unit-tested (test/workflow.test.ts).
 *
 *   name: ship-feature
 *   steps:
 *     - prompt: |
 *         Implement {{task}}. Write tests alongside.
 *     - command: npm test
 *       retry: 2
 *     - prompt: Review the diff adversarially and fix anything you would reject in code review.
 *       skill: code-review
 *     - command: npm run lint
 *
 * Two kinds of step, told apart by shape (a step with `prompt` is an AGENT step; one with `command`
 * is a CHECK; a step with both or neither is refused):
 *
 *   agent  — one more turn of the SAME agent in the SAME box, delivered through the ordinary resume
 *            lane, so the transcript shows every step as a message and the operator can still answer
 *            a question or steer in between. `{{task}}` is the text the operator typed. `skill` names
 *            a saved playbook the agent is told to use (src/skill-store.ts).
 *   check  — a shell command run in the box after the previous agent turn finishes (the verify
 *            command lane, src/verify.ts). Exit 0 advances; a failure is handed BACK to the agent with
 *            the output tail, up to `retry` more times, then the workflow fails honestly.
 *
 * The first agent step IS the delegate task (rendered with {{task}}); everything after it rides the
 * finish edge of the fleet sweep (src/workflow-engine.ts). Nothing here opens boxes or merges: the
 * workflow ends on the same `done` the operator reviews today, with the verify/PR path unchanged.
 *
 * Why a workflow and not a harness: a harness (src/harness.ts) is SETTINGS for one run — driver,
 * model, rules, verify command. A workflow is the SEQUENCE. They compose: a run may name both.
 */
import { randomUUID } from "node:crypto";
import type { VerifyResult } from "./verify.js";
import { loadBlob, ownerKey, saveBlob } from "./user-store.js";

export const WORKFLOWS_KIND = "workflows";
export const WORKFLOW_FILE_DIR = ".agent-sandbox/workflows";

export const WORKFLOW_LIMITS = {
  maxWorkflows: 40,
  maxSteps: 12,
  maxName: 60,
  maxDescription: 300,
  maxTitle: 80,
  maxPrompt: 4000,
  maxCommand: 500,
  maxFeedback: 1000,
  maxRetry: 3,
  maxYamlBytes: 32_000,
} as const;

export interface AgentStep {
  kind: "agent";
  title?: string;
  prompt: string;
  skill?: string;
}

export interface CheckStep {
  kind: "check";
  title?: string;
  command: string;
  /** How many times a failure is handed back to the agent before the workflow fails (0..maxRetry). */
  retry: number;
  /** Extra guidance appended to the failure the agent gets back. */
  feedback?: string;
}

export type WorkflowStep = AgentStep | CheckStep;

export interface WorkflowDef {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  /** Where it came from: typed on the page, or a file in a repository. */
  origin?: { kind: "repo"; repo: string; path: string; ref?: string } | { kind: "manual" };
  createdAt: number;
  updatedAt: number;
}

const ID_RE = /^wf_[\w-]{6,40}$/;
const SKILL_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;

/* ───────────────────────────── YAML subset ───────────────────────────── */

/**
 * The YAML this format needs and nothing more: top-level `key: value`, a `steps:` list of maps
 * (`- key: value` with continuation keys indented under the dash), `|` / `>` block scalars, quoted
 * and plain scalars, ints and booleans, `#` comments. Anchors, flow collections, multi-document
 * streams and nested lists are refused with a line number rather than guessed at — a workflow file
 * is read by a machine that must not misread a prompt as a command.
 */
export function parseWorkflowYaml(text: string): Record<string, unknown> {
  if (text.length > WORKFLOW_LIMITS.maxYamlBytes) throw new Error(`Workflow file too large (max ${WORKFLOW_LIMITS.maxYamlBytes} bytes).`);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const root: Record<string, unknown> = {};
  let i = 0;
  const err = (msg: string, ln = i): never => {
    throw new Error(`workflow yaml line ${ln + 1}: ${msg}`);
  };
  const indentOf = (s: string) => s.length - s.trimStart().length;
  const blank = (s: string) => /^\s*(#.*)?$/.test(s);

  /** Read a block scalar whose header (`|`, `>`, `|-`, …) was on line i-1; body lines indent > parentIndent. */
  const readBlock = (style: string, parentIndent: number): string => {
    const keep = style.startsWith("|");
    const chomp = style.endsWith("-") ? "strip" : style.endsWith("+") ? "keep" : "clip";
    const body: string[] = [];
    let bodyIndent = -1;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*$/.test(l)) {
        body.push("");
        i++;
        continue;
      }
      const ind = indentOf(l);
      if (ind <= parentIndent) break;
      if (bodyIndent < 0) bodyIndent = ind;
      if (ind < bodyIndent) err("block scalar line indented less than its first line");
      body.push(l.slice(bodyIndent));
      i++;
    }
    while (body.length && body[body.length - 1] === "") body.pop();
    let out = keep ? body.join("\n") : body.map((l) => l.trim()).join(" ").replace(/ {2,}/g, " ");
    if (chomp !== "strip") out += "\n";
    return out;
  };

  const scalar = (raw: string, ln: number): unknown => {
    const v = raw.trim();
    if (v === "" || v === "~" || v === "null") return null;
    if (/^"(?:[^"\\]|\\.)*"$/.test(v)) {
      try {
        return JSON.parse(v);
      } catch {
        err("bad double-quoted string", ln);
      }
    }
    if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
    if (/^(true|false)$/i.test(v)) return v.toLowerCase() === "true";
    if (/^-?\d{1,9}$/.test(v)) return Number(v);
    if (/^[[{&*!|>%@`]/.test(v)) err(`unsupported yaml syntax '${v[0]}' — use a quoted or block scalar`, ln);
    return v.replace(/\s+#.*$/, "");
  };

  /** `key: value` → [key, rawValue]; refuses anything that is not a plain mapping entry. */
  const splitEntry = (s: string, ln: number): [string, string] => {
    const m = /^([A-Za-z_][\w-]*)\s*:(?:\s+(.*))?$/.exec(s.trim());
    if (!m) err(`expected 'key: value', got '${s.trim().slice(0, 40)}'`, ln);
    return [m![1], m![2] ?? ""];
  };

  /** Parse one mapping whose entries sit at exactly `indent`; stops at a dedent or a list dash. */
  const readMap = (indent: number, into: Record<string, unknown>, stopAtDash: boolean): void => {
    while (i < lines.length) {
      const l = lines[i];
      if (blank(l)) {
        i++;
        continue;
      }
      const ind = indentOf(l);
      if (ind < indent) return;
      if (ind > indent) err("unexpected indentation");
      const body = l.trim();
      if (body.startsWith("- ")) {
        if (stopAtDash) return;
        err("a list is not allowed here");
      }
      const [key, raw] = splitEntry(body, i);
      if (key in into) err(`duplicate key '${key}'`);
      i++;
      if (/^[|>][+-]?(\s*#.*)?$/.test(raw)) {
        into[key] = readBlock(raw.trim().replace(/\s*#.*$/, ""), indent);
      } else if (raw.trim() === "" || /^#/.test(raw.trim())) {
        // Nested structure on the following lines: a list (only `steps` may be one) or a map.
        const next = peekNonBlank();
        if (next < 0) {
          into[key] = null;
          continue;
        }
        const nind = indentOf(lines[next]);
        if (nind <= indent) {
          into[key] = null;
          continue;
        }
        if (lines[next].trim().startsWith("- ")) into[key] = readList(nind);
        else {
          const sub: Record<string, unknown> = {};
          readMap(nind, sub, false);
          into[key] = sub;
        }
      } else {
        into[key] = scalar(raw, i - 1);
      }
    }
  };

  const peekNonBlank = (): number => {
    for (let k = i; k < lines.length; k++) if (!blank(lines[k])) return k;
    return -1;
  };

  /** A list of maps: every item starts with `- key: value`; further keys sit at the dash's indent + 2. */
  const readList = (indent: number): unknown[] => {
    const out: unknown[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (blank(l)) {
        i++;
        continue;
      }
      const ind = indentOf(l);
      if (ind < indent) return out;
      if (ind > indent) err("unexpected indentation in list");
      const body = l.trim();
      if (!body.startsWith("- ")) return out;
      const first = body.slice(2);
      if (!/^[A-Za-z_][\w-]*\s*:/.test(first)) err("each step must be a mapping (`- prompt: …` or `- command: …`)");
      // Re-enter the map parser with the first entry rewritten onto its own virtual line.
      const item: Record<string, unknown> = {};
      lines[i] = " ".repeat(ind + 2) + first;
      readMap(ind + 2, item, true);
      out.push(item);
    }
    return out;
  };

  if (/^\s*---\s*$/m.test(text.split("\n").slice(1).join("\n"))) throw new Error("workflow yaml: one document per file.");
  if (/^\s*---\s*$/.test(lines[0] ?? "")) i = 1;
  readMap(indentOf(lines.find((l) => !blank(l)) ?? ""), root, false);
  if (i < lines.length) err("unexpected content");
  return root;
}

/* ───────────────────────────── normalise ───────────────────────────── */

function cleanText(v: unknown, max: number, what: string, opts: { multiline?: boolean } = {}): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`${what} must be text.`);
  const s = (opts.multiline ? v.replace(/\r\n?/g, "\n") : v.replace(/\s+/g, " ")).trim();
  if (!s) return undefined;
  if (s.length > max) throw new Error(`${what} is too long (max ${max} chars).`);
  if (/[\0]/.test(s)) throw new Error(`${what} contains a control character.`);
  return s;
}

export function normalizeStep(input: unknown, n: number): WorkflowStep {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const where = `Step ${n}`;
  const title = cleanText(r.title ?? r.name, WORKFLOW_LIMITS.maxTitle, `${where} title`);
  const prompt = cleanText(r.prompt, WORKFLOW_LIMITS.maxPrompt, `${where} prompt`, { multiline: true });
  const command = cleanText(r.command ?? r.run, WORKFLOW_LIMITS.maxCommand, `${where} command`, { multiline: true });
  if (prompt && command) throw new Error(`${where}: a step is EITHER a prompt (agent turn) OR a command (check), not both.`);
  if (!prompt && !command) throw new Error(`${where}: needs a prompt (agent turn) or a command (check).`);
  if (prompt) {
    if (r.retry !== undefined || r.feedback !== undefined) throw new Error(`${where}: retry/feedback belong to a command step.`);
    const skill = cleanText(r.skill, 64, `${where} skill`);
    if (skill && !SKILL_RE.test(skill)) throw new Error(`${where}: skill must be a plain name (letters, digits, dashes).`);
    return { kind: "agent", prompt, ...(title ? { title } : {}), ...(skill ? { skill } : {}) };
  }
  if (r.skill !== undefined) throw new Error(`${where}: a command step takes no skill.`);
  if (/\n/.test(command!)) throw new Error(`${where}: a command is one line; chain with && or put it in a script.`);
  let retry = 0;
  if (r.retry !== undefined && r.retry !== null) {
    if (typeof r.retry === "boolean") retry = r.retry ? 1 : 0;
    else if (typeof r.retry === "number" && Number.isInteger(r.retry)) retry = r.retry;
    else throw new Error(`${where}: retry must be a whole number.`);
    if (retry < 0 || retry > WORKFLOW_LIMITS.maxRetry) throw new Error(`${where}: retry must be 0..${WORKFLOW_LIMITS.maxRetry}.`);
  }
  const feedback = cleanText(r.feedback ?? r.onFail, WORKFLOW_LIMITS.maxFeedback, `${where} feedback`, { multiline: true });
  return { kind: "check", command: command!, retry, ...(title ? { title } : {}), ...(feedback ? { feedback } : {}) };
}

export function normalizeWorkflow(input: unknown, existing?: WorkflowDef, now = Date.now()): WorkflowDef {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = cleanText(r.name, WORKFLOW_LIMITS.maxName, "Name");
  if (!name) throw new Error("A workflow needs a name.");
  const description = cleanText(r.description, WORKFLOW_LIMITS.maxDescription, "Description");
  if (!Array.isArray(r.steps) || !r.steps.length) throw new Error("A workflow needs at least one step.");
  if (r.steps.length > WORKFLOW_LIMITS.maxSteps) throw new Error(`At most ${WORKFLOW_LIMITS.maxSteps} steps.`);
  const steps = r.steps.map((s, k) => normalizeStep(s, k + 1));
  if (!steps.some((s) => s.kind === "agent")) throw new Error("A workflow needs at least one prompt step — checks alone have nothing to check.");
  const origin = existing?.origin ?? (r.origin && typeof r.origin === "object" ? (r.origin as WorkflowDef["origin"]) : { kind: "manual" as const });
  return {
    id: existing?.id ?? (typeof r.id === "string" && ID_RE.test(r.id) ? r.id : `wf_${randomUUID().slice(0, 12)}`),
    name,
    ...(description ? { description } : {}),
    steps,
    origin,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/** A workflow from a YAML file's text (repo discovery and the page's paste box). */
export function workflowFromYaml(text: string, fallbackName?: string, origin?: WorkflowDef["origin"], now = Date.now()): WorkflowDef {
  const doc = parseWorkflowYaml(text);
  if (!doc.name && fallbackName) doc.name = fallbackName;
  return normalizeWorkflow({ ...doc, ...(origin ? { origin } : {}) }, undefined, now);
}

/** The YAML the page shows for a saved workflow (round-trips through parseWorkflowYaml). */
export function workflowToYaml(w: Pick<WorkflowDef, "name" | "description" | "steps">): string {
  const q = (s: string) => JSON.stringify(s);
  const block = (key: string, text: string, indent: string) =>
    /\n/.test(text) ? `${indent}${key}: |\n${text.split("\n").map((l) => `${indent}  ${l}`).join("\n")}` : `${indent}${key}: ${/^[\w .,'{}()/-]+$/.test(text) && !/^[-'"{[]/.test(text) ? text : q(text)}`;
  const out = [`name: ${/^[\w .-]+$/.test(w.name) ? w.name : q(w.name)}`];
  if (w.description) out.push(block("description", w.description, ""));
  out.push("steps:");
  for (const s of w.steps) {
    const keys: string[] = [];
    if (s.title) keys.push(block("title", s.title, "    "));
    if (s.kind === "agent") {
      keys.push(block("prompt", s.prompt, "    "));
      if (s.skill) keys.push(`    skill: ${s.skill}`);
    } else {
      keys.push(block("command", s.command, "    "));
      if (s.retry) keys.push(`    retry: ${s.retry}`);
      if (s.feedback) keys.push(block("feedback", s.feedback, "    "));
    }
    out.push(`  - ${keys[0].trimStart()}`, ...keys.slice(1));
  }
  return out.join("\n") + "\n";
}

/* ───────────────────────────── rendering ───────────────────────────── */

const TEMPLATE_RE = /\{\{\s*task\s*\}\}/g;

export function renderPrompt(prompt: string, task: string): string {
  return TEMPLATE_RE.test(prompt) ? prompt.replace(TEMPLATE_RE, task.trim()) : prompt;
}

export function stepTitle(step: WorkflowStep, n: number): string {
  if (step.title) return step.title;
  return step.kind === "agent" ? (step.skill ? `/${step.skill}` : `step ${n}`) : step.command;
}

/**
 * What the agent receives for an agent step after the first. The header is deliberately plain
 * prose: the step text is an operator message in the transcript, not a sentinel the formatter
 * could mistake for structure.
 */
export function stepMessage(step: AgentStep, n: number, total: number, task: string): string {
  const head = `Workflow step ${n} of ${total}${step.title ? ` — ${step.title}` : ""}.`;
  const skill = step.skill ? `\nUse the /${step.skill} skill for this step.` : "";
  return `${head}${skill}\n\n${renderPrompt(step.prompt, task)}`;
}

/** The task of the delegation that starts the workflow: its first agent step, or the typed task. */
export function firstTask(w: Pick<WorkflowDef, "steps">, task: string): { task: string; cursor: number } {
  const s = w.steps[0];
  if (s.kind !== "agent") return { task: task.trim(), cursor: 0 };
  // Step 1 of 1 is just the task; a longer workflow says where it is going so the plan reflects it.
  const head = w.steps.length > 1 ? `Workflow step 1 of ${w.steps.length}${s.title ? ` — ${s.title}` : ""}.` : "";
  const skill = s.skill ? `\nUse the /${s.skill} skill for this step.` : "";
  const body = renderPrompt(s.prompt, task);
  return { task: head ? `${head}${skill}\n\n${body}` : skill ? `${skill.trim()}\n\n${body}` : body, cursor: 1 };
}

/** What a failed check tells the agent (the verify retry message, plus the step's own guidance). */
export function checkFeedback(step: CheckStep, r: VerifyResult, n: number, total: number, attempt: number): string {
  const tail = (r.output ?? r.detail).trim();
  const extra = step.feedback ? `\n\n${step.feedback}` : "";
  return (
    `Workflow step ${n} of ${total} — check failed (attempt ${attempt} of ${step.retry + 1}): \`${step.command}\` exited ${r.code ?? 1}.\n\n` +
    `${tail}${extra}\n\nFix it, re-run \`${step.command}\` yourself, and finish when it passes.`
  );
}

/* ───────────────────────────── state machine ───────────────────────────── */

export interface StepRecord {
  n: number;
  kind: WorkflowStep["kind"];
  title: string;
  state: "done" | "failed";
  /** Checks: attempts used (1 = passed first time). */
  attempts?: number;
  detail?: string;
}

export interface WorkflowRun {
  workflowId: string;
  name: string;
  steps: WorkflowStep[];
  task: string;
  /** Index of the next step to START when the current agent turn finishes. */
  cursor: number;
  /** The 1-based step in progress (an agent turn running, or a check about to run / being retried). */
  current: number;
  /** Failed attempts of the check at `cursor` handed back so far. */
  retriesUsed: number;
  history: StepRecord[];
  state: "running" | "done" | "failed";
  /** Why it failed, for the fleet card and the digest. */
  failure?: string;
}

/** `cursor` is firstTask()'s: 1 when the delegate task was step 1, 0 when step 1 is a check. */
export function startRun(w: WorkflowDef, task: string, cursor: number): WorkflowRun {
  // The first step's "done" is recorded when its turn finishes, not here — see advance().
  return { workflowId: w.id, name: w.name, steps: w.steps, task, cursor, current: 1, retriesUsed: 0, history: [], state: "running" };
}

export type WorkflowAction =
  | { type: "resume"; message: string }
  | { type: "check"; command: string }
  | { type: "hold" }
  | { type: "end"; state: "done" | "failed" };

export type WorkflowEvent =
  | { kind: "finish"; runState: "done" | "failed" | "waiting"; exitCode?: number }
  | { kind: "checked"; result: VerifyResult };

/**
 * One transition. Immutable: returns the next run and what to do. The caller performs the action
 * and feeds the outcome back as the next event (a check result at once; a resume's finish at the
 * next sweep edge).
 */
export function advance(run: WorkflowRun, ev: WorkflowEvent): { run: WorkflowRun; action: WorkflowAction } {
  if (run.state !== "running") return { run, action: { type: "end", state: run.state } };
  const total = run.steps.length;
  const cur = run.steps[run.cursor];
  if (ev.kind === "finish") {
    // A question pauses the workflow, never ends it: the operator's answer is the next turn.
    if (ev.runState === "waiting") return { run, action: { type: "hold" } };
    if (ev.runState === "failed" || (ev.exitCode ?? 0) !== 0) {
      const n = run.current;
      return end(run, "failed", `step ${n} ended with exit ${ev.exitCode ?? "?"}`, { n, kind: run.steps[n - 1].kind, title: stepTitle(run.steps[n - 1], n), state: "failed" });
    }
    // The agent turn that just finished was the step before `cursor` (or a retry of the check at it).
    const history = run.retriesUsed > 0 || run.cursor === 0 ? run.history : [...run.history, { n: run.cursor, kind: "agent" as const, title: stepTitle(run.steps[run.cursor - 1], run.cursor), state: "done" as const }];
    return begin({ ...run, history });
  }
  // ev.kind === "checked": the check at `cursor` ran.
  if (!cur || cur.kind !== "check") return { run, action: { type: "hold" } };
  const n = run.cursor + 1;
  const attempt = run.retriesUsed + 1;
  if (ev.result.pass) {
    const history = [...run.history, { n, kind: "check" as const, title: stepTitle(cur, n), state: "done" as const, attempts: attempt, detail: ev.result.detail }];
    return begin({ ...run, cursor: run.cursor + 1, retriesUsed: 0, history });
  }
  if (run.retriesUsed < cur.retry) {
    return { run: { ...run, retriesUsed: run.retriesUsed + 1 }, action: { type: "resume", message: checkFeedback(cur, ev.result, n, total, attempt) } };
  }
  return end(run, "failed", `check \`${cur.command}\` failed ${attempt}×: ${ev.result.detail}`, { n, kind: "check", title: stepTitle(cur, n), state: "failed", attempts: attempt, detail: ev.result.detail });
}

function end(run: WorkflowRun, state: "done" | "failed", failure: string | undefined, rec?: StepRecord): { run: WorkflowRun; action: WorkflowAction } {
  const history = rec ? [...run.history, rec] : run.history;
  return { run: { ...run, state, history, ...(failure ? { failure } : {}) }, action: { type: "end", state } };
}

/** Start the step at `cursor`: an agent step resumes, a check runs, past the end is done. */
function begin(run: WorkflowRun): { run: WorkflowRun; action: WorkflowAction } {
  const s = run.steps[run.cursor];
  if (!s) return end(run, "done", undefined);
  const n = run.cursor + 1;
  if (s.kind === "agent") return { run: { ...run, cursor: run.cursor + 1, current: n, retriesUsed: 0 }, action: { type: "resume", message: stepMessage(s, n, run.steps.length, run.task) } };
  return { run: { ...run, current: n }, action: { type: "check", command: s.command } };
}

/** The fleet card's one line: `ship-feature · step 3/5 · npm test` — or how it ended. */
export function runLine(run: WorkflowRun): string {
  const total = run.steps.length;
  if (run.state === "done") return `${run.name} · ${total}/${total} steps done`;
  if (run.state === "failed") return `${run.name} · failed: ${run.failure ?? "?"}`;
  const n = run.current;
  const s = run.steps[n - 1];
  return `${run.name} · step ${n}/${total}${s ? ` · ${stepTitle(s, n)}` : ""}`;
}

export interface WorkflowView {
  id: string;
  name: string;
  line: string;
  state: WorkflowRun["state"];
  step: number;
  total: number;
  history: StepRecord[];
  failure?: string;
}

export function viewOf(run: WorkflowRun): WorkflowView {
  const total = run.steps.length;
  return {
    id: run.workflowId,
    name: run.name,
    line: runLine(run),
    state: run.state,
    step: run.state === "done" ? total : run.current,
    total,
    history: run.history,
    ...(run.failure ? { failure: run.failure } : {}),
  };
}

/* ───────────────────────────── store ───────────────────────────── */

function parseStore(raw: string | null): Record<string, WorkflowDef> {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as { workflows?: Record<string, WorkflowDef> };
    return j && typeof j.workflows === "object" && j.workflows ? { ...j.workflows } : {};
  } catch {
    return {};
  }
}

function saveAll(all: Record<string, WorkflowDef>, owner: string): void {
  if (Object.keys(all).length > WORKFLOW_LIMITS.maxWorkflows) throw new Error(`At most ${WORKFLOW_LIMITS.maxWorkflows} saved workflows.`);
  saveBlob(WORKFLOWS_KIND, JSON.stringify({ workflows: all }), owner);
}

export function loadWorkflows(owner = ownerKey()): WorkflowDef[] {
  return Object.values(parseStore(loadBlob(WORKFLOWS_KIND, owner))).sort((a, b) => a.name.localeCompare(b.name));
}

export function getWorkflow(id: string, owner = ownerKey()): WorkflowDef | undefined {
  return parseStore(loadBlob(WORKFLOWS_KIND, owner))[id];
}

/** Create (no id) or update (id) from form or parsed-YAML input. */
export function upsertWorkflow(input: unknown, id: string | undefined, owner = ownerKey()): WorkflowDef {
  const all = parseStore(loadBlob(WORKFLOWS_KIND, owner));
  const existing = id ? all[id] : undefined;
  if (id && !existing) throw new Error("No such workflow.");
  const def = normalizeWorkflow({ ...(input as object), id: undefined }, existing);
  all[def.id] = def;
  saveAll(all, owner);
  return def;
}

/** Store an already-normalised def (repo import keeps its origin). A same-origin file replaces its earlier import. */
export function putWorkflow(def: WorkflowDef, owner = ownerKey()): WorkflowDef {
  const all = parseStore(loadBlob(WORKFLOWS_KIND, owner));
  if (def.origin?.kind === "repo") {
    const o = def.origin;
    const prev = Object.values(all).find((w) => w.origin?.kind === "repo" && w.origin.repo === o.repo && w.origin.path === o.path);
    if (prev) {
      def = { ...def, id: prev.id, createdAt: prev.createdAt };
    }
  }
  all[def.id] = def;
  saveAll(all, owner);
  return def;
}

export function deleteWorkflow(id: string, owner = ownerKey()): boolean {
  const all = parseStore(loadBlob(WORKFLOWS_KIND, owner));
  if (!all[id]) return false;
  delete all[id];
  saveAll(all, owner);
  return true;
}
