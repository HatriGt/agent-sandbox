/**
 * The launch feed (src/launch-progress.ts): what a dashboard launch is doing between Send and the
 * agent's first words. Pure registry, so the order of events the browser relies on is pinned here:
 * subscribe-before-open, replay, live steps, close on started/failed, owner isolation, sweeping.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LaunchRegistry, LAUNCH_KEEP_MS, LAUNCH_ORPHAN_MS, isLaunchId, launchLabel, type LaunchStep } from "../src/launch-progress.ts";

const sub = (owner = "u1") => {
  const got: Array<{ step: LaunchStep; index: number }> = [];
  let closed = 0;
  return { got, closed: () => closed, s: { owner, onStep: (step: LaunchStep, index: number) => got.push({ step, index }), onClose: () => closed++ } };
};

test("isLaunchId: a browser-minted id, nothing shorter or stranger", () => {
  assert.equal(isLaunchId("l-1731900000000-abc123xyz"), true);
  assert.equal(isLaunchId("short"), false);
  assert.equal(isLaunchId("has space in it here"), false);
  assert.equal(isLaunchId(42), false);
});

test("launchLabel: the sandbox step says which way the box is coming", () => {
  assert.equal(launchLabel("sandbox"), "Getting a sandbox");
  assert.equal(launchLabel("sandbox", "warm"), "Claiming a warm sandbox");
  assert.equal(launchLabel("sandbox", "cold"), "Booting a fresh sandbox");
  assert.equal(launchLabel("host", "asb-host"), "Waking the asb-host host");
  assert.equal(launchLabel("clone", "o/n"), "Cloning o/n");
});

test("subscribe before open: the viewer is attached when the POST opens the entry, then gets every step live and a close on started", () => {
  const reg = new LaunchRegistry(() => 1000);
  const v = sub();
  const off = reg.subscribe("l-000000000001", v.s);
  assert.notEqual(off, false);
  const report = reg.open("l-000000000001", "u1");
  report("accepted");
  report("clone", "o/n");
  report("sandbox", "warm");
  report("agent");
  report("started", "dusk-cedar");
  assert.deepEqual(v.got.map((g) => [g.index, g.step.phase, g.step.detail]), [
    [0, "accepted", undefined],
    [1, "clone", "o/n"],
    [2, "sandbox", "warm"],
    [3, "agent", undefined],
    [4, "started", "dusk-cedar"],
  ]);
  assert.equal(v.closed(), 1);
  // Nothing after the terminal step is recorded.
  report("agent");
  assert.equal(reg.steps("l-000000000001")!.length, 5);
});

test("subscribe after some steps replays them from the index asked for, then continues live", () => {
  const reg = new LaunchRegistry(() => 1000);
  const report = reg.open("l-000000000002", "u1");
  report("accepted");
  report("access");
  report("host");
  const v = sub();
  reg.subscribe("l-000000000002", v.s, 1);
  assert.deepEqual(v.got.map((g) => g.step.phase), ["access", "host"]);
  report("sandbox", "cold");
  assert.deepEqual(v.got.map((g) => g.step.phase), ["access", "host", "sandbox"]);
  assert.equal(v.closed(), 0);
});

test("a closed launch replays and closes at once; a failed launch carries its reason", () => {
  const reg = new LaunchRegistry(() => 1000);
  const report = reg.open("l-000000000003", "u1");
  report("accepted");
  reg.fail("l-000000000003", "Refused: 3/3 boxes already running");
  const v = sub();
  reg.subscribe("l-000000000003", v.s);
  assert.deepEqual(v.got.map((g) => g.step.phase), ["accepted", "failed"]);
  assert.equal(v.got[1].step.detail, "Refused: 3/3 boxes already running");
  assert.equal(v.got[1].step.label, "Could not start");
  assert.equal(v.closed(), 1);
  // fail after close is a no-op
  reg.fail("l-000000000003", "again");
  assert.equal(reg.steps("l-000000000003")!.length, 2);
});

test("owner isolation: another owner's subscribe is refused, and one waiting before open is closed without a step", () => {
  const reg = new LaunchRegistry(() => 1000);
  const early = sub("u2");
  reg.subscribe("l-000000000004", early.s);
  const report = reg.open("l-000000000004", "u1");
  report("accepted");
  assert.equal(early.got.length, 0);
  assert.equal(early.closed(), 1);
  const late = sub("u2");
  assert.equal(reg.subscribe("l-000000000004", late.s), false);
  assert.equal(late.got.length, 0);
});

test("unsubscribe: a viewer that left gets nothing more, whether it was waiting or attached", () => {
  const reg = new LaunchRegistry(() => 1000);
  const waiting = sub();
  const offW = reg.subscribe("l-000000000005", waiting.s) as () => void;
  offW();
  const report = reg.open("l-000000000005", "u1");
  const attached = sub();
  const offA = reg.subscribe("l-000000000005", attached.s) as () => void;
  report("accepted");
  offA();
  report("agent");
  assert.equal(waiting.got.length, 0);
  assert.deepEqual(attached.got.map((g) => g.step.phase), ["accepted"]);
});

test("sweep: closed entries are kept ten minutes, an orphan that never closed thirty", () => {
  let t = 0;
  const reg = new LaunchRegistry(() => t);
  reg.open("l-00000000000a", "u1")("started", "b");
  reg.open("l-00000000000b", "u1")("accepted");
  t = LAUNCH_KEEP_MS + 1;
  reg.sweep();
  assert.equal(reg.steps("l-00000000000a"), undefined);
  assert.notEqual(reg.steps("l-00000000000b"), undefined);
  t = LAUNCH_ORPHAN_MS + 1;
  reg.sweep();
  assert.equal(reg.steps("l-00000000000b"), undefined);
  assert.equal(reg.size, 0);
});
