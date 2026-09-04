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

/** A skill: a reusable playbook synced into every sandbox as ~/.claude/skills/<name>/SKILL.md. */
export interface SkillView {
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  addedAt: number;
  updatedAt: number;
}
export interface SkillsResponse {
  skills: SkillView[];
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
}

export interface FleetSnapshot {
  boxes: BoxView[];
  lifecycle: FleetLifecycle;
  at: number;
}

export interface WatchSnapshot extends Omit<BoxView, "role"> {
  log: string;
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

  delegate: (input: { task: string; repos?: { repo: string; ref?: string }[]; attachments?: { name: string; dataUrl: string }[]; model?: string }) =>
    post<{ ok: true; box: string; warm: boolean; output: string; inferred?: string[] } | { ok: false; question: string }>(
      "/delegate.json",
      { source: "git", ...input }
    ),

  /** MCP servers the sandbox agent gets. */
  mcpServers: (signal?: AbortSignal) =>
    fetch(url("/mcp-servers.json"), { headers: authHeaders, signal }).then(parse<McpServersResponse>),
  mcpMutate: (body: Record<string, unknown>) => post<McpServersResponse>("/mcp-servers.json", body),
  /** One server's health: the same MCP initialize handshake the in-box claude does at startup. */
  mcpTest: (name: string) => post<{ ok: boolean; status?: number; detail: string }>("/mcp-servers/test.json", { name }),
  skills: (signal?: AbortSignal) => fetch(url("/skills.json"), { headers: authHeaders, signal }).then(parse<SkillsResponse>),
  skillMutate: (body: Record<string, unknown>) => post<SkillsResponse>("/skills.json", body),
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
  /** Clone a repository into a running sandbox at /workspace/<name>. */
  attachRepo: (session: string, repo: string, ref?: string) =>
    post<{ ok: true; name: string; login?: string }>("/repos/attach.json", { session, repo, ref }),
};
