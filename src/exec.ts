/**
 * Minimal promisified command runner. Uses argv arrays (no shell) to avoid injection
 * from task text, repo paths, or box names.
 */
import { spawn, execFile } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { unlink, stat } from "node:fs";
import { redactShapes } from "./redact.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  /** Extra env merged over process.env for the child. */
  env?: Record<string, string>;
  /** Reject the promise on non-zero exit. Default true. */
  check?: boolean;
  /** Data written to the child's stdin (then closed). Use for payloads too big for argv. */
  input?: string;
  /**
   * Kill the child and reject after this many ms. Default DEFAULT_TIMEOUT_MS; pass 0 to wait
   * forever (only for commands with no bounded runtime, e.g. a streaming exec).
   *
   * Not optional in practice: an `msb exec` into a box that is mid-shutdown parks in poll() and
   * NEVER returns. Observed in production — one such call hung for 23 minutes, and because the
   * fleet reader memoises its in-flight sweep, every /fleet.json after it was handed the same
   * dead promise and the dashboard showed skeletons until the controller was restarted.
   */
  timeoutMs?: number;
}

/**
 * Ceiling for any command that doesn't set its own. Generous: a cold `msb run` boots a microVM and
 * copies a repo in, and `npm i -g` inside a box is minutes. The point is not to be tight, it is that
 * NOTHING waits forever — an unbounded wait turns one wedged sandbox into a dead control plane.
 */
export const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * The multiplexing socket an ssh (or rsync -e ssh) argv rides, or null when it rides none.
 * Exported for the test; the hook below is the only caller.
 */
export function sshControlPathOf(cmd: string, args: string[]): string | null {
  if (cmd !== "ssh" && cmd !== "rsync") return null;
  for (const a of args) {
    const m = /(?:^|\s)-o\s*ControlPath=(\S+)/.exec(a) ?? /^ControlPath=(\S+)$/.exec(a);
    if (m && m[1] !== "none") return m[1];
  }
  return null;
}

/**
 * A timed-out ssh takes its master down with it. A ControlMaster whose connection died underneath
 * (Freestyle's proxy after a VM pause and resume) keeps answering the control socket, so every
 * later command queues on the dead channel and times out in turn — seen live 2026-11-19: with one
 * such master, a fresh master and a plain ssh to the same host answered in 8 s while the shared
 * one hung until killed. Closing the socket here, at the one place every timeout passes, means the
 * NEXT command builds a fresh master instead of inheriting the hang. `-O exit` is asked politely
 * and the socket is unlinked regardless: a master that cannot even answer its control socket is
 * orphaned (it exits on its own once no client holds it) and the unlink is what frees the path.
 */
export function resetSshMasterOnTimeout(cmd: string, args: string[]): void {
  const sock = sshControlPathOf(cmd, args);
  if (!sock) return;
  // Busy is not dead. A provider's proxy runs sessions one after the other and a cold connection
  // costs 6-9 s, so a burst of parallel commands overruns its timeouts while the master is fine;
  // closing it then cuts every command still in flight, and the retries rebuild it cold, again in
  // a burst (seen live 2026-11-19 07:21: seven timeouts a second, the host unreachable for
  // minutes). A master that completed a command within the window stays; only one that nothing has
  // got through lately is the dead channel this exists for.
  const last = sockLastDone.get(sock);
  if (last !== undefined && Date.now() - last < MASTER_BUSY_WINDOW_MS) {
    console.warn(`[ssh] a command through ${sock} timed out, but another finished through it ${Math.round((Date.now() - last) / 1000)}s ago; the master stays (busy, not dead)`);
    return;
  }
  console.warn(`[ssh] a command through ${sock} timed out; closing that master so the next command builds a fresh one`);
  const c = execFile("ssh", ["-O", "exit", "-o", `ControlPath=${sock}`, "asb-master"], { timeout: 3_000 }, () => {
    unlink(sock, () => {});
  });
  c.on("error", () => unlink(sock, () => {}));
  noteSshFailure(sock, "timeout");
}

/** When a command last completed (any exit but 255) through each control socket. */
const sockLastDone = new Map<string, number>();
export const MASTER_BUSY_WINDOW_MS = 30_000;
export function noteSshDone(cmd: string, args: string[], code: number): void {
  if (code === 255) return;
  const sock = sshControlPathOf(cmd, args);
  if (sock) sockLastDone.set(sock, Date.now());
}
/** Tests. */
export function forgetSshDoneForTest(): void {
  sockLastDone.clear();
}

/**
 * A connection-level ssh failure: the command timed out, or ssh itself exited 255 (its own exit
 * code, never a remote command's). Whoever owns a route through that control socket hears of it:
 * the direct route to a proxied VM (src/ssh-tunnel.ts) drops itself on the first such failure,
 * because its forward can be dead underneath while its process lives on, and nothing else would
 * ever notice. Registered by the owner at load; exec.ts stays free of ssh imports.
 */
export type SshFailure = "timeout" | "exit255";
export const sshFailureHooks = new Set<(sock: string, why: SshFailure) => void>();
export function noteSshFailure(sock: string, why: SshFailure): void {
  for (const hook of sshFailureHooks) {
    try {
      hook(sock, why);
    } catch {
      /* a hook must never fail a command */
    }
  }
}
/**
 * The socket a command found "already exists" is unlinked only when its master is really gone.
 *
 * The same message comes from a benign race: a burst of parallel commands to a host with no socket
 * yet (the sweep's listing, the keep and claim markers, the titles) all start as masters, the first
 * binds the path and the rest find it there. Unlinking on the message alone took the LIVE socket
 * away after every such burst, so the next burst built another master, and every master, orphaned
 * to PID 1 (node, which reaps no grandchild), stayed a zombie: 521 of them in 25 minutes on the
 * primary host, 19 088 by 13:48 UTC on 2026-11-20, when the kernel refused the controller every
 * fork ("spawn ssh EAGAIN"; every automation fire failed for an hour). Now a socket younger than
 * SOCKET_RACE_WINDOW_MS is a race and stays, an older one is asked (`ssh -O check`) and goes only
 * when nothing answers. Pure verdict in `staleSocketVerdict` for the test.
 */
export const SOCKET_RACE_WINDOW_MS = 15_000;
export function staleSocketVerdict(o: { ageMs: number | undefined; masterAnswers: boolean | undefined }): "keep-race" | "keep-alive" | "unlink" {
  if (o.ageMs !== undefined && o.ageMs < SOCKET_RACE_WINDOW_MS) return "keep-race";
  if (o.masterAnswers) return "keep-alive";
  return "unlink";
}
async function unlinkIfStaleSocket(sock: string): Promise<void> {
  const ageMs = await new Promise<number | undefined>((res) => stat(sock, (err, st) => res(err ? undefined : Date.now() - st.mtimeMs)));
  if (ageMs === undefined) return; // already gone
  if (staleSocketVerdict({ ageMs, masterAnswers: undefined }) === "keep-race") return;
  const masterAnswers = await new Promise<boolean>((res) => {
    const c = execFile("ssh", ["-O", "check", "-o", `ControlPath=${sock}`, "asb-master"], { timeout: 3_000 }, (err) => res(!err));
    c.on("error", () => res(false));
  });
  if (staleSocketVerdict({ ageMs, masterAnswers }) !== "unlink") return;
  console.warn(`[ssh] the master behind ${sock} is gone; unlinking the stale socket`);
  unlink(sock, () => {});
}

/** The exit-255 case of `noteSshFailure`, from an argv. */
export function noteSshExit(cmd: string, args: string[], code: number, stderr = ""): void {
  // ssh found the control socket, nobody answered on it, and it could not become the master
  // because the file is there: the master is gone and the file is stale. Without this every
  // command through that path paid a cold connection until something unlinked it.
  if (/ControlSocket \S+ already exists, disabling multiplexing/.test(stderr)) {
    const sock = sshControlPathOf(cmd, args);
    if (sock) void unlinkIfStaleSocket(sock);
  }
  if (code !== 255) return;
  const sock = sshControlPathOf(cmd, args);
  if (sock) noteSshFailure(sock, "exit255");
}

/**
 * One ssh channel opened at a time per host behind a provider's SSH proxy.
 *
 * Measured from the controller on 2026-11-19 against Freestyle's proxy (both accounts): one
 * command alone takes 0.45 s through the direct route and about 3 s through a proxy channel; a
 * long channel beside them (idle or streaming) changes nothing; but two commands STARTED together
 * take 60 s, four take 34 s, and four through the proxy's own channels take 13 s. The relay stalls
 * on channel openings that interleave. A sweep started six commands at once with 15 s timeouts, so
 * all of them timed out, the host was marked unreachable, host-sleep paused it, and a kept thread's
 * reply failed on a machine that answers one command in half a second.
 *
 * So a proxied host gets a lane of width one: a command waits its turn to start, and gives the
 * lane back as soon as its channel is clearly open (its first byte of output, its end, or
 * SSH_LANE_HOLD_MS for a quiet one), so a running agent never blocks the sweep behind it. The wait
 * is not counted against the command's timeout, and a laned command gets at least
 * SSH_LANE_MIN_TIMEOUT_MS: a cold master through the proxy is 5-15 s by itself. The host pool
 * registers the lane per target tag (src/host-pool.ts); a static host has none and runs in parallel.
 */
export interface SshLane {
  width: number;
  busy: number;
  waiting: Array<() => void>;
}
const sshLanes = new Map<string, SshLane>();
export const SSH_LANE_HOLD_MS = 15_000;
export const SSH_LANE_MIN_TIMEOUT_MS = 45_000;

export function setSshLane(tag: string, width: number | undefined): void {
  if (!width) {
    sshLanes.delete(tag);
    return;
  }
  const lane = sshLanes.get(tag);
  if (lane) lane.width = width;
  else sshLanes.set(tag, { width, busy: 0, waiting: [] });
}

/** The target tag of a control socket (`<tag>.sock` is the proxy's, `<tag>d.sock` the direct route's: one lane). */
export function sshLaneTagOf(sock: string): string | null {
  const m = /([0-9a-f]{8})d?\.sock$/.exec(sock);
  return m ? m[1] : null;
}

/** The lane an argv rides, or null: not ssh, no socket, or a host with no lane. */
export function sshLaneOf(cmd: string, args: string[]): SshLane | null {
  const sock = sshControlPathOf(cmd, args);
  const tag = sock ? sshLaneTagOf(sock) : null;
  return (tag && sshLanes.get(tag)) || null;
}

/**
 * Commands run inside `sshLaneFront` take the front of the queue: the readiness probe after a wake
 * and the direct route's dial. Seen live after the lane shipped (2026-11-19 08:02): one command at
 * a time, none timing out, and the host still "unreachable", because the probe queued behind two
 * sweeps' worth of 3 s proxy commands and its 45 s cap ran out. The probe first makes the host
 * answer; the dial first makes every command after it 0.45 s instead of 3 s.
 */
const laneContext = new AsyncLocalStorage<{ front: boolean }>();
export function sshLaneFront<T>(fn: () => Promise<T>): Promise<T> {
  return laneContext.run({ front: true }, fn);
}

/**
 * Wait for a turn on the lane. The function returned gives it back; once, however often it is
 * called. A command that waits longer than `waitMs` is refused without ever reaching the host: a
 * sweep whose cap ran out must not leave its commands in the queue to run for nobody.
 */
export function takeSshLane(lane: SshLane, o: { front?: boolean; waitMs?: number } = {}): Promise<() => void> {
  let given = false;
  const giveBack = () => {
    if (given) return;
    given = true;
    lane.busy--;
    lane.waiting.shift()?.();
  };
  if (lane.busy < lane.width) {
    lane.busy++;
    return Promise.resolve(giveBack);
  }
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const turn = () => {
      if (timer) clearTimeout(timer);
      lane.busy++;
      res(giveBack);
    };
    const timer =
      o.waitMs && o.waitMs > 0
        ? setTimeout(() => {
            const i = lane.waiting.indexOf(turn);
            if (i >= 0) lane.waiting.splice(i, 1);
            rej(new Error(`waited ${Math.round((Date.now() - t0) / 1000)}s for a turn on the host's ssh lane (${lane.waiting.length} still queued); not sent`));
          }, o.waitMs)
        : null;
    timer?.unref?.();
    if (o.front) lane.waiting.unshift(turn);
    else lane.waiting.push(turn);
  });
}

/** A laned command's timeout: its own, but never under SSH_LANE_MIN_TIMEOUT_MS (0 stays "forever"). */
export function sshLaneTimeoutMs(lane: SshLane | null, ms: number): number {
  return lane && ms > 0 && ms < SSH_LANE_MIN_TIMEOUT_MS ? SSH_LANE_MIN_TIMEOUT_MS : ms;
}

/** POSIX single-quote a string so it survives one round of remote shell parsing (ssh). */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {}
): Promise<RunResult> {
  const { cwd, env, check = true, input } = opts;
  const lane = sshLaneOf(cmd, args);
  const timeoutMs = sshLaneTimeoutMs(lane, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const giveBack = lane ? await takeSshLane(lane, { front: laneContext.getStore()?.front, waitMs: timeoutMs }) : () => {};
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (input !== undefined && child.stdin) {
      child.stdin.on("error", () => {}); // EPIPE if the remote exits early — the close handler reports it
      child.stdin.end(input);
    }
    // The lane is the host's again once the channel is clearly open: first output, end, or the hold.
    const hold = lane ? setTimeout(giveBack, SSH_LANE_HOLD_MS) : null;
    hold?.unref?.();
    const freeLane = () => {
      if (hold) clearTimeout(hold);
      giveBack();
    };

    let stdout = "";
    let stderr = "";
    // setEncoding makes Node buffer partial multi-byte sequences across chunk boundaries; a raw
    // per-chunk toString() turns a UTF-8 character split across two `data` events (e.g. a ⟦you⟧
    // sentinel landing on a 64 KB pipe boundary) into U+FFFD, corrupting the parsed trace.
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => {
      freeLane();
      stdout += d;
    });
    child.stderr?.on("data", (d) => {
      freeLane();
      stderr += d;
    });

    // SIGKILL, not SIGTERM: a wedged ssh sitting in poll() is exactly the case this exists for, and
    // it may not act on a polite signal.
    //
    // The timer REJECTS rather than only killing and waiting for "close". "close" fires when the
    // child's stdio closes, not when the child dies, so a grandchild holding the inherited pipes
    // (the remote command behind ssh does exactly this) keeps the promise pending — which is the
    // hang this whole mechanism exists to prevent. Kill for hygiene, settle regardless.
    let settled = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            settled = true;
            freeLane();
            child.kill("SIGKILL");
            resetSshMasterOnTimeout(cmd, args);
            reject(new Error(redactShapes(`Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(" ")}`)));
          }, timeoutMs)
        : null;
    const done = () => {
      if (timer) clearTimeout(timer);
      freeLane();
      const first = !settled;
      settled = true;
      return first;
    };

    child.on("error", (err) => void (done() && reject(err)));
    child.on("close", (code) => {
      if (!done()) return; // already rejected by the timeout
      const result: RunResult = { code: code ?? -1, stdout, stderr };
      noteSshExit(cmd, args, result.code, stderr);
      noteSshDone(cmd, args, result.code);
      if (check && result.code !== 0) {
        // The argv is redacted, not omitted (it's what makes ssh failures debuggable) — but it can
        // carry a token-embedded clone URL, and this message flows back to MCP callers verbatim:
        // a failed `git clone --branch <bad-ref> https://x-access-token:ghp_…@github.com/…` was
        // observed returning the live GitHub token to the calling agent.
        // Include a stdout tail too: remote commands often collapse their real message into stdout
        // (`… 2>&1` inside the box), and an error whose only content is the ssh argv gets masked as
        // plumbing — hiding, e.g., gh's "no pull request found" from the operator.
        const tail = stdout.trim().slice(-600);
        reject(
          new Error(
            redactShapes(`Command failed (${result.code}): ${cmd} ${args.join(" ")}\n${stderr.trim()}${tail ? `\n${tail}` : ""}`)
          )
        );
        return;
      }
      resolve(result);
    });
  });
}

export interface StreamOptions {
  /** The child's stdout is written here, byte for byte (tmp + rename is the caller's business). */
  stdoutFile?: string;
  /** The child's stdin is fed from this file. */
  stdinFile?: string;
  timeoutMs?: number;
}

export interface StreamResult {
  code: number;
  stderr: string;
  /** The child's stdout when no `stdoutFile` was given (capped at 64 KB), else "". */
  stdout: string;
  /** Bytes written to `stdoutFile` (0 when none was given). */
  bytes: number;
}

/**
 * Like `run`, for payloads that must not pass through a JS string: a tarball coming out of a box
 * or going into one. stdout streams to a file and stdin streams from a file, so a 300 MB copy costs
 * no heap. Never throws on a non-zero exit (the caller reads the code and the stderr tail); a
 * timeout rejects, as in `run`.
 */
export async function runStream(cmd: string, args: string[], opts: StreamOptions = {}): Promise<StreamResult> {
  const { createReadStream, createWriteStream } = await import("node:fs");
  const lane = sshLaneOf(cmd, args);
  const timeoutMs = sshLaneTimeoutMs(lane, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const giveBack = lane ? await takeSshLane(lane, { front: laneContext.getStore()?.front, waitMs: timeoutMs }) : () => {};
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: [opts.stdinFile ? "pipe" : "ignore", "pipe", "pipe"] });
    const hold = lane ? setTimeout(giveBack, SSH_LANE_HOLD_MS) : null;
    hold?.unref?.();
    const freeLane = () => {
      if (hold) clearTimeout(hold);
      giveBack();
    };
    let stderr = "";
    let stdout = "";
    let bytes = 0;
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (d) => {
      freeLane();
      stderr += d;
    });
    let outDone: Promise<void> = Promise.resolve();
    if (opts.stdoutFile && child.stdout) {
      const out = createWriteStream(opts.stdoutFile);
      child.stdout.on("data", (d: Buffer) => {
        freeLane();
        bytes += d.length;
      });
      child.stdout.pipe(out);
      outDone = new Promise((r) => out.on("close", () => r()));
      out.on("error", (e) => reject(e));
    } else if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d: string) => {
        freeLane();
        if (stdout.length < 65_536) stdout += d;
      });
    }
    if (opts.stdinFile && child.stdin) {
      child.stdin.on("error", () => {});
      createReadStream(opts.stdinFile).on("error", (e) => reject(e)).pipe(child.stdin);
    }
    let settled = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      settled = true;
      freeLane();
      child.kill("SIGKILL");
      resetSshMasterOnTimeout(cmd, args);
      reject(new Error(redactShapes(`Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(" ")}`)));
    }, timeoutMs) : null;
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      freeLane();
      if (!settled) (settled = true), reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      freeLane();
      if (settled) return;
      settled = true;
      noteSshExit(cmd, args, code ?? -1, stderr);
      noteSshDone(cmd, args, code ?? -1);
      void outDone.then(() => resolve({ code: code ?? -1, stderr, stdout, bytes }));
    });
  });
}
