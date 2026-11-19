/**
 * `run()` must never wait forever. An unbounded wait is what turned one wedged `msb exec` (a box
 * caught mid-shutdown, parked in poll()) into a dead control plane: the fleet sweep's Promise.all
 * never settled, and every later /fleet.json was handed the same dead promise.
 *
 * The children here are `sh`, not another node — spawning node from inside the test runner is heavy
 * enough to fail on a loaded Windows host, and the timeout is about the child not returning, which
 * `sleep` models exactly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { run, DEFAULT_TIMEOUT_MS } from "../src/exec.ts";

test("run: kills and rejects a command that outlives its timeout", async () => {
  const started = Date.now();
  await assert.rejects(
    () => run("sh", ["-c", "sleep 60"], { timeoutMs: 300 }),
    /timed out after 300ms/,
    "the rejection must name the timeout, not look like a plain non-zero exit",
  );
  assert.ok(Date.now() - started < 10_000, "rejected promptly rather than waiting out the child");
});

test("run: a command that finishes inside its timeout is unaffected", async () => {
  const r = await run("sh", ["-c", "printf ok"], { timeoutMs: 30_000 });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), "ok");
});

test("run: timeoutMs 0 opts out, and the default is generous but finite", async () => {
  const r = await run("sh", ["-c", "printf ok"], { timeoutMs: 0 });
  assert.equal(r.stdout.trim(), "ok");
  assert.ok(DEFAULT_TIMEOUT_MS > 60_000 && Number.isFinite(DEFAULT_TIMEOUT_MS));
});

test("a timed-out ssh names its master socket; a plain command or ControlPath=none names none", async () => {
  const { sshControlPathOf } = await import("../src/exec.ts");
  assert.equal(sshControlPathOf("ssh", ["-o", "BatchMode=yes", "-o", "ControlPath=/root/.ssh/asb/82f88631.sock", "host", "true"]), "/root/.ssh/asb/82f88631.sock");
  assert.equal(sshControlPathOf("rsync", ["-e", "ssh -o BatchMode=yes -o ControlPath=/root/.ssh/asb/82f88631d.sock", "a", "b"]), "/root/.ssh/asb/82f88631d.sock");
  assert.equal(sshControlPathOf("ssh", ["-o", "ControlMaster=no", "-o", "ControlPath=none", "host", "true"]), null);
  assert.equal(sshControlPathOf("msb", ["ls"]), null);
});

test("run: a timeout on an ssh argv closes that master (pinned at the source)", () => {
  const src = fs.readFileSync(new URL("../src/exec.ts", import.meta.url), "utf8");
  const hooks = src.match(/child\.kill\("SIGKILL"\);\s*resetSshMasterOnTimeout\(cmd, args\);/g) ?? [];
  assert.equal(hooks.length, 2, "both run() and runStream() reset the master on timeout");
});
