/**
 * Durable "last known run" per box, on the VPS host.
 *
 * A sleeping (stopped) box cannot be asked what it was doing — exec would boot it — so the fleet view
 * shows it from memory: task, question, run state, role. That memory used to live only in the
 * controller process, so every deploy or restart made every sleeping run disappear from the dashboard
 * (the boxes were still there, held by the reaper, but invisible). Now each box's metadata is written
 * to `~/.agent-sandbox/runs/<box>.json` whenever it changes while the box is running, and loaded on
 * demand for stopped boxes. Small files, owner-only, removed with the box.
 *
 * A second copy lives on the controller's own data volume (`<dataDir>/runs/<box>.json`): a host
 * that is asleep or unreachable when the controller starts cannot hand over its memory, and a
 * sleeping thread on it would be invisible (and, before 2026-11-18, forgotten) until the host
 * answered. The local copy is read first; the host's answer, when it comes, wins per box.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import type { BoxView } from "./monitor.js";
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";
import { assertBoxName } from "./sync.js";

const DIR = '"$HOME/.agent-sandbox/runs"';

async function ssh(cfg: Config, cmd: string): Promise<string> {
  // Bounded — a convenience layer must never be able to hang the fleet read (see claims.ts).
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, cmd], { check: false, timeoutMs: 15_000 });
  return r.stdout ?? "";
}

/** The subset worth remembering: what the UI needs to describe a sleeping run, and which host it is on. */
export type RunMeta = Pick<BoxView, "name" | "host" | "role" | "runState" | "exitCode" | "task" | "question" | "repos" | "uptime">;

export function metaOf(b: BoxView): RunMeta {
  return { name: b.name, host: b.host, role: b.role, runState: b.runState, exitCode: b.exitCode, task: b.task, question: b.question, repos: b.repos, uptime: b.uptime };
}

// --- The controller-side mirror ---------------------------------------------------------------
function localDir(cfg: Pick<Config, "dataDir">): string {
  return path.join(cfg.dataDir, "runs");
}

export async function saveRunMetaLocal(cfg: Pick<Config, "dataDir">, meta: RunMeta): Promise<void> {
  assertBoxName(meta.name);
  const dir = localDir(cfg);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${meta.name}.json`);
  await fs.writeFile(`${file}.tmp`, JSON.stringify(meta));
  await fs.rename(`${file}.tmp`, file);
}

export async function forgetRunMetaLocal(cfg: Pick<Config, "dataDir">, box: string): Promise<void> {
  assertBoxName(box);
  await fs.rm(path.join(localDir(cfg), `${box}.json`), { force: true });
}

export async function loadRunMetasLocal(cfg: Pick<Config, "dataDir">): Promise<Map<string, RunMeta>> {
  const names = await fs.readdir(localDir(cfg)).catch(() => [] as string[]);
  const lines: string[] = [];
  for (const f of names) {
    if (!f.endsWith(".json")) continue;
    lines.push(await fs.readFile(path.join(localDir(cfg), f), "utf8").catch(() => ""));
  }
  return parseRunMetas(lines.join("\n"));
}

export async function saveRunMeta(cfg: Config, meta: RunMeta): Promise<void> {
  const json = JSON.stringify(meta);
  await ssh(cfg, `mkdir -p ${DIR} && chmod 700 ${DIR} && printf '%s' ${shellQuote(json)} > ${DIR}/${shellQuote(meta.name)}.json`);
}

export async function forgetRunMeta(cfg: Config, box: string): Promise<void> {
  await ssh(cfg, `rm -f ${DIR}/${shellQuote(box)}.json`);
}

/**
 * Forget many at once: one command per batch, not one SSH per box. Seventy boxes gone from a host
 * used to be seventy parallel SSHs through its proxy, which serialises them; most timed out, the
 * files stayed, and every restart did it again (2026-11-19).
 */
export async function forgetRunMetas(cfg: Config, boxes: readonly string[]): Promise<void> {
  for (const b of boxes) assertBoxName(b);
  for (let i = 0; i < boxes.length; i += 100) {
    const names = boxes.slice(i, i + 100).map((b) => `${shellQuote(b)}.json`);
    await ssh(cfg, `cd ${DIR} 2>/dev/null && rm -f ${names.join(" ")} || true`);
  }
}

/**
 * Every remembered run on the host, keyed by box name. Tolerates a missing dir and malformed files;
 * throws when the host did not answer, so the caller can tell "nothing remembered" from "not read"
 * and try again later instead of treating silence as an empty memory.
 */
export async function loadRunMetas(cfg: Config): Promise<Map<string, RunMeta>> {
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `[ -d ${DIR} ] && cd ${DIR} && for f in *.json; do [ -f "$f" ] && cat "$f" && echo; done || true`], { check: false, timeoutMs: 15_000 });
  if (r.code !== 0) throw new Error(`run memory of ${cfg.hostId ?? cfg.vpsSsh} could not be read (ssh exit ${r.code}): ${(r.stderr ?? "").trim().slice(-160)}`);
  return parseRunMetas(r.stdout ?? "");
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
