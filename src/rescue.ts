/**
 * Rescue copies: a thread's context, kept OFF its box.
 *
 * Every turn end already captures an in-box checkpoint tar (src/checkpoint.ts: /workspace and the
 * agent's home, heavy dirs excluded). That tar dies with the box — and boxes do die: a host that
 * resumed badly, a reaper that misjudged a probe, a microVM that crashed, an operator's `msb rm`.
 * On 2026-11-18 one such reap destroyed a day-long thread with three PRs in it, and nothing could
 * bring it back. So the newest checkpoint is now pulled to the controller's data volume as soon as
 * it is written (`<dataDir>/rescue/<box>/t<n>.tar.gz` + meta.json), one per box, and a thread
 * whose box is gone can be brought back onto a fresh box under the SAME name: workspace, session
 * memory and the visible transcript all return, and the next message resumes the same agent
 * session (`claude -c`). What the copy never carries: installed dependencies (node_modules and the
 * like, re-installable) and anything the agent wrote outside /workspace and ~/.claude.
 *
 * Budget: one copy per box, the newest only; a tar over RESCUE_MAX_MB (default 512) is skipped
 * and the thread is marked "too big to copy"; copies older than RESCUE_TTL_DAYS (default 14) are
 * swept. Pulls are best-effort and never on a user-facing path: a failed pull logs and the next
 * turn tries again.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import { runStream, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";
import { CKPT_DIR } from "./checkpoint.js";
import { assertBoxName } from "./sync.js";

export const RESCUE_MAX_MB = Math.max(1, Number(process.env.RESCUE_MAX_MB) || 512);
/** A KEPT thread's copy may be much bigger: the user said this one must not be lost. */
export const RESCUE_KEPT_MAX_MB = Math.max(RESCUE_MAX_MB, Number(process.env.RESCUE_KEPT_MAX_MB) || 4096);
export const RESCUE_TTL_DAYS = Math.max(1, Number(process.env.RESCUE_TTL_DAYS) || 14);
/** A pull or a push of a few hundred MB through a proxied SSH route needs minutes, not seconds. */
const TRANSFER_TIMEOUT_MS = 15 * 60_000;
/** Where the copy lands in the box before it is applied (the host's `msb copy` puts it there). */
export const RESTORE_FILE = "/root/rescue-restore.tar.gz";

export interface RescueMeta {
  v: 1;
  box: string;
  owner: string | null;
  /** The turn the copy was taken after (checkpoint t<n>). */
  turn: number;
  /** When the copy landed on the controller (epoch ms). */
  at: number;
  /** Which host the box lived on when the copy was taken. */
  hostId?: string;
  agent?: string;
  task?: string;
  title?: string;
  /** The box was kept (pinned) when the copy was taken: the copy is never swept by age. */
  kept?: boolean;
  /** Compressed bytes on the controller. */
  bytes: number;
  tar: string;
  /** Set instead of a copy when the checkpoint exceeded RESCUE_MAX_MB (uncompressed bytes). */
  tooBig?: number;
}

/** What a client sees: enough to offer "bring it back" and say what it brings. */
export interface RescueSummary {
  box: string;
  turn: number;
  at: number;
  bytes: number;
  agent?: string;
  task?: string;
  title?: string;
  tooBig?: number;
}

export function rescueRoot(cfg: Pick<Config, "dataDir">): string {
  return path.join(cfg.dataDir, "rescue");
}

export function rescueDirOf(cfg: Pick<Config, "dataDir">, box: string): string {
  assertBoxName(box);
  return path.join(rescueRoot(cfg), box);
}

/** The capture result's turn: `CKPT_OK t7` / `CKPT_HAVE t7` → 7; anything else → undefined. Pure. */
export function capturedTurn(stdout: string): { turn: number; fresh: boolean } | undefined {
  const m = stdout.match(/CKPT_(OK|HAVE) t(\d+)\s*$/m);
  return m ? { turn: Number(m[2]), fresh: m[1] === "OK" } : undefined;
}

export async function readRescue(cfg: Pick<Config, "dataDir">, box: string): Promise<RescueMeta | null> {
  try {
    const raw = await fs.readFile(path.join(rescueDirOf(cfg, box), "meta.json"), "utf8");
    const m = JSON.parse(raw) as RescueMeta;
    if (m?.v !== 1 || m.box !== box) return null;
    if (!m.tooBig && !(await fs.stat(path.join(rescueDirOf(cfg, box), m.tar)).catch(() => null))) return null;
    return m;
  } catch {
    return null;
  }
}

export function summarize(m: RescueMeta): RescueSummary {
  return { box: m.box, turn: m.turn, at: m.at, bytes: m.bytes, agent: m.agent, task: m.task, title: m.title, ...(m.tooBig ? { tooBig: m.tooBig } : {}), ...(m.kept ? { kept: true } : {}) };
}

/** The in-box size probe for checkpoint t<n>: prints the byte size, or MISSING. */
export function sizeProbeSh(turn: number): string {
  return `f=${shellQuote(`${CKPT_DIR}/t${turn}.tar`)}; if [ -f "$f" ]; then stat -c %s "$f"; else echo MISSING; fi`;
}

/** The in-box stream: checkpoint t<n>, gzipped, on stdout. */
export function pullSh(turn: number): string {
  return `gzip -1 -c ${shellQuote(`${CKPT_DIR}/t${turn}.tar`)}`;
}

/**
 * The host-side upload: the gzipped tar arrives on stdin, is staged under the host's own
 * ~/.agent-sandbox and moved into the box by `msb copy`. The copy used to travel on the stdin of
 * `msb exec` straight into `tar`; that path carries a few MB and then parks forever (measured
 * 2026-11-18 on msb 0.6.9: 1 and 4 MB in a second, 16 MB never), and the box had already been
 * wiped. `msb copy` moves the same 16 MB in six seconds. Prints UPLOADED on success.
 */
export function uploadSh(msb: string, box: string): string {
  assertBoxName(box);
  const stage = `"$HOME/.agent-sandbox/rescue-in/${box}.tar.gz"`;
  return (
    `set -e; mkdir -p "$HOME/.agent-sandbox/rescue-in"; trap 'rm -f ${stage}' EXIT; ` +
    `cat > ${stage}; ` +
    `${shellQuote(msb)} copy -q ${stage} ${shellQuote(`${box}:${RESTORE_FILE}`)}; ` +
    `echo UPLOADED`
  );
}

/**
 * The in-box restore of the uploaded file: check the archive is whole BEFORE anything is wiped,
 * wipe what a fresh box has at those paths, untar at /, mark the box claimed (a run, for every
 * reaper), and say in the transcript what happened so the agent and the reader both know the
 * dependencies are not there. Prints RESTORED on success.
 */
export function restoreSh(turn: number, lostAt: number, file: string = RESTORE_FILE, seamText?: string): string {
  const when = new Date(lostAt).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const seam =
    seamText ??
    `● brought back from a copy taken after turn ${turn} — the machine was lost around ${when}; ` +
      `installed dependencies (node_modules and the like) are not in the copy, run the package manager's install if builds act oddly`;
  const f = shellQuote(file);
  return (
    `set -e; gzip -t ${f}; ` +
    `rm -rf /workspace /root/.claude; mkdir -p /workspace; ` +
    `gzip -dc ${f} | tar -xf - -C /; rm -f ${f}; ` +
    `touch /.claimed; ` +
    `printf '\\n%s\\n' ${shellQuote(seam)} >> /workspace/.agent.log; ` +
    `echo RESTORED t${turn}`
  );
}

/** The ssh argv that runs `sh` inside `box` on the host `cfg` is bound to, with stdio passed through. */
function sshExecArgv(cfg: Config, box: string, sh: string): string[] {
  const remoteCmd = [cfg.msb, "exec", box, "--", "sh", "-lc", sh].map(shellQuote).join(" ");
  return [...sshMuxOpts(cfg), cfg.vpsSsh, remoteCmd];
}

export interface RescueIO {
  /** A text command in the box (the size probe; the restore, which may take minutes). */
  exec: (cfg: Config, box: string, sh: string, timeoutMs?: number) => Promise<{ stdout: string }>;
  /** Stream a box command's stdout to a file. */
  pull: (cfg: Config, box: string, sh: string, file: string) => Promise<{ code: number; stderr: string; bytes: number }>;
  /** Feed a file to the host-side upload command's stdin (uploadSh), returning its stdout. */
  upload: (cfg: Config, box: string, file: string) => Promise<{ code: number; stderr: string; stdout: string }>;
}

export const realRescueIO: RescueIO = {
  exec: async (cfg, box, sh, timeoutMs = 60_000) => {
    const r = await runStream("ssh", sshExecArgv(cfg, box, sh), { timeoutMs });
    if (r.code !== 0) throw new Error(`exec in ${box} failed (${r.code}): ${r.stderr.trim().slice(-300)}`);
    return { stdout: r.stdout };
  },
  pull: (cfg, box, sh, file) => runStream("ssh", sshExecArgv(cfg, box, sh), { stdoutFile: file, timeoutMs: TRANSFER_TIMEOUT_MS }),
  upload: (cfg, box, file) => runStream("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, uploadSh(cfg.msb, box)], { stdinFile: file, timeoutMs: TRANSFER_TIMEOUT_MS }),
};

const inFlight = new Map<string, Promise<RescueMeta | null>>();

/**
 * Pull checkpoint t<turn> of `box` to the controller, replacing the box's older copy. Idempotent
 * per (box, turn): a copy of that turn already here is kept as is. One pull per box at a time.
 */
export function pullRescue(cfg: Config, box: string, turn: number, meta: Partial<Pick<RescueMeta, "owner" | "hostId" | "agent" | "task" | "title" | "kept">>, io: RescueIO = realRescueIO): Promise<RescueMeta | null> {
  const key = box;
  const running = inFlight.get(key);
  if (running) return running;
  const flight = (async (): Promise<RescueMeta | null> => {
    const dir = rescueDirOf(cfg, box);
    const have = await readRescue(cfg, box);
    if (have && have.turn === turn && !have.tooBig) {
      // The copy is current; a keep that arrived since is stamped on it so the sweep spares it.
      if (meta.kept && !have.kept) {
        const m: RescueMeta = { ...have, kept: true };
        await writeMeta(dir, m);
        return m;
      }
      return have;
    }
    const probe = await io.exec(cfg, box, sizeProbeSh(turn));
    const size = Number(probe.stdout.trim().split("\n").pop());
    if (!Number.isFinite(size)) {
      console.error(`[rescue] ${box}: checkpoint t${turn} is not in the box (${probe.stdout.trim().slice(-80) || "no answer"})`);
      return have;
    }
    await fs.mkdir(dir, { recursive: true });
    const base: RescueMeta = { v: 1, box, owner: meta.owner ?? null, turn, at: Date.now(), hostId: meta.hostId, agent: meta.agent, task: meta.task?.slice(0, 500), title: meta.title, ...(meta.kept ? { kept: true } : {}), bytes: 0, tar: `t${turn}.tar.gz` };
    const capMb = meta.kept ? RESCUE_KEPT_MAX_MB : RESCUE_MAX_MB;
    if (size > capMb * 1024 * 1024) {
      // Too big to keep: say so in the meta (the thread shows it), keep an older copy if one exists.
      const m: RescueMeta = { ...base, tooBig: size, bytes: have?.bytes ?? 0, tar: have?.tar ?? base.tar, turn: have?.turn ?? turn };
      await writeMeta(dir, m);
      console.error(`[rescue] ${box}: checkpoint t${turn} is ${Math.round(size / 1048576)} MB, over ${meta.kept ? "RESCUE_KEPT_MAX_MB" : "RESCUE_MAX_MB"}=${capMb}; not copied${meta.kept ? " — THIS THREAD IS KEPT and has no fresh copy off its box" : ""}`);
      return m;
    }
    const file = path.join(dir, base.tar);
    const tmp = `${file}.tmp`;
    const t0 = Date.now();
    const r = await io.pull(cfg, box, pullSh(turn), tmp);
    if (r.code !== 0 || r.bytes === 0) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      console.error(`[rescue] ${box}: pull of t${turn} failed (${r.code}): ${r.stderr.trim().slice(-200)}`);
      return have;
    }
    await fs.rename(tmp, file);
    const m: RescueMeta = { ...base, bytes: r.bytes };
    await writeMeta(dir, m);
    // The older copy goes once the new one is published.
    for (const f of await fs.readdir(dir)) if (f !== m.tar && f !== "meta.json") await fs.rm(path.join(dir, f), { force: true }).catch(() => {});
    console.error(`[rescue] ${box}: kept a copy of turn ${turn} (${Math.round(r.bytes / 1024)} KB gz of ${Math.round(size / 1024)} KB, ${Date.now() - t0} ms)`);
    return m;
  })().catch((e) => {
    console.error(`[rescue] ${box}: ${(e as Error).message.slice(0, 200)}`);
    return null;
  });
  const tracked = flight.finally(() => {
    if (inFlight.get(key) === tracked) inFlight.delete(key);
  });
  inFlight.set(key, tracked);
  return tracked;
}

async function writeMeta(dir: string, m: RescueMeta): Promise<void> {
  const tmp = path.join(dir, "meta.json.tmp");
  await fs.writeFile(tmp, JSON.stringify(m));
  await fs.rename(tmp, path.join(dir, "meta.json"));
}

/**
 * Put the copy into a box that already exists under the box's name on the host `cfg` is bound to:
 * upload first (nothing in the box is touched), then apply. Throws when the copy is missing, the
 * upload did not land, or the box did not confirm — and in every case the box still holds whatever
 * it held before.
 */
export async function pushRescue(cfg: Config, box: string, m: RescueMeta, lostAt: number, io: RescueIO = realRescueIO, seam?: string): Promise<void> {
  if (m.tooBig && !m.bytes) throw new Error("the last checkpoint was too big to copy, so there is nothing to bring back");
  const file = path.join(rescueDirOf(cfg, box), m.tar);
  const up = await io.upload(cfg, box, file);
  if (up.code !== 0 || !/UPLOADED/.test(up.stdout)) throw new Error(`the copy did not reach the box (${up.code}): ${(up.stderr || up.stdout).trim().slice(-300)}`);
  const r = await io.exec(cfg, box, restoreSh(m.turn, lostAt, RESTORE_FILE, seam), TRANSFER_TIMEOUT_MS).catch((e) => ({ stdout: "", error: e as Error }));
  if (!/RESTORED t\d+/.test(r.stdout)) throw new Error(`the box did not confirm the restore: ${("error" in r ? r.error.message : r.stdout).trim().slice(-300)}`);
}

/** The seam a moved thread reads: the copy came from a machine that still worked, nothing was lost. */
export function moveSeam(turn: number, fromHost: string, toHost: string): string {
  return (
    `● moved from ${fromHost} to ${toHost} after turn ${turn}: workspace, session memory and this transcript came along; ` +
    `installed dependencies (node_modules and the like) did not, run the package manager's install if builds act oddly`
  );
}

export async function dropRescue(cfg: Pick<Config, "dataDir">, box: string): Promise<void> {
  await fs.rm(rescueDirOf(cfg, box), { recursive: true, force: true }).catch(() => {});
}

/** Remove copies older than the TTL. Returns how many went. */
export async function sweepRescues(cfg: Pick<Config, "dataDir">, now = Date.now(), ttlMs = RESCUE_TTL_DAYS * 86_400_000, isKept?: (box: string) => boolean): Promise<number> {
  let gone = 0;
  const root = rescueRoot(cfg);
  const names = await fs.readdir(root).catch(() => [] as string[]);
  for (const name of names) {
    const m = await readRescue(cfg, name).catch(() => null);
    // A kept thread's copy has no age: it is the user's word that this one must not be lost.
    if (m?.kept || isKept?.(name)) continue;
    const at = m?.at ?? (await fs.stat(path.join(root, name)).then((s) => s.mtimeMs).catch(() => 0));
    if (now - at > ttlMs) {
      await fs.rm(path.join(root, name), { recursive: true, force: true }).catch(() => {});
      gone++;
    }
  }
  return gone;
}

/** A keep that arrived after the copy was taken: stamp it on the meta so the sweep spares the copy. */
export async function stampRescueKept(cfg: Pick<Config, "dataDir">, box: string): Promise<boolean> {
  const m = await readRescue(cfg, box);
  if (!m || m.kept) return false;
  await writeMeta(rescueDirOf(cfg, box), { ...m, kept: true });
  return true;
}

/** The boxes a copy is kept for (a directory with a meta.json), for the fleet's away rows. */
export async function rescueBoxes(cfg: Pick<Config, "dataDir">): Promise<Set<string>> {
  const root = rescueRoot(cfg);
  const names = await fs.readdir(root).catch(() => [] as string[]);
  const out = new Set<string>();
  await Promise.all(
    names.map(async (name) => {
      if (await fs.stat(path.join(root, name, "meta.json")).catch(() => null)) out.add(name);
    })
  );
  return out;
}

/** The copies on disk, newest first (for the History decoration and the health view). */
export async function listRescues(cfg: Pick<Config, "dataDir">): Promise<RescueSummary[]> {
  const root = rescueRoot(cfg);
  const names = await fs.readdir(root).catch(() => [] as string[]);
  const out: RescueSummary[] = [];
  for (const name of names) {
    const m = await readRescue(cfg, name).catch(() => null);
    if (m) out.push(summarize(m));
  }
  return out.sort((a, b) => b.at - a.at);
}
