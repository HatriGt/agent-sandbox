/**
 * Provider adapters: what the controller can ask a host's cloud about the machine itself, beyond
 * SSH. A static host (our own VPS) has nothing to ask. A Freestyle VM can be looked up, paused and
 * started through the REST API (the `freestyle` CLI calls the same endpoints: GET /v5/vms/{id},
 * POST .../pause, POST .../start, bearer API key).
 *
 * The pool never relies on these to run: a host pauses itself when the controller goes quiet and
 * wakes on the next SSH. The adapter is for the dashboard (is the VM running or paused right now)
 * and for the two buttons (pause now, wake now), plus a pre-wake before a run so the SSH that
 * launches it does not pay the resume. Every call is bounded and every failure is a string, never
 * a throw into the run path.
 */
import type { HostSpec } from "./hosts.js";

export interface ProviderState {
  /** "running" | "paused" | "stopped" | "unknown" | "n/a" (static). */
  state: string;
  detail?: string;
  at: number;
}

export interface ProviderAdapter {
  /** What the cloud says the machine is doing. */
  state(spec: HostSpec): Promise<ProviderState>;
  /** Freeze the machine now (no-op where unsupported). */
  pause(spec: HostSpec): Promise<ProviderState>;
  /** Start or resume it now (no-op where unsupported). */
  start(spec: HostSpec): Promise<ProviderState>;
  /** Whether this provider bills awake time: the pool counts it against the allowance then. */
  metered: boolean;
}

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const staticAdapter: ProviderAdapter = {
  metered: false,
  state: async () => ({ state: "n/a", at: Date.now() }),
  pause: async () => ({ state: "n/a", detail: "a static host is never paused by the controller", at: Date.now() }),
  start: async () => ({ state: "n/a", at: Date.now() }),
};

export const FREESTYLE_API = "https://api.freestyle.sh";

export function makeFreestyleAdapter(fetcher: Fetcher = fetch as unknown as Fetcher, timeoutMs = 20_000): ProviderAdapter {
  const call = async (spec: HostSpec, method: "GET" | "POST", suffix: string): Promise<ProviderState> => {
    const fs = spec.freestyle;
    if (!fs?.vmId) return { state: "unknown", detail: "no VM id", at: Date.now() };
    if (!fs.apiKey) return { state: "unknown", detail: "no API key stored for this host", at: Date.now() };
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetcher(`${FREESTYLE_API}/v5/vms/${encodeURIComponent(fs.vmId)}${suffix}`, {
        method,
        headers: { Authorization: `Bearer ${fs.apiKey}`, Accept: "application/json" },
        signal: ac.signal,
      });
      const body = await r.text();
      if (!r.ok) return { state: "unknown", detail: `${method} ${suffix || "/"} → ${r.status}: ${summarizeError(body)}`, at: Date.now() };
      return { ...parseVmState(body), at: Date.now() };
    } catch (e) {
      return { state: "unknown", detail: (e as Error).message.slice(0, 200), at: Date.now() };
    } finally {
      clearTimeout(t);
    }
  };
  return {
    metered: true,
    state: (spec) => call(spec, "GET", ""),
    pause: (spec) => call(spec, "POST", "/pause"),
    start: (spec) => call(spec, "POST", "/start"),
  };
}

/** The VM's lifecycle word from a GET/POST body; the API nests it in a few shapes, so look in each. */
export function parseVmState(body: string): { state: string; detail?: string } {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const vm = (j.vm ?? j) as Record<string, unknown>;
    const raw = vm.state ?? vm.status ?? (vm.lifecycle as Record<string, unknown> | undefined)?.state ?? j.state;
    const s = typeof raw === "string" ? raw.toLowerCase() : typeof raw === "object" && raw ? String((raw as Record<string, unknown>).kind ?? (raw as Record<string, unknown>).type ?? "").toLowerCase() : "";
    if (/run|active|booted/.test(s)) return { state: "running" };
    if (/pause|suspend|frozen/.test(s)) return { state: "paused" };
    if (/stop|off|shut/.test(s)) return { state: "stopped" };
    if (/start|boot|resum|pending/.test(s)) return { state: "starting" };
    return { state: s || "unknown", detail: s ? undefined : "no state in the reply" };
  } catch {
    return { state: "unknown", detail: body.slice(0, 120) };
  }
}

function summarizeError(body: string): string {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const m = j.message ?? j.error ?? (j.detail as unknown);
    return typeof m === "string" ? m.slice(0, 160) : body.slice(0, 160);
  } catch {
    return body.slice(0, 160);
  }
}

const adapters: Record<string, ProviderAdapter> = {
  static: staticAdapter,
  freestyle: makeFreestyleAdapter(),
};

export function providerFor(spec: HostSpec): ProviderAdapter {
  return adapters[spec.provider] ?? staticAdapter;
}

/** Test seam. */
export function setProviderForTest(name: string, adapter: ProviderAdapter | null): void {
  if (adapter) adapters[name] = adapter;
  else if (name === "freestyle") adapters.freestyle = makeFreestyleAdapter();
  else delete adapters[name];
}
