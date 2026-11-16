import { test } from "node:test";
import assert from "node:assert/strict";
import { pickHost, totalCapacity, type HostCandidate } from "../src/host-pick.ts";

const host = (id: string, extra: Partial<HostCandidate> = {}): HostCandidate => ({
  id,
  enabled: true,
  unreachable: false,
  running: 0,
  reserved: 0,
  maxBoxes: 5,
  warmReady: false,
  asleep: false,
  priority: 10,
  ...extra,
});

test("pickHost: priority first, then a warm box, then awake, then allowance left", () => {
  assert.equal(pickHost([host("vm", { priority: 10 }), host("vps", { priority: 0 })]).id, "vps");
  assert.equal(pickHost([host("a", { warmReady: false }), host("b", { warmReady: true })]).id, "b");
  assert.equal(pickHost([host("a", { asleep: true }), host("b")]).id, "b");
  assert.equal(pickHost([host("a", { allowanceLeft: 20 }), host("b", { allowanceLeft: 120 })]).id, "b");
  // Unmetered beats metered when everything else is equal.
  assert.equal(pickHost([host("a", { allowanceLeft: 300 }), host("b")]).id, "b");
});

test("pickHost: equal hosts fill evenly by share of their own capacity, ids break the last tie", () => {
  assert.equal(pickHost([host("a", { running: 2, maxBoxes: 4 }), host("b", { running: 1, maxBoxes: 4 })]).id, "b");
  assert.equal(pickHost([host("a", { running: 1, maxBoxes: 2 }), host("b", { running: 2, maxBoxes: 10 })]).id, "b");
  assert.equal(pickHost([host("b"), host("a")]).id, "a");
});

test("pickHost: disabled, unreachable, full and spent hosts are never picked; the reason says which", () => {
  assert.deepEqual(pickHost([]), { reason: "no box host is configured", ranked: [] });
  assert.equal(pickHost([host("a", { enabled: false })]).reason, "every box host is disabled");
  assert.equal(pickHost([host("a", { unreachable: true })]).reason, "every box host is unreachable");
  assert.equal(pickHost([host("a", { running: 5 }), host("b", { running: 3, reserved: 2 })]).reason, "every box host is full (a 5/5, b 5/5)");
  assert.equal(pickHost([host("a", { allowanceLeft: 0.5, minAllowance: 1 })]).reason, "every box host with room has used up its monthly allowance");
  // A full host does not hide a free one, nor a spent one a funded one.
  assert.equal(pickHost([host("a", { running: 5, priority: 0 }), host("b")]).id, "b");
  assert.equal(pickHost([host("a", { allowanceLeft: 0, priority: 0 }), host("b", { allowanceLeft: 50 })]).id, "b");
});

test("pickHost: in-flight reservations count against a host", () => {
  const r = pickHost([host("a", { reserved: 5 }), host("b")]);
  assert.equal(r.id, "b");
  assert.deepEqual(r.ranked, ["b"]);
});

test("totalCapacity counts enabled hosts only", () => {
  assert.equal(totalCapacity([host("a", { maxBoxes: 5 }), host("b", { maxBoxes: 3, enabled: false }), host("c", { maxBoxes: 2, unreachable: true })]), 7);
});
