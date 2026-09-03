/**
 * Per-message revert checkpoints: in-box tar capture (online, ~1 s, no VM stop), ring pruning,
 * in-place restore with the log seam, and the between-turns-only policy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRevert,
  captureCmd,
  checkpointForMessage,
  CKPT_KEEP,
  HEAVY_DIRS,
  listCmd,
  parseCkptLs,
  pruneCmd,
  revertCmd,
  withBoxLock,
} from "../src/checkpoint.ts";

test("captureCmd tars workspace + agent home into a store OUTSIDE /workspace, tolerates exit 1", () => {
  const cmd = captureCmd(3);
  assert.match(cmd, /tar -cf '\/root\/\.agent-ckpt\/t3\.tar\.tmp'/);
  assert.match(cmd, /-C \/ 'workspace' 'root\/\.claude'/);
  // The store must NOT live under /workspace — it would leak into the changes dock and file tree.
  assert.ok(!cmd.includes("/workspace/.agent.ckpt"));
  assert.match(cmd, /\|\| \[ \$\? -eq 1 \]/); // "file changed as we read it" must not fail capture
  assert.match(cmd, /mv .*t3\.tar\.tmp.*t3\.tar/); // atomic publish
  assert.match(cmd, /echo CKPT_OK t3/);
});

test("captureCmd excludes every heavy dir — a GB node_modules must never enter the tar", () => {
  const cmd = captureCmd(1);
  for (const d of HEAVY_DIRS) assert.ok(cmd.includes(`--exclude='*/${d}'`), d);
});

test("pruneCmd keeps the newest CKPT_KEEP by turn number", () => {
  assert.match(pruneCmd(), new RegExp(`head -n -${CKPT_KEEP}`));
  assert.match(pruneCmd(), /sort -t t -k2 -n/);
});

test("parseCkptLs reads turn numbers, sorted, ignoring junk", () => {
  assert.deepEqual(parseCkptLs("t10.tar\nt2.tar\nt1.tar.tmp\nnotes.txt\nt1.tar\n"), [1, 2, 10]);
  assert.deepEqual(parseCkptLs(""), []);
});

test("revertCmd guards on the tar, wipes around the heavy dirs, appends the seam with the deps caveat", () => {
  const cmd = revertCmd(2, 3);
  assert.match(cmd, /\[ -f '\/root\/\.agent-ckpt\/t2\.tar' \] \|\| \{ echo CKPT_MISSING t2; exit 9; \}/);
  // The wipe prunes heavy dirs (preserved installs) and runs BEFORE the untar.
  assert.match(cmd, /-name 'node_modules'/);
  assert.match(cmd, /-prune/);
  assert.ok(cmd.indexOf("find /workspace") < cmd.indexOf("tar -xf"));
  // The agent home is restored whole (no heavy dirs there).
  assert.match(cmd, /rm -rf \/root\/\.claude/);
  assert.match(cmd, /3 later turns discarded/);
  assert.match(cmd, /dependencies were kept/);
  assert.match(revertCmd(1, 1), /1 later turn discarded/);
  assert.match(cmd, /\.agent\.log/);
});

test("canRevert only between turns", () => {
  assert.equal(canRevert("done"), true);
  assert.equal(canRevert("waiting"), true);
  assert.equal(canRevert("idle"), true);
  assert.equal(canRevert("running"), false);
});

test("checkpointForMessage: message k restores t(k-1); the task itself has none", () => {
  assert.equal(checkpointForMessage(1), null);
  assert.equal(checkpointForMessage(2), 1);
  assert.equal(checkpointForMessage(5), 4);
});

test("withBoxLock serializes per box and survives a rejection", async () => {
  const order: string[] = [];
  const slow = withBoxLock("b1", async () => {
    await new Promise((r) => setTimeout(r, 30));
    order.push("capture");
  });
  const rejected = withBoxLock("b1", async () => {
    order.push("boom");
    throw new Error("x");
  }).catch(() => order.push("caught"));
  const after = withBoxLock("b1", async () => {
    order.push("resume");
  });
  await Promise.all([slow, rejected, after]);
  assert.deepEqual(order, ["capture", "boom", "caught", "resume"]);
  assert.match(listCmd(), /\.agent-ckpt/);
});
