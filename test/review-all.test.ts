/** WS2b UI — splitting the archived multi-file diff into per-file sections for the Review panel. */
import test from "node:test";
import assert from "node:assert/strict";
import { splitUnifiedDiff } from "../web/src/lib/diff.ts";

const SAMPLE = [
  "diff --git a/app/src/x.ts b/app/src/x.ts",
  "--- a/app/src/x.ts",
  "+++ b/app/src/x.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "diff --git a/lib/y.md b/lib/y.md",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/lib/y.md",
  "@@ -0,0 +1 @@",
  "+hello",
].join("\n");

test("splitUnifiedDiff yields one section per file with parsed hunks", () => {
  const files = splitUnifiedDiff(SAMPLE);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, "app/src/x.ts");
  assert.equal(files[1].path, "lib/y.md");
  assert.equal(files[0].diff.hunks.length, 1);
  assert.ok(files[0].diff.hunks[0].lines.some((l) => l.kind === "add" && l.text === "new"));
  assert.ok(files[1].diff.hunks[0].lines.some((l) => l.kind === "add" && l.text === "hello"));
});

test("splitUnifiedDiff of empty or garbage input is empty", () => {
  assert.deepEqual(splitUnifiedDiff(""), []);
  assert.deepEqual(splitUnifiedDiff("not a diff at all"), []);
});
