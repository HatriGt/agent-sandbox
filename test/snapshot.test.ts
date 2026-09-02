/**
 * Step snapshots v0 — rewind an answered question (docs/features-2026-09.md §5).
 *
 * Spike measured on the VPS (2026-09-01): msb snapshot create needs a STOPPED box (~1.3 s), and
 * `msb run --from-snapshot <snap> --name <same>` after an rm restores /workspace AND ~/.claude
 * (the Claude session) in ~1.7 s. So the pause point is captured AT RESUME TIME, before the answer
 * is delivered: the waiting box's state is untouched until then, the operator can still inspect it,
 * and the ~3 s stop+snapshot cost lands only on answered questions — gated behind SNAP_ASK=1.
 *
 * Pure parts tested here: the name scheme, the ls parser, and the capture/rewind predicates.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { askSnapName, parseSnapshotLs, shouldCaptureBeforeAnswer } from "../src/snapshot.ts";

test("askSnapName derives a valid, deterministic per-box name", () => {
  assert.equal(askSnapName("delegate-123-abc"), "snap-ask-delegate-123-abc");
  assert.match(askSnapName("pool-1788316340633-ay4mga"), /^snap-ask-[\w.-]+$/);
});

test("parseSnapshotLs finds names in the table output, ignoring the header", () => {
  const out = [
    "NAME          SCOPE    MIGRATION    IMAGE    SIZE       CREATED                DIGEST",
    "agent-base    disk     canonical    node     4.0 GiB    2026-08-18 09:39:48    sha256:de93a181a2c2",
    "snap-ask-b1   disk     canonical    node     4.1 GiB    2026-09-01 21:12:00    sha256:aaaa",
  ].join("\n");
  assert.deepEqual(parseSnapshotLs(out), ["agent-base", "snap-ask-b1"]);
  assert.deepEqual(parseSnapshotLs(""), []);
  assert.deepEqual(parseSnapshotLs("NAME SCOPE\n"), []);
});

test("capture only when enabled AND the box is actually waiting on a question", () => {
  assert.equal(shouldCaptureBeforeAnswer(true, "waiting"), true);
  assert.equal(shouldCaptureBeforeAnswer(true, "running"), false, "mid-turn state is not a pause point");
  assert.equal(shouldCaptureBeforeAnswer(true, "done"), false);
  assert.equal(shouldCaptureBeforeAnswer(true, "idle"), false);
  assert.equal(shouldCaptureBeforeAnswer(false, "waiting"), false);
});
