/**
 * Box hosts: the machines the controller may start sandboxes on.
 *
 * One controller used to mean one host: the SSH target in .env. Every msb call, the staging copy,
 * the claims and the run memory go over that one target, which is exactly what makes the host
 * swappable, and what makes a POOL of them possible: a host is nothing more than an SSH target
 * plus a few paths, and a run only ever needs to know which one its box lives on.
 *
 * This module is the registry: what a host IS (HostSpec), how it is stored (the `hosts` table),
 * how a box remembers its host (`box_hosts`) and how awake time is counted against an allowance
 * (`host_usage`). The primary host is seeded from .env on every boot so a controller that never
 * adds a second host behaves exactly as before, and the .env switch keeps working. Routing,
 * sleep and the provider calls live in host-pool.ts, host-pick.ts and providers.ts.
 */
import type { Db } from "./db.js";
import type { Config } from "./config.js";

/** Where a host comes from. "static": a machine of our own, nothing to pause. */
export type HostProvider = "static" | "freestyle";

export interface HostAllowance {
  /** Billable vCPU-hours per month on this account (Freestyle Free: 200, with a card: 400). */
  vcpuHours: number;
  /** vCPUs the host bills per awake hour. */
  vcpu: number;
  /** Day of the month the allowance resets (1-28). */
  resetDay: number;
}

export interface HostSpec {
  /** Stable id: "primary" for the .env host, a slug otherwise. */
  id: string;
  /** What the dashboard calls it. */
  name: string;
  provider: HostProvider;
  /** The SSH target (`user@host`, or `box+user:token@beta-ssh.freestyle.sh` for a Freestyle VM). */
  ssh: string;
  /** Extra ssh -o flags for this host only (an identity file, StrictHostKeyChecking). */
  sshExtraOpts?: string[];
  /** msb binary path on the host; the primary's value when unset. */
  msb?: string;
  /** microsandbox home on the host; the primary's value when unset. */
  msbHome?: string;
  /** Staging dir on the host; the primary's value when unset. */
  stagingDir?: string;
  /** Concurrent boxes this host may run; the primary's MSB_MAX_BOXES when unset. */
  maxBoxes?: number;
  /** Lower runs first. Equal priorities split by readiness, then by allowance left. */
  priority: number;
  /** Leave the host to pause itself after this long without a working box (0 = never). */
  sleepAfterMs: number;
  /** Keep warm boxes on this host. Off for a metered host that should sleep between runs. */
  warm: boolean;
  enabled: boolean;
  allowance?: HostAllowance;
  /** Provider handles: the VM id and the API key that may pause and start it. */
  freestyle?: { vmId: string; apiKey: string };
  /** Boot sources on this host when they differ from the primary's (an image not loaded there). */
  snapshot?: string;
  ompSnapshot?: string;
  claudeImage?: string;
  ompImage?: string;
}

export const PRIMARY_HOST_ID = "primary";

/** The host .env describes, as a spec. Connection fields come from the env on every boot. */
export function primaryHostSpec(cfg: Config): HostSpec {
  return {
    id: PRIMARY_HOST_ID,
    name: "Primary host",
    provider: "static",
    ssh: cfg.vpsSsh,
    sshExtraOpts: cfg.sshExtraOpts,
    msb: cfg.msb,
    msbHome: cfg.msbHome,
    stagingDir: cfg.vpsStagingDir,
    maxBoxes: cfg.maxBoxes,
    priority: 0,
    sleepAfterMs: cfg.hostSleepAfterMs,
    warm: true,
    enabled: true,
  };
}

/**
 * A Config bound to one host: the same controller settings with the connection fields swapped.
 * Every msb/ssh/rsync helper reads these fields, so a run started with this config lands on that
 * host and nowhere else. `hostId` lets the pool find the host again from any config it handed out.
 */
export function configForHost(base: Config, spec: HostSpec): Config {
  if (spec.id === PRIMARY_HOST_ID) return { ...base, hostId: PRIMARY_HOST_ID };
  return {
    ...base,
    hostId: spec.id,
    vpsSsh: spec.ssh,
    sshExtraOpts: spec.sshExtraOpts ?? base.sshExtraOpts,
    msb: spec.msb || base.msb,
    msbHome: (spec.msbHome || base.msbHome).replace(/\/+$/, ""),
    vpsStagingDir: spec.stagingDir || base.vpsStagingDir,
    maxBoxes: spec.maxBoxes ?? base.maxBoxes,
    hostSleepAfterMs: spec.sleepAfterMs,
    poolSize: spec.warm ? base.poolSize : 0,
    ompPoolSize: spec.warm ? base.ompPoolSize : 0,
    ...(spec.snapshot !== undefined ? { snapshot: spec.snapshot } : {}),
    ...(spec.ompSnapshot !== undefined ? { ompSnapshot: spec.ompSnapshot } : {}),
    ...(spec.claudeImage !== undefined ? { claudeImage: spec.claudeImage } : {}),
    ...(spec.ompImage !== undefined ? { ompImage: spec.ompImage } : {}),
  };
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Validate an operator-supplied spec; returns the normalised spec or throws with a plain message. */
export function normalizeHostSpec(raw: Partial<HostSpec> & { id?: string }, existing?: HostSpec): HostSpec {
  const id = (raw.id ?? existing?.id ?? slugify(String(raw.name ?? ""))).trim();
  if (!SLUG.test(id)) throw new Error("host id must be a lowercase slug (letters, digits, dashes)");
  const provider = raw.provider ?? existing?.provider ?? "static";
  if (provider !== "static" && provider !== "freestyle") throw new Error(`unknown provider "${String(provider)}"`);
  const ssh = String(raw.ssh ?? existing?.ssh ?? "").trim();
  if (!ssh || /\s/.test(ssh)) throw new Error("ssh target is required (user@host, no spaces)");
  if (ssh.startsWith("-")) throw new Error("ssh target cannot start with a dash");
  const name = String(raw.name ?? existing?.name ?? id).trim().slice(0, 60) || id;
  const num = (v: unknown, fallback: number, min: number, max: number): number => {
    if (v === undefined || v === null || v === "") return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error("expected a number");
    return Math.min(max, Math.max(min, n));
  };
  const opts = Array.isArray(raw.sshExtraOpts)
    ? raw.sshExtraOpts.map(String).filter(Boolean)
    : typeof (raw as { sshExtraOpts?: unknown }).sshExtraOpts === "string"
      ? String((raw as { sshExtraOpts?: unknown }).sshExtraOpts).split(/\s+/).filter(Boolean)
      : existing?.sshExtraOpts;
  let allowance: HostAllowance | undefined = existing?.allowance;
  if (raw.allowance === null) allowance = undefined;
  else if (raw.allowance) {
    allowance = {
      vcpuHours: num(raw.allowance.vcpuHours, 0, 0, 1_000_000),
      vcpu: num(raw.allowance.vcpu, 1, 1, 256),
      resetDay: Math.round(num(raw.allowance.resetDay, 1, 1, 28)),
    };
    if (allowance.vcpuHours <= 0) allowance = undefined;
  }
  let freestyle = existing?.freestyle;
  if (raw.freestyle === null) freestyle = undefined;
  else if (raw.freestyle) {
    const vmId = String(raw.freestyle.vmId ?? "").trim();
    // An edit that leaves the key blank keeps the stored one: the dashboard never shows it back.
    const apiKey = String(raw.freestyle.apiKey ?? "").trim() || existing?.freestyle?.apiKey || "";
    if (vmId && !/^[A-Za-z0-9_-]{3,80}$/.test(vmId)) throw new Error("Freestyle VM id looks wrong");
    freestyle = vmId ? { vmId, apiKey } : undefined;
  }
  if (provider === "freestyle" && !freestyle?.vmId) throw new Error("a Freestyle host needs its VM id");
  const str = (k: "msb" | "msbHome" | "stagingDir" | "snapshot" | "ompSnapshot" | "claudeImage" | "ompImage"): string | undefined => {
    const v = raw[k];
    if (v === undefined) return existing?.[k];
    const s = String(v).trim();
    return s === "" && (k === "msb" || k === "msbHome" || k === "stagingDir") ? undefined : s;
  };
  const maxBoxes = raw.maxBoxes === undefined ? existing?.maxBoxes : raw.maxBoxes === null || raw.maxBoxes === ("" as never) ? undefined : Math.round(num(raw.maxBoxes, 1, 1, 100));
  return {
    id,
    name,
    provider,
    ssh,
    ...(opts && opts.length ? { sshExtraOpts: opts } : {}),
    ...(str("msb") ? { msb: str("msb") } : {}),
    ...(str("msbHome") ? { msbHome: str("msbHome") } : {}),
    ...(str("stagingDir") ? { stagingDir: str("stagingDir") } : {}),
    ...(maxBoxes !== undefined ? { maxBoxes } : {}),
    priority: Math.round(num(raw.priority, existing?.priority ?? 10, -1000, 1000)),
    sleepAfterMs: Math.round(num(raw.sleepAfterMs, existing?.sleepAfterMs ?? (provider === "freestyle" ? 300_000 : 0), 0, 24 * 3600_000)),
    warm: raw.warm === undefined ? (existing?.warm ?? provider === "static") : !!raw.warm,
    enabled: raw.enabled === undefined ? (existing?.enabled ?? true) : !!raw.enabled,
    ...(allowance ? { allowance } : {}),
    ...(freestyle ? { freestyle } : {}),
    ...(str("snapshot") !== undefined ? { snapshot: str("snapshot") } : {}),
    ...(str("ompSnapshot") !== undefined ? { ompSnapshot: str("ompSnapshot") } : {}),
    ...(str("claudeImage") !== undefined ? { claudeImage: str("claudeImage") } : {}),
    ...(str("ompImage") !== undefined ? { ompImage: str("ompImage") } : {}),
  };
}

/** What the dashboard may see: the same spec with secrets replaced by "is set" flags. */
export function publicHostSpec(spec: HostSpec): Omit<HostSpec, "freestyle" | "ssh"> & { ssh: string; freestyle?: { vmId: string; hasApiKey: boolean } } {
  const { freestyle, ssh, ...rest } = spec;
  return {
    ...rest,
    ssh: redactSshTarget(ssh),
    ...(freestyle ? { freestyle: { vmId: freestyle.vmId, hasApiKey: !!freestyle.apiKey } } : {}),
  };
}

/** `box+user:TOKEN@proxy` → `box+user:…@proxy`; a plain `user@host` is unchanged. */
export function redactSshTarget(ssh: string): string {
  return ssh.replace(/^([^:@\s]+):([^@\s]+)@/, "$1:…@");
}

// --- storage --------------------------------------------------------------------------------------

export function listHostSpecs(db: Db): HostSpec[] {
  const rows = db.prepare(`SELECT spec_json FROM hosts ORDER BY created_at`).all() as { spec_json: string }[];
  const out: HostSpec[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.spec_json) as HostSpec);
    } catch {
      /* a corrupt row is skipped, never fatal */
    }
  }
  return out;
}

export function getHostSpec(db: Db, id: string): HostSpec | undefined {
  const row = db.prepare(`SELECT spec_json FROM hosts WHERE id = ?`).get(id) as { spec_json: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.spec_json) as HostSpec;
  } catch {
    return undefined;
  }
}

export function saveHostSpec(db: Db, spec: HostSpec, now = Date.now()): void {
  db.prepare(
    `INSERT INTO hosts (id, spec_json, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET spec_json = excluded.spec_json, updated_at = excluded.updated_at`
  ).run(spec.id, JSON.stringify(spec), now, now);
}

export function removeHostSpec(db: Db, id: string): boolean {
  if (id === PRIMARY_HOST_ID) throw new Error("the primary host comes from .env and cannot be removed");
  const r = db.prepare(`DELETE FROM hosts WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM box_hosts WHERE host_id = ?`).run(id);
  return r.changes > 0;
}

/**
 * Seed or refresh the primary host from .env. Operator-tunable fields (name, priority, enabled,
 * allowance, sleep) survive; the connection fields always follow the env so the .env switch that
 * moved production between hosts keeps working.
 */
export function seedPrimaryHost(db: Db, cfg: Config): HostSpec {
  const env = primaryHostSpec(cfg);
  const stored = getHostSpec(db, PRIMARY_HOST_ID);
  const spec: HostSpec = stored
    ? { ...stored, ssh: env.ssh, sshExtraOpts: env.sshExtraOpts, msb: env.msb, msbHome: env.msbHome, stagingDir: env.stagingDir, maxBoxes: env.maxBoxes, enabled: true, snapshot: undefined, ompSnapshot: undefined, claudeImage: undefined, ompImage: undefined }
    : env;
  // The env's sleep setting wins when it is set at all: it is the knob the runbook documents.
  if (cfg.hostSleepAfterMs > 0 || !stored) spec.sleepAfterMs = cfg.hostSleepAfterMs;
  saveHostSpec(db, spec);
  return spec;
}

// --- box → host memory ------------------------------------------------------------------------------

export function rememberBoxHost(db: Db, box: string, hostId: string, now = Date.now()): void {
  db.prepare(`INSERT INTO box_hosts (box, host_id, at) VALUES (?, ?, ?) ON CONFLICT(box) DO UPDATE SET host_id = excluded.host_id, at = excluded.at`).run(box, hostId, now);
}

export function forgetBoxHost(db: Db, box: string): void {
  db.prepare(`DELETE FROM box_hosts WHERE box = ?`).run(box);
}

export function boxHostOf(db: Db, box: string): string | undefined {
  const row = db.prepare(`SELECT host_id FROM box_hosts WHERE box = ?`).get(box) as { host_id: string } | undefined;
  return row?.host_id;
}

export function allBoxHosts(db: Db): Map<string, string> {
  const rows = db.prepare(`SELECT box, host_id FROM box_hosts`).all() as { box: string; host_id: string }[];
  return new Map(rows.map((r) => [r.box, r.host_id]));
}

// --- awake-time accounting -----------------------------------------------------------------------------

/** The billing month a moment falls in, given the day the allowance resets: "2026-11" style keys. */
export function billingMonth(atMs: number, resetDay = 1): string {
  const d = new Date(atMs);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  if (d.getUTCDate() < resetDay) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function addAwakeMs(db: Db, hostId: string, month: string, ms: number): void {
  if (ms <= 0) return;
  db.prepare(
    `INSERT INTO host_usage (host_id, month, awake_ms) VALUES (?, ?, ?)
     ON CONFLICT(host_id, month) DO UPDATE SET awake_ms = awake_ms + excluded.awake_ms`
  ).run(hostId, month, Math.round(ms));
}

export function awakeMsOf(db: Db, hostId: string, month: string): number {
  const row = db.prepare(`SELECT awake_ms FROM host_usage WHERE host_id = ? AND month = ?`).get(hostId, month) as { awake_ms: number } | undefined;
  return row?.awake_ms ?? 0;
}

/** vCPU-hours left this month, or undefined when the host has no allowance. */
export function allowanceLeft(spec: HostSpec, awakeMs: number): { usedHours: number; leftHours: number; pct: number } | undefined {
  if (!spec.allowance) return undefined;
  const usedHours = (awakeMs / 3600_000) * spec.allowance.vcpu;
  const leftHours = Math.max(0, spec.allowance.vcpuHours - usedHours);
  return { usedHours, leftHours, pct: Math.min(100, Math.round((usedHours / spec.allowance.vcpuHours) * 100)) };
}
