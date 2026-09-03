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

test("captureCmd labels the tar IN-BOX from the log, is idempotent, tolerates tar exit 1", () => {
  const cmd = captureCmd();
  // The turn number comes from the same log the tar captures — never a controller-side count that
  // can be stale (the off-by-one found in the live stress run).
  assert.match(cmd, /grep -a -c '\^⟦you⟧' \/workspace\/\.agent\.log/);
  assert.match(cmd, /\[ -f "\$f" \] && \{ echo CKPT_HAVE t\$n; exit 0; \}/); // idempotent
  assert.match(cmd, /-C \/ 'workspace' 'root\/\.claude'/);
  assert.ok(!cmd.includes("/workspace/.agent.ckpt")); // store never under /workspace
  assert.match(cmd, /\|\| \[ \$\? -eq 1 \]/); // "file changed as we read it" must not fail capture
  assert.match(cmd, /mv "\$f\.tmp" "\$f"/); // atomic publish
  assert.match(cmd, /echo CKPT_OK t\$n/);
});

test("captureCmd excludes every heavy dir — a GB node_modules must never enter the tar", () => {
  const cmd = captureCmd();
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

test("revertCmd guards on the tar, wipes around the heavy dirs, computes the seam count in-box", () => {
  const cmd = revertCmd(2);
  assert.match(cmd, /\[ -f '\/root\/\.agent-ckpt\/t2\.tar' \] \|\| \{ echo CKPT_MISSING t2; exit 9; \}/);
  // The wipe prunes heavy dirs (preserved installs) and runs BEFORE the untar.
  assert.match(cmd, /-name 'node_modules'/);
  assert.match(cmd, /-prune/);
  assert.ok(cmd.indexOf("find /workspace") < cmd.indexOf("tar -xf"));
  // The agent home is restored whole (no heavy dirs there).
  assert.match(cmd, /rm -rf \/root\/\.claude/);
  // Discarded count comes from the live log, before the wipe, never below 1.
  assert.match(cmd, /d=\$\(\( \$\(grep -a -c '\^⟦you⟧'/);
  assert.match(cmd, /\[ "\$d" -lt 1 \] && d=1/);
  assert.match(cmd, /\$d later turn\(s\) discarded/);
  assert.match(cmd, /dependencies were kept/);
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
