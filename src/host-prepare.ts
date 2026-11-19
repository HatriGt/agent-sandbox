/**
 * Making a new host ready to take boxes, from the dashboard, instead of the runbook's hand steps.
 *
 * A machine that answers SSH is not yet a box host: it needs the `msb` the controller drives (the
 * real one on a KVM machine, the Docker-backed shim on one without), the tools the controller's
 * helpers assume (rsync for the staging copy), its directories, and the box images the primary
 * boots from. The provider adapter knows the first three for its kind of machine (`prepare`,
 * src/host-providers.ts); the images are the same on every host, so they are streamed from the
 * primary: `msb save --format docker` there, `msb load` here, one ssh piped into the other
 * through the controller (1.9 GB in about three minutes, measured hostbrr → Instabox 2026-11-19).
 *
 * One prepare runs per host at a time, in the background; `prepareStatus` is what the dashboard
 * shows (`prepare` on the host row of /hosts.json). An image already on the host is skipped, so
 * running it again after a failure only does what is missing.
 */
import { spawn } from "node:child_process";
import type { Config } from "./config.js";
import { run, shellQuote } from "./exec.js";
import type { HostSpec } from "./hosts.js";
import { providerFor, type PrepareIO } from "./host-providers.js";
import { sshMuxOpts } from "./ssh.js";

export interface PrepareReport {
  running: boolean;
  ok?: boolean;
  /** What was done, in order ("shim installed · rsync:ok", "agent-claude:… streamed in 2m48s"). */
  steps: string[];
  error?: string;
  startedAt: number;
  endedAt?: number;
}

const jobs = new Map<string, PrepareReport>();

export function prepareStatus(id: string): PrepareReport | undefined {
  return jobs.get(id);
}

/** The IO an adapter's `prepare` gets: a script on the host with optional stdin, over the host's own mux. */
export function prepareIO(cfg: Config, log?: (m: string) => void): PrepareIO {
  return {
    ssh: async (script, input, timeoutMs = 120_000) => {
      try {
        return await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, script], { check: false, input: input ?? "", timeoutMs });
      } catch (e) {
        return { code: 255, stdout: "", stderr: String((e as Error).message ?? e) };
      }
    },
    log,
  };
}

/** The images every box boots from on the primary; a host row may name its own instead. */
export function imagesWanted(primary: Config, host: Config): string[] {
  return Array.from(new Set([host.claudeImage || primary.claudeImage, host.ompImage || primary.ompImage].filter((s): s is string => !!s)));
}

export interface PrepareDeps {
  /** Is the image on the host already (`msb image inspect` exits 0)? */
  hasImage?: (host: Config, ref: string) => Promise<boolean>;
  /** Stream one image from the primary into the host; rejects with the reason. */
  streamImage?: (primary: Config, host: Config, ref: string) => Promise<void>;
  log?: (m: string) => void;
  now?: () => number;
  /** Called once the run ends, with the report (the caller re-checks the host after a success). */
  done?: (report: PrepareReport) => void;
}

/**
 * A failed check that preparation would cure: the machine answered over SSH but has no `msb`
 * (exit 127, "not found"), which is what the adapter's step installs. A check that failed for
 * any other reason (no SSH, a wrong token, a broken shim) is left alone: preparing it would fail
 * the same way and the row already says why.
 */
export function prepareCuresCheck(check: { ok: boolean; detail: string } | undefined): boolean {
  if (!check || check.ok) return true;
  return /exit 127\b|not found/i.test(check.detail);
}

async function hasImageOverSsh(host: Config, ref: string): Promise<boolean> {
  const r = await run("ssh", [...sshMuxOpts(host), host.vpsSsh, `${shellQuote(host.msb)} image inspect ${shellQuote(ref)} >/dev/null 2>&1 && echo present`], { check: false, timeoutMs: 60_000 }).catch(() => undefined);
  return !!r && r.code === 0 && /present/.test(r.stdout);
}

/**
 * `msb save` on the primary writes a docker-format tar (msb 0.6.9 has no stdout mode), which is
 * then catted into `msb load` on the host. The two ssh processes are joined by a pipe here; the
 * tar never touches the controller's disk. The primary's temporary file is removed either way.
 */
function streamImageOverSsh(primary: Config, host: Config, ref: string): Promise<void> {
  const tmp = `$HOME/.agent-sandbox/asb-image-${Date.now().toString(36)}.tar`;
  const save = `F=${tmp}; mkdir -p "$(dirname "$F")"; ${shellQuote(primary.msb)} save ${shellQuote(ref)} --format docker -o "$F" >&2 && cat "$F"; S=$?; rm -f "$F"; exit $S`;
  const load = `${shellQuote(host.msb)} load -q -t ${shellQuote(ref)}`;
  return new Promise<void>((resolve, reject) => {
    const src = spawn("ssh", [...sshMuxOpts(primary), primary.vpsSsh, save], { stdio: ["ignore", "pipe", "pipe"] });
    const dst = spawn("ssh", [...sshMuxOpts(host), host.vpsSsh, load], { stdio: ["pipe", "pipe", "pipe"] });
    let srcErr = "";
    let dstErr = "";
    let dstOut = "";
    src.stderr.setEncoding("utf8");
    dst.stderr.setEncoding("utf8");
    dst.stdout.setEncoding("utf8");
    src.stderr.on("data", (d: string) => (srcErr = (srcErr + d).slice(-600)));
    dst.stderr.on("data", (d: string) => (dstErr = (dstErr + d).slice(-600)));
    dst.stdout.on("data", (d: string) => (dstOut = (dstOut + d).slice(-200)));
    src.stdout.pipe(dst.stdin);
    const timer = setTimeout(() => {
      src.kill();
      dst.kill();
      reject(new Error(`streaming ${ref} took more than 45 minutes`));
    }, 45 * 60_000);
    let srcCode: number | null | undefined;
    let dstCode: number | null | undefined;
    const settle = () => {
      if (srcCode === undefined || dstCode === undefined) return;
      clearTimeout(timer);
      if (srcCode !== 0) reject(new Error(`msb save on the primary exited ${srcCode}: ${srcErr.trim().split("\n").pop() ?? ""}`));
      else if (dstCode !== 0) reject(new Error(`msb load on the host exited ${dstCode}: ${dstErr.trim().split("\n").pop() ?? ""}`));
      else resolve();
    };
    src.on("error", (e) => {
      srcCode = 255;
      srcErr = String(e.message);
      dst.kill();
      settle();
    });
    dst.on("error", (e) => {
      dstCode = 255;
      dstErr = String(e.message);
      src.kill();
      settle();
    });
    src.on("close", (code) => {
      srcCode = code ?? 255;
      // A source that failed before writing: the load would wait on stdin forever.
      if (srcCode !== 0) dst.stdin.end();
      settle();
    });
    dst.on("close", (code) => {
      dstCode = code ?? 255;
      if (dstCode !== 0) src.kill();
      settle();
    });
  });
}

const fmtMs = (ms: number): string => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`);

/**
 * Run the whole preparation now and resolve with the report. Refused (the previous report) while
 * one runs for this host. A failure stops at the step that failed; the report says which.
 */
export async function prepareHost(primary: Config, host: Config, spec: HostSpec, deps: PrepareDeps = {}): Promise<PrepareReport> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.error(m));
  const prev = jobs.get(spec.id);
  if (prev?.running) return prev;
  const report: PrepareReport = { running: true, steps: [], startedAt: now() };
  jobs.set(spec.id, report);
  const say = (m: string) => {
    report.steps.push(m);
    log(`[hosts] prepare ${spec.id}: ${m}`);
  };
  try {
    const adapter = providerFor(spec);
    if (adapter.prepare) {
      const r = await adapter.prepare(spec, prepareIO(host));
      if (!r.ok) throw new Error(r.detail);
      say(r.detail);
    } else say("nothing to install for this kind of host");
    const hasImage = deps.hasImage ?? hasImageOverSsh;
    const streamImage = deps.streamImage ?? streamImageOverSsh;
    for (const ref of imagesWanted(primary, host)) {
      if (await hasImage(host, ref)) {
        say(`${ref} is on the host already`);
        continue;
      }
      const t0 = now();
      await streamImage(primary, host, ref);
      say(`${ref} streamed from the primary in ${fmtMs(now() - t0)}`);
    }
    report.ok = true;
  } catch (e) {
    report.ok = false;
    report.error = String((e as Error).message ?? e).slice(0, 300);
    log(`[hosts] prepare ${spec.id} failed: ${report.error}`);
  } finally {
    report.running = false;
    report.endedAt = now();
    deps.done?.(report);
  }
  return report;
}

/** Start a preparation in the background; what is returned is the report as it stands (running). */
export function startPrepare(primary: Config, host: Config, spec: HostSpec, deps: PrepareDeps = {}): PrepareReport {
  const prev = jobs.get(spec.id);
  if (prev?.running) return prev;
  void prepareHost(primary, host, spec, deps).catch(() => undefined);
  return jobs.get(spec.id)!;
}

/** Test seam. */
export function resetPrepareForTest(): void {
  jobs.clear();
}
