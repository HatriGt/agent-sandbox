/**
 * Minimal promisified command runner. Uses argv arrays (no shell) to avoid injection
 * from task text, repo paths, or box names.
 */
import { spawn } from "node:child_process";
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

/** POSIX single-quote a string so it survives one round of remote shell parsing (ssh). */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {}
): Promise<RunResult> {
  const { cwd, env, check = true, input, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
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

    let stdout = "";
    let stderr = "";
    // setEncoding makes Node buffer partial multi-byte sequences across chunk boundaries; a raw
    // per-chunk toString() turns a UTF-8 character split across two `data` events (e.g. a ⟦you⟧
    // sentinel landing on a 64 KB pipe boundary) into U+FFFD, corrupting the parsed trace.
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));

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
            child.kill("SIGKILL");
            reject(new Error(redactShapes(`Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(" ")}`)));
          }, timeoutMs)
        : null;
    const done = () => {
      if (timer) clearTimeout(timer);
      const first = !settled;
      settled = true;
      return first;
    };

    child.on("error", (err) => void (done() && reject(err)));
    child.on("close", (code) => {
      if (!done()) return; // already rejected by the timeout
      const result: RunResult = { code: code ?? -1, stdout, stderr };
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
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: [opts.stdinFile ? "pipe" : "ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    let bytes = 0;
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (d) => (stderr += d));
    let outDone: Promise<void> = Promise.resolve();
    if (opts.stdoutFile && child.stdout) {
      const out = createWriteStream(opts.stdoutFile);
      child.stdout.on("data", (d: Buffer) => (bytes += d.length));
      child.stdout.pipe(out);
      outDone = new Promise((r) => out.on("close", () => r()));
      out.on("error", (e) => reject(e));
    } else if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d: string) => {
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
      child.kill("SIGKILL");
      reject(new Error(redactShapes(`Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(" ")}`)));
    }, timeoutMs) : null;
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      if (!settled) (settled = true), reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (settled) return;
      settled = true;
      void outDone.then(() => resolve({ code: code ?? -1, stderr, stdout, bytes }));
    });
  });
}
