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
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
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
