/**
 * The controller's JSON surface. Every route is bearer-guarded; the token rides in the page URL
 * (`?token=`) — a deliberate, confirmed decision — and is sent as both a header and a query param
 * so a page opened by navigation and a fetch from that page authenticate identically.
 */

export type RunState = "running" | "waiting" | "done" | "idle";
export type BoxRole = "session" | "pool-claimed" | "pool-free";

/** One row of /monitor.json (BoxView in src/monitor.ts). */
export interface BoxView {
  name: string;
  role: BoxRole;
  boxStatus: string;
  runState: RunState;
  exitCode?: number;
  task?: string;
  question?: string;
  uptime?: string;
  cpu?: string;
  mem?: string;
}

/** /watch.json — one box, including the agent log tail. */
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

/** Thrown for any non-2xx so callers can surface the server's own message verbatim. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);
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

async function post<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url(path), {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  return parse<T>(res);
}

export const api = {
  monitor: (signal?: AbortSignal) => fetch(url("/monitor.json"), { headers: authHeaders, signal }).then(parse<BoxView[]>),

  watch: (session: string, signal?: AbortSignal) =>
    fetch(url("/watch.json", { session }), { headers: authHeaders, signal }).then(parse<WatchSnapshot>),

  /** Read-only co-pilot. Cannot steer the driver — see the lane split in PRODUCT.md. */
  ask: (session: string, question: string, newThread = false) =>
    post<AskResult>("/ask.json", { session, question, newThread }),

  /** The ONLY way to steer a driver: answers the question it is blocked on. */
  resume: (session: string, message: string) => post<{ output: string }>("/resume.json", { session, message }),

  teardown: (session: string) => post<{ ok: true }>("/teardown.json", { session }),

  delegate: (input: { task: string; repo?: string; ref?: string }) =>
    post<
      | { ok: true; box: string; warm: boolean; output: string }
      | { ok: false; question: string }
    >("/delegate.json", { source: "git", ...input }),
};
