import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiff, diffForNewFile } from "../web/src/lib/diff.ts";

test("parseUnifiedDiff: hunks, line numbers, counts", () => {
  const d = parseUnifiedDiff(
    [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1..2 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10,3 +10,4 @@ function retry() {",
      " const a = 1;",
      "-const b = Date.now();",
      "+const b = clock.now();",
      "+const c = 2;",
      " return a;",
      "\\ No newline at end of file",
    ].join("\n")
  );
  assert.equal(d.hunks.length, 1);
  assert.equal(d.hunks[0].header, "function retry() {");
  assert.deepEqual([d.additions, d.deletions, d.binary], [2, 1, false]);
  assert.deepEqual(
    d.hunks[0].lines.map((l) => [l.kind, l.oldNo, l.newNo]),
    [
      ["context", 10, 10],
      ["del", 11, undefined],
      ["add", undefined, 11],
      ["add", undefined, 12],
      ["context", 12, 13],
      ["meta", undefined, undefined],
    ]
  );
  assert.equal(parseUnifiedDiff("Binary files a/x.png and b/x.png differ").binary, true);
  assert.equal(parseUnifiedDiff("").hunks.length, 0);
});

test("diffForNewFile renders every line as added", () => {
  const d = diffForNewFile("a\nb\n");
  assert.deepEqual([d.additions, d.deletions], [2, 0]);
  assert.deepEqual(d.hunks[0].lines.map((l) => [l.kind, l.newNo, l.text]), [["add", 1, "a"], ["add", 2, "b"]]);
});
