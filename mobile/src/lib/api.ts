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

export type DelegateResult =
  | { ok: true; box: string; warm: boolean; output: string; inferred?: string[] }
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
  delegate: (input: {
    task: string;
    repos?: { repo: string; ref?: string }[];
    attachments?: { name: string; dataUrl: string }[];
    model?: string;
  }) => post<DelegateResult>("/delegate.json", { source: "git", ...input }, AGENT_TIMEOUT_MS),
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
  fileText: async (session: string, path: string): Promise<string> => {
    const res = await fetch(url("/artifact", { session, path }), { headers: authHeaders(false) });
    if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
    return res.text();
  },
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
  mcpTest: (name: string) => post<{ ok: boolean; error?: string }>("/mcp-servers/test.json", { name }),
  notifySettings: () => get<NotifySettings>("/notify.json"),
  saveNotifySettings: (s: { url?: string; events?: Partial<NotifySettings["events"]> }) =>
    post<NotifySettings>("/notify.json", s),
  testNotify: () => post<{ ok: true }>("/notify/test.json", {}),

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
