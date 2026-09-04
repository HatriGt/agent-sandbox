/**
 * Durable "last known run" per box, on the VPS host.
 *
 * A sleeping (stopped) box cannot be asked what it was doing — exec would boot it — so the fleet view
 * shows it from memory: task, question, run state, role. That memory used to live only in the
 * controller process, so every deploy or restart made every sleeping run disappear from the dashboard
 * (the boxes were still there, held by the reaper, but invisible). Now each box's metadata is written
 * to `~/.agent-sandbox/runs/<box>.json` whenever it changes while the box is running, and loaded on
 * demand for stopped boxes. Small files, owner-only, removed with the box.
 */
import type { Config } from "./config.js";
import type { BoxView } from "./monitor.js";
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";

const DIR = '"$HOME/.agent-sandbox/runs"';

async function ssh(cfg: Config, cmd: string): Promise<string> {
  // Bounded — a convenience layer must never be able to hang the fleet read (see claims.ts).
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, cmd], { check: false, timeoutMs: 15_000 });
  return r.stdout ?? "";
}

/** The subset worth remembering: what the UI needs to describe a sleeping run. */
export type RunMeta = Pick<BoxView, "name" | "role" | "runState" | "exitCode" | "task" | "question" | "repos" | "uptime">;

export function metaOf(b: BoxView): RunMeta {
  return { name: b.name, role: b.role, runState: b.runState, exitCode: b.exitCode, task: b.task, question: b.question, repos: b.repos, uptime: b.uptime };
}

export async function saveRunMeta(cfg: Config, meta: RunMeta): Promise<void> {
  const json = JSON.stringify(meta);
  await ssh(cfg, `mkdir -p ${DIR} && chmod 700 ${DIR} && printf '%s' ${shellQuote(json)} > ${DIR}/${shellQuote(meta.name)}.json`);
}

export async function forgetRunMeta(cfg: Config, box: string): Promise<void> {
  await ssh(cfg, `rm -f ${DIR}/${shellQuote(box)}.json`);
}

/** Every remembered run, keyed by box name. Tolerates a missing dir and malformed files. */
export async function loadRunMetas(cfg: Config): Promise<Map<string, RunMeta>> {
  const out = await ssh(cfg, `[ -d ${DIR} ] && cd ${DIR} && for f in *.json; do [ -f "$f" ] && cat "$f" && echo; done || true`);
  return parseRunMetas(out);
}

export function parseRunMetas(stdout: string): Map<string, RunMeta> {
  const m = new Map<string, RunMeta>();
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const meta = JSON.parse(t) as RunMeta;
      if (meta?.name) m.set(meta.name, meta);
    } catch {
      /* skip a torn write */
    }
  }
  return m;
}
