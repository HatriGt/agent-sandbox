import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confineFsOp, fsCommand, exitCodeOf, fsFailure, type SafeFsOp } from "../src/fs-ops.ts";

function confined(body: unknown): SafeFsOp {
  const r = confineFsOp(body);
  assert.ok(r.ok, `expected ${JSON.stringify(body)} to confine, got ${JSON.stringify(r)}`);
  return r.op;
}
function refused(body: unknown): { status: number; message: string } {
  const r = confineFsOp(body);
  assert.ok(!r.ok, `expected ${JSON.stringify(body)} to be refused`);
  return r;
}

test("confineFsOp confines every path and names the op", () => {
  assert.deepEqual(confined({ op: "create", path: "/workspace/./repo//new.ts" }), { op: "create", path: "repo/new.ts" });
  assert.deepEqual(confined({ op: "move", path: "repo/a.ts", to: "repo/b/c.ts" }), { op: "move", path: "repo/a.ts", to: "repo/b/c.ts" });
  assert.equal(refused({ op: "create", path: "../etc/passwd" }).status, 400);
  assert.equal(refused({ op: "copy", path: "repo/a.ts", to: "/etc/x" }).status, 400);
  assert.equal(refused({ op: "chmod", path: "repo/a.ts" }).status, 400);
  assert.equal(refused({ op: "delete" }).status, 400);
  assert.equal(refused({ op: "move", path: "repo/a.ts" }).status, 400);
});

test("confineFsOp keeps repository roots: delete and move at depth 1 are refused, create is not", () => {
  assert.equal(refused({ op: "delete", path: "repo" }).status, 409);
  assert.equal(refused({ op: "move", path: "repo", to: "renamed" }).status, 409);
  assert.equal(confined({ op: "create", path: "NOTES.md" }).path, "NOTES.md");
  assert.equal(confined({ op: "mkdir", path: "scratch" }).path, "scratch");
  assert.equal(confined({ op: "copy", path: "repo", to: "repo-copy" }).op, "copy");
});

test("confineFsOp refuses a move or copy onto itself or into itself", () => {
  assert.equal(refused({ op: "move", path: "repo/src", to: "repo/src" }).status, 400);
  assert.equal(refused({ op: "copy", path: "repo/src", to: "repo/src/inner" }).status, 400);
  assert.equal(confined({ op: "move", path: "repo/src", to: "repo/src2" }).op, "move");
});

/**
 * The shell strings run for real where a POSIX sh exists, with /workspace rewritten to a temp
 * dir; the observable effects (filesystem state, exit code) are the contract the route maps.
 */
const sh = process.platform === "win32" ? ["C:\\Program Files\\Git\\usr\\bin\\sh.exe", "C:\\Program Files\\Git\\bin\\sh.exe"].find((p) => existsSync(p)) : "sh";
const run = (op: SafeFsOp, root: string) => {
  const script = fsCommand(op).replaceAll("'/workspace/", `'${root.replaceAll("\\", "/")}/`);
  try {
    execFileSync(sh as string, ["-c", script], { stdio: ["ignore", "pipe", "pipe"] });
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
};
const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), "fs-ops-"));
  mkdirSync(join(root, "repo", "src"), { recursive: true });
  writeFileSync(join(root, "repo", "src", "a.ts"), "A");
  return root;
};

test("fsCommand ops converge and refuse to clobber", { skip: !sh && "no sh" }, () => {
  const root = fresh();
  try {
    const create = confined({ op: "create", path: "repo/src/deep/it's new.ts" });
    assert.equal(run(create, root), 0);
    assert.equal(readFileSync(join(root, "repo/src/deep/it's new.ts"), "utf8"), "");
    writeFileSync(join(root, "repo/src/deep/it's new.ts"), "kept");
    assert.equal(run(create, root), 0, "create again is a no-op");
    assert.equal(readFileSync(join(root, "repo/src/deep/it's new.ts"), "utf8"), "kept", "an existing file is not truncated");
    assert.equal(run(confined({ op: "create", path: "repo/src" }), root), 3, "a folder in the way");

    const mkdir = confined({ op: "mkdir", path: "repo/src/deep" });
    assert.equal(run(mkdir, root), 0, "mkdir of an existing folder");
    assert.equal(run(confined({ op: "mkdir", path: "repo/src/a.ts" }), root), 3, "a file in the way");

    assert.equal(run(confined({ op: "copy", path: "repo/src/a.ts", to: "repo/dst/b.ts" }), root), 0);
    assert.equal(readFileSync(join(root, "repo/dst/b.ts"), "utf8"), "A");
    assert.ok(existsSync(join(root, "repo/src/a.ts")), "copy keeps the source");
    assert.equal(run(confined({ op: "copy", path: "repo/src/a.ts", to: "repo/dst/b.ts" }), root), 5, "copy never clobbers");

    assert.equal(run(confined({ op: "move", path: "repo/src/deep", to: "repo/moved/deep" }), root), 0);
    assert.ok(statSync(join(root, "repo/moved/deep")).isDirectory());
    assert.ok(!existsSync(join(root, "repo/src/deep")));
    assert.equal(run(confined({ op: "move", path: "repo/src/deep", to: "repo/elsewhere" }), root), 4, "source gone");
    assert.equal(run(confined({ op: "move", path: "repo/src/a.ts", to: "repo/dst/b.ts" }), root), 5, "move never clobbers");

    const del = confined({ op: "delete", path: "repo/moved" });
    assert.equal(run(del, root), 0);
    assert.ok(!existsSync(join(root, "repo/moved")));
    assert.equal(run(del, root), 0, "delete of a missing path");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exit codes map to the client statuses the explorer branches on", () => {
  assert.equal(exitCodeOf(new Error("Command failed (5): ssh -o ... \nstderr")), 5);
  assert.equal(exitCodeOf(new Error("Command timed out after 300000ms: ssh")), null);
  assert.deepEqual(fsFailure(3), { status: 409, message: "already exists" });
  assert.equal(fsFailure(4)?.status, 404);
  assert.equal(fsFailure(5)?.status, 409);
  assert.equal(fsFailure(1), null);
  assert.equal(fsFailure(null), null);
});
