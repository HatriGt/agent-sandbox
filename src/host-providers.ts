/**
 * Provider adapters: what the controller can ask a host's cloud about the machine itself, beyond
 * SSH. A static host (our own VPS) has nothing to ask. A Freestyle VM can be looked up, paused and
 * started through the REST API (the `freestyle` CLI calls the same endpoints: GET /v5/vms/{id},
 * POST .../pause, POST .../start, bearer API key), and a new one can be provisioned from an API
 * key alone (POST /v5/vms, then an identity, a grant and a token for the SSH proxy).
 *
 * The pool never relies on these to run: a host pauses itself when the controller goes quiet and
 * wakes on the next SSH. The adapter is for the dashboard (is the VM running or paused right now)
 * and for the two buttons (pause now, wake now), plus a pre-wake before a run so the SSH that
 * launches it does not pay the resume. Every call is bounded and every failure is a string, never
 * a throw into the run path.
 *
 * Everything the pool knows about a provider comes from here: whether it is metered, whether its
 * credentials are present (`canDrive`), whether its machines sit behind an SSH proxy worth
 * tunnelling past (`proxyHost`), which `cloud` fields a host row needs, and what the add-host
 * form should ask for (`listProviders`). A second provider is one more adapter in `adapters`.
 */
import type { HostCloud, HostSpec } from "./hosts.js";

export interface ProviderState {
  /** "running" | "paused" | "stopped" | "unknown" | "n/a" (static). */
  state: string;
  detail?: string;
  at: number;
}

/** What `provision` needs from the operator: the account key and a name for the machine. */
export interface ProvisionRequest {
  apiKey: string;
  /** The VM's slug in that account (unique there); the host's id is a fine choice. */
  slug: string;
  /** The image to boot from; the adapter's default when unset (Freestyle: `freestyle/ubuntu`). */
  snapshotId?: string;
  /** Pause after this long without network activity (Freestyle default here: 300 s). */
  idleTimeoutSeconds?: number;
}

export interface ProvisionIO {
  log?: (m: string) => void;
  /**
   * Resolve once the SSH target answers (the route passes a real `ssh … true` with retries); reject
   * to have the adapter tear down what it made. Unset: the adapter does not wait.
   */
  sshReady?: (ssh: string) => Promise<void>;
}

export type ProvisionResult =
  | {
      ok: true;
      /** The SSH target the host row stores (`slug+root:TOKEN@proxy` for Freestyle). */
      ssh: string;
      /** The provider handles the host row stores: the VM id, the key, and what a later destroy needs. */
      cloud: HostCloud;
      /** The image the VM booted from, for the record. */
      snapshotId?: string;
      log: string[];
    }
  | { ok: false; error: string; log: string[] };

export interface ProviderInfo {
  id: string;
  /** What the dashboard calls a host of this kind ("Freestyle VM", "your machine"). */
  label: string;
  /** One line under the provider choice. */
  hint: string;
  /** `cloud` fields a host row of this kind must carry (the form asks for them). */
  needs: string[];
  /** `cloud` fields that are secrets: stored, never sent back, blank on an edit keeps them. */
  secrets: string[];
  /** Guidance for the SSH target field. */
  sshHint: string;
  sshPlaceholder: string;
  /** The adapter can build a machine from an API key alone (POST /hosts/provision.json). */
  canProvision: boolean;
  /** The adapter can snapshot a prepared machine so the next provision boots from it. */
  canSnapshot: boolean;
  metered: boolean;
}

export interface ProviderAdapter extends ProviderInfo {
  /** What the cloud says the machine is doing. */
  state(spec: HostSpec): Promise<ProviderState>;
  /** Freeze the machine now (no-op where unsupported). */
  pause(spec: HostSpec): Promise<ProviderState>;
  /** Start or resume it now (no-op where unsupported). */
  start(spec: HostSpec): Promise<ProviderState>;
  /** The credentials to drive the machine are present: the pool may pause, start and poll it. */
  canDrive(spec: HostSpec): boolean;
  /**
   * The SSH proxy its machines sit behind, when they do: the pool dials a direct route past it
   * (src/ssh-tunnel.ts). Unset for a machine reached directly.
   */
  proxyHost?: string;
  /** The SSH target for a machine behind the proxy, from the parts the proxy wants in the username. */
  sshTarget?(parts: { vm: string; user?: string; token: string }): string;
  /** Build a machine from an API key: VM, identity, grant, token, SSH target. Never throws. */
  provision?(req: ProvisionRequest, io?: ProvisionIO): Promise<ProvisionResult>;
  /** Capture a prepared host as a snapshot in its account; the id can seed the next provision. */
  snapshot?(spec: HostSpec, opts?: { slug?: string; displayName?: string }): Promise<{ ok: true; snapshotId: string; slug?: string } | { ok: false; error: string }>;
  /** Delete the machine and the identity made for it (what `provision` created). Never throws. */
  destroy?(spec: HostSpec): Promise<{ ok: boolean; detail: string }>;
}

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const staticAdapter: ProviderAdapter = {
  id: "static",
  label: "My own machine",
  hint: "A machine of your own: a VPS, a home server. Nothing is paused.",
  needs: [],
  secrets: [],
  sshHint: "user@host, reachable with the controller's key",
  sshPlaceholder: "root@203.0.113.7",
  canProvision: false,
  canSnapshot: false,
  metered: false,
  canDrive: () => false,
  state: async () => ({ state: "n/a", at: Date.now() }),
  pause: async () => ({ state: "n/a", detail: "a static host is never paused by the controller", at: Date.now() }),
  start: async () => ({ state: "n/a", at: Date.now() }),
};

export const FREESTYLE_API = "https://api.freestyle.sh";
export const FREESTYLE_SSH_PROXY = "beta-ssh.freestyle.sh";
export const FREESTYLE_DEFAULT_SNAPSHOT = "freestyle/ubuntu";

/** The credentials block of a spec, whichever key a stored row used. */
export function cloudOf(spec: Pick<HostSpec, "cloud"> & { freestyle?: HostCloud }): HostCloud | undefined {
  return spec.cloud ?? spec.freestyle;
}

export function makeFreestyleAdapter(fetcher: Fetcher = fetch as unknown as Fetcher, timeoutMs = 20_000, pollMs = 2_000): ProviderAdapter {
  interface Reply {
    ok: boolean;
    status: number;
    body: string;
    json: Record<string, unknown> | undefined;
  }
  /** One bounded request; a transport failure is a reply with status 0, never a throw. */
  const req = async (apiKey: string, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, ms = timeoutMs): Promise<Reply> => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetcher(`${FREESTYLE_API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        signal: ac.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await r.text();
      let json: Record<string, unknown> | undefined;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        json = undefined;
      }
      return { ok: r.ok, status: r.status, body: text, json };
    } catch (e) {
      return { ok: false, status: 0, body: (e as Error).message.slice(0, 200), json: undefined };
    } finally {
      clearTimeout(t);
    }
  };
  const fail = (what: string, r: Reply): string => `${what} → ${r.status || "no reply"}: ${summarizeError(r.body)}`;

  const call = async (spec: HostSpec, method: "GET" | "POST", suffix: string): Promise<ProviderState> => {
    const fs = cloudOf(spec);
    if (!fs?.vmId) return { state: "unknown", detail: "no VM id", at: Date.now() };
    if (!fs.apiKey) return { state: "unknown", detail: "no API key stored for this host", at: Date.now() };
    const r = await req(fs.apiKey, method, `/v5/vms/${encodeURIComponent(fs.vmId)}${suffix}`);
    if (r.status === 0) return { state: "unknown", detail: r.body, at: Date.now() };
    if (!r.ok) return { state: "unknown", detail: `${method} ${suffix || "/"} → ${r.status}: ${summarizeError(r.body)}`, at: Date.now() };
    return { ...parseVmState(r.body), at: Date.now() };
  };

  const sshTarget = ({ vm, user = "root", token }: { vm: string; user?: string; token: string }): string => `${vm}+${user}:${token}@${FREESTYLE_SSH_PROXY}`;

  const provision = async (p: ProvisionRequest, io: ProvisionIO = {}): Promise<ProvisionResult> => {
    const log: string[] = [];
    const say = (m: string) => {
      log.push(m);
      io.log?.(m);
    };
    const apiKey = p.apiKey.trim();
    if (!apiKey) return { ok: false, error: "an API key is required", log };
    const slug = p.slug.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) || /--/.test(slug)) return { ok: false, error: `"${p.slug}" is not a Freestyle slug (a-z, 0-9, single dashes, up to 63)`, log };
    const snapshotId = p.snapshotId?.trim() || FREESTYLE_DEFAULT_SNAPSHOT;
    const idle = p.idleTimeoutSeconds ?? 300;
    let vmId: string | undefined;
    let identityId: string | undefined;
    const undo = async (why: string): Promise<void> => {
      // Identity first (its tokens and grants go with it), then the VM; a failure here is logged, not fatal.
      if (identityId) {
        const r = await req(apiKey, "DELETE", `/v5/identities/${encodeURIComponent(identityId)}`);
        say(r.ok ? `identity ${identityId} deleted` : `could not delete identity ${identityId} (${fail("DELETE", r)}); remove it by hand`);
      }
      if (vmId) {
        const r = await req(apiKey, "DELETE", `/v5/vms/${encodeURIComponent(vmId)}`);
        say(r.ok ? `VM ${vmId} deleted` : `could not delete VM ${vmId} (${fail("DELETE", r)}); remove it by hand`);
      }
      say(`undone: ${why}`);
    };
    // 1. The VM. The API grants nothing implicitly, so the outbound rule is written out: boxes
    // need npm, GitHub and the model proxy. A create can outlive a plain request while the image
    // materialises (the CLI backgrounds it); a longer cap here, and a 202 is polled below.
    say(`creating VM "${slug}" from ${snapshotId} (idle ${idle}s)`);
    const made = await req(apiKey, "POST", "/v5/vms", { snapshotId, slug, displayName: `agent-sandbox ${slug}`, idleTimeoutSeconds: idle, firewall: { rules: [{ action: "allow", source: {}, destination: { public: true } }] }, metadata: { "agent-sandbox": "box-host" } }, Math.max(timeoutMs, 120_000));
    const vm = made.ok ? await settle(apiKey, made) : made;
    vmId = typeof vm.json?.id === "string" ? vm.json.id : undefined;
    if (!vm.ok || !vmId) return { ok: false, error: fail("create VM", vm), log };
    say(`VM ${vmId} created (${parseVmState(vm.body).state})`);
    // 2. An identity the controller SSHes as, with root on this VM only, and a token that never expires.
    const idn = await req(apiKey, "POST", "/v5/identities", {});
    identityId = typeof idn.json?.id === "string" ? idn.json.id : undefined;
    if (!idn.ok || !identityId) {
      await undo(fail("create identity", idn));
      return { ok: false, error: fail("create identity", idn), log };
    }
    say(`identity ${identityId} created`);
    const grant = await req(apiKey, "POST", `/v5/identities/${encodeURIComponent(identityId)}/permissions/vm`, { vmId, allowedLinuxUsers: ["root"] });
    if (!grant.ok) {
      await undo(fail("grant root on the VM", grant));
      return { ok: false, error: fail("grant root on the VM", grant), log };
    }
    say("root on the VM granted to it");
    const tok = await req(apiKey, "POST", `/v5/identities/${encodeURIComponent(identityId)}/tokens`, {});
    const token = typeof tok.json?.token === "string" ? tok.json.token : undefined;
    const tokenId = typeof tok.json?.id === "string" ? tok.json.id : undefined;
    if (!tok.ok || !token) {
      await undo(fail("mint a token", tok));
      return { ok: false, error: fail("mint a token", tok), log };
    }
    say(`token ${tokenId ?? "?"} minted (shown once, kept in the SSH target)`);
    const ssh = sshTarget({ vm: slug, token });
    // 3. The proxy has to take the token and the VM's sshd has to answer before the row is worth saving.
    if (io.sshReady) {
      say("waiting for SSH through the proxy");
      try {
        await io.sshReady(ssh);
      } catch (e) {
        const why = `SSH never answered: ${String((e as Error).message ?? e).split("\n")[0].slice(0, 200)}`;
        await undo(why);
        return { ok: false, error: why, log };
      }
      say("SSH answers");
    }
    return { ok: true, ssh, cloud: { vmId, apiKey, slug, identityId, ...(tokenId ? { tokenId } : {}) }, snapshotId, log };
  };

  /** A 202 from a long create: poll the background request until the VM record is there (2 s apart, 3 min cap). */
  const settle = async (apiKey: string, first: Reply): Promise<Reply> => {
    if (first.status !== 202) return first;
    const id = typeof first.json?.requestId === "string" ? first.json.requestId : undefined;
    const path = typeof first.json?.resultUrl === "string" ? first.json.resultUrl.replace(/^https?:\/\/[^/]+/, "") : id ? `/v5/background-requests/${encodeURIComponent(id)}` : undefined;
    if (!path) return { ...first, ok: false, body: "202 Accepted carried no background request id" };
    const until = Date.now() + 180_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, pollMs));
      const r = await req(apiKey, "GET", path);
      if (r.status === 202) continue;
      if (r.status === 0) continue;
      return r;
    }
    return { ok: false, status: 202, body: "the VM was still being created after 3 minutes", json: undefined };
  };

  const snapshot = async (spec: HostSpec, opts: { slug?: string; displayName?: string } = {}) => {
    const fs = cloudOf(spec);
    if (!fs?.vmId || !fs.apiKey) return { ok: false as const, error: "the host has no VM id or API key" };
    const r = await req(fs.apiKey, "POST", `/v5/vms/${encodeURIComponent(fs.vmId)}/snapshot`, { ...(opts.slug ? { slug: opts.slug } : {}), ...(opts.displayName ? { displayName: opts.displayName } : {}) }, Math.max(timeoutMs, 180_000));
    const id = typeof r.json?.snapshotId === "string" ? r.json.snapshotId : typeof (r.json?.snapshot as Record<string, unknown> | undefined)?.id === "string" ? String((r.json!.snapshot as Record<string, unknown>).id) : undefined;
    if (!r.ok || !id) return { ok: false as const, error: fail("snapshot", r) };
    const snap = r.json?.snapshot as Record<string, unknown> | undefined;
    return { ok: true as const, snapshotId: id, ...(typeof snap?.slug === "string" ? { slug: snap.slug } : {}) };
  };

  const destroy = async (spec: HostSpec): Promise<{ ok: boolean; detail: string }> => {
    const fs = cloudOf(spec);
    if (!fs?.vmId || !fs.apiKey) return { ok: false, detail: "the host has no VM id or API key" };
    const notes: string[] = [];
    let ok = true;
    if (fs.identityId) {
      const r = await req(fs.apiKey, "DELETE", `/v5/identities/${encodeURIComponent(fs.identityId)}`);
      if (r.ok || r.status === 404) notes.push(`identity ${fs.identityId} deleted`);
      else {
        ok = false;
        notes.push(`identity ${fs.identityId}: ${fail("DELETE", r)}`);
      }
    }
    const r = await req(fs.apiKey, "DELETE", `/v5/vms/${encodeURIComponent(fs.vmId)}`);
    if (r.ok || r.status === 404) notes.push(`VM ${fs.vmId} deleted`);
    else {
      ok = false;
      notes.push(`VM ${fs.vmId}: ${fail("DELETE", r)}`);
    }
    return { ok, detail: notes.join("; ") };
  };

  return {
    id: "freestyle",
    label: "Freestyle VM",
    hint: "A Freestyle VM pauses itself when idle and bills only while awake; the API key lets the controller pause and start it, or build a new one.",
    needs: ["vmId"],
    secrets: ["apiKey"],
    sshHint: `name+root:TOKEN@${FREESTYLE_SSH_PROXY} — the identity token from the runbook`,
    sshPlaceholder: `asb-host+root:…@${FREESTYLE_SSH_PROXY}`,
    canProvision: true,
    canSnapshot: true,
    metered: true,
    proxyHost: FREESTYLE_SSH_PROXY,
    canDrive: (spec) => !!cloudOf(spec)?.apiKey && !!cloudOf(spec)?.vmId,
    sshTarget,
    state: (spec) => call(spec, "GET", ""),
    pause: (spec) => call(spec, "POST", "/pause"),
    start: (spec) => call(spec, "POST", "/start"),
    provision,
    snapshot,
    destroy,
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

export function providerFor(spec: Pick<HostSpec, "provider">): ProviderAdapter {
  return adapters[spec.provider] ?? staticAdapter;
}

export function knownProvider(id: unknown): id is string {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(adapters, id);
}

/** What the add-host form needs to know about each provider, in the order they are offered. */
export function listProviders(): ProviderInfo[] {
  return Object.values(adapters).map(({ id, label, hint, needs, secrets, sshHint, sshPlaceholder, canProvision, canSnapshot, metered }) => ({ id, label, hint, needs, secrets, sshHint, sshPlaceholder, canProvision, canSnapshot, metered }));
}

/** Test seam. */
export function setProviderForTest(name: string, adapter: (Partial<ProviderAdapter> & Pick<ProviderAdapter, "metered" | "state" | "pause" | "start">) | null): void {
  if (adapter) {
    // By reference, so a test that swaps `fake.pause` afterwards is heard; the facts a partial fake left out come from the real one.
    const base = adapters[name] ?? staticAdapter;
    for (const k of Object.keys(base) as (keyof ProviderAdapter)[]) if (!(k in adapter)) (adapter as Record<string, unknown>)[k] = base[k];
    (adapter as { id: string }).id = name;
    adapters[name] = adapter as ProviderAdapter;
  }
  else if (name === "freestyle") adapters.freestyle = makeFreestyleAdapter();
  else if (name === "static") adapters.static = staticAdapter;
  else delete adapters[name];
}
