import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUnifiedDiff, hunkToPatch, hunkId } from "../web/src/lib/diff.ts";
import { buildHunkPatch, discardFileSh, discardHunkSh, splitRepoPath } from "../src/changes.ts";

const SAMPLE = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1..2 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " top",
  "-old1",
  "+new1",
  " x",
  "@@ -20,4 +20,5 @@ function mid() {",
  " a",
  "",
  "-b",
  "+B",
  "+c",
  " d",
  "\\ No newline at end of file",
].join("\n");

test("hunkToPatch: rebuilds the @@ header and prefixes from parsed lines (mid-file hunk, empty context, no-newline meta)", () => {
  const d = parseUnifiedDiff(SAMPLE);
  assert.equal(d.hunks.length, 2);
  assert.equal(hunkToPatch(d.hunks[0]), "@@ -1,3 +1,3 @@\n top\n-old1\n+new1\n x\n");
  assert.equal(hunkToPatch(d.hunks[1]), "@@ -20,4 +20,5 @@ function mid() {\n a\n \n-b\n+B\n+c\n d\n\\ No newline at end of file\n");
});

test("hunkId: stable across re-parses, position-aware, content-aware", () => {
  const a = parseUnifiedDiff(SAMPLE);
  const b = parseUnifiedDiff(SAMPLE);
  assert.equal(hunkId(a.hunks[0]), hunkId(b.hunks[0]));
  assert.notEqual(hunkId(a.hunks[0]), hunkId(a.hunks[1]));
  const c = parseUnifiedDiff(SAMPLE.replace("+new1", "+new2"));
  assert.notEqual(hunkId(a.hunks[0]), hunkId(c.hunks[0]));
  assert.equal(hunkId(a.hunks[1]), hunkId(c.hunks[1]));
});

test("buildHunkPatch: strips any client file header, prepends ours, restores stripped-blank context lines", () => {
  const withHeader = "diff --git a/evil b/evil\n--- a/evil\n+++ b/evil\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n";
  assert.equal(buildHunkPatch("src/a.ts", withHeader), "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n");
  assert.equal(buildHunkPatch("f", "@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n\n"), "--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n \n-b\n+c\n");
  assert.throws(() => buildHunkPatch("f", "no hunk here"), /@@ header/);
  // CRLF from a Windows client is normalised.
  assert.equal(buildHunkPatch("f", "@@ -1 +1 @@\r\n-a\r\n+b\r\n"), "--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n");
});

test("discard scripts: repo-relative paths, quoted, with the sentinel", () => {
  assert.deepEqual(splitRepoPath("repo/src/x y.ts"), { top: "repo", inner: "src/x y.ts" });
  const f = discardFileSh("repo/src/x y.ts");
  assert.match(f, /cat-file -e HEAD:'src\/x y.ts'/);
  assert.match(f, /git -C 'repo' reset -q -- 'src\/x y.ts' && git -C 'repo' checkout -- 'src\/x y.ts'/);
  assert.match(f, /rm -f 'repo'\/'src\/x y.ts'/);
  assert.match(f, /@@DISCARDED/);
  // A loose file outside any repo is simply deleted.
  assert.match(discardFileSh("report.md"), /else rm -f 'report.md' && echo @@DISCARDED/);
  const h = discardHunkSh("repo/src/a.ts");
  assert.match(h, /cd \/workspace\/'repo'/);
  assert.match(h, /base64 -d \| git apply -R --recount --whitespace=nowarn -/);
  assert.match(h, /@@UNTRACKED/);
});

/**
 * The real thing: a file edited in three places, the MIDDLE hunk (as the client would rebuild it
 * from the parsed diff) reverse-applied through the same `git apply -R --recount` the box runs.
 * Skipped only when git is not on PATH.
 */
test("reverse-applying one mid-file hunk leaves the other two edits in place", (t) => {
  let dir: string;
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("git not available");
    return;
  }
  dir = mkdtempSync(join(tmpdir(), "asb-hunk-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd: dir, encoding: "utf8" });
  try {
    git("init", "-q", ".");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    const nums = Array.from({ length: 40 }, (_, i) => String(i + 1));
    writeFileSync(join(dir, "f.txt"), nums.join("\n") + "\n");
    git("add", "f.txt");
    git("commit", "-qm", "init");
    const edited = nums.map((n) => (n === "3" ? "three" : n === "20" ? "twenty" : n === "21" ? "twentyone" : n === "38" ? "thirtyeight" : n));
    writeFileSync(join(dir, "f.txt"), edited.join("\n") + "\n");
    const parsed = parseUnifiedDiff(git("diff", "--", "f.txt"));
    assert.equal(parsed.hunks.length, 3);
    const patch = buildHunkPatch("f.txt", hunkToPatch(parsed.hunks[1]));
    execFileSync("git", ["-c", "core.autocrlf=false", "apply", "-R", "--recount", "--whitespace=nowarn", "-"], { cwd: dir, input: patch });
    const after = readFileSync(join(dir, "f.txt"), "utf8").split("\n");
    assert.equal(after[2], "three");
    assert.equal(after[19], "20");
    assert.equal(after[20], "21");
    assert.equal(after[37], "thirtyeight");
    // Applying the same hunk again must fail loudly (the client would see git's message).
    assert.throws(() => execFileSync("git", ["apply", "-R", "--recount", "-"], { cwd: dir, input: patch, stdio: "pipe" }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
