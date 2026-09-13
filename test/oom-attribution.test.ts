/**
 * Run-state sentinel: is an interrupted run reported as OOM (137) or a restart (254)?
 *
 * These run the REAL shell fragment, not a reimplementation — the bug they pin was in the shell
 * itself, so a TypeScript mock of it would have passed while production stayed broken. A live run
 * on a box that had OOM-killed something earlier was reported as `done exit=137` while `claude` was
 * still running: dmesg is per-BOOT, the run is not, and every later interruption inherited the old
 * kill. The fragment now only blames a kill that happened after the run started.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_STATE_SH } from "../src/msb.ts";

/** The kernel timestamp of the fake kill every fixture is written relative to. */
const KILL_AT = 2047.861194;
const DMESG = `[    0.000000] Linux version 6.1.0\n[ ${KILL_AT}] Out of memory: Killed process 422 (node-MainThread) total-vm:2398720kB\n`;

/**
 * Run the fragment against a scratch dir standing in for /workspace, with a stub `dmesg` on PATH
 * (the test host has no guest ring buffer). `marks` are the sentinel files to lay down first.
 */
function runState(marks: Record<string, string>, opts: { dmesg?: string; livePid?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "asb-oom-"));
  try {
    const bin = join(dir, "bin");
    execFileSync("mkdir", ["-p", bin]);
    writeFileSync(join(bin, "dmesg"), `#!/bin/sh\ncat <<'EOF'\n${opts.dmesg ?? DMESG}EOF\n`, { mode: 0o755 });
    for (const [name, body] of Object.entries(marks)) writeFileSync(join(dir, name), body);
    const ws = `${dir.replaceAll("\\", "/")}/`;
    // A live pid has to be one the RUNNING SHELL can see in /proc: on a Windows dev host the test
    // process's own pid is not in the shell's /proc view, so the fixture spawns its own child.
    // Redirected so the fixture's own stdout does not keep execFileSync waiting on the child.
    const prelude = opts.livePid ? `sleep 30 >/dev/null 2>&1 & echo $! > ${ws}.agent.pid; ` : "";
    const sh = prelude + RUN_STATE_SH.replaceAll("/workspace/", ws);
    return execFileSync("sh", ["-c", sh], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    }).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DEAD_PID = "999999";
const after = (s: string) => String(KILL_AT + 100) + s; // run started AFTER the kill
const before = (s: string) => String(KILL_AT - 100) + s; // run started BEFORE the kill

test("a live run is never healed to done, even on a box that OOMed earlier", () => {
  // The reported bug: pid alive, but an older kill in dmesg reported the run as OOM-killed.
  const out = runState({ ".agent.start": after("\n"), ".agent.running": "" }, { livePid: true });
  assert.equal(out, "run:running");
});

test("an interrupted run does NOT inherit an OOM kill from an earlier run", () => {
  const out = runState({ ".agent.pid": DEAD_PID, ".agent.start": after("\n"), ".agent.running": "" });
  assert.equal(out, "run:done exit=254", "a kill that predates the run is not this run's");
});

test("an interrupted run IS blamed on a kill that happened after it started", () => {
  const out = runState({ ".agent.pid": DEAD_PID, ".agent.start": before("\n"), ".agent.running": "" });
  assert.equal(out, "run:done exit=137");
});

test("no kill in the ring buffer at all reports a restart", () => {
  const out = runState(
    { ".agent.pid": DEAD_PID, ".agent.start": before("\n"), ".agent.running": "" },
    { dmesg: "[    0.000000] Linux version 6.1.0\n" }
  );
  assert.equal(out, "run:done exit=254");
});

test("a missing start mark cannot attribute a kill, so it reports a restart", () => {
  // A box whose run began before this change shipped: no mark, so no confident 137.
  const out = runState({ ".agent.pid": DEAD_PID, ".agent.running": "" });
  assert.equal(out, "run:done exit=254");
});

test("the start mark is agent-writable, so only a bare number is trusted", () => {
  // The mark lives in /workspace and is interpolated into an awk program. Stripping non-digits
  // would turn this into "01" — a plausible timestamp that reads as a genuine OOM.
  const out = runState({
    ".agent.pid": DEAD_PID,
    ".agent.start": '0) || system("touch /tmp/asb-pwned") || (1\n',
    ".agent.running": "",
  });
  assert.equal(out, "run:done exit=254");
});

test("sentinel passthrough: idle and a recorded exit are unchanged", () => {
  assert.equal(runState({}), "run:idle");
  assert.equal(runState({ ".agent.done": "7\n" }), "run:done exit=7");
  assert.equal(runState({ ".agent.done": "0\n" }), "run:done exit=0");
});
