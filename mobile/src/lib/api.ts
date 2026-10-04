// API client mirroring web/src/lib/api.ts (same wire types, same routes).
// Auth is header-only: Bearer <operator token | asb_ api key>. The custom
// X-Requested-With header is the CSRF proof for cookie sessions; harmless
// with bearer auth, so we always send it on mutations.
import { bearer, serverUrl } from "./config";

export type RunState = "running" | "waiting" | "done" | "idle";
export type BoxRole = "session" | "pool-claimed" | "pool-free";

export interface BoxView {
  name: string;
  role: BoxRole;
  boxStatus: string; // "Running" | "Stopped"
  runState: RunState;
  exitCode?: number;
  task?: string;
  question?: string;
  uptime?: string;
  cpu?: string;
  mem?: string;
  /** `mem` parsed into numbers (MiB), for the usage meter. Total is the box's memory cap. */
  memUsage?: { usedMib: number; totalMib: number };
  /** Root-disk occupancy in MiB, from df inside the box. Absent while asleep. */
  disk?: { usedMib: number; totalMib: number };
  lastOutputAt?: number; // unix seconds
  kept?: boolean;
  title?: string;
  asleepSec?: number;
  queued?: string[];
  repos?: { name: string; branch?: string }[];
  /** Which coding agent this thread runs on ("claude" | "omp" | …). Absent on older boxes. */
  agent?: string;
  /** Running, but the log has not moved for the stall window. */
  stalled?: boolean;
  /** The saved harness this thread started on, with its one-line summary for the header. */
  harness?: { id: string; name: string; line: string };
  /** The workflow this thread is running (or just ran): step n/total and what each step did. */
  workflow?: WorkflowRunView;
  /** Skills the run was pointed at: explicit `/name` from the user, or the controller's auto match. */
  skills?: { name: string; how: "explicit" | "auto" }[];
}

export interface WorkflowRunView {
  id: string;
  name: string;
  line: string;
  state: "running" | "done" | "failed";
  step: number;
  total: number;
  history: Array<{ n: number; kind: "agent" | "check"; title: string; state: "done" | "failed"; attempts?: number; detail?: string }>;
  failure?: string;
}

/** Default coding agent for new threads. */
export type AgentId = "claude" | "omp" | "codex" | "opencode";
export interface DriverCapabilities {
  gate: "hook" | "wrapper" | "none";
  sideQuestion: boolean;
  planEvents: boolean;
  resume: boolean;
  modelSources: string[];
  caveat?: string;
}
export interface AgentChoice {
  id: AgentId;
  label: string;
  capabilities?: DriverCapabilities;
  /** false → below the supervision floor: badge "supervised: partial". */
  supervised?: boolean;
}
export interface AgentPrefs {
  defaultAgent: AgentId;
  agents: AgentChoice[];
}

/** A saved harness (src/harness.ts). Never carries a key. Mobile only picks one; editing is on web. */
export interface HarnessView {
  id: string;
  name: string;
  description?: string;
  driver?: AgentId;
  providerId?: string;
  model?: string;
  skills?: string[];
  rules: { askBeforeGuess: boolean; planFirst: boolean; verifyOnDone: boolean; autoRetry?: number };
  rulesMd?: string;
  verifyCommand?: string;
  egress?: string[];
  needsReview?: boolean;
  builtin?: string;
  createdAt: number;
  updatedAt: number;
  providerMissing?: boolean;
}
export interface WorkflowStep {
  n: number;
  kind: "agent" | "check";
  title: string;
}
export interface WorkflowView {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  origin?: { kind: "repo"; repo: string; path: string; ref?: string } | { kind: "manual" };
  createdAt: number;
  updatedAt: number;
}

/** What a memory note is (src/memory-store.ts). */
export type MemoryKind = "preference" | "rule" | "domain" | "fact" | "decision" | "lesson" | "playbook";
export interface MemoryNote {
  id: string;
  kind: MemoryKind;
  scope: "operator" | "repo";
  /** pending = proposed by a run, awaiting confirmation (auto-kept after a while); kept = confirmed. */
  status: "pending" | "kept";
  text: string;
  why?: string;
  at: number;
  source: string;
  repo?: string;
  pinned?: boolean;
  supersedes?: string;
  until?: number;
  uses?: number;
  lastUsed?: number;
  area?: string;
  paths?: string[];
  links?: string[];
  stale?: { at: number; box: string; paths: string[] };
  history?: { id: string; text: string; why?: string; at: number; source: string; until?: number }[];
}
export interface MemoryNotesResponse {
  enabled: boolean;
  notes: MemoryNote[];
}
/** A note a running box just produced, carried on the watch snapshot so the thread can offer Keep / Forget. */
export interface MemoryNew {
  id: string;
  kind: MemoryKind;
  text: string;
  why?: string;
  status: "pending" | "kept";
  at: number;
  area?: string;
  /** The text of the older note this one rewrote. */
  revises?: string;
}

export interface McpProbe {
  ok: boolean;
  status?: number;
  detail: string;
  tools?: string[];
}

export type ProviderKind = "anthropic" | "openai" | "openai-compatible" | "ollama" | "ccproxy";
export interface ProviderView {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  hasKey: boolean;
  apiKeyMasked: string | null;
  models?: string[];
  modelsFetchedAt?: string;
  source: string;
  drivers: AgentId[];
}
export interface ProvidersResponse {
  providers: ProviderView[];
  kinds: { id: ProviderKind; label: string; drivers: AgentId[] }[];
  cliLoginPolicy: string;
}
export interface LedgerTotals {
  runs: number;
  done: number;
  failed: number;
  checked: number;
  passed: number;
  inputTokens: number;
  outputTokens: number;
  withUsage: number;
  /** null when no run in the set reported a cost — never an estimate. */
  costUsd: number | null;
  withCost: number;
}

/** One stored audit event, raw from the controller — the UI derives the human verb. */
export interface AuditEventRow {
  id: number;
  at: string;
  method: string;
  path: string;
  status: number;
  session: string | null;
  action: string | null;
  client: string | null;
}

export interface FleetLifecycle {
  idleTimeoutSec?: number;
  poolIdleTimeoutSec?: number;
  maxDurationSec?: number;
  capacity: number;
  poolSize: number;
  sleepTtlSec?: number;
  /** Memory tiers a box may be resized to. Server-supplied so the app never hardcodes them. */
  memoryTiers?: string[];
  /** The tier every new box boots with. */
  memoryDefault?: string;
  /** Root-disk tiers a box may GROW to — the runtime cannot shrink a managed disk. */
  diskTiers?: string[];
}

export interface FleetSnapshot {
  boxes: BoxView[];
  lifecycle: FleetLifecycle;
  at: number;
}

export interface WatchSnapshot extends Omit<BoxView, "role"> {
  log: string;
  /** Notes this box produced recently; absent on older controllers. */
  memoryNew?: MemoryNew[];
}

export interface RepoInfo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  pushedAt?: string;
  logins: string[];
  description?: string;
}

export interface ChangedFile {
  path: string;
  repo?: string;
  status: "modified" | "added" | "deleted" | "untracked" | "renamed";
  additions: number;
  deletions: number;
}

export interface GitStatus {
  repo: string;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  lastCommit?: string;
  clean: boolean;
  changed: number;
}

export interface FileDiff {
  path: string;
  diff: string;
  untracked: boolean;
  binary: boolean;
  original?: string;
}

export interface PullInfo {
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged" | "draft";
  additions: number;
  deletions: number;
  changedFiles: number;
  head: string;
  base: string;
  author?: string;
  url: string;
  mergeable?: boolean | null;
  reviewDecision?: "approved" | "changes_requested" | "review_required" | null;
  reviewers?: { login: string; state: "approved" | "changes_requested" | "commented" | "pending" }[];
  checks?: { total: number; success: number; failure: number; pending: number };
}

/** Mirrors `PullDetail` in src/changes.ts and web/src/lib/api.ts — the PR screen's payload. */
export interface PullDetail extends PullInfo {
  body?: string;
  labels?: { name: string; color?: string }[];
  assignees?: string[];
  milestone?: string;
  createdAt?: string;
  updatedAt?: string;
  commits?: { sha: string; message: string; author?: string; date?: string }[];
  files?: { path: string; status: string; additions: number; deletions: number; patch?: string }[];
  comments?: { id: string; author?: string; body: string; at?: string; kind: "comment" | "review"; state?: string }[];
  checkRuns?: { name: string; status: string; conclusion?: string | null; url?: string }[];
  truncated?: boolean;
}

// ---- run digest (mirrors src/digest.ts RunDigest) ----
export interface DigestFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}
export interface DigestPlanStep {
  text: string;
  state: "done" | "active" | "todo";
  /** True when an err-marked tool call ran while this step was the active one. */
  failed?: boolean;
}
export interface RunDigest {
  box: string;
  task: string;
  state: "done" | "failed" | "waiting" | "running";
  exitCode?: number;
  /** Wall-clock ms from the first/last plan sentinel stamps. */
  startedAt?: number;
  endedAt?: number;
  plan: DigestPlanStep[];
  files: DigestFile[];
  failedCommands: { name: string; arg?: string }[];
  questions: { question: string; answer?: string }[];
  /** One sentence for notifications and list rows. */
  headline: string;
  /** Post-run verification outcome, when the delegate asked for one. */
  verified?: { mode: "command" | "criterion"; pass: boolean; detail: string };
}

// ---- run history (server-side archive of finished runs) ----
export interface HistoryRun {
  id: number;
  box: string;
  owner: string;
  task: string;
  state: "done" | "failed";
  exitCode: number;
  startedAt: number;
  endedAt: number;
  archivedAt: number;
  headline: string;
  outcome?: RunOutcome | null;
}
/** Mirrors SetupProfile in src/setup-profile.ts. Env vars are names only — never values. */
export interface RepoSetupProfile {
  v: 1;
  install?: string;
  build?: string;
  test?: string;
  lint?: string;
  runtimes: Record<string, string>;
  envVars: string[];
  notes?: string;
  detectedAt: number;
  confirmedBy: "detected" | "agent" | "user";
}
export interface RepoSetupsResponse {
  profiles: Array<{ repo: string; profile: RepoSetupProfile; updatedAt: number }>;
}

/** Mirrors RunOutcome in src/outcome.ts — the outcome card. null means unknown: render "—". */
export interface RunOutcome {
  v: 1;
  state: "done" | "failed" | "waiting" | "running";
  header: { startedBy: { kind: string } | null; label: string | null; link: { href: string; external: boolean } | null };
  result: {
    prs: { url: string; repo: string; number: number }[];
    diff: { files: number; additions: number; deletions: number } | null;
    followedBy?: { box: string; archiveId: number | null } | null;
    followups?: Array<{ box: string; kind: "ci" | "review"; subject: string; attempt: number; state: "running" | "done" | "failed"; archiveId: number | null; at: number; pr: { repo: string; number: number }; line?: string }>;
  };
  trust: {
    tests: { runner: string; passed: number; failed: number; skipped: number; source: "verify" | "trace" } | null;
    exitCode: number | null;
    verified: { pass: boolean; mode: string } | null;
    /** The verify command that ran; absent on outcomes archived before it existed. */
    testedWith?: string | null;
    prOnly: boolean;
    questions: number;
    openQuestions: number;
    blocked: number;
  };
  cost: {
    durationMs: number | null;
    tokens: { input: number; output: number } | null;
    usd: number | null;
    model: string | null;
  };
}
export interface HistoryDetail extends HistoryRun {
  /** Full receipt when the archiver captured one; null for runs that left no digest. */
  digest: RunDigest | null;
}

export type McpTransport = "stdio" | "http" | "sse";
export interface McpServerView {
  name: string;
  type: McpTransport;
  tokenExpiresAt?: string;
  tokenExpired?: boolean;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled: boolean;
  addedAt: number;
}
export interface McpServersResponse {
  servers: McpServerView[];
  config: { mcpServers: Record<string, unknown> };
}

export interface SkillView {
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  addedAt: number;
  updatedAt: number;
}

export interface AccountView {
  login: string;
  type: "classic" | "fine-grained" | "unknown";
  orgs: string[];
  verifiedRepos: string[];
  tokenHint: string;
  isDefault: boolean;
}
export interface AccountsResponse {
  accounts: AccountView[];
  oauth: boolean;
}
export type DevicePoll =
  | { status: "pending"; interval?: number }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "error"; message: string }
  | { status: "done"; login: string; accounts: AccountView[] };

export interface QueuedMessage {
  id: string;
  text: string;
  at: number;
}

export interface AskResult {
  answer: string;
  timedOut: boolean;
  continued: boolean;
  driverState?: string;
}

export interface SessionRow {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  ip: string | null;
  userAgent: string | null;
}
export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
export interface UserRow {
  id: string;
  login: string;
  email: string | null;
  role: "user" | "admin";
  maxBoxes: number | null;
  createdAt: string;
  lastSeenAt: string | null;
  github: boolean;
  keys: number;
  boxes: number;
  name?: string | null;
  plan: "trial" | "pro" | "free";
  trialEndsAt: string | null;
  daysLeft: number | null;
  expired: boolean;
}
export interface AuthConfig {
  mode: "token" | "saas";
  providers: string[];
  tokenLogin?: boolean;
  password?: boolean;
  signup?: boolean;
  passwordMin?: number;
  trialDays?: number;
  billingUrl?: string | null;
  beta?: boolean;
}
export type Me =
  | { kind: "operator"; mode: "token" | "saas"; role: "admin" }
  | {
      kind: "user";
      mode: "token" | "saas";
      id: string;
      login: string;
      name: string | null;
      role: "user" | "admin";
      via: "session" | "apikey";
      email: string | null;
      avatarUrl: string | null;
      github: boolean;
      hasPassword: boolean;
      maxBoxes: number;
      plan: "trial" | "pro" | "free";
      trialEndsAt: string | null;
      daysLeft: number | null;
      expired: boolean;
      billingUrl: string | null;
    };

export interface NotifySettings {
  url?: string;
  events: { waiting: boolean; done: boolean; failed: boolean };
  fallbackConfigured?: boolean;
}

/** Mirrors GET /triggers.json rows (src/trigger-store.ts). Stamps are epoch ms. Never carries a secret. */
export interface AutomationResult {
  at: number;
  outcome: "started" | "skipped" | "failed";
  box?: string;
  reason?: string;
  finished?: { state: string; headline: string; archiveId?: number };
}
export type AutomationKind = "schedule" | "webhook" | "github" | "chain";
export type GithubEvent = "issue_labeled" | "issue_comment" | "pr_opened";
export type AlertPreset = "sentry" | "datadog" | "pagerduty";
export interface AutomationSpec {
  keepGreen?: boolean;
  addressReviews?: boolean;
  cron?: string;
  /** One-time run at this epoch ms (chat schedules). */
  at?: number;
  timezone?: string;
  event?: GithubEvent;
  label?: string;
  command?: string;
  allowForks?: boolean;
  afterTrigger?: string;
  on?: "done" | "any";
  carry?: "patch" | "none";
  preset?: AlertPreset;
  cooldownMin?: number;
}
/** What the editor sends (POST /triggers.json, POST /triggers/:id.json). */
export interface AutomationDraft {
  name: string;
  kind: AutomationKind;
  spec: AutomationSpec;
  repo?: string;
  taskTemplate: string;
  enabled: boolean;
  concurrency: number;
  prComment: boolean;
  quiet?: boolean;
  agent?: string;
  model?: string;
  harnessId?: string;
  workflowId?: string;
  /** Write-only: the vendor's signing secret. */
  signingSecret?: string;
}
/** scheduled: made from a chat (usually once) · automation: a standing rule. */
export type AutomationScope = "scheduled" | "automation";
export type ScheduleStatus = "needs-ok" | "waiting" | "running" | "done" | "failed" | "paused" | "cancelled";
export interface Automation extends AutomationDraft {
  id: string;
  when: string;
  scope: AutomationScope;
  status: ScheduleStatus;
  sourceBox?: string;
  sourceTitle?: string;
  lastFired: number | null;
  nextFire: number | null;
  lastResult: AutomationResult | null;
  hasPayload: boolean;
  hasSigningSecret?: boolean;
  lastDelivery?: AutomationDelivery;
  /** Proposed by an agent at the end of a run; paused until enabled (approve) or deleted (dismiss). */
  proposed?: boolean;
  counts?: { checked: number; reports: number };
  active: number;
  createdAt: number;
  updatedAt: number;
}
/** Something scheduled as part of one thread (GET /triggers/for-box.json). */
export interface ThreadScheduleItem {
  id: string;
  name: string;
  /** proposed: waiting on you · created: scheduled from here · repeats: the schedule that started this thread · after: a chain that follows it */
  relation: "proposed" | "created" | "repeats" | "after";
  category: "ci" | "deploy" | "monitor" | "report" | "follow-up" | "maintenance" | "task";
  when: string;
  cron?: string;
  at?: number;
  scope: AutomationScope;
  status: ScheduleStatus;
  nextFire: number | null;
  lastFired: number | null;
  lastOutcome?: string;
  lastBox?: string;
  repo?: string;
  enabled: boolean;
  task: string;
  why?: string;
}
export interface ThreadScheduleReject {
  scope: AutomationScope;
  when: string;
  task: string;
  reason: string;
}
/** One row of an automation's delivery log, newest first (GET /triggers/:id/deliveries.json). */
export interface AutomationDelivery {
  id: number;
  at: number;
  outcome: "fired" | "skipped" | "rejected" | "failed";
  reason?: "cooldown" | "disabled" | "limit" | "dedupe" | "ignored" | "signature" | "payload" | "error";
  detail?: string;
  box?: string;
  test?: boolean;
}

/** "Tries several approaches" (GET /attempt-groups.json). Stamps are epoch ms. */
export type AttemptGroupStatus = "running" | "deciding" | "needs-pick" | "decided" | "no-winner" | "failed";
export interface AttemptFacts {
  state: string;
  exitCode: number | null;
  verified: boolean | null;
  tests: { passed: number; failed: number } | null;
  diffLines: number | null;
  files: number | null;
  costUsd: number | null;
  tokens: number | null;
  durationMs: number | null;
}
export interface AttemptView {
  index: number;
  label: string;
  branch: string;
  box: string | null;
  error: string | null;
  tornDown: boolean;
  winner: boolean;
  facts: AttemptFacts | null;
}
export interface AttemptGroupView {
  id: string;
  task: string;
  status: AttemptGroupStatus;
  createdAt: number;
  deadlineAt: number;
  winnerBox: string | null;
  decidedBy: "auto" | "user" | null;
  decidedAt: number | null;
  overrideUntil: number | null;
  question: string | null;
  choices: { label: string; answer: string; index: number; box: string | null }[];
  prUrls: string[];
  note: string | null;
  attempts: AttemptView[];
}
export interface AttemptGroupRow {
  id: string;
  task: string;
  status: AttemptGroupStatus;
  createdAt: number;
  winnerBox: string | null;
  prUrls: string[];
  attempts: { index: number; box: string | null; label: string }[];
}

export type DelegateResult =
  | {
      ok: true;
      box: string;
      warm: boolean;
      output: string;
      inferred?: string[];
      harness?: { id: string; name: string; applied: string[] };
      attemptGroup?: { id: string; attempts: Array<{ index: number; box: string | null; label: string; branch: string; error?: string }> };
    }
  | { ok: false; question: string };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export function authHeaders(mutating = true): Record<string, string> {
  const t = bearer();
  return {
    ...(mutating ? { "x-requested-with": "agent-sandbox" } : {}),
    ...(t ? { authorization: `Bearer ${t}` } : {}),
  };
}

function url(path: string, params: Record<string, string> = {}): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${serverUrl()}${path}${qs ? `?${qs}` : ""}`;
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = null;
  }
  if (res.status === 401) onUnauthorized?.();
  if (!res.ok || body === null) {
    const msg =
      body && typeof body.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

/**
 * Every request gets a deadline. `fetch` in RN has none, so a server that accepts the connection and
 * then never answers leaves the caller spinning forever — that is exactly what a wedged fleet read
 * looked like on the box screen: "Waking the sandbox…" counting up past a minute with no error. A
 * rejection at least reaches the error path the screens already have.
 *
 * 45s is generous: a cold delegate boots a microVM and copies a repo in. Reads are much shorter.
 */
const READ_TIMEOUT_MS = 20_000;
const WRITE_TIMEOUT_MS = 45_000;
/** Lanes that wait on the agent itself (resume/ask/delegate) — minutes, not seconds, but still bounded. */
const AGENT_TIMEOUT_MS = 300_000;

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ac.signal });
  } catch (e) {
    if (ac.signal.aborted) throw new ApiError(`The server did not respond within ${Math.round(timeoutMs / 1000)}s.`, 0);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  return fetchWithTimeout(url(path, params), { headers: authHeaders(false) }, READ_TIMEOUT_MS).then((r) => parse<T>(r));
}

async function post<T>(path: string, body: unknown, timeoutMs = WRITE_TIMEOUT_MS): Promise<T> {
  return fetchWithTimeout(
    url(path),
    {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
  ).then((r) => parse<T>(r));
}

async function del<T>(path: string, params: Record<string, string> = {}, body?: unknown): Promise<T> {
  return fetchWithTimeout(
    url(path, params),
    {
      method: "DELETE",
      headers: { ...authHeaders(), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    },
    WRITE_TIMEOUT_MS,
  ).then((r) => parse<T>(r));
}

export const api = {
  // ---- auth / identity ----
  authConfig: () => get<AuthConfig>("/auth/config.json"),
  signup: (u: { login: string; name: string; email: string; password: string }) =>
    post<{ ok: true; id: string; login: string; role: string }>("/auth/signup", u),
  login: (login: string, password: string) =>
    post<{ ok: true; id: string; login: string; role: string }>("/auth/login", { login, password }),
  logout: () => post<{ ok: true }>("/auth/logout", {}),
  me: () => get<Me>("/me.json"),
  updateAccount: (p: { name?: string; email?: string | null; currentPassword?: string; newPassword?: string }) =>
    post<{ ok: true }>("/account.json", p),
  sessions: () => get<{ sessions: SessionRow[] }>("/sessions.json"),
  revokeSession: (id: string) => del<{ ok: true }>("/sessions.json", {}, { id }),
  revokeOtherSessions: () => del<{ ok: true; revoked: number }>("/sessions.json", {}, { others: true }),
  apiKeys: () => get<{ keys: ApiKeyRow[] }>("/api-keys.json"),
  createApiKey: (name: string) => post<{ id: string; token: string; prefix: string }>("/api-keys.json", { name }),
  revokeApiKey: (id: string) => del<{ ok: true }>("/api-keys.json", {}, { id }),

  // ---- admin ----
  users: () => get<{ users: UserRow[] }>("/users.json"),
  createUser: (login: string, role: "user" | "admin") =>
    post<{ id: string; login: string; role: string; token: string }>("/users.json", { login, role }),
  issueUserKey: (id: string) => post<{ id: string; token: string; prefix: string }>("/users/key.json", { id }),
  setUserRole: (id: string, role: "user" | "admin") => post<{ ok: true }>("/users/role.json", { id, role }),
  setUserPlan: (id: string, plan: "trial" | "pro" | "free", days?: number) =>
    post<{ ok: true }>("/users/plan.json", { id, plan, days }),
  deleteUser: (id: string) => del<{ ok: true }>("/users.json", {}, { id }),

  // ---- fleet & lifecycle ----
  fleet: async (): Promise<FleetSnapshot> => {
    const snap = await get<FleetSnapshot>("/fleet.json");
    return { ...snap, lifecycle: snap.lifecycle ?? { capacity: 0, poolSize: 0 } };
  },
  watch: (session: string) => get<WatchSnapshot>("/watch.json", { session }),
  /** The run receipt for a finished thread — headline, plan, files, questions. */
  digest: (session: string) => get<RunDigest>("/digest.json", { session }),
  /** Archived finished runs, reverse-chron. `before` pages past the given id; `limit` caps at 50 server-side. */
  history: (opts: { limit?: number; before?: number } = {}) =>
    get<{ runs: HistoryRun[] }>("/history.json", {
      ...(opts.limit !== undefined ? { limit: String(opts.limit) } : {}),
      ...(opts.before !== undefined ? { before: String(opts.before) } : {}),
    }),
  /** One archived run with its full digest (null when none was captured). */
  historyDetail: (id: number) => get<{ run: HistoryDetail }>("/history.json", { id: String(id) }),
  /** The outcome card of an archived run: by archive id, or the latest record for a box. */
  outcome: (q: { id: number } | { box: string }) =>
    get<{ id: number; box: string; outcome: RunOutcome }>("/history/outcome.json", "id" in q ? { id: String(q.id) } : { box: q.box }),
  attemptGroups: () => get<{ groups: AttemptGroupRow[] }>("/attempt-groups.json"),
  attemptGroup: (id: string) => get<AttemptGroupView>("/attempt-groups.json", { id }),
  attemptGroupOfBox: (box: string) => get<{ group: AttemptGroupView | null; index?: number }>("/attempt-groups.json", { box }),
  /** Override the winner ({box}) or answer a tie ({choice}: index into `choices`). */
  attemptPick: (id: string, pick: { box: string } | { choice: number }) =>
    post<AttemptGroupView>("/attempt-groups.json", { id, ...pick }),
  /** Remove one archived run's receipt permanently. */
  historyDelete: (id: number) => del<{ ok: true }>("/history.json", { id: String(id) }),
  delegate: (input: {
    task: string;
    repos?: { repo: string; ref?: string }[];
    attachments?: { name: string; dataUrl: string }[];
    model?: string;
    /** Exactly one key: a sandbox command (exit 0 = verified) or a plain-language criterion. */
    verify?: { command: string } | { criterion: string };
    /** Coding agent for the new thread; omit to use the stored default. */
    agent?: AgentId;
    /** Sent only after the user saw the "supervised: partial" badge for a below-floor driver. */
    allowPartialSupervision?: boolean;
    /** A saved model provider id; the model then comes from its list. */
    provider?: string;
    /** A saved harness id: fills the fields this input leaves out (explicit fields win). */
    harness?: string;
    /** A saved workflow id: the task becomes its first step. */
    workflow?: string;
    /** Run as 1-3 parallel attempts; the controller picks the winner. */
    attempts?: 1 | 2 | 3;
    attemptSpecs?: Array<{ agent?: string; model?: string; provider?: string; harness?: string }>;
  }) => post<DelegateResult>("/delegate.json", { source: "git", ...input }, AGENT_TIMEOUT_MS),
  /** Stop the running turn now. The box stays up; the thread can be resumed. */
  interrupt: (session: string) => post<{ ok: true; stopped: boolean }>("/interrupt.json", { session }),
  resume: (session: string, message: string, opts: { force?: boolean; model?: string } = {}) =>
    post<{ output: string; queued?: undefined } | { queued: true; id: string }>("/resume.json", {
      session,
      message,
      force: opts.force,
      ...(opts.model ? { model: opts.model } : {}),
    }, AGENT_TIMEOUT_MS),
  ask: (session: string, question: string, newThread = false) =>
    post<AskResult>("/ask.json", { session, question, newThread }, AGENT_TIMEOUT_MS),
  teardown: (session: string) => post<{ ok: true }>("/teardown.json", { session }),
  keep: (session: string, keep: boolean) => post<{ ok: true; kept: boolean }>("/keep.json", { session, keep }),
  wake: (session: string) => post<{ ok: true }>("/wake.json", { session }),
  sleep: (session: string) => post<{ ok: true }>("/sleep.json", { session }),
  /** Resize a box's memory. Always reboots the machine — this runtime has no live resize. */
  setMemory: (session: string, memory: string) =>
    post<{ ok: true; memory: string }>("/memory.json", { session, memory }),
  /** Grow a box's root disk. Grow-only and always reboots; the server rejects a smaller tier. */
  setDisk: (session: string, disk: string) => post<{ ok: true; disk: string }>("/disk.json", { session, disk }),
  rename: (session: string, title: string) => post<{ title: string }>("/rename.json", { session, title }),
  title: (session: string) => post<{ title?: string }>("/title.json", { session }),
  inbox: (session: string) => get<{ queued: QueuedMessage[] }>("/inbox.json", { session }),
  sendNow: (session: string, id: string) => post<{ ok: true; queued: QueuedMessage[] }>("/send-now.json", { session, id }),
  dequeue: (session: string, id?: string) =>
    del<{ queued: QueuedMessage[] }>("/inbox.json", id ? { session, id } : { session }),

  // ---- checkpoints ----
  revertPoints: (session: string) => get<{ messages: number[] }>("/revert-points.json", { session }),
  revert: (session: string, message: number) => post<{ ok: true; message: number }>("/revert.json", { session, message }),

  // ---- code / repo ----
  changes: (session: string) => get<{ files: ChangedFile[] }>("/changes.json", { session }),
  diff: (session: string, path: string) => get<FileDiff>("/diff.json", { session, path }),
  files: (session: string, q: string) =>
    get<{ files: string[]; total: number; truncated: boolean }>("/files.json", { session, q }),
  tree: (session: string) => get<{ files: string[]; total: number; truncated: boolean }>("/tree.json", { session }),
  /** Write a workspace file (UTF-8 text). */
  writeFile: (session: string, path: string, content: string) =>
    fetchWithTimeout(
      url("/file.json"),
      { method: "PUT", headers: { ...authHeaders(), "content-type": "application/json" }, body: JSON.stringify({ session, path, content }) },
      WRITE_TIMEOUT_MS,
    ).then((r) => parse<{ ok: true; path: string; bytes: number }>(r)),
  /** The whole run's diff as one unified patch (review-all). */
  runDiff: (session: string) => get<{ diff: string }>("/rundiff.json", { session }),
  fileText: async (session: string, path: string): Promise<string> => {
    const res = await fetchWithTimeout(url("/artifact", { session, path }), { headers: authHeaders(false) }, READ_TIMEOUT_MS);
    if (res.status === 401) onUnauthorized?.();
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new ApiError(typeof body.error === "string" ? body.error : `Request failed (${res.status})`, res.status);
    }
    return res.text();
  },
  /** The URL a produced file can be shared/opened from (bearer must be attached by the caller). */
  artifactUrl: (session: string, path: string) => url("/artifact", { session, path }),
  gitStatus: (session: string, repo: string) => post<GitStatus>("/git.json", { session, repo, action: "status" }),
  gitCommit: (session: string, repo: string, message: string) =>
    post<{ sha: string; summary: string }>("/git.json", { session, repo, action: "commit", message }),
  gitPush: (session: string, repo: string) => post<{ output: string }>("/git.json", { session, repo, action: "push" }),
  pull: (repo: string, number: number) => get<PullInfo>("/pr.json", { repo, number: String(number) }),
  mergePull: (
    session: string,
    repo: string,
    number: number,
    opts?: { method?: "merge" | "squash" | "rebase"; auto?: boolean; admin?: boolean },
  ) => post<{ ok: true; auto: boolean; output: string }>("/pr/merge.json", { session, repo, number, ...opts }),
  approvePull: (session: string, repo: string, number: number) =>
    post<{ ok: true; output: string }>("/pr/approve.json", { session, repo, number }),
  /** Everything the dedicated PR screen shows, in one request. */
  pullDetail: (repo: string, number: number) => get<PullDetail>("/pr/detail.json", { repo, number: String(number) }),
  commentPull: (session: string, repo: string, number: number, body: string) =>
    post<{ ok: true; output: string }>("/pr/comment.json", { session, repo, number, body }),
  reviewPull: (session: string, repo: string, number: number, event: "approve" | "request-changes" | "comment", body?: string) =>
    post<{ ok: true; output: string }>("/pr/review.json", { session, repo, number, event, body }),
  setPullState: (session: string, repo: string, number: number, action: "close" | "reopen" | "ready") =>
    post<{ ok: true; output: string }>("/pr/state.json", { session, repo, number, action }),

  // ---- integrations ----
  accounts: () => get<AccountsResponse>("/accounts.json"),
  addAccount: (token: string) => post<{ accounts: AccountView[]; added: string }>("/accounts.json", { token }),
  removeAccount: (login: string) => del<{ accounts: AccountView[] }>("/accounts.json", { login }),
  setDefaultAccount: (login: string) => post<{ accounts: AccountView[] }>("/accounts/default.json", { login }),
  deviceStart: () =>
    post<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }>(
      "/accounts/device.json",
      {},
    ),
  devicePoll: (device_code: string) => post<DevicePoll>("/accounts/device/poll.json", { device_code }),
  repos: (q: string, refresh = false) =>
    get<{ repos: RepoInfo[] }>("/repos.json", refresh ? { q, refresh: "1" } : { q }),
  attachRepo: (session: string, repo: string, ref?: string) =>
    post<{ ok: true; name: string; login?: string }>("/repos/attach.json", { session, repo, ref }),
  skills: () => get<{ skills: SkillView[] }>("/skills.json"),
  skillMutate: (body: Record<string, unknown>) => post<{ skills: SkillView[] }>("/skills.json", body),
  mcpServers: () => get<McpServersResponse>("/mcp-servers.json"),
  mcpMutate: (body: Record<string, unknown>) => post<McpServersResponse>("/mcp-servers.json", body),
  mcpTest: (name: string) => post<McpProbe>("/mcp-servers/test.json", { name }),
  /** Browse a GitHub repo for SKILL.md folders / import them (body mirrors web/src/lib/skillImport.ts). */
  skillRepo: <T,>(body: Record<string, unknown>) => post<T>("/skill-repo.json", body),

  // ---- memory across runs (not /memory.json, which is the VM's RAM) ----
  memoryNotes: () => get<MemoryNotesResponse>("/memory-notes.json"),
  memoryNoteUpdate: (
    body:
      | { enabled: boolean }
      | { id: string; text?: string; why?: string; pinned?: boolean; status?: "kept"; area?: string; paths?: string; links?: string; verified?: boolean; repo?: string },
  ) => post<MemoryNotesResponse>("/memory-notes.json", body),
  memoryNoteAdd: (add: { kind: MemoryKind; text: string; why?: string; repo?: string; area?: string }) =>
    post<MemoryNotesResponse>("/memory-notes.json", { add }),
  memoryNoteDelete: (id: string) => del<MemoryNotesResponse>("/memory-notes.json", { id }),
  /** Turn a playbook note into a skill draft. 409 when a skill of that name exists. */
  memoryPromote: (id: string) => post<{ skill: { name: string }; enabled: boolean; notes: MemoryNote[] }>("/memory-promote.json", { id }),

  // ---- composer choices: agents, harnesses, workflows ----
  agentPrefs: () => get<AgentPrefs>("/agent-prefs.json"),
  saveAgentPrefs: (defaultAgent: AgentId, allowPartialSupervision?: boolean) =>
    post<AgentPrefs>("/agent-prefs.json", { defaultAgent, ...(allowPartialSupervision ? { allowPartialSupervision } : {}) }),
  harnesses: () => get<{ harnesses: HarnessView[]; limits: Record<string, number>; builtins?: number }>("/harnesses.json"),
  workflows: () => get<{ workflows: WorkflowView[]; limits: Record<string, number>; dir: string }>("/workflows.json"),
  harnessMutate: (body: Record<string, unknown>) =>
    post<{ harnesses: HarnessView[]; limits: Record<string, number>; builtins?: number; saved?: string }>("/harnesses.json", body),
  workflowMutate: (body: Record<string, unknown>) =>
    post<{ workflows: WorkflowView[]; limits: Record<string, number>; dir: string; saved?: string; imported?: string[]; skipped?: string[] }>("/workflows.json", body),
  workflowPreview: (yaml: string) => post<{ ok: true; workflow: WorkflowView }>("/workflows.json", { action: "preview", yaml }),
  workflowYaml: (id: string) => get<{ id: string; yaml: string; filename: string }>("/workflows/yaml.json", { id }),

  // ---- providers ----
  /** Model providers: the caller's own keys/endpoints. Keys come back masked only. */
  providers: () => get<ProvidersResponse>("/providers.json"),
  saveProvider: (body: { id?: string; kind: ProviderKind; label?: string; baseUrl?: string; apiKey?: string }) =>
    post<ProvidersResponse & { saved: string }>("/providers.json", body),
  deleteProvider: (id: string) => post<ProvidersResponse>("/providers/delete.json", { id }),
  providerModels: (id: string, force?: boolean) =>
    post<{ models: string[]; cached: boolean; error?: string }>("/providers/models.json", { id, ...(force ? { force } : {}) }),
  /** History ledger totals over the archive (rows ignored here; the list pages separately). */
  ledger: (since?: number) => get<{ totals: LedgerTotals }>("/history/ledger.json", { limit: "1", ...(since ? { since: String(since) } : {}) }),

  // ---- audit ----
  audit: (opts: { limit?: number; before?: string; beforeId?: number } = {}) =>
    get<{ events: AuditEventRow[] }>("/audit.json", {
      ...(opts.limit ? { limit: String(opts.limit) } : {}),
      ...(opts.before ? { before: opts.before } : {}),
      ...(opts.beforeId != null ? { beforeId: String(opts.beforeId) } : {}),
    }),
  repoSetups: () => get<RepoSetupsResponse>("/repo-setup.json"),
  saveRepoSetup: (repo: string, profile: Partial<RepoSetupProfile>) => post<RepoSetupsResponse>("/repo-setup.json", { repo, profile }),
  resetRepoSetup: (repo: string) => post<RepoSetupsResponse>("/repo-setup/delete.json", { repo }),
  notifySettings: () => get<NotifySettings>("/notify.json"),
  saveNotifySettings: (s: { url?: string; events?: Partial<NotifySettings["events"]> }) =>
    post<NotifySettings>("/notify.json", s),
  testNotify: () => post<{ ok: true }>("/notify/test.json", {}),
  pushRegister: (token: string, platform: string) => post<{ ok: true; id: string }>("/push/register.json", { token, platform }),
  /** Answer from a notification action: one-use nonce + choice index (server: src/answer-choice.ts). */
  answerQuestion: (box: string, nonce: string, choice: number) =>
    post<{ ok: true; already?: boolean; answer?: string }>("/questions/answer.json", { box, nonce, choice }, AGENT_TIMEOUT_MS),
  pushTest: () => post<{ ok: boolean; devices: number; accepted: number; errors: string[] }>("/push/test.json", {}),
  pushUnregister: (token: string) => post<{ ok: true; removed: boolean }>("/push/unregister.json", { token }),

  automations: () => get<{ triggers: Automation[] }>("/triggers.json"),
  setAutomationEnabled: (id: string, enabled: boolean) =>
    post<{ trigger: Automation }>(`/triggers/${encodeURIComponent(id)}/enabled.json`, { enabled }),
  runAutomation: (id: string) => post<{ result: AutomationResult }>(`/triggers/${encodeURIComponent(id)}/run.json`, {}),
  testAutomation: (id: string) => post<{ ok: boolean; result?: AutomationResult; skipped?: string; ignored?: string }>(`/triggers/${encodeURIComponent(id)}/test.json`, {}),
  automationDeliveries: (id: string) => get<{ deliveries: AutomationDelivery[] }>(`/triggers/${encodeURIComponent(id)}/deliveries.json`),
  createAutomation: (t: AutomationDraft) => post<{ trigger: Automation; secret?: string; hookUrl?: string }>("/triggers.json", t),
  updateAutomation: (id: string, t: AutomationDraft) => post<{ trigger: Automation }>(`/triggers/${encodeURIComponent(id)}.json`, t),
  deleteAutomation: (id: string) => del<{ ok: true }>(`/triggers/${encodeURIComponent(id)}.json`),
  /** Render a task template with sample payload fields; `missing` lists placeholders nothing fills. */
  previewAutomation: (taskTemplate: string, id?: string, name?: string) =>
    post<{ text: string; missing: string[]; hasPayload: boolean }>("/triggers/preview.json", { taskTemplate, id, name }),
  /** Schedules proposed / created from one thread, plus anything the controller could not read. */
  threadSchedules: (box: string) =>
    get<{ items: ThreadScheduleItem[]; rejected?: ThreadScheduleReject[] }>("/triggers/for-box.json", { box }),

  models: (session?: string) =>
    get<{ default: string; current: string; models: { id: string; label: string; tier: "opus" | "sonnet" | "haiku" | "other" }[] }>(
      "/models.json",
      session ? { session } : {},
    ),

  verifyToken: async (token: string): Promise<boolean> => {
    const res = await fetch(url("/fleet.json"), { headers: { authorization: `Bearer ${token}` } });
    return res.status !== 401;
  },
};

// ---- "Starts from your inbox" (src/intake-routes.ts) ----
export type IntakeEmailProvider = "postmark" | "sendgrid" | "mailgun" | "cloudflare";
export interface IntakeView {
  channel: { id: string; allowEmails: string[]; slackUsers: string[]; defaultRepo?: string; hasMailgunKey: boolean; hasSlackSecret: boolean; hasSlackBotToken: boolean; hasSentryToken: boolean };
  accountEmail: string | null;
  email: { urls: Record<IntakeEmailProvider, string>; cloudflareWorker: string };
  slack: { url: string; manifest: string };
  pending: Array<{ id: string; source: "email" | "slack"; task: string; choices: string[]; meta: { from?: string }; createdAt: number; attachmentCount: number }>;
  deliveries: Array<{ id: number; at: number; outcome: "fired" | "skipped" | "rejected" | "failed"; reason?: string; detail?: string; box?: string }>;
}
export const intakeApi = {
  get: () => get<IntakeView>("/intake.json"),
  update: (u: { allowEmails?: string[]; slackUsers?: string[]; defaultRepo?: string }) => post<IntakeView>("/intake.json", u),
  rotate: () => post<IntakeView>("/intake/rotate.json", {}),
  answer: (id: string, repo: string) => post<{ ok: true; box: string; url: string }>(`/intake/pending/${encodeURIComponent(id)}/answer.json`, { repo }),
  dismiss: (id: string) => post<{ ok: true }>(`/intake/pending/${encodeURIComponent(id)}/dismiss.json`, {}),
  /** A pasted GitHub issue/PR or Sentry link becomes a task (src/intake.ts). */
  unfurl: (link: string) => post<Unfurled>("/intake/unfurl.json", { url: link }),
};
export interface Unfurled {
  task: string;
  title: string;
  source: "github" | "sentry";
  repo?: string;
}

/** Mirrors src/intake.ts parseIssueUrl — only whole-paste links worth a round trip. */
export function isUnfurlable(text: string): boolean {
  const s = text.trim();
  if (!/^https:\/\/\S+$/.test(s)) return false;
  try {
    const u = new URL(s);
    if (u.hostname === "github.com") return /^\/[\w.-]+\/[\w.-]+\/(issues|pull)\/\d+/.test(u.pathname);
    if (u.hostname === "sentry.io") return /^\/organizations\/[\w-]+\/issues\/\d+/.test(u.pathname);
    if (/^[\w-]+\.sentry\.io$/.test(u.hostname)) return /^\/issues\/\d+/.test(u.pathname);
  } catch {
    /* not a URL */
  }
  return false;
}
