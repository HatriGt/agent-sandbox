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
  boxStatus: string;
  runState: RunState;
  exitCode?: number;
  task?: string;
  question?: string;
  uptime?: string;
  cpu?: string;
  mem?: string;
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

export const api = {
  monitor: (signal?: AbortSignal) =>
    fetch(url("/monitor.json"), { headers: authHeaders, signal }).then(parse<BoxView[]>),

  watch: (session: string, signal?: AbortSignal) =>
    fetch(url("/watch.json", { session }), { headers: authHeaders, signal }).then(parse<WatchSnapshot>),

  /** Read-only observer. Cannot steer the agent, by design. */
  ask: (session: string, question: string, newThread = false) =>
    post<AskResult>("/ask.json", { session, question, newThread }),

  /** The only way to steer the agent: answers what it is blocked on, or sends a follow-up. */
  resume: (session: string, message: string) => post<{ output: string }>("/resume.json", { session, message }),

  teardown: (session: string) => post<{ ok: true }>("/teardown.json", { session }),

  delegate: (input: { task: string; repo?: string; ref?: string }) =>
    post<{ ok: true; box: string; warm: boolean; output: string } | { ok: false; question: string }>(
      "/delegate.json",
      { source: "git", ...input }
    ),
};
