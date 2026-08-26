/**
 * The controller's JSON surface. Every data route is bearer-guarded; the token rides in the page URL
 * (`?token=`) and is sent as both a header and a query param, so a page opened by navigation and a
 * fetch made from it authenticate identically.
 */

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
  /** Follow-ups queued while the agent was mid-turn; delivered when it finishes. */
  queued?: string[];
}

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

export const token = new URLSearchParams(location.search).get("token") ?? "";

function url(path: string, params: Record<string, string> = {}) {
  const u = new URL(path, location.origin);
  if (token) u.searchParams.set("token", token);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

const authHeaders: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
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

export const api = {
  /**
   * The fleet with lifecycle facts. Falls back to `/monitor.json` (boxes only, no lifecycle) against
   * an older controller so the dashboard still works during a rolling deploy.
   */
  async fleet(signal?: AbortSignal): Promise<FleetSnapshot> {
    if (!fleetRouteMissing) {
      const res = await fetch(url("/fleet.json"), { headers: authHeaders, signal });
      if (res.status !== 404) return parse<FleetSnapshot>(res);
      fleetRouteMissing = true;
    }
    const boxes = await fetch(url("/monitor.json"), { headers: authHeaders, signal }).then(parse<BoxView[]>);
    return { boxes, lifecycle: { capacity: 0, poolSize: 0 }, at: Date.now() };
  },

  watch: (session: string, signal?: AbortSignal) =>
    fetch(url("/watch.json", { session }), { headers: authHeaders, signal }).then(parse<WatchSnapshot>),

  /** URL for the live SSE log stream. EventSource can't set headers, so the token rides in the query. */
  watchStreamUrl: (session: string, from = 0) =>
    url("/watch.sse", from > 0 ? { session, from: String(from) } : { session }),

  /** Download URL for a produced file — token in the query so the browser's own GET authenticates. */
  artifactUrl: (session: string, path: string) => url("/artifact", { session, path }),

  /** Fetch a produced file's text for inline preview. Throws ApiError (404/413/…) on failure. */
  async artifactText(session: string, path: string, signal?: AbortSignal): Promise<string> {
    const res = await fetch(url("/artifact", { session, path }), { headers: authHeaders, signal });
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
  resume: (session: string, message: string, opts: { force?: boolean } = {}) =>
    post<{ output: string; queued?: undefined } | { queued: true; id: string }>("/resume.json", {
      session,
      message,
      force: opts.force,
    }),

  /** Queued follow-ups for a box. */
  inbox: (session: string) =>
    fetch(url("/inbox.json", { session }), { headers: authHeaders }).then(parse<{ queued: QueuedMessage[] }>),
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

  delegate: (input: { task: string; repo?: string; ref?: string }) =>
    post<{ ok: true; box: string; warm: boolean; output: string } | { ok: false; question: string }>(
      "/delegate.json",
      { source: "git", ...input }
    ),
};
