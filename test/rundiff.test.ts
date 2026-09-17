/**
 * WS2b — the end-of-run full diff, captured at the finish edge and archived so it survives teardown.
 *
 * `git diff` output was never persisted: /diff.json is per-file and needs a RUNNING box, so a
 * finished+torn-down run had no reviewable diff at all. `fullDiffSh`/`parseFullDiff` produce one
 * whole-workspace unified diff (per repo, untracked files rendered as all-added via `git add -N`),
 * and run-archive rows gain a diff_text column written at archive time.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fullDiffSh, parseFullDiff, FULL_DIFF_MAX_BYTES } from "../src/changes.ts";
import { openMemoryDb } from "../src/db.ts";
import { archiveRun, getRun, listRuns } from "../src/run-archive.ts";
import type { RunDigest } from "../src/digest.ts";

test("fullDiffSh walks every repo and bounds the output", () => {
  const sh = fullDiffSh();
  assert.match(sh, /git -C "\$r" add -A -N/, "untracked files must be shown as added (intent-to-add)");
  assert.match(sh, /git -C "\$r" diff HEAD/);
  assert.match(sh, new RegExp(`head -c ${FULL_DIFF_MAX_BYTES}`), "the capture must be byte-bounded");
  assert.match(sh, /@@repo /, "per-repo sections need a marker the parser can split on");
});

test("parseFullDiff splits repo sections and prefixes paths with the repo dir", () => {
  const raw = [
    "@@repo app",
    "diff --git a/src/x.ts b/src/x.ts",
    "--- a/src/x.ts",
    "+++ b/src/x.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "@@repo lib",
    "diff --git a/y.md b/y.md",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/y.md",
    "@@ -0,0 +1 @@",
    "+hello",
  ].join("\n");
  const out = parseFullDiff(raw);
  // Paths become workspace-relative (repo/dir/file), matching /changes.json and the ChangesDock.
  assert.match(out, /^diff --git a\/app\/src\/x\.ts b\/app\/src\/x\.ts$/m);
  assert.match(out, /^\+\+\+ b\/lib\/y\.md$/m);
  assert.match(out, /^\+new$/m);
  assert.match(out, /^\+hello$/m);
});

test("parseFullDiff of an empty capture is empty", () => {
  assert.equal(parseFullDiff(""), "");
  assert.equal(parseFullDiff("@@repo app\n"), "");
});

test("archiveRun stores the diff and getRun returns it", () => {
  const db = openMemoryDb();
  const digest: RunDigest = { task: "t", state: "done", headline: "done", plan: [], files: [], failedCommands: [], questions: [] } as unknown as RunDigest;
  const id = archiveRun(db, { box: "b1", owner: "op", digest, diffText: "diff --git a/x b/x\n+1" });
  assert.ok(id);
  const row = getRun(db, "op", id!);
  assert.equal(row?.diffText, "diff --git a/x b/x\n+1");
  // The list view must NOT carry the (potentially large) diff.
  const listed = listRuns(db, "op")[0] as Record<string, unknown>;
  assert.ok(!("diffText" in listed) && !("diff_text" in listed), "list rows must not carry the diff");
});

test("archiveRun without a diff stores null and getRun degrades honestly", () => {
  const db = openMemoryDb();
  const digest: RunDigest = { task: "t", state: "done", headline: "done", plan: [], files: [], failedCommands: [], questions: [] } as unknown as RunDigest;
  const id = archiveRun(db, { box: "b2", owner: "op", digest });
  const row = getRun(db, "op", id!);
  assert.equal(row?.diffText, undefined);
});
