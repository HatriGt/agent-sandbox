/**
 * The controller's JSON surface. Every data route is bearer-guarded; the token lives in local storage
 * (lib/auth.ts) and is sent ONLY as an `Authorization: Bearer` header — never in a URL. The live
 * stream uses fetch (not EventSource, which cannot set headers) and downloads go through fetch + blob.
 * A 401 anywhere signs the browser out so the token gate reappears.
 */
import { currentToken, signOut } from "./auth";

export type RunState = "running" | "waiting" | "done" | "idle";
export type BoxRole = "session" | "pool-claimed" | "pool-free";

export interface BoxView {
  name: string;
  role: BoxRole;
  /** msb lifecycle: "Running" while the microVM is up, "Stopped" for a sleeping (idle-stopped) box. */
  boxStatus: string;
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
  /** Unix seconds of the agent's last output (log mtime). */
  lastOutputAt?: number;
  /** Pinned by the operator: never reaped while asleep; only Destroy removes it. */
  kept?: boolean;
  /** A short name for the run, written by the in-box helper from the first message. */
  title?: string;
  /** Seconds this stopped box has been asleep, when known. */
  asleepSec?: number;
  /** Follow-ups queued while the agent was mid-turn; delivered when it finishes. */
  queued?: string[];
  /** Repositories checked out under /workspace. */
  repos?: { name: string; branch?: string }[];
  /** Which coding agent this thread runs on ("claude" | "omp"). Absent on older boxes. */
  agent?: string;
  /** Running, but the log has not moved for the stall window (src/stall.ts STALL_AFTER_MS). */
  stalled?: boolean;
  /** The saved harness this thread started on, with its one-line summary for the header. */
  harness?: { id: string; name: string; line: string };
  /** The workflow this thread is running (or just ran): step n/total and what each step did. */
  workflow?: WorkflowRunView;
  /** Skills the run was pointed at: explicit `/name` from the user, or the controller's auto match. */
  skills?: { name: string; how: "explicit" | "auto" }[];
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

/** Default coding agent for new threads (Claude Code vs oh-my-pi). */
export type AgentId = "claude" | "omp" | "codex" | "opencode";

/** What a driver can actually do (src/drivers/types.ts) — shown as badges, never overstated. */
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

/** Default coding agent for new threads. */
export interface AgentPrefs {
  defaultAgent: AgentId;
  agents: AgentChoice[];
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
  /** The file as of HEAD, for the merge view (absent for untracked/binary). */
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

/** Mirrors `PullDetail` in src/changes.ts — the dedicated PR page's payload. */
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

export type McpTransport = "stdio" | "http" | "sse";
/** Servers for the list, plus the same data as the editable `{"mcpServers": …}` JSON (secrets masked). */
export interface McpServersResponse {
  servers: McpServerView[];
  config: { mcpServers: Record<string, unknown> };
}

export interface McpServerView {
  name: string;
  type: McpTransport;
  /** Set when a header carries a JWT: its expiry, so a dead token shows in the list. */
  tokenExpiresAt?: string;
  tokenExpired?: boolean;
  command?: string;
  args?: string[];
  url?: string;
  /** Values are masked by the controller. */
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled: boolean;
  addedAt: number;
}

/** Outcome of `mcpTest`; `tools` only when the server answered `tools/list`. */
export interface McpProbe {
  ok: boolean;
  status?: number;
  detail: string;
  tools?: string[];
}

/** A skill: a reusable playbook synced into every sandbox as ~/.claude/skills/<name>/SKILL.md. */
export interface SkillView {
  name: string;
  description: string;
  content: string;
  /** Supporting files beside SKILL.md (scripts, docs) — absent for single-file skills. */
  files?: { path: string; content: string }[];
  enabled: boolean;
  addedAt: number;
  updatedAt: number;
}
export interface SkillsResponse {
  skills: SkillView[];
}

/** What a memory note is (src/memory-store.ts): taste, standing instruction, repo knowledge, a choice, a correction, a how-to. */
export type MemoryKind = "preference" | "rule" | "domain" | "fact" | "decision" | "lesson" | "playbook";
/** A note an earlier run left for future runs (src/memory-store.ts). */
export interface MemoryNote {
  id: string;
  kind: MemoryKind;
  /** preference/rule follow the operator everywhere; the rest belong to one repo when known. */
  scope: "operator" | "repo";
  /** pending = proposed by a run, awaiting the toast (auto-kept after a while); kept = confirmed. */
  status: "pending" | "kept";
  text: string;
  /** Rationale for a decision/lesson — "tried X, failed because Y". */
  why?: string;
  at: number;
  /** The run (box id) that wrote it. */
  source: string;
  /** owner/name when the note belongs to one repo; absent = global. */
  repo?: string;
  pinned?: boolean;
  /** The older note this one replaced. */
  supersedes?: string;
  /** Set when a newer note replaced this one: it leaves MEMORY.md but stays as history. */
  until?: number;
  /** Playbooks: how many runs matched it (promote-to-skill signal). */
  uses?: number;
  lastUsed?: number;
  /** Knowledge base: the area (page) a repo note belongs to, the code it describes, related areas. */
  area?: string;
  paths?: string[];
  links?: string[];
  /** Set when a later run changed code the note is anchored to; cleared when reaffirmed or marked verified. */
  stale?: { at: number; box: string; paths: string[] };
  /** Earlier versions this note replaced, the one it directly replaced first (only on revised notes; capped at 10). */
  history?: MemoryNoteVersion[];
}
/** One earlier version of a note (see MemoryNote.history). */
export interface MemoryNoteVersion {
  id: string;
  text: string;
  why?: string;
  at: number;
  source: string;
  /** When this version was superseded. */
  until?: number;
}
export interface MemoryNotesResponse {
  enabled: boolean;
  notes: MemoryNote[];
}
/** A note a running box just produced, carried on the watch snapshot so the thread can show the confirm toast. */
export interface MemoryNew {
  id: string;
  kind: MemoryKind;
  text: string;
  why?: string;
  status: "pending" | "kept";
  at: number;
  area?: string;
  /** The text of the older note this one rewrote (the toast reads "Updated" and shows it struck through). */
  revises?: string;
}

/** A saved workflow (src/workflow.ts): a task as a short script of agent turns and command checks. */
export type WorkflowStep =
  | { kind: "agent"; title?: string; prompt: string; skill?: string }
  | { kind: "check"; title?: string; command: string; retry: number; feedback?: string };
export interface WorkflowView {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  origin?: { kind: "repo"; repo: string; path: string; ref?: string } | { kind: "manual" };
  createdAt: number;
  updatedAt: number;
}
export interface WorkflowsResponse {
  workflows: WorkflowView[];
  limits: Record<string, number>;
  /** Where a repository keeps its workflow files (`.agent-sandbox/workflows`). */
  dir: string;
  saved?: string;
  imported?: string[];
  skipped?: string[];
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

/** A saved harness (src/harness.ts). Never carries a key: a provider is referenced by id only. */
export interface HarnessRules {
  askBeforeGuess: boolean;
  planFirst: boolean;
  verifyOnDone: boolean;
  /** Failed-verification retries the controller issues (0–2; absent = 1). */
  autoRetry?: number;
}
export interface HarnessView {
  id: string;
  name: string;
  description?: string;
  driver?: AgentId;
  providerId?: string;
  model?: string;
  skills?: string[];
  rules: HarnessRules;
  rulesMd?: string;
  verifyCommand?: string;
  egress?: string[];
  needsReview?: boolean;
  unresolvedProvider?: { kind: string; label: string };
  origin?: { kind: "file" | "github" | "duplicate"; source?: string; at: number };
  /** Set on the seeded best-practice defaults (its key); a duplicate is a plain custom harness. */
  builtin?: string;
  createdAt: number;
  updatedAt: number;
  provider?: { id: string; kind: string; label: string } | null;
  providerMissing?: boolean;
}
export interface HarnessesResponse {
  harnesses: HarnessView[];
  limits: Record<string, number>;
  /** How many built-in harnesses exist (for "Restore built-ins"). */
  builtins?: number;
}
export interface HarnessImportPreview {
  preview: { harness: HarnessView; skills: Array<{ name: string; description: string; files: number }>; notes: string[] };
}
export interface CompareFacts {
  box: string;
  state: string;
  verified: boolean | null;
  verifyDetail?: string;
  questions: number;
  tokens: { input: number; output: number } | null;
  costUsd: number | null;
  durationMs: number | null;
  files: string[];
  headline: string;
}
export interface AttemptFacts {
  index: number;
  box: string | null;
  state: "done" | "failed" | "running" | "gone" | "timeout" | "not-started";
  exitCode: number | null;
  verified: boolean | null;
  tests: { passed: number; failed: number } | null;
  diffLines: number | null;
  files: number | null;
  costUsd: number | null;
  tokens: number | null;
  durationMs: number | null;
}

export type AttemptGroupStatus = "running" | "deciding" | "needs-pick" | "decided" | "no-winner" | "failed";

export interface AttemptGroupSummary {
  id: string;
  task: string;
  status: AttemptGroupStatus;
  createdAt: number;
  winnerBox: string | null;
  prUrls: string[];
  attempts: Array<{ index: number; box: string | null; label: string }>;
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
  choices: Array<{ label: string; answer: string; index: number; box: string | null }>;
  prUrls: string[];
  note: string | null;
  attempts: Array<{ index: number; label: string; branch: string; box: string | null; error: string | null; tornDown: boolean; winner: boolean; facts: AttemptFacts | null }>;
}

export interface CompareDetail {
  id: string;
  task: string;
  createdAt: number;
  sides: Array<{ side: "a" | "b"; harnessId: string; harnessName: string; box: string | null; source: "not-started" | "gone" | "archive" | "live"; facts: CompareFacts | null }>;
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
  /** True when "Sign in with GitHub" (device flow) is configured on the controller. */
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

export interface FleetLifecycle {
  idleTimeoutSec?: number;
  poolIdleTimeoutSec?: number;
  maxDurationSec?: number;
  capacity: number;
  poolSize: number;
  /** How long a non-kept sandbox may sleep before it is destroyed. */
  sleepTtlSec?: number;
  /** Memory tiers a box may be resized to. Server-supplied so the UI never hardcodes them. */
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
  /** Notes this box produced recently (memory v2); absent on older controllers. */
  memoryNew?: MemoryNew[];
}

/** Walk-away notifications: the owner's webhook + which run events fire it. */
export interface NotifySettings {
  url: string;
  events: { waiting: boolean; done: boolean; failed: boolean };
  /** True when the deployment has a NOTIFY_WEBHOOK_URL fallback configured. */
  fallbackConfigured: boolean;
}

/** Mirrors `RunDigest` in src/digest.ts — the run receipt for a finished thread. */
export interface DigestPlanStep {
  text: string;
  state: "done" | "active" | "todo";
  failed?: boolean;
}
export interface RunDigest {
  box: string;
  task: string;
  state: "done" | "failed" | "waiting" | "running";
  exitCode?: number;
  startedAt?: number;
  endedAt?: number;
  plan: DigestPlanStep[];
  files: { path: string; status: string; additions: number; deletions: number }[];
  failedCommands: { name: string; arg?: string }[];
  /** Calls the in-box guard denied — trust made visible, split from ordinary failures.
   *  Optional: archived digests written before the field exist without it. */
  blocked?: { name: string; arg?: string }[];
  questions: { question: string; answer?: string }[];
  /** Turn-end token usage from the log's ⟦usage⟧ sentinel; absent on older logs. */
  usage?: { inputTokens: number; outputTokens: number; contextTokens: number };
  headline: string;
  /** Post-run verification, when the task was delegated with a `verify` clause. */
  verified?: { mode: "command" | "criterion"; pass: boolean; detail: string };
  /** Receipt provenance: which agent ran and on which model, only when known. */
  provenance?: { agent?: string; agentLabel?: string; model?: string; provider?: string; skills?: { name: string; how: "explicit" | "auto" }[] };
}

export interface AskResult {
  answer: string;
  timedOut: boolean;
  continued: boolean;
  driverState?: string;
}

function url(path: string, params: Record<string, string> = {}) {
  const u = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function headersFor(token = currentToken()): Record<string, string> {
  // The custom header is the CSRF proof for cookie sessions: a cross-site page cannot add it without
  // a CORS preflight we never grant. Harmless with bearer auth.
  return { "X-Requested-With": "agent-sandbox", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
/** Live headers object — read at call time so a token entered a moment ago is used immediately. */
const authHeaders: HeadersInit = new Proxy({} as Record<string, string>, {
  get: (_t, k: string) => headersFor()[k],
  ownKeys: () => Object.keys(headersFor()),
  getOwnPropertyDescriptor: (_t, k: string) => {
    const v = headersFor()[k];
    return v === undefined ? undefined : { value: v, enumerable: true, configurable: true, writable: true };
  },
});

export interface SessionRow {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  ip: string | null;
  userAgent: string | null;
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
export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** One stored audit event, raw from the controller — the UI derives the human verb. */
export interface AuditEventRow {
  /** Row id — paired with `at` it forms the paging cursor (`at` alone is not unique). */
  id: number;
  at: string;
  method: string;
  path: string;
  status: number;
  session: string | null;
  action: string | null;
  client: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  // A 200 that is not JSON (the SPA's index.html during a deploy, a proxy error page) must be an
  // error, not an empty object handed to the UI as data.
  let body: Record<string, unknown> | null = null;
  const text = await res.text();
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = null;
  }
  if (res.status === 401) signOut();
  if (res.ok && body === null) throw new ApiError("The controller returned a non-JSON response (deploying?)", 502);
  if (body === null) body = {};
  if (!res.ok) {
    const msg =
      typeof body.error === "string"
        ? body.error
        : res.status === 401
          ? "Unauthorized — check the ?token= in the URL"
          : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  return parse<T>(
    await fetch(url(path), {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}

/** A controller built before /fleet.json existed: fall back to the bare monitor list once, remember. */
let fleetRouteMissing = false;

/**
 * Server-sent events over fetch, so the bearer header can be sent. Emits parsed `{event, data, id}`
 * frames; resolves when the server ends the stream; rejects on a network error. The caller owns
 * reconnection (and passes `lastEventId` back in).
 */
export async function openSse(
  path: string,
  params: Record<string, string>,
  opts: { signal: AbortSignal; lastEventId?: string; onFrame: (f: { event: string; data: string; id?: string }) => void; onOpen?: () => void }
): Promise<void> {
  const res = await fetch(url(path, params), {
    headers: { ...headersFor(), Accept: "text/event-stream", ...(opts.lastEventId ? { "Last-Event-ID": opts.lastEventId } : {}) },
    signal: opts.signal,
  });
  if (res.status === 401) signOut();
  if (!res.ok || !res.body) throw new ApiError(`stream failed (${res.status})`, res.status);
  // The SPA fallback (a deploy in progress) answers 200 text/html; that is not a stream.
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) throw new ApiError("not an event stream", 502);
  opts.onOpen?.();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      let id: string | undefined;
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("id:")) id = line.slice(3).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) opts.onFrame({ event, data: data.join("\n"), id });
    }
  }
}

export const api = {
  /** Does the controller accept this token? (Used by the token gate before storing it.) */
  /** Which front door: one operator token, or sign-in. Public. */
  authConfig: () => fetch(url("/auth/config.json")).then(parse<AuthConfig>),
  signup: (u: { login: string; name: string; email: string; password: string }) => post<{ ok: true; id: string; login: string; role: string }>("/auth/signup", u),
  login: (login: string, password: string) => post<{ ok: true; id: string; login: string; role: string }>("/auth/login", { login, password }),
  updateAccount: (p: { name?: string; email?: string | null; currentPassword?: string; newPassword?: string }) => post<{ ok: true }>("/account.json", p),
  /** Prove a bearer works, from the browser — the "Test connection" on the connect page. */
  whoIs: async (token: string): Promise<Me | null> => {
    const res = await fetch(url("/me.json"), { headers: headersFor(token) });
    return res.ok ? ((await res.json()) as Me) : null;
  },
  users: () => fetch(url("/users.json"), { headers: authHeaders }).then(parse<{ users: UserRow[] }>),
  createUser: (login: string, role: "user" | "admin") => post<{ id: string; login: string; role: string; token: string }>("/users.json", { login, role }),
  issueUserKey: (id: string) => post<{ id: string; token: string; prefix: string }>("/users/key.json", { id }),
  setUserRole: (id: string, role: "user" | "admin") => post<{ ok: true }>("/users/role.json", { id, role }),
  setUserPlan: (id: string, plan: "trial" | "pro" | "free", days?: number) => post<{ ok: true }>("/users/plan.json", { id, plan, days }),
  deleteUser: (id: string) =>
    fetch(url("/users.json"), { method: "DELETE", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then(parse<{ ok: true }>),
  /** Who am I (401 when nobody). */
  me: async (): Promise<Me | null> => {
    const res = await fetch(url("/me.json"), { headers: authHeaders });
    if (res.status === 401) return null;
    return parse<Me>(res);
  },
  logout: () => post<{ ok: true }>("/auth/logout", {}),
  apiKeys: () => fetch(url("/api-keys.json"), { headers: authHeaders }).then(parse<{ keys: ApiKeyRow[] }>),
  sessions: () => fetch(url("/sessions.json"), { headers: authHeaders }).then(parse<{ sessions: SessionRow[] }>),
  revokeSession: (id: string) =>
    fetch(url("/sessions.json"), { method: "DELETE", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then(parse<{ ok: true }>),
  revokeOtherSessions: () =>
    fetch(url("/sessions.json"), { method: "DELETE", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ others: true }) }).then(parse<{ ok: true; revoked: number }>),
  /** Stored audit trail (reverse-chron). `before` pages backwards from the last row's `at`. */
  audit: (opts: { limit?: number; before?: string; beforeId?: number } = {}, signal?: AbortSignal) =>
    fetch(
      url("/audit.json", {
        ...(opts.limit ? { limit: String(opts.limit) } : {}),
        ...(opts.before ? { before: opts.before } : {}),
        ...(opts.beforeId != null ? { beforeId: String(opts.beforeId) } : {}),
      }),
      { headers: authHeaders, signal }
    ).then(
      parse<{ events: AuditEventRow[] }>
    ),
  createApiKey: (name: string) => post<{ id: string; token: string; prefix: string }>("/api-keys.json", { name }),
  revokeApiKey: (id: string) =>
    fetch(url("/api-keys.json"), { method: "DELETE", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then(parse<{ ok: true }>),
  verifyToken: async (token: string): Promise<boolean> => {
    const res = await fetch(url("/fleet.json"), { headers: headersFor(token) });
    return res.status !== 401;
  },

  /**
   * The fleet with lifecycle facts. Falls back to `/monitor.json` (boxes only, no lifecycle) against
   * an older controller so the dashboard still works during a rolling deploy.
   */
  async fleet(signal?: AbortSignal): Promise<FleetSnapshot> {
    if (!fleetRouteMissing) {
      const res = await fetch(url("/fleet.json"), { headers: authHeaders, signal });
      if (res.status !== 404) {
        const snap = await parse<FleetSnapshot>(res);
        if (!Array.isArray(snap.boxes)) throw new ApiError("Unexpected fleet response", 502);
        return { ...snap, lifecycle: snap.lifecycle ?? { capacity: 0, poolSize: 0 } };
      }
      fleetRouteMissing = true;
    }
    const boxes = await fetch(url("/monitor.json"), { headers: authHeaders, signal }).then(parse<BoxView[]>);
    return { boxes, lifecycle: { capacity: 0, poolSize: 0 }, at: Date.now() };
  },

  watch: (session: string, signal?: AbortSignal) =>
    fetch(url("/watch.json", { session }), { headers: authHeaders, signal }).then(parse<WatchSnapshot>),

  /** Download a produced file as a blob (authenticated by header; the browser saves it). */
  async artifactBlob(session: string, path: string): Promise<Blob> {
    const res = await fetch(url("/artifact", { session, path }), { headers: authHeaders });
    if (res.status === 401) signOut();
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new ApiError(typeof body.error === "string" ? body.error : `Request failed (${res.status})`, res.status);
    }
    return res.blob();
  },

  /** Files the agent changed in the sandbox, with +/- counts. */
  changes: (session: string, signal?: AbortSignal) =>
    fetch(url("/changes.json", { session }), { headers: authHeaders, signal }).then(parse<{ files: ChangedFile[] }>),
  /** Unified diff for one file (or `untracked`). */
  diff: (session: string, path: string, signal?: AbortSignal) =>
    fetch(url("/diff.json", { session, path }), { headers: authHeaders, signal }).then(parse<FileDiff>),
  /** The WHOLE workspace's unified diff (live box) — the Review-all panel. */
  runDiff: (session: string, signal?: AbortSignal) =>
    fetch(url("/rundiff.json", { session }), { headers: authHeaders, signal }).then(parse<{ diff: string }>),
  /** Pull request metadata for a card. */
  pull: (repo: string, number: number, signal?: AbortSignal) =>
    fetch(url("/pr.json", { repo, number: String(number) }), { headers: authHeaders, signal }).then(parse<PullInfo>),

  /** Keep (pin) a sandbox until destroyed, or release it. */
  /** Source control on one cloned repo inside the sandbox. */
  gitStatus: (session: string, repo: string) => post<GitStatus>("/git.json", { session, repo, action: "status" }),
  gitCommit: (session: string, repo: string, message: string) => post<{ sha: string; summary: string }>("/git.json", { session, repo, action: "commit", message }),
  gitPush: (session: string, repo: string) => post<{ output: string }>("/git.json", { session, repo, action: "push" }),
  /** Ask the in-box helper to name this run (idempotent; the fleet carries the result). */
  title: (session: string) => post<{ title?: string }>("/title.json", { session }),
  /** Start a sleeping sandbox now (opening its thread does this automatically). */
  wake: (session: string) => post<{ ok: true }>("/wake.json", { session }),
  sleep: (session: string) => post<{ ok: true }>("/sleep.json", { session }),
  /** Resize a box's memory. Always reboots the machine — this runtime has no live resize. */
  setMemory: (session: string, memory: string) => post<{ ok: true; memory: string }>("/memory.json", { session, memory }),
  /** Grow a box's root disk. Grow-only and always reboots; the server rejects a smaller tier. */
  setDisk: (session: string, disk: string) => post<{ ok: true; disk: string }>("/disk.json", { session, disk }),
  rename: (session: string, title: string) => post<{ title: string }>("/rename.json", { session, title }),
  /** Every workspace file (flat paths) for the explorer tree. */
  tree: (session: string, signal?: AbortSignal) =>
    fetch(url("/tree.json", { session }), { headers: authHeaders, signal }).then(parse<{ files: string[]; total: number; truncated: boolean }>),
  /** The same index with size + mtime per file, for the records table. */
  treeDetails: (session: string, signal?: AbortSignal) =>
    fetch(url("/tree.json", { session, details: "1" }), { headers: authHeaders, signal }).then(
      parse<{ files: { path: string; bytes: number; mtime: number }[]; total: number; truncated: boolean }>
    ),
  /** Write a text file inside the sandbox. */
  writeFile: (session: string, path: string, content: string, encoding?: "base64") =>
    fetch(url("/file.json"), { method: "PUT", headers: { ...authHeaders, "content-type": "application/json" }, body: JSON.stringify({ session, path, content, encoding }) }).then(
      parse<{ ok: true; path: string; bytes: number }>
    ),
  /** The model catalog for the picker + this box's current sticky model. */
  models: (session?: string, signal?: AbortSignal) =>
    fetch(url("/models.json", session ? { session } : {}), { headers: authHeaders, signal }).then(
      parse<{ default: string; current: string; models: { id: string; label: string; tier: "opus" | "sonnet" | "haiku" | "other" }[] }>
    ),
  /** Which operator messages (1-based; task = 1) have a restore point. */
  revertPoints: (session: string, signal?: AbortSignal) =>
    fetch(url("/revert-points.json", { session }), { headers: authHeaders, signal }).then(parse<{ messages: number[] }>),
  /** Revert the box to the state before operator message k was delivered (~1 s, in place). */
  revert: (session: string, message: number) => post<{ ok: true; message: number }>("/revert.json", { session, message }),
  /** Merge the PR from inside the sandbox (`gh pr merge --merge`). */
  mergePull: (session: string, repo: string, number: number, opts?: { method?: "merge" | "squash" | "rebase"; auto?: boolean; admin?: boolean }) =>
    post<{ ok: true; auto: boolean; output: string }>("/pr/merge.json", { session, repo, number, ...opts }),
  /** Approve the PR from inside the sandbox (`gh pr review --approve`). */
  approvePull: (session: string, repo: string, number: number) =>
    post<{ ok: true; output: string }>("/pr/approve.json", { session, repo, number }),
  /** Everything the dedicated PR page shows, in one request. */
  pullDetail: (repo: string, number: number, signal?: AbortSignal) =>
    fetch(url("/pr/detail.json", { repo, number: String(number) }), { headers: authHeaders, signal }).then(parse<PullDetail>),
  commentPull: (session: string, repo: string, number: number, body: string) =>
    post<{ ok: true; output: string }>("/pr/comment.json", { session, repo, number, body }),
  reviewPull: (session: string, repo: string, number: number, event: "approve" | "request-changes" | "comment", body?: string) =>
    post<{ ok: true; output: string }>("/pr/review.json", { session, repo, number, event, body }),
  setPullState: (session: string, repo: string, number: number, action: "close" | "reopen" | "ready") =>
    post<{ ok: true; output: string }>("/pr/state.json", { session, repo, number, action }),
  keep: (session: string, keep: boolean) => post<{ ok: true; kept: boolean }>("/keep.json", { session, keep }),

  /** Fetch a produced file's text for inline preview. Throws ApiError (404/413/…) on failure. */
  async artifactText(session: string, path: string, signal?: AbortSignal): Promise<string> {
    const res = await fetch(url("/artifact", { session, path }), { headers: authHeaders, signal });
    if (res.status === 401) signOut();
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const msg = typeof body.error === "string" ? body.error : `Request failed (${res.status})`;
      throw new ApiError(msg, res.status);
    }
    return res.text();
  },

  /** Read-only observer. Cannot steer the agent, by design. */
  ask: (session: string, question: string, newThread = false) =>
    post<AskResult>("/ask.json", { session, question, newThread }),

  /**
   * The only way to steer the agent: answers what it is blocked on, or sends a follow-up. While the
   * agent is mid-turn the controller QUEUES the message ({queued:true}) and delivers it when the run
   * finishes; `force` bypasses the queue (used for answering a question).
   */
  resume: (session: string, message: string, opts: { force?: boolean; model?: string } = {}) =>
    post<{ output: string; queued?: undefined } | { queued: true; id: string }>("/resume.json", {
      session,
      message,
      force: opts.force,
      ...(opts.model ? { model: opts.model } : {}),
    }),

  /** Queued follow-ups for a box. */
  inbox: (session: string) =>
    fetch(url("/inbox.json", { session }), { headers: authHeaders }).then(parse<{ queued: QueuedMessage[] }>),
  /**
   * Deliver a queued follow-up NOW: the controller interrupts the running turn and resumes the
   * agent with this message (same session, `claude -c`). For turns stuck on something that will
   * never finish. Other queued messages stay queued.
   */
  sendNow: (session: string, id: string) => post<{ ok: true; queued: QueuedMessage[] }>("/send-now.json", { session, id }),
  /** Stop the running turn (session kept; a later message resumes it). The watch pill's Stop. */
  interrupt: (session: string) => post<{ ok: true; stopped: boolean }>("/interrupt.json", { session }),
  dequeue: (session: string, id?: string) =>
    fetch(url("/inbox.json", id ? { session, id } : { session }), { method: "DELETE", headers: authHeaders }).then(
      parse<{ queued: QueuedMessage[] }>
    ),

  /** Workspace files matching `q`, for `@` mentions in the composer. */
  files: (session: string, q: string, signal?: AbortSignal) =>
    fetch(url("/files.json", { session, q }), { headers: authHeaders, signal }).then(
      parse<{ files: string[]; total: number; truncated: boolean }>
    ),

  teardown: (session: string) => post<{ ok: true }>("/teardown.json", { session }),

  /** GitHub accounts (tokens stay on the VPS; only masked hints come back). */
  accounts: (signal?: AbortSignal) =>
    fetch(url("/accounts.json"), { headers: authHeaders, signal }).then(parse<AccountsResponse>),
  addAccount: (token: string) => post<{ accounts: AccountView[]; added: string }>("/accounts.json", { token }),
  removeAccount: (login: string) =>
    fetch(url("/accounts.json", { login }), { method: "DELETE", headers: authHeaders }).then(parse<{ accounts: AccountView[] }>),
  setDefaultAccount: (login: string) => post<{ accounts: AccountView[] }>("/accounts/default.json", { login }),
  deviceStart: () =>
    post<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }>(
      "/accounts/device.json",
      {}
    ),
  devicePoll: (device_code: string) => post<DevicePoll>("/accounts/device/poll.json", { device_code }),

  delegate: (input: {
    task: string;
    repos?: { repo: string; ref?: string }[];
    attachments?: { name: string; dataUrl: string }[];
    model?: string;
    /** Coding agent for the new thread; omit to use the stored default. */
    agent?: AgentId;
    /** Sent only after the user saw the "supervised: partial" badge for a below-floor driver. */
    allowPartialSupervision?: boolean;
    /** A saved model provider id (Providers page); the model then comes from its list. */
    provider?: string;
    /** Exactly one key: a command run in the sandbox after the run, or a criterion a read-only checker judges. */
    verify?: { command: string } | { criterion: string };
    /** A saved harness id: fills the fields this input leaves out (explicit fields win). */
    harness?: string;
    /** A saved workflow id: the task becomes its first step; later steps and checks run on the finish edge. */
    workflow?: string;
    compareId?: string;
    compareSide?: "a" | "b";
    /** Run the task N ways in parallel; the best attempt gets the PR. */
    attempts?: 1 | 2 | 3;
    /** One entry per attempt (length must equal `attempts`); omit for server defaults. */
    attemptSpecs?: Array<{ agent?: string; model?: string; provider?: string; harness?: string }>;
  }) =>
    post<{ ok: true; box: string; warm: boolean; output: string; inferred?: string[]; harness?: { id: string; name: string; applied: string[] }; attemptGroup?: { id: string; attempts: Array<{ index: number; box: string | null; label: string; branch: string; error?: string }> } } | { ok: false; question: string }>(
      "/delegate.json",
      { source: "git", ...input }
    ),

  /** MCP servers the sandbox agent gets. */
  mcpServers: (signal?: AbortSignal) =>
    fetch(url("/mcp-servers.json"), { headers: authHeaders, signal }).then(parse<McpServersResponse>),
  mcpMutate: (body: Record<string, unknown>) => post<McpServersResponse>("/mcp-servers.json", body),
  /** One server's health: the same MCP initialize handshake the in-box claude does at startup, then `tools/list`. */
  mcpTest: (name: string) => post<McpProbe>("/mcp-servers/test.json", { name }),
  skills: (signal?: AbortSignal) => fetch(url("/skills.json"), { headers: authHeaders, signal }).then(parse<SkillsResponse>),
  skillMutate: (body: Record<string, unknown>) => post<SkillsResponse>("/skills.json", body),
  /** Memory across runs: the owner's notes. Not /memory.json, which is the VM's RAM. */
  memoryNotes: (signal?: AbortSignal) => fetch(url("/memory-notes.json"), { headers: authHeaders, signal }).then(parse<MemoryNotesResponse>),
  memoryNoteUpdate: (body: { enabled: boolean } | { id: string; text?: string; why?: string; pinned?: boolean; status?: "kept"; area?: string; paths?: string; links?: string; verified?: boolean; repo?: string }) =>
    post<MemoryNotesResponse>("/memory-notes.json", body),
  /** Add a preference/rule by hand (the composer on the Memory page). */
  memoryNoteAdd: (add: { kind: MemoryKind; text: string; why?: string; repo?: string; area?: string; paths?: string; links?: string }) => post<MemoryNotesResponse>("/memory-notes.json", { add }),
  memoryNoteDelete: (id: string) =>
    fetch(url("/memory-notes.json", { id }), { method: "DELETE", headers: authHeaders }).then(parse<MemoryNotesResponse>),
  /** Turn a playbook note into a SKILL.md draft in the skill store. 409 when a skill of that name exists. */
  memoryPromote: (id: string) => post<{ skill: { name: string }; enabled: boolean; notes: MemoryNote[] }>("/memory-promote.json", { id }),
  /** Every kept note as one Markdown file (authenticated by header; the caller saves the blob). */
  memoryExport: async (): Promise<Blob> => {
    const res = await fetch(url("/memory-export.md"), { headers: authHeaders });
    if (res.status === 401) signOut();
    if (!res.ok) throw new ApiError(`Export failed (${res.status})`, res.status);
    return res.blob();
  },
  memoryImport: (markdown: string) => post<MemoryNotesResponse>("/memory-import.json", { markdown }),
  workflows: (signal?: AbortSignal) => fetch(url("/workflows.json"), { headers: authHeaders, signal }).then(parse<WorkflowsResponse>),
  workflowMutate: (body: Record<string, unknown>) => post<WorkflowsResponse>("/workflows.json", body),
  workflowPreview: (yaml: string) => post<{ ok: true; workflow: WorkflowView }>("/workflows.json", { action: "preview", yaml }),
  workflowYaml: (id: string) => fetch(url(`/workflows/yaml.json?id=${encodeURIComponent(id)}`), { headers: authHeaders }).then(parse<{ id: string; yaml: string; filename: string }>),
  harnesses: (signal?: AbortSignal) => fetch(url("/harnesses.json"), { headers: authHeaders, signal }).then(parse<HarnessesResponse>),
  harnessMutate: (body: Record<string, unknown>) => post<HarnessesResponse & { saved?: string }>("/harnesses.json", body),
  harnessExport: (id: string) =>
    fetch(url(`/harnesses/export.json?id=${encodeURIComponent(id)}`), { headers: authHeaders }).then(parse<{ bundle: unknown; redacted: number; skipped: string[]; filename: string }>),
  harnessImport: <T>(body: Record<string, unknown>) => post<T>("/harnesses/import.json", body),
  compareCreate: (body: { task: string; harnessA: string; harnessB: string }) => post<{ id: string }>("/harness-compares.json", body),
  compares: () => fetch(url("/harness-compares.json"), { headers: authHeaders }).then(parse<{ compares: Array<{ id: string; task: string; harnessA: string; harnessB: string; createdAt: number; sides: Array<{ side: "a" | "b"; box: string }> }> }>),
  compare: (id: string) => fetch(url(`/harness-compares.json?id=${encodeURIComponent(id)}`), { headers: authHeaders }).then(parse<CompareDetail>),
  attemptGroups: () => fetch(url("/attempt-groups.json"), { headers: authHeaders }).then(parse<{ groups: AttemptGroupSummary[] }>),
  attemptGroup: (id: string) => fetch(url(`/attempt-groups.json?id=${encodeURIComponent(id)}`), { headers: authHeaders }).then(parse<AttemptGroupView>),
  attemptGroupOfBox: (box: string) =>
    fetch(url(`/attempt-groups.json?box=${encodeURIComponent(box)}`), { headers: authHeaders }).then(parse<{ group: AttemptGroupView | null; index?: number }>),
  /** `{id, box}` = pick this attempt instead; `{id, choice}` = answer the tie question. */
  attemptPick: (body: { id: string; box: string } | { id: string; choice: number }) => post<AttemptGroupView>("/attempt-groups.json", body),
  /**
   * Browse a public GitHub repo for skills. Goes through the controller because the page's CSP is
   * `connect-src 'self'` — see lib/skillImport.ts. Caller supplies the response shape per action.
   */
  skillRepo: <T>(body: Record<string, unknown>) => post<T>("/skill-repo.json", body),

  /** Repositories reachable through the connected accounts, ranked for a picker. */
  repos: (q: string, refresh = false, signal?: AbortSignal) =>
    fetch(url("/repos.json", refresh ? { q, refresh: "1" } : { q }), { headers: authHeaders, signal }).then(
      parse<{ repos: RepoInfo[]; total: number }>
    ),
  /** Default coding agent for new threads (Claude Code vs oh-my-pi). */
  agentPrefs: (signal?: AbortSignal) =>
    fetch(url("/agent-prefs.json"), { headers: authHeaders, signal }).then(parse<AgentPrefs>),
  saveAgentPrefs: (defaultAgent: AgentId, allowPartialSupervision?: boolean) =>
    post<AgentPrefs>("/agent-prefs.json", { defaultAgent, ...(allowPartialSupervision ? { allowPartialSupervision } : {}) }),

  /** Model providers: the caller's own keys/endpoints. Keys come back masked only. */
  providers: (signal?: AbortSignal) => fetch(url("/providers.json"), { headers: authHeaders, signal }).then(parse<ProvidersResponse>),
  saveProvider: (body: { id?: string; kind: ProviderKind; label?: string; baseUrl?: string; apiKey?: string }) =>
    post<ProvidersResponse & { saved: string }>("/providers.json", body),
  deleteProvider: (id: string) => post<ProvidersResponse>("/providers/delete.json", { id }),
  /** Repo setup profiles (src/setup-profile.ts): what each repo installs/builds/tests with. */
  repoSetups: (signal?: AbortSignal) => fetch(url("/repo-setup.json"), { headers: authHeaders, signal }).then(parse<RepoSetupsResponse>),
  saveRepoSetup: (repo: string, profile: Partial<RepoSetupProfile>) => post<RepoSetupsResponse>("/repo-setup.json", { repo, profile }),
  resetRepoSetup: (repo: string) => post<RepoSetupsResponse>("/repo-setup/delete.json", { repo }),
  providerModels: (id: string, force?: boolean) =>
    post<{ models: string[]; cached: boolean; error?: string }>("/providers/models.json", { id, ...(force ? { force } : {}) }),

  /** Walk-away notifications: the caller's webhook and per-event toggles. */
  notifySettings: (signal?: AbortSignal) =>
    fetch(url("/notify.json"), { headers: authHeaders, signal }).then(parse<NotifySettings>),
  saveNotifySettings: (url_: string, events: NotifySettings["events"]) =>
    post<NotifySettings>("/notify.json", { url: url_, events }),
  /** Fire a test event at the stored webhook (or the deployment fallback). */
  testNotify: () => post<{ ok: boolean; status: number }>("/notify/test.json", {}),

  /** The run receipt for a finished thread: plan, files, failed commands, questions, headline. */
  digest: (session: string, signal?: AbortSignal) =>
    fetch(url("/digest.json", { session }), { headers: authHeaders, signal }).then(parse<RunDigest>),

  /** Clone a repository into a running sandbox at /workspace/<name>. */
  attachRepo: (session: string, repo: string, ref?: string) =>
    post<{ ok: true; name: string; login?: string }>("/repos/attach.json", { session, repo, ref }),

  /** Archived runs, reverse-chron. `before` pages backwards from the last row's id (exclusive). */
  history: (opts: { limit?: number; before?: number } = {}, signal?: AbortSignal) =>
    fetch(
      url("/history.json", { ...(opts.limit ? { limit: String(opts.limit) } : {}), ...(opts.before != null ? { before: String(opts.before) } : {}) }),
      { headers: authHeaders, signal }
    ).then(parse<{ runs: HistoryRun[] }>),
  /** One archived run with its full digest. */
  historyRun: (id: number, signal?: AbortSignal) =>
    fetch(url("/history.json", { id: String(id) }), { headers: authHeaders, signal }).then(parse<{ run: HistoryRunDetail }>),
  /** Delete one archived run's record. */
  historyActivity: (since: number, signal?: AbortSignal) =>
    fetch(url("/history/activity.json", { since: String(since) }), { headers: authHeaders, signal }).then(
      parse<{ runs: { t: number; failed: boolean }[] }>
    ),
  deleteHistoryRun: (id: number) =>
    fetch(url("/history.json", { id: String(id) }), { method: "DELETE", headers: authHeaders }).then(parse<{ ok: true }>),
  /** The outcome card of an archived run: by archive id, or the latest record for a box. */
  outcome: (q: { id: number } | { box: string }, signal?: AbortSignal) =>
    fetch(url("/history/outcome.json", "id" in q ? { id: String(q.id) } : { box: q.box }), { headers: authHeaders, signal }).then(
      parse<{ id: number; box: string; outcome: RunOutcome }>
    ),
  /** The History ledger: totals + filtered rows over the archive. */
  ledger: (f: LedgerQuery = {}, signal?: AbortSignal) =>
    fetch(url("/history/ledger.json", Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))), { headers: authHeaders, signal }).then(
      parse<{ totals: LedgerTotals; rows: LedgerRow[] }>
    ),

  /** Automations (triggers): schedules, webhooks, GitHub events and chains. */
  prFollowups: (signal?: AbortSignal) =>
    fetch(url("/pr-followups.json"), { headers: authHeaders, signal }).then(
      parse<{ prefs: PrFollowupPrefs; hook: { id: string; createdAt: number; events: string[] } | null }>,
    ),
  setPrFollowups: (p: Partial<PrFollowupPrefs>) => post<{ prefs: PrFollowupPrefs }>("/pr-followups/settings.json", p),
  rotatePrFollowupHook: () => post<{ id: string; secret: string; hookUrl: string; events: string[] }>("/pr-followups/hook.json", {}),
  triggers: (signal?: AbortSignal) => fetch(url("/triggers.json"), { headers: authHeaders, signal }).then(parse<{ triggers: Automation[] }>),
  createTrigger: (t: AutomationDraft) => post<{ trigger: Automation; secret?: string; hookUrl?: string }>("/triggers.json", t),
  updateTrigger: (id: string, t: AutomationDraft) => post<{ trigger: Automation }>(`/triggers/${encodeURIComponent(id)}.json`, t),
  deleteTrigger: (id: string) => fetch(url(`/triggers/${encodeURIComponent(id)}.json`), { method: "DELETE", headers: authHeaders }).then(parse<{ ok: true }>),
  setTriggerEnabled: (id: string, enabled: boolean) => post<{ trigger: Automation }>(`/triggers/${encodeURIComponent(id)}/enabled.json`, { enabled }),
  promoteTrigger: (id: string) => post<{ trigger: Automation }>(`/triggers/${encodeURIComponent(id)}/promote.json`, {}),
  rotateTrigger: (id: string) => post<{ secret: string; hookUrl: string }>(`/triggers/${encodeURIComponent(id)}/rotate.json`, {}),
  threadSchedule: (box: string, signal?: AbortSignal) =>
    fetch(url(`/triggers/for-box.json?box=${encodeURIComponent(box)}`), { headers: authHeaders, signal }).then(parse<{ items: ThreadScheduleItem[]; rejected?: ThreadScheduleReject[] }>),
  runTrigger: (id: string) => post<{ result: AutomationResult }>(`/triggers/${encodeURIComponent(id)}/run.json`, {}),
  testTrigger: (id: string) => post<{ ok: boolean; test: true; result?: AutomationResult; skipped?: string; ignored?: string }>(`/triggers/${encodeURIComponent(id)}/test.json`, {}),
  triggerDeliveries: (id: string) => fetch(url(`/triggers/${encodeURIComponent(id)}/deliveries.json`), { headers: authHeaders }).then(parse<{ deliveries: AutomationDelivery[] }>),
  previewTrigger: (taskTemplate: string, id?: string, name?: string) =>
    post<{ text: string; missing: string[]; hasPayload: boolean }>("/triggers/preview.json", { taskTemplate, id, name }),
};

export type AutomationKind = "schedule" | "webhook" | "github" | "chain" | "watch";
export type GithubEvent = "issue_labeled" | "issue_comment" | "pr_opened";
/** Repo-activity events the controller polls GitHub for (kind "watch"); no webhook involved. */
export type WatchEvent =
  | "pr_opened"
  | "pr_pushed"
  | "pr_ready"
  | "pr_merged"
  | "pr_closed"
  | "pr_reopened"
  | "issue_opened"
  | "issue_closed"
  | "issue_reopened"
  | "issue_labeled"
  | "comment_created"
  | "push"
  | "run_failed"
  | "run_succeeded"
  | "release_published";
export interface AutomationSpec {
  /** PR follow-ups for this automation's PRs; unset = the user's default. */
  keepGreen?: boolean;
  addressReviews?: boolean;
  /** Box when a run finishes: unset/"keep" = global sleep TTL; "done" = destroy after a clean finish; "always" = destroy on any finish. */
  destroy?: "keep" | "done" | "always";
  cron?: string;
  /** One-time run at this epoch ms (chat schedules). */
  at?: number;
  timezone?: string;
  event?: GithubEvent;
  label?: string;
  command?: string;
  allowForks?: boolean;
  /** kind "watch": the events that fire it (non-empty). */
  watch?: WatchEvent[];
  /** kind "watch": `push` branch (default = repo default branch); `run_*` filter (unset = any branch). */
  branch?: string;
  afterTrigger?: string;
  on?: "done" | "any";
  carry?: "patch" | "none";
  /** webhook: alert-source preset (vendor signature + {{alert.*}} fields). */
  preset?: AlertPreset;
  /** preset: minutes one alert stays quiet after it fired. */
  cooldownMin?: number;
}
export type AlertPreset = "sentry" | "datadog" | "pagerduty";
/** What a delivery was about and what its run produced (src/run-facts.ts). Fire-time fields first, finish-time ones after. */
export interface RunFacts {
  v: 1;
  subject?: { kind: "pr" | "issue"; number: number; repo: string; url: string; title?: string; author?: string };
  alert?: { source: string; title: string; severity?: string; url?: string };
  event?: string;
  state?: "done" | "failed" | "waiting" | "running";
  headline?: string;
  archiveId?: number;
  prs?: Array<{ url: string; repo: string; number: number }>;
  tests?: { passed: number; failed: number } | null;
  diff?: { files: number; additions: number; deletions: number } | null;
  verified?: boolean | null;
  review?: { verdict: "approve" | "needs-work" | null; findings?: Record<"high" | "medium" | "low" | "info", number>; blocking: number } | null;
  receiptUrl?: string;
  durationMs?: number | null;
  usd?: number | null;
}
/** One row of an automation's delivery log (GET /triggers/:id/deliveries.json), newest first. */
export interface AutomationDelivery {
  id: number;
  at: number;
  outcome: "fired" | "skipped" | "rejected" | "failed";
  reason?: "cooldown" | "disabled" | "limit" | "dedupe" | "ignored" | "signature" | "payload" | "error" | "sender" | "asked";
  detail?: string;
  box?: string;
  test?: boolean;
  /** The fired run finished with the quiet marker — nothing needed the operator. */
  quiet?: boolean;
  facts?: RunFacts;
}
export interface AutomationDraft {
  name: string;
  kind: AutomationKind;
  spec: AutomationSpec;
  repos?: string[];
  taskTemplate: string;
  enabled: boolean;
  prComment: boolean;
  /** Quiet: a run that finds nothing for the operator sends no notification. */
  quiet?: boolean;
  agent?: string;
  model?: string;
  harnessId?: string;
  /** Saved workflow id: the rendered task fills {{task}} in its first step. */
  workflowId?: string;
  /** Write-only: the vendor's signing secret (Sentry client secret, PagerDuty webhook secret, Datadog header token). */
  signingSecret?: string;
}
export interface AutomationResult {
  at: number;
  outcome: "started" | "skipped" | "failed";
  box?: string;
  reason?: string;
  finished?: { state: string; headline: string; archiveId?: number };
}
/** Something scheduled as part of one thread (src/thread-schedule.ts). */
export interface ThreadScheduleItem {
  id: string;
  name: string;
  /** proposed: critical, waiting on you · created: scheduled from here · repeats: the schedule that started this thread · after: a chain that follows it */
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
  repos?: string[];
  enabled: boolean;
  task: string;
  why?: string;
}
/** A schedule the agent tried to set up from this thread that the controller could not read. */
export interface ThreadScheduleReject {
  scope: AutomationScope;
  when: string;
  task: string;
  reason: string;
}

/** Mirrors GET /triggers.json rows. Stamps are epoch ms. Never carries the webhook secret. */
export type AutomationScope = "scheduled" | "automation";
export type ScheduleStatus = "needs-ok" | "waiting" | "running" | "done" | "failed" | "paused" | "cancelled";
export interface Automation extends AutomationDraft {
  id: string;
  when: string;
  /** scheduled: made from a chat (usually once) · automation: a standing rule. */
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
  /** Quiet automations only: runs that found nothing vs runs that reported something. */
  counts?: { checked: number; reports: number };
  active: number;
  createdAt: number;
  updatedAt: number;
}

export interface LedgerQuery {
  startedBy?: string;
  trigger?: string;
  agent?: string;
  state?: string;
  verified?: string;
  since?: number;
  limit?: number;
  before?: number;
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
/** Mirrors `SetupProfile` in src/setup-profile.ts. Env vars are names only — never values. */
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

/** Mirrors `RunOutcome` in src/outcome.ts — the outcome card. Every null is "unknown": render "—". */
export interface PrFollowupPrefs {
  keepGreen: boolean;
  addressReviews: boolean;
}

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
    /** 
etries: how many times a failed verification sent the run back before this finish. */
    verified: { pass: boolean; mode: string; retries?: number } | null;
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
  /** Facts this run left in memory; absent on older outcomes. */
  remembered?: number;
  /** The same count split by kind ("2 lessons, 1 playbook"); absent on outcomes archived before memory v2. */
  rememberedKinds?: Partial<Record<MemoryKind, number>>;
}
export interface LedgerRow extends HistoryRun {
  outcome?: RunOutcome | null;
  startedBy?: string | null;
  triggerId?: string | null;
  agent?: string | null;
  verified?: boolean | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
}

/** One archived run — a record kept after its machine is gone. Mirrors GET /history.json rows. */
export interface HistoryRun {
  id: number;
  box: string;
  owner?: string | null;
  task?: string | null;
  state: "done" | "failed";
  exitCode?: number | null;
  /**
   * Epoch MILLISECONDS, not seconds — these come straight off RunDigest (whose stamps are the
   * in-box plan sentinel's Date.now()) and off the archiver's own Date.now(). The console's
   * fmtAgo/fmtDuration both take seconds, so every read site must divide.
   */
  startedAt?: number | null;
  endedAt?: number | null;
  /** Epoch milliseconds. */
  archivedAt: number;
  headline?: string | null;
}
export interface HistoryRunDetail extends HistoryRun {
  digest: RunDigest | null;
  /** The run's full workspace diff, captured at the finish edge — reviewable after teardown. */
  diffText?: string;
}

/** Low-level helpers for feature modules that keep their own endpoints (lib/intake-api.ts). */
export const apiRaw = { url, parse, post, authHeaders };
