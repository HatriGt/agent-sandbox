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

test("run: ssh exit 255 and a timeout both announce the control socket to the failure hooks (pinned at the source)", async () => {
  const { noteSshExit, sshFailureHooks } = await import("../src/exec.ts");
  const heard: string[] = [];
  const hook = (sock: string, why: string) => void heard.push(`${why} ${sock}`);
  sshFailureHooks.add(hook);
  try {
    noteSshExit("ssh", ["-o", "ControlPath=/root/.ssh/asb/82f88631d.sock", "host", "true"], 255);
    noteSshExit("ssh", ["-o", "ControlPath=/root/.ssh/asb/82f88631d.sock", "host", "false"], 1);
    noteSshExit("msb", ["ls"], 255);
    assert.deepEqual(heard, ["exit255 /root/.ssh/asb/82f88631d.sock"], "only ssh's own exit code, only with a socket");
  } finally {
    sshFailureHooks.delete(hook);
  }
  const src = fs.readFileSync(new URL("../src/exec.ts", import.meta.url), "utf8");
  assert.equal((src.match(/noteSshExit\(cmd, args, /g) ?? []).length, 2, "both run() and runStream() announce an exit 255");
  assert.match(src, /c\.on\("error", \(\) => unlink\(sock, \(\) => \{\}\)\);\s*noteSshFailure\(sock, "timeout"\);/, "a timeout announces too");
});

test("a timed-out command leaves a master that completed another command within the window (busy, not dead); otherwise the master is reset and the failure announced", async () => {
  const { forgetSshDoneForTest, noteSshDone, resetSshMasterOnTimeout, sshFailureHooks } = await import("../src/exec.ts");
  forgetSshDoneForTest();
  const heard: string[] = [];
  const hook = (sock: string, why: string) => void heard.push(`${why} ${sock}`);
  sshFailureHooks.add(hook);
  try {
    const busy = ["-o", "ControlPath=/nonexistent/asb/11111111.sock", "host", "true"];
    const dead = ["-o", "ControlPath=/nonexistent/asb/22222222d.sock", "host", "true"];
    noteSshDone("ssh", busy, 0);
    noteSshDone("ssh", dead, 255); // an ssh-level failure is not a completion
    resetSshMasterOnTimeout("ssh", busy);
    resetSshMasterOnTimeout("ssh", dead);
    assert.deepEqual(heard, ["timeout /nonexistent/asb/22222222d.sock"], "only the socket nothing got through is reset and announced");
  } finally {
    sshFailureHooks.delete(hook);
    forgetSshDoneForTest();
  }
});

test("ssh lanes: a proxied host's commands start one at a time, both routes share the lane, it is given back once, and a host without one runs in parallel", async () => {
  const { setSshLane, sshLaneOf, sshLaneTagOf, sshLaneTimeoutMs, takeSshLane, SSH_LANE_MIN_TIMEOUT_MS } = await import("../src/exec.ts");
  assert.equal(sshLaneTagOf("/root/.ssh/asb/82f88631d.sock"), "82f88631");
  assert.equal(sshLaneTagOf("/root/.ssh/asb/82f88631.sock"), "82f88631");
  assert.equal(sshLaneTagOf("/tmp/other.sock"), null);
  const argv = (s: string) => ["-o", `ControlPath=${s}`, "host", "true"];
  assert.equal(sshLaneOf("ssh", argv("/root/.ssh/asb/82f88631.sock")), null, "no lane registered: parallel, as a static host");
  setSshLane("82f88631", 1);
  const lane = sshLaneOf("ssh", argv("/root/.ssh/asb/82f88631d.sock"));
  assert.ok(lane, "the direct route is laned");
  assert.equal(sshLaneOf("ssh", argv("/root/.ssh/asb/82f88631.sock")), lane, "the proxy route shares it");
  assert.equal(sshLaneOf("rsync", ["-e", "ssh -o ControlPath=/root/.ssh/asb/82f88631.sock", "a", "b"]), lane, "rsync's ssh too");
  assert.equal(sshLaneOf("msb", ["ls"]), null);
  assert.equal(sshLaneOf("ssh", ["-o", "ControlPath=none", "host", "true"]), null, "a gated command has no socket and no lane");
  try {
    const first = await takeSshLane(lane);
    let secondStarted = false;
    const second = takeSshLane(lane).then((g) => ((secondStarted = true), g));
    await new Promise((r) => setImmediate(r));
    assert.equal(secondStarted, false, "the second waits for the first to open its channel");
    first();
    first();
    const g2 = await second;
    assert.equal(secondStarted, true);
    assert.equal(lane.busy, 1, "a double give-back counts once");
    g2();
    assert.equal(lane.busy, 0);
    assert.equal(sshLaneTimeoutMs(lane, 15_000), SSH_LANE_MIN_TIMEOUT_MS, "a short timeout is raised: a cold master through the proxy is 5-15 s");
    assert.equal(sshLaneTimeoutMs(lane, 300_000), 300_000);
    assert.equal(sshLaneTimeoutMs(lane, 0), 0, "forever stays forever");
    assert.equal(sshLaneTimeoutMs(null, 15_000), 15_000);
  } finally {
    setSshLane("82f88631", undefined);
  }
  assert.equal(sshLaneOf("ssh", argv("/root/.ssh/asb/82f88631.sock")), null);
  const src = fs.readFileSync(new URL("../src/exec.ts", import.meta.url), "utf8");
  assert.equal((src.match(/const lane = sshLaneOf\(cmd, args\);/g) ?? []).length, 2, "run and runStream both take the lane");
  assert.ok((src.match(/freeLane\(\);/g) ?? []).length >= 9, "the lane is given back on first output, on close, on error and on timeout, in both");
});

test("ssh lanes: the second command starts only when the first lets go", async () => {
  const { setSshLane, takeSshLane, sshLaneOf } = await import("../src/exec.ts");
  setSshLane("0badf00d", 1);
  const lane = sshLaneOf("ssh", ["-o", "ControlPath=/root/.ssh/asb/0badf00d.sock", "h", "true"])!;
  try {
    const give = await takeSshLane(lane);
    const t0 = Date.now();
    const waited = takeSshLane(lane).then((g) => (g(), Date.now() - t0));
    setTimeout(give, 120);
    assert.ok((await waited) >= 100, "the second started only when the first let go");
  } finally {
    setSshLane("0badf00d", undefined);
  }
});

test("ssh lanes: a front-of-lane command starts before the queue, a command that waits past its timeout is refused unsent, and run() reads the front context", async () => {
  const { setSshLane, sshLaneOf, takeSshLane, sshLaneFront } = await import("../src/exec.ts");
  setSshLane("0f00f00d", 1);
  const lane = sshLaneOf("ssh", ["-o", "ControlPath=/root/.ssh/asb/0f00f00d.sock", "h", "true"])!;
  try {
    const holder = await takeSshLane(lane);
    const order: string[] = [];
    const back = takeSshLane(lane).then((g) => (order.push("back"), g()));
    const front = takeSshLane(lane, { front: true }).then((g) => (order.push("front"), g()));
    const refused = takeSshLane(lane, { waitMs: 50 });
    await assert.rejects(refused, /waited \d+s for a turn on the host's ssh lane \(2 still queued\); not sent/);
    assert.equal(lane.waiting.length, 2, "the refused one left the queue");
    holder();
    await Promise.all([front, back]);
    assert.deepEqual(order, ["front", "back"]);
    assert.equal(lane.busy, 0);
    let seen: boolean | undefined;
    await sshLaneFront(async () => {
      await new Promise((r) => setImmediate(r));
      const { AsyncLocalStorage } = await import("node:async_hooks");
      void AsyncLocalStorage;
      seen = true;
    });
    assert.equal(seen, true);
  } finally {
    setSshLane("0f00f00d", undefined);
  }
  const src = fs.readFileSync(new URL("../src/exec.ts", import.meta.url), "utf8");
  assert.equal((src.match(/takeSshLane\(lane, \{ front: laneContext\.getStore\(\)\?\.front, waitMs: timeoutMs \}\)/g) ?? []).length, 2, "run and runStream take the front context and bound the wait");
  const tunnel = fs.readFileSync(new URL("../src/ssh-tunnel.ts", import.meta.url), "utf8");
  assert.match(tunnel, /sshLaneFront\(\(\) => io\.installKey\(cfg\)\)/, "the dial's key install goes first");
  assert.match(tunnel, /sshLaneFront\(\(\) => io\.probe\(cfg, route, 20_000\)\)/, "the dial's check goes first");
  const http = fs.readFileSync(new URL("../src/http.ts", import.meta.url), "utf8");
  assert.match(http, /await sshLaneFront\(\(\) => Promise\.all\(\[countBoxesOnHost\(c\)/, "the readiness probe goes first");
});
