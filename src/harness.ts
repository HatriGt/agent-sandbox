/**
 * Harness bundles (docs/plan-agent-cloud.md workstream F, increment 8).
 *
 * A harness is a SAVED COMBINATION of run settings that already exist one by one:
 *   driver · provider + model · skills · rules (ask-before-guess / plan-first / verify-on-done +
 *   RULES.md text) · verify command · egress extras.
 * It adds no new run machinery: `applyHarness` folds a harness into a delegate body, and the
 * delegate route validates the merged body exactly as it validates a hand-typed one — so a
 * tampered store, or a bundle that slipped a bad value past import, still meets every existing gate.
 * The RULES (toggles + RULES.md) are NOT part of the body: they come back separately as prompt text
 * the run puts in the agent's SYSTEM prompt (src/agent-prompt.ts harnessPromptHint), so the task the
 * operator typed stays exactly what the transcript shows as their message.
 *
 * Precedence (the one rule, stated in the UI too): an explicit per-run field wins; the harness only
 * fills fields the run left empty. Provider and model are ONE unit — a run that names either keeps
 * both of its own and takes neither from the harness (a harness model on a different provider would
 * be a silent cross-wiring). Lists (egress, skills) are replaced, not merged.
 *
 * Bundles: a versioned folder `{ harness.json, RULES.md, verify.sh, skills/<name>/… }`, exported as
 * one JSON document ({format, version, files}) and imported from that document or from a GitHub
 * folder. Safety rules, all enforced here (pure) and tested:
 *   - Export never carries a secret: the provider is exported as {kind, label} only (no id, base
 *     URL or key), skill files with secret-shaped names are dropped, and every text passes through
 *     the controller's redactor (known stored secrets + token shapes).
 *   - Import is strict: format + schema version, file count / byte / path limits, secret-shaped
 *     keys in harness.json rejected. An imported harness is `needsReview` — it cannot start a run
 *     until its owner has seen the RULES.md, verify.sh and egress it brings and approved them.
 *     Imported skills land DISABLED, so they only ever reach the box through this harness.
 *   - hooks/ in a bundle is ignored: an imported bundle never installs executable hooks.
 */
import { randomUUID } from "node:crypto";
import { loadBlob, ownerKey, saveBlob } from "./user-store.js";
import { AGENT_KINDS, isAgentKind, type AgentKind } from "./agent-kind.js";
import { SKILL_LIMITS, normalizeSkill, validateSkillFilePath, type SkillDef, type SkillFile, type SkillStore } from "./skill-store.js";
import { PROVIDER_KINDS, type ProviderKind, type ProviderRecord } from "./providers.js";
import { redactShapes } from "./redact.js";
import { AUTO_RETRY_MAX } from "./verify.js";

export const HARNESS_FORMAT = "agent-sandbox/harness";
export const HARNESS_BUNDLE_FORMAT = "agent-sandbox/harness-bundle";
export const HARNESS_VERSION = 1;
export const HARNESSES_KIND = "harnesses";

export const HARNESS_LIMITS = {
  /** Includes the seeded built-ins (BUILTIN_HARNESSES). */
  maxHarnesses: 40,
  maxName: 60,
  maxDescription: 300,
  maxRulesMd: 16_384,
  maxVerify: 4000,
  maxEgress: 20,
  maxSkills: 50,
  /** Bundle-level caps (import). */
  maxBundleFiles: 300,
  maxBundleBytes: 3_000_000,
  maxBundleFileBytes: 512_000,
} as const;

export interface HarnessRules {
  askBeforeGuess: boolean;
  planFirst: boolean;
  verifyOnDone: boolean;
  /**
   * Done means verified: how many times a run whose verification FAILED is sent back with the
   * failure to fix it (0–AUTO_RETRY_MAX, default AUTO_RETRY_DEFAULT; src/verify.ts). Optional so
   * stored blobs and BUILTIN_HARNESSES from before the rule read as the default.
   */
  autoRetry?: number;
}

export interface HarnessOrigin {
  kind: "github" | "file" | "duplicate";
  /** github: owner/repo@ref:path — shown on the review panel. */
  source?: string;
  at: number;
}

export interface HarnessDef {
  id: string;
  name: string;
  description?: string;
  driver?: AgentKind;
  /** The owner's own provider record id. Never exported (see ExportedProviderRef). */
  providerId?: string;
  model?: string;
  /** Skill names from the owner's library; undefined = the library's enabled set (today's default). */
  skills?: string[];
  rules: HarnessRules;
  rulesMd?: string;
  verifyCommand?: string;
  egress?: string[];
  /** Imported and not yet approved by its owner: cannot start a run. */
  needsReview?: boolean;
  /** An imported provider ref that matched none of the owner's providers (UI prompt to connect one). */
  unresolvedProvider?: ExportedProviderRef;
  origin?: HarnessOrigin;
  /** Seeded from BUILTIN_HARNESSES (its key). Editable in place; deleting hides it (see seeding). */
  builtin?: string;
  createdAt: number;
  updatedAt: number;
}

/** A provider as it may leave the controller: kind + label, nothing that reaches or unlocks it. */
export interface ExportedProviderRef {
  kind: ProviderKind;
  label: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,49}$/; // skill names (mirrors skill-store)
const MODEL_RE = /^[\w.:\/@-]{1,120}$/;
const PROVIDER_ID_RE = /^[\w-]{1,64}$/;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const NO_RULES: HarnessRules = { askBeforeGuess: false, planFirst: false, verifyOnDone: false };

function cleanText(v: unknown, max: number, what: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`${what} must be text.`);
  const s = v.replace(/\r\n/g, "\n").trim();
  if (!s) return undefined;
  if (s.includes("\0")) throw new Error(`${what} is not text.`);
  if (s.length > max) throw new Error(`${what} is over ${max} characters.`);
  return s;
}

/** Validate one egress list (hostnames only: no scheme, port, path or wildcard). */
export function normalizeEgress(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new Error("egress must be a list of hostnames.");
  if (v.length > HARNESS_LIMITS.maxEgress) throw new Error(`egress: at most ${HARNESS_LIMITS.maxEgress} hosts.`);
  const out = new Set<string>();
  for (const raw of v) {
    const h = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!HOST_RE.test(h)) throw new Error(`egress: "${String(raw).slice(0, 80)}" is not a hostname (like api.example.com).`);
    out.add(h);
  }
  return [...out].sort();
}

/** Validate + normalise a harness (form input, stored blob, or parsed bundle). Throws a human message. */
export function normalizeHarness(input: unknown, existing?: HarnessDef, now = Date.now()): HarnessDef {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = cleanText(r.name, HARNESS_LIMITS.maxName, "Name");
  if (!name) throw new Error("A harness needs a name.");
  const description = cleanText(r.description, HARNESS_LIMITS.maxDescription, "Description");
  let driver: AgentKind | undefined;
  if (r.driver !== undefined && r.driver !== null && r.driver !== "") {
    if (!isAgentKind(r.driver)) throw new Error(`driver must be one of ${AGENT_KINDS.join(", ")}.`);
    driver = r.driver;
  }
  let providerId: string | undefined;
  if (typeof r.providerId === "string" && r.providerId) {
    if (!PROVIDER_ID_RE.test(r.providerId)) throw new Error("Invalid provider reference.");
    providerId = r.providerId;
  }
  let model: string | undefined;
  if (typeof r.model === "string" && r.model.trim()) {
    if (!MODEL_RE.test(r.model.trim())) throw new Error("Invalid model id.");
    model = r.model.trim();
  }
  let skills: string[] | undefined;
  if (r.skills !== undefined && r.skills !== null) {
    if (!Array.isArray(r.skills)) throw new Error("skills must be a list of skill names.");
    if (r.skills.length > HARNESS_LIMITS.maxSkills) throw new Error(`At most ${HARNESS_LIMITS.maxSkills} skills.`);
    const set = new Set<string>();
    for (const s of r.skills) {
      if (typeof s !== "string" || !NAME_RE.test(s)) throw new Error(`"${String(s).slice(0, 60)}" is not a skill name.`);
      set.add(s);
    }
    skills = [...set].sort();
  }
  const rr = (r.rules && typeof r.rules === "object" ? r.rules : {}) as Record<string, unknown>;
  const rules: HarnessRules = { askBeforeGuess: rr.askBeforeGuess === true, planFirst: rr.planFirst === true, verifyOnDone: rr.verifyOnDone === true };
  if (rr.autoRetry !== undefined && rr.autoRetry !== null) {
    if (typeof rr.autoRetry !== "number" || !Number.isInteger(rr.autoRetry) || rr.autoRetry < 0 || rr.autoRetry > AUTO_RETRY_MAX) throw new Error(`autoRetry must be a whole number from 0 to ${AUTO_RETRY_MAX}.`);
    rules.autoRetry = rr.autoRetry;
  }
  const rulesMd = cleanText(r.rulesMd, HARNESS_LIMITS.maxRulesMd, "RULES.md");
  const verifyCommand = cleanText(r.verifyCommand, HARNESS_LIMITS.maxVerify, "Verify command");
  const egress = normalizeEgress(r.egress);
  const def: HarnessDef = {
    id: existing?.id ?? (typeof r.id === "string" && /^hrn_[\w-]{6,40}$/.test(r.id) ? r.id : `hrn_${randomUUID().slice(0, 12)}`),
    name,
    rules,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (description) def.description = description;
  if (driver) def.driver = driver;
  if (providerId) def.providerId = providerId;
  if (model) def.model = model;
  if (skills) def.skills = skills;
  if (rulesMd) def.rulesMd = rulesMd;
  if (verifyCommand) def.verifyCommand = verifyCommand;
  if (egress?.length) def.egress = egress;
  // Review state is NEVER taken from client input: only import sets it, only approve clears it.
  if (existing?.needsReview) def.needsReview = true;
  if (existing?.unresolvedProvider && !providerId) def.unresolvedProvider = existing.unresolvedProvider;
  if (existing?.origin) def.origin = existing.origin;
  if (existing?.builtin) def.builtin = existing.builtin;
  return def;
}

/* ───────────────────────────── resolution ───────────────────────────── */

/** The run-shaping fields of a delegate body a harness may fill. */
export interface HarnessableBody {
  task?: unknown;
  agent?: unknown;
  provider?: unknown;
  model?: unknown;
  allowDomains?: unknown;
  verify?: unknown;
  skills?: unknown;
  [k: string]: unknown;
}

/** An empty list counts as "left empty" too: a composer that sends `skills: []` has picked nothing. */
const present = (v: unknown) => v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "") && !(Array.isArray(v) && v.length === 0);

/**
 * The rules block for the agent's SYSTEM prompt (never the task). Plain prompt text — stated as
 * such in the UI, not a hook. Empty when the harness has no toggles on and no RULES.md.
 */
export function rulesPreamble(h: Pick<HarnessDef, "name" | "rules" | "rulesMd">): string {
  const lines: string[] = [];
  if (h.rules.askBeforeGuess) lines.push("- When a requirement is ambiguous or a decision is the operator's to make, ask a question and wait instead of guessing.");
  if (h.rules.planFirst) lines.push("- Before changing anything, write a short numbered plan, then follow it.");
  if (h.rules.verifyOnDone) lines.push("- Before you say you are done, check the result yourself (run the tests or the verify command) and report what you checked.");
  const md = h.rulesMd?.trim();
  if (!lines.length && !md) return "";
  return [`Harness rules (${h.name}):`, ...lines, ...(md ? [md] : [])].join("\n");
}

/** The short human labels of the rule toggles that are on, in UI order. */
export function ruleLabels(r: HarnessRules): string[] {
  const out: string[] = [];
  if (r.askBeforeGuess) out.push("asks before guessing");
  if (r.planFirst) out.push("plans first");
  if (r.verifyOnDone) out.push("verify on done");
  return out;
}

/**
 * One line for the thread header: "Bug fixer · asks before guessing · verify on done". Name only
 * when nothing is toggled (RULES.md text is not summarised — it is shown on the Harnesses page).
 */
export function harnessSummaryLine(h: Pick<HarnessDef, "name" | "rules">): string {
  return [h.name, ...ruleLabels(h.rules)].join(" · ");
}

/**
 * Fold a harness into a delegate body. Returns the merged body, which fields the harness supplied
 * (the route echoes them, so a surprise is visible) and the rules text for the system prompt —
 * never mutates the input, and never touches `task`: the operator's message stays their own.
 */
export function applyHarness(h: HarnessDef, body: HarnessableBody): { body: HarnessableBody; applied: string[]; rules?: string } {
  if (h.needsReview) throw new Error(`Harness "${h.name}" was imported and has not been reviewed yet — open it on the Harnesses page and approve it first.`);
  const out: HarnessableBody = { ...body };
  const applied: string[] = [];
  if (!present(body.agent) && h.driver) {
    out.agent = h.driver;
    // The owner picked this driver in the editor, next to its supervision badge: that pick IS the
    // "supervised: partial" acknowledgement the delegate gate asks for. Without it a harness pinning
    // codex/opencode never started — the gate answered with a question the composer could not show.
    out.allowPartialSupervision = true;
    applied.push("driver");
  }
  // Provider + model travel together (see header).
  if (!present(body.provider) && !present(body.model)) {
    if (h.providerId) {
      out.provider = h.providerId;
      applied.push("provider");
    }
    if (h.model) {
      out.model = h.model;
      applied.push("model");
    }
  }
  if (!present(body.allowDomains) && h.egress?.length) {
    out.allowDomains = [...h.egress];
    applied.push("egress");
  }
  if (!present(body.skills) && h.skills) {
    out.skills = [...h.skills];
    applied.push("skills");
  }
  if (!present(body.verify) && h.rules.verifyOnDone) {
    const task = typeof body.task === "string" ? body.task.trim() : "";
    out.verify = h.verifyCommand
      ? { command: h.verifyCommand }
      : { criterion: `The task below was completed as asked, and nothing it did not ask for was changed:\n${task.slice(0, 3500)}` };
    applied.push("verify");
  }
  const pre = rulesPreamble(h);
  if (pre) applied.push("rules");
  return { body: out, applied, ...(pre ? { rules: pre } : {}) };
}

/* ───────────────────────────── store ───────────────────────────── */

export function parseHarnessStore(raw: string | null): Record<string, HarnessDef> {
  return parseStoreFull(raw).harnesses;
}

/** The blob also records which built-ins were ever seeded, so a deleted one stays deleted. */
function parseStoreFull(raw: string | null): { harnesses: Record<string, HarnessDef>; seeded: string[] } {
  if (!raw) return { harnesses: {}, seeded: [] };
  try {
    const j = JSON.parse(raw) as { harnesses?: Record<string, HarnessDef>; seeded?: unknown };
    return {
      harnesses: j && typeof j.harnesses === "object" && j.harnesses ? { ...j.harnesses } : {},
      seeded: Array.isArray(j?.seeded) ? j.seeded.filter((x): x is string => typeof x === "string") : [],
    };
  } catch {
    return { harnesses: {}, seeded: [] };
  }
}

export function loadHarnesses(owner = ownerKey()): HarnessDef[] {
  return Object.values(parseHarnessStore(loadBlob(HARNESSES_KIND, owner))).sort((a, b) => a.name.localeCompare(b.name));
}

export function getHarness(id: string, owner = ownerKey()): HarnessDef | undefined {
  // A built-in id may reach the delegate route (API, trigger) before the list was ever loaded.
  if (id.startsWith(BUILTIN_ID_PREFIX)) ensureDefaultHarnesses(owner);
  return parseHarnessStore(loadBlob(HARNESSES_KIND, owner))[id];
}

function saveAll(all: Record<string, HarnessDef>, owner: string, seeded?: string[]): void {
  if (Object.keys(all).length > HARNESS_LIMITS.maxHarnesses) throw new Error(`At most ${HARNESS_LIMITS.maxHarnesses} saved harnesses.`);
  const keep = seeded ?? parseStoreFull(loadBlob(HARNESSES_KIND, owner)).seeded;
  saveBlob(HARNESSES_KIND, JSON.stringify({ harnesses: all, ...(keep.length ? { seeded: keep } : {}) }), owner);
}

/** Create (no id) or update (id) from form input. Review state and origin are preserved, never set. */
export function upsertHarness(input: unknown, id: string | undefined, owner = ownerKey()): HarnessDef {
  const all = parseHarnessStore(loadBlob(HARNESSES_KIND, owner));
  const existing = id ? all[id] : undefined;
  if (id && !existing) throw new Error("No such harness.");
  const def = normalizeHarness({ ...(input as object), id: undefined }, existing);
  all[def.id] = def;
  saveAll(all, owner);
  return def;
}

/** Store an already-normalised def as-is (import path: sets needsReview/origin deliberately). */
export function putHarness(def: HarnessDef, owner = ownerKey()): HarnessDef {
  const all = parseHarnessStore(loadBlob(HARNESSES_KIND, owner));
  all[def.id] = def;
  saveAll(all, owner);
  return def;
}

export function deleteHarness(id: string, owner = ownerKey()): boolean {
  const all = parseHarnessStore(loadBlob(HARNESSES_KIND, owner));
  if (!all[id]) return false;
  delete all[id];
  saveAll(all, owner);
  return true;
}

export function approveHarness(id: string, owner = ownerKey()): HarnessDef | undefined {
  const all = parseHarnessStore(loadBlob(HARNESSES_KIND, owner));
  const h = all[id];
  if (!h) return undefined;
  delete h.needsReview;
  h.updatedAt = Date.now();
  saveAll(all, owner);
  return h;
}

export function duplicateHarness(id: string, owner = ownerKey()): HarnessDef | undefined {
  const all = parseHarnessStore(loadBlob(HARNESSES_KIND, owner));
  const h = all[id];
  if (!h) return undefined;
  const names = new Set(Object.values(all).map((x) => x.name));
  let name = `${h.name} copy`.slice(0, HARNESS_LIMITS.maxName);
  for (let n = 2; names.has(name); n++) name = `${h.name} copy ${n}`.slice(0, HARNESS_LIMITS.maxName);
  const now = Date.now();
  const { builtin: _builtin, ...rest } = structuredClone(h);
  const copy: HarnessDef = { ...rest, id: `hrn_${randomUUID().slice(0, 12)}`, name, createdAt: now, updatedAt: now, origin: { kind: "duplicate", source: h.name, at: now } };
  all[copy.id] = copy;
  saveAll(all, owner);
  return copy;
}

/* ───────────────────────────── built-ins ───────────────────────────── */

/**
 * Best-practice starting points every owner gets. Only fields the schema already has are used;
 * driver, provider/model and egress are left to the owner's defaults (nothing guessed).
 * verifyOnDone without a command means the controller's criterion check (see applyHarness).
 */
export interface BuiltinHarness {
  key: string;
  name: string;
  description: string;
  rules: HarnessRules;
  rulesMd: string;
}

export const BUILTIN_ID_PREFIX = "hrn_builtin-";

export const BUILTIN_HARNESSES: readonly BuiltinHarness[] = [
  {
    key: "bug-fixer",
    name: "Bug fixer",
    description: "Reproduce the bug, pin it with a failing test, fix it, run the suite, open a PR.",
    rules: { askBeforeGuess: true, planFirst: false, verifyOnDone: true },
    rulesMd: [
      "1. Reproduce the bug first and note the exact steps or command.",
      "2. Write a test that fails because of the bug, and run it to see it fail.",
      "3. Make the smallest change that makes that test pass. Fix the cause, not the symptom.",
      "4. Run the full test suite (and typecheck/lint if the repo has them).",
      "5. Open a pull request that states the cause, the fix and the new test.",
      "If you cannot reproduce it, stop and report what you tried instead of guessing a fix.",
    ].join("\n"),
  },
  {
    key: "feature-builder",
    name: "Feature builder",
    description: "Plan first, ask when the request is ambiguous, add tests, open a PR.",
    rules: { askBeforeGuess: true, planFirst: true, verifyOnDone: true },
    rulesMd: [
      "- Read the surrounding code and follow its existing patterns and style.",
      "- Keep the change scoped to the request; list follow-ups instead of doing them.",
      "- Add or update tests that cover the new behaviour.",
      "- Run the tests, then open a pull request describing what changed and how to try it.",
    ].join("\n"),
  },
  {
    key: "code-reviewer",
    name: "Code reviewer",
    description: "Read-only review: findings as comments, no code changes.",
    rules: { askBeforeGuess: false, planFirst: false, verifyOnDone: false },
    rulesMd: [
      "- This is a review. Do not edit, commit or push any files.",
      "- Look for correctness bugs first, then security, then error handling, then clarity.",
      "- Report each finding with file:line, why it matters and a suggested fix.",
      "- Mark each finding as blocking or a nit. Say plainly when you found nothing serious.",
      "- If you were given a pull request, leave the findings as review comments on it.",
    ].join("\n"),
  },
  {
    key: "test-writer",
    name: "Test writer",
    description: "Raise test coverage with the repo's existing test framework. No source changes.",
    rules: { askBeforeGuess: false, planFirst: true, verifyOnDone: true },
    rulesMd: [
      "- Only add or change test files. Do not modify source code.",
      "- Use the test framework and conventions the repo already has.",
      "- Prefer tests of real behaviour and edge cases over tests of implementation details.",
      "- If a test exposes a real bug, mark it skipped or expected-to-fail and report the bug.",
      "- Run the suite; every new test must pass (or be the reported bug). Open a pull request.",
    ].join("\n"),
  },
  {
    key: "dependency-upgrader",
    name: "Dependency upgrader",
    description: "Upgrade dependencies in small steps, read changelogs, keep the build and tests green.",
    rules: { askBeforeGuess: true, planFirst: true, verifyOnDone: true },
    rulesMd: [
      "- Use the repo's own package manager and keep the lockfile in sync.",
      "- Upgrade one dependency (or one tightly coupled group) at a time.",
      "- Read the changelog for every major version jump and apply the required migrations.",
      "- Build and run the tests after each step; if one breaks and the fix is not clear, leave it and report why.",
      "- Open a pull request listing each package's old and new version and any breaking changes handled.",
    ].join("\n"),
  },
  {
    key: "docs-changelog",
    name: "Docs & changelog",
    description: "Bring README, docs and the changelog in line with the code. No behaviour changes.",
    rules: { askBeforeGuess: false, planFirst: false, verifyOnDone: true },
    rulesMd: [
      "- Only change documentation, comments and the changelog; do not change behaviour.",
      "- Describe what the code does now; check every command and example you write.",
      "- Follow the changelog's existing format and add entries under Unreleased.",
      "- Open a pull request.",
    ].join("\n"),
  },
  {
    key: "incident-responder",
    name: "Incident responder",
    description: "For alert webhooks: find the breaking change, prepare a minimal fix or a revert, ask before choosing.",
    rules: { askBeforeGuess: true, planFirst: false, verifyOnDone: true },
    rulesMd: [
      "1. Read the alert payload and logs; state the symptom and when it started.",
      "2. Find the change that caused it (recent commits and deploys; git bisect with a reproducing check).",
      "3. Prepare two options: a minimal forward fix, and a revert of the offending change.",
      "4. Ask the operator which one to ship before opening a pull request. Never deploy or push to the default branch.",
      "5. In the pull request, include the timeline, the root cause and how you verified the fix.",
    ].join("\n"),
  },
];

export function builtinHarnessDef(b: BuiltinHarness, now = Date.now()): HarnessDef {
  const def = normalizeHarness({ id: `${BUILTIN_ID_PREFIX}${b.key}`, name: b.name, description: b.description, rules: b.rules, rulesMd: b.rulesMd }, undefined, now);
  def.builtin = b.key;
  return def;
}

/**
 * Give an owner every built-in they have not had yet — new accounts, existing accounts and the
 * token-mode operator alike, on first read. Idempotent: each built-in is seeded once per owner, so
 * deleting one hides it for good (until `restore`), and edits are never overwritten. Never pushes an
 * owner over the harness cap (a skipped one is retried when there is room). Returns how many were added.
 */
export function ensureDefaultHarnesses(owner = ownerKey(), opts: { restore?: boolean } = {}): number {
  const { harnesses: all, seeded } = parseStoreFull(loadBlob(HARNESSES_KIND, owner));
  const done = new Set(opts.restore ? [] : seeded);
  const now = Date.now();
  let added = 0;
  let changed = false;
  for (const b of BUILTIN_HARNESSES) {
    if (done.has(b.key)) continue;
    const id = `${BUILTIN_ID_PREFIX}${b.key}`;
    if (!all[id]) {
      if (Object.keys(all).length >= HARNESS_LIMITS.maxHarnesses) continue;
      all[id] = builtinHarnessDef(b, now);
      added++;
    }
    done.add(b.key);
    changed = true;
  }
  if (changed) saveAll(all, owner, [...new Set([...seeded, ...done])].sort());
  return added;
}

/* ───────────────────────────── bundles ───────────────────────────── */

export interface BundleFile {
  path: string;
  content: string;
}

export interface HarnessBundle {
  format: typeof HARNESS_BUNDLE_FORMAT;
  version: number;
  files: BundleFile[];
}

/** What harness.json holds. Deliberately no provider id, base URL or key field exists. */
export interface HarnessJson {
  format: typeof HARNESS_FORMAT;
  version: number;
  name: string;
  description?: string;
  driver?: AgentKind;
  provider?: ExportedProviderRef;
  model?: string;
  skills?: string[];
  rules: HarnessRules;
  egress?: string[];
}

/** Skill files that are secrets by NAME — never exported, whatever they contain. */
const SECRET_FILE_RE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore)|id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|credentials(\.json)?|\.npmrc|\.netrc|\.pypirc)$/i;

export function isSecretFileName(path: string): boolean {
  return SECRET_FILE_RE.test(path);
}

/**
 * Build the export bundle. `redact` is the controller redactor (known stored secrets + shapes);
 * shapes are applied again here so the pure function is safe on its own.
 */
export function buildHarnessBundle(
  h: HarnessDef,
  ctx: { provider?: Pick<ProviderRecord, "kind" | "label">; skills: SkillDef[]; redact?: (s: string) => string }
): { bundle: HarnessBundle; redacted: number; skipped: string[] } {
  let redacted = 0;
  const clean = (s: string) => {
    const a = ctx.redact ? ctx.redact(s) : s;
    const b = redactShapes(a);
    if (b !== s) redacted++;
    return b;
  };
  const skipped: string[] = [];
  const hj: HarnessJson = {
    format: HARNESS_FORMAT,
    version: HARNESS_VERSION,
    name: clean(h.name),
    ...(h.description ? { description: clean(h.description) } : {}),
    ...(h.driver ? { driver: h.driver } : {}),
    ...(ctx.provider ? { provider: { kind: ctx.provider.kind, label: clean(ctx.provider.label.slice(0, 80)) } } : {}),
    ...(h.model ? { model: clean(h.model) } : {}),
    ...(h.skills ? { skills: [...h.skills] } : {}),
    rules: { ...h.rules },
    ...(h.egress?.length ? { egress: [...h.egress] } : {}),
  };
  const files: BundleFile[] = [];
  // Strings were cleaned field by field above.
  const hjText = JSON.stringify(hj, null, 2) + "\n";
  files.push({ path: "harness.json", content: hjText });
  if (h.rulesMd) files.push({ path: "RULES.md", content: clean(h.rulesMd + "\n") });
  if (h.verifyCommand) files.push({ path: "verify.sh", content: clean(`#!/bin/sh\n# Exit code is the verdict.\n${h.verifyCommand}\n`) });
  const wanted = new Set(h.skills ?? []);
  for (const s of ctx.skills) {
    if (!wanted.has(s.name)) continue;
    files.push({ path: `skills/${s.name}/SKILL.md`, content: clean(`---\nname: ${s.name}\ndescription: ${JSON.stringify(s.description)}\n---\n\n${s.content}\n`) });
    for (const f of s.files ?? []) {
      if (isSecretFileName(f.path)) {
        skipped.push(`skills/${s.name}/${f.path} (secret file name)`);
        continue;
      }
      files.push({ path: `skills/${s.name}/${f.path}`, content: clean(f.content) });
    }
  }
  return { bundle: { format: HARNESS_BUNDLE_FORMAT, version: HARNESS_VERSION, files }, redacted, skipped };
}

export interface ParsedBundle {
  harness: HarnessJson;
  rulesMd?: string;
  verifySh?: string;
  /** Skills the bundle carries (validated, not yet stored). */
  skills: SkillDef[];
  warnings: string[];
}

/** Keys that would mean a bundle is carrying a credential or an endpoint — refused outright. */
const FORBIDDEN_KEY_RE = /(api[_-]?key|token|secret|password|passwd|credential|base[_-]?url|endpoint|authorization|private[_-]?key)/i;

/** Our own schema's names that happen to contain a forbidden word. */
const ALLOWED_KEYS = new Set(["maxTokens"]);

function scanKeys(v: unknown, path: string[] = []): string | null {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const hit = scanKeys(v[i], [...path, String(i)]);
      if (hit) return hit;
    }
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN_KEY_RE.test(k) && !ALLOWED_KEYS.has(k)) return [...path, k].join(".");
      const hit = scanKeys(x, [...path, k]);
      if (hit) return hit;
    }
  }
  return null;
}

/** Strip a verify.sh down to the command: drop the shebang and comment lines we (or anyone) add. */
export function verifyCommandOf(sh: string): string {
  return sh
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n")
    .trim();
}

const HARNESS_KEYS = new Set(["format", "version", "name", "description", "driver", "provider", "model", "skills", "rules", "egress"]);

/**
 * Parse + strictly validate a harness folder (from an uploaded bundle or a GitHub directory).
 * Throws on anything that makes the bundle untrustworthy; soft oddities become warnings.
 */
export function parseHarnessFolder(files: BundleFile[]): ParsedBundle {
  if (!Array.isArray(files) || !files.length) throw new Error("The bundle is empty.");
  if (files.length > HARNESS_LIMITS.maxBundleFiles) throw new Error(`The bundle has too many files (max ${HARNESS_LIMITS.maxBundleFiles}).`);
  let total = 0;
  const byPath = new Map<string, string>();
  for (const f of files) {
    const path = typeof f?.path === "string" ? f.path.trim() : "";
    const content = typeof f?.content === "string" ? f.content.replace(/\r\n/g, "\n") : null;
    validateSkillFilePath(path.toLowerCase() === "skill.md" ? `x/${path}` : path); // same traversal gate as skills
    if (content === null || content.includes("\0")) throw new Error(`${path} is not a text file.`);
    const n = Buffer.byteLength(content, "utf8");
    if (n > HARNESS_LIMITS.maxBundleFileBytes) throw new Error(`${path} is over ${Math.floor(HARNESS_LIMITS.maxBundleFileBytes / 1024)} KB.`);
    total += n;
    if (total > HARNESS_LIMITS.maxBundleBytes) throw new Error(`The bundle is over ${HARNESS_LIMITS.maxBundleBytes / 1_000_000} MB.`);
    if (byPath.has(path.toLowerCase())) throw new Error(`Duplicate file ${path}.`);
    byPath.set(path.toLowerCase(), content);
  }
  const hjText = byPath.get("harness.json");
  if (!hjText) throw new Error("No harness.json at the top of the folder.");
  let hj: Record<string, unknown>;
  try {
    hj = JSON.parse(hjText) as Record<string, unknown>;
  } catch {
    throw new Error("harness.json is not valid JSON.");
  }
  if (!hj || typeof hj !== "object" || Array.isArray(hj)) throw new Error("harness.json must be an object.");
  if (hj.format !== HARNESS_FORMAT) throw new Error(`harness.json format must be "${HARNESS_FORMAT}".`);
  if (typeof hj.version !== "number" || !Number.isInteger(hj.version) || hj.version < 1) throw new Error("harness.json needs an integer version.");
  if (hj.version > HARNESS_VERSION) throw new Error(`This harness uses schema version ${hj.version}; this controller reads up to ${HARNESS_VERSION}. Update the controller.`);
  const bad = scanKeys(hj);
  if (bad) throw new Error(`harness.json has a "${bad}" field — bundles must never carry keys, tokens or endpoints.`);
  // Older bundles may still carry a numeric `budget` block (ignored); keep it out of the secret-shape scan.
  const { budget: _budget, ...hjStrings } = hj;
  const shapeText = JSON.stringify(hjStrings);
  if (redactShapes(shapeText) !== shapeText) throw new Error("harness.json contains something shaped like a secret — refusing it.");
  const warnings: string[] = [];
  for (const k of Object.keys(hj)) if (!HARNESS_KEYS.has(k)) warnings.push(`harness.json: unknown field "${k}" ignored.`);

  let provider: ExportedProviderRef | undefined;
  if (hj.provider !== undefined && hj.provider !== null) {
    const p = hj.provider as Record<string, unknown>;
    if (!p || typeof p !== "object" || !PROVIDER_KINDS.includes(p.kind as ProviderKind)) throw new Error(`provider.kind must be one of ${PROVIDER_KINDS.join(", ")}.`);
    const extra = Object.keys(p).filter((k) => k !== "kind" && k !== "label");
    if (extra.length) throw new Error(`provider may only name a kind and a label (found ${extra.join(", ")}).`);
    provider = { kind: p.kind as ProviderKind, label: typeof p.label === "string" ? p.label.trim().slice(0, 80) : String(p.kind) };
  }
  // Reuse the one validator for everything else (driver, model, skills, rules, egress).
  const norm = normalizeHarness({ ...hj, providerId: undefined });

  const rulesMd = byPath.get("rules.md");
  if (rulesMd !== undefined && rulesMd.length > HARNESS_LIMITS.maxRulesMd) throw new Error("RULES.md is too long.");
  const verifyRaw = byPath.get("verify.sh");
  let verifySh: string | undefined;
  if (verifyRaw !== undefined) {
    verifySh = verifyCommandOf(verifyRaw);
    if (verifySh.length > HARNESS_LIMITS.maxVerify) throw new Error(`verify.sh is over ${HARNESS_LIMITS.maxVerify} characters.`);
    if (!verifySh) verifySh = undefined;
  }

  // skills/<name>/SKILL.md (+ supporting files)
  const skillFiles = new Map<string, { md?: string; files: SkillFile[] }>();
  for (const f of files) {
    const path = f.path.trim();
    const lower = path.toLowerCase();
    if (["harness.json", "rules.md", "verify.sh"].includes(lower)) continue;
    if (/^(readme|license|changelog)(\.[a-z]+)?$/i.test(path)) continue;
    if (lower.startsWith("hooks/")) {
      if (!warnings.some((w) => w.startsWith("hooks/"))) warnings.push("hooks/ ignored: imported bundles never install executable hooks.");
      continue;
    }
    const m = path.match(/^skills\/([^/]+)\/(.+)$/);
    if (!m) {
      warnings.push(`${path}: not part of the harness format, ignored.`);
      continue;
    }
    const [, sname, rest] = m;
    if (!NAME_RE.test(sname)) throw new Error(`skills/${sname}: skill folder names must be kebab-case.`);
    const entry = skillFiles.get(sname) ?? { files: [] };
    if (rest.toLowerCase() === "skill.md") entry.md = f.content.replace(/\r\n/g, "\n");
    else if (isSecretFileName(rest)) warnings.push(`skills/${sname}/${rest}: secret-looking file name, not imported.`);
    else entry.files.push({ path: rest, content: f.content.replace(/\r\n/g, "\n") });
    skillFiles.set(sname, entry);
  }
  const skills: SkillDef[] = [];
  for (const [sname, e] of skillFiles) {
    if (!e.md) throw new Error(`skills/${sname} has no SKILL.md.`);
    const { description, body } = splitSkillMd(e.md);
    const def = normalizeSkill({ name: sname, description: description || `Imported with harness ${norm.name}.`, content: body, files: e.files, enabled: false });
    skills.push(def);
  }
  if (skills.length > HARNESS_LIMITS.maxSkills) throw new Error(`The bundle carries too many skills (max ${HARNESS_LIMITS.maxSkills}).`);
  // A skill in the folder but not listed is still offered (listed ∪ carried); a listed one not
  // carried must already exist in the importer's library — resolved (and warned) at import time.
  const listed = new Set([...(norm.skills ?? []), ...skills.map((s) => s.name)]);

  const harness: HarnessJson = {
    format: HARNESS_FORMAT,
    version: hj.version,
    name: norm.name,
    ...(norm.description ? { description: norm.description } : {}),
    ...(norm.driver ? { driver: norm.driver } : {}),
    ...(provider ? { provider } : {}),
    ...(norm.model ? { model: norm.model } : {}),
    ...(listed.size || norm.skills ? { skills: [...listed].sort() } : {}),
    rules: norm.rules,
    ...(norm.egress ? { egress: norm.egress } : {}),
  };
  return { harness, ...(rulesMd?.trim() ? { rulesMd: rulesMd.trim() } : {}), ...(verifySh ? { verifySh } : {}), skills, warnings };
}

/** SKILL.md → {description, body}. Frontmatter is optional; only `description` is read from it. */
export function splitSkillMd(md: string): { description: string; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { description: "", body: md.trim() };
  let description = "";
  for (const line of m[1].split("\n")) {
    const d = line.match(/^description:\s*(.*)$/);
    if (d) {
      const v = d[1].trim();
      try {
        description = v.startsWith('"') ? String(JSON.parse(v)) : v.replace(/^'(.*)'$/, "$1");
      } catch {
        description = v;
      }
    }
  }
  return { description: description.slice(0, SKILL_LIMITS.maxDescription), body: m[2].trim() };
}

/** Accept an uploaded export document. */
export function parseBundleDocument(doc: unknown): BundleFile[] {
  const d = (doc && typeof doc === "object" ? doc : {}) as Record<string, unknown>;
  if (d.format !== HARNESS_BUNDLE_FORMAT) throw new Error(`Not a harness bundle (format must be "${HARNESS_BUNDLE_FORMAT}").`);
  if (typeof d.version !== "number" || d.version > HARNESS_VERSION || d.version < 1) throw new Error(`Unsupported bundle version ${String(d.version)}.`);
  if (!Array.isArray(d.files)) throw new Error("Bundle has no files.");
  return d.files as BundleFile[];
}

/**
 * Turn a parsed bundle into a stored harness + the skills to add, against the importer's current
 * library and providers. Never overwrites an existing skill: a same-name skill with different
 * content is imported under a suffixed name (a bundle must not be able to rewrite your playbooks).
 */
export function planImport(
  parsed: ParsedBundle,
  ctx: { store: SkillStore; providers: Array<Pick<ProviderRecord, "id" | "kind" | "label">>; origin: HarnessOrigin; now?: number }
): { harness: HarnessDef; addSkills: SkillDef[]; notes: string[] } {
  const now = ctx.now ?? Date.now();
  const notes = [...parsed.warnings];
  const rename = new Map<string, string>();
  const addSkills: SkillDef[] = [];
  const taken = new Set(Object.keys(ctx.store.skills));
  for (const s of parsed.skills) {
    const cur = ctx.store.skills[s.name];
    if (cur && cur.content === s.content && cur.description === s.description) continue; // identical: reuse
    let name = s.name;
    if (taken.has(name)) {
      for (let n = 2; taken.has(name); n++) name = `${s.name.slice(0, 45)}-${n}`;
      notes.push(`Skill "${s.name}" already exists in your library with different content — imported as "${name}".`);
      rename.set(s.name, name);
    }
    taken.add(name);
    addSkills.push({ ...s, name, enabled: false, addedAt: now, updatedAt: now });
  }
  const skills = parsed.harness.skills?.map((n) => rename.get(n) ?? n);
  for (const n of skills ?? []) if (!taken.has(n)) notes.push(`Skill "${n}" is listed but neither carried nor in your library — it will be skipped.`);
  let providerId: string | undefined;
  let unresolvedProvider: ExportedProviderRef | undefined;
  if (parsed.harness.provider) {
    const want = parsed.harness.provider;
    const sameKind = ctx.providers.filter((p) => p.kind === want.kind);
    const exact = sameKind.find((p) => p.label === want.label);
    const pick = exact ?? (sameKind.length === 1 ? sameKind[0] : undefined);
    if (pick) {
      providerId = pick.id;
      if (!exact) notes.push(`Provider "${want.label}" matched your ${pick.label} (same kind).`);
    } else {
      unresolvedProvider = want;
      notes.push(`This harness expects a ${want.kind} provider ("${want.label}"). Connect one, then pick it in the harness.`);
    }
  }
  const def = normalizeHarness(
    {
      name: parsed.harness.name,
      description: parsed.harness.description,
      driver: parsed.harness.driver,
      providerId,
      model: providerId || !parsed.harness.provider ? parsed.harness.model : undefined,
      skills,
      rules: parsed.harness.rules,
      rulesMd: parsed.rulesMd,
      verifyCommand: parsed.verifySh,
      egress: parsed.harness.egress,
    },
    undefined,
    now
  );
  def.needsReview = true;
  def.origin = ctx.origin;
  if (unresolvedProvider) def.unresolvedProvider = unresolvedProvider;
  return { harness: def, addSkills, notes };
}

/* ───────────────────────────── compare ───────────────────────────── */

export interface CompareSideFacts {
  box: string;
  state: string;
  verified: boolean | null;
  verifyDetail?: string;
  questions: number;
  tokens: { input: number; output: number } | null;
  /** Only when the model's price is known; never estimated. */
  costUsd: number | null;
  durationMs: number | null;
  files: string[];
  headline: string;
}

/** Receipt fields for one side of a compare, straight off the digest — absent data stays null. */
export function compareFacts(
  d: {
    box: string;
    state: string;
    verified?: { pass: boolean; detail?: string };
    questions?: unknown[];
    usage?: { inputTokens: number; outputTokens: number };
    startedAt?: number;
    endedAt?: number;
    files?: Array<{ path: string }>;
    headline?: string;
  },
  costUsd?: number | null
): CompareSideFacts {
  return {
    box: d.box,
    state: d.state,
    verified: d.verified ? d.verified.pass : null,
    ...(d.verified?.detail ? { verifyDetail: d.verified.detail.slice(0, 300) } : {}),
    questions: d.questions?.length ?? 0,
    tokens: d.usage ? { input: d.usage.inputTokens, output: d.usage.outputTokens } : null,
    costUsd: typeof costUsd === "number" && Number.isFinite(costUsd) ? costUsd : null,
    durationMs: d.startedAt && d.endedAt && d.endedAt >= d.startedAt ? d.endedAt - d.startedAt : null,
    files: (d.files ?? []).map((f) => f.path).slice(0, 200),
    headline: d.headline ?? "",
  };
}
