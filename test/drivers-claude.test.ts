/**
 * Snapshot lock for the driver extraction (plan workstream A, step 1): the shell the controller
 * emits for the claude and omp drivers — launch/resume wrapper, bootstrap (hooks, formatter,
 * guard) and the exec env — must be byte-identical to what msb.ts emitted before the drivers
 * moved into src/drivers/. The fixture was captured from the pre-refactor code; a diff here is a
 * behaviour change to live runs, never a snapshot to regenerate casually.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { snapshotCases } from "./drivers-snapshot-cases.js";

const golden = JSON.parse(readFileSync(new URL("./fixtures/drivers-snapshot.json", import.meta.url), "utf8")) as Record<string, unknown>;

test("driver shell snapshots: same case matrix as the captured fixture", () => {
  assert.deepEqual(Object.keys(snapshotCases()).sort(), Object.keys(golden).sort());
});

for (const [name, value] of Object.entries(snapshotCases())) {
  test(`driver shell snapshot is byte-identical: ${name}`, () => {
    assert.deepEqual(value, golden[name]);
  });
}
