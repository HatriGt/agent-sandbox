import { test } from "node:test";
import assert from "node:assert/strict";
import { EXIT_DISK_FULL, EXIT_NOTES, hadAgentTurn, isStartFailure, logTail, StartFailureStreak, startFailureAlertText } from "../src/run-health.ts";
import { parseTrace } from "../src/trace.ts";

test("a run that died before its first turn is a start failure; one that had a session is not", () => {
  const dead = parseTrace("Error: ENOSPC: no space left on device, write\n    at Object.writeSync (node:fs:946:3)\n");
  assert.equal(hadAgentTurn(dead), false);
  assert.equal(isStartFailure(1, dead), true);
  assert.equal(isStartFailure(0, dead), false, "a clean exit is never a start failure");
  assert.equal(isStartFailure(undefined, dead), false);
  const alive = parseTrace("● session started\nsome output\n");
  assert.equal(hadAgentTurn(alive), true);
  assert.equal(isStartFailure(1, alive), false, "the agent ran: its failure is its own");
});

test("exit 250 is the disk-full code and has a note next to 254/253", () => {
  assert.equal(EXIT_DISK_FULL, 250);
  assert.match(EXIT_NOTES[250], /disk is full/);
  assert.match(EXIT_NOTES[254], /interrupted/);
  assert.match(EXIT_NOTES[253], /stopped/);
});

test("logTail keeps the last lines, drops sentinel and marker lines, and bounds the size", () => {
  const log = ["⟦task⟧ hello", "● session started", "a", "", "b\r", "c", "d", "e", "f", "g"].join("\n");
  assert.equal(logTail(log, 3), "e\nf\ng");
  assert.equal(logTail(["⟦x⟧", "● session started", "→ step", "only"].join("\n")), "only");
  assert.equal(logTail("x".repeat(600), 6, 100).length, 101);
  assert.equal(logTail(""), "");
});

test("the streak alerts on the third consecutive start failure, once per cooldown, and a real turn resets it", () => {
  let now = 1_000_000;
  const s = new StartFailureStreak(3, 60_000, () => now);
  assert.deepEqual(s.record("a", true, "t1"), { streak: 1, alert: false });
  assert.deepEqual(s.record("b", true, "t2"), { streak: 2, alert: false });
  assert.deepEqual(s.record("c", true, "t3"), { streak: 3, alert: true });
  assert.deepEqual(s.record("d", true, "t4"), { streak: 4, alert: false }, "still inside the cooldown");
  now += 60_001;
  assert.deepEqual(s.record("e", true, "t5"), { streak: 5, alert: true });
  assert.equal(s.state().last?.box, "e");
  assert.deepEqual(s.record("f", false), { streak: 0, alert: false });
  assert.equal(s.state().streak, 0);
});

test("the alert text leads with the count and ends with the box link", () => {
  const t = startFailureAlertText(3, { box: "pool-1-x", tail: "l1\nENOSPC" }, "https://asb.example/");
  assert.match(t, /^3 runs in a row died before their first turn/);
  assert.match(t, /l1 \| ENOSPC/);
  assert.match(t, /https:\/\/asb\.example\/dashboard\/#\/box\/pool-1-x$/);
});
