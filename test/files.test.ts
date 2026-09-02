import { test } from "node:test";
import assert from "node:assert/strict";
import { matchFiles, parseFileList, makeFileIndex, fileListCommand, fileDetailsCommand, parseFileDetails } from "../src/files.ts";
const await_import = { fileDetailsCommand, parseFileDetails };

test("parseFileList drops blanks and sentinels", () => {
  assert.deepEqual(parseFileList("src/a.ts\n\n.agent.question\nREADME.md\n"), ["src/a.ts", "README.md"]);
});

test("matchFiles ranks basename prefix > basename substring > path substring > fuzzy", () => {
  const paths = ["src/util/StampUtility.js", "src/stamp/index.ts", "docs/notes-on-stamps.md", "src/s/t/a/m/p.ts", "x.ts"];
  assert.deepEqual(matchFiles(paths, "stamp"), [
    "src/stamp/index.ts", // path substring… wait: basename "index.ts" has no 'stamp'; path does
    "src/util/StampUtility.js",
    "docs/notes-on-stamps.md",
    "src/s/t/a/m/p.ts",
  ].sort((a, b) => rank(a) - rank(b)));
  function rank(p: string) {
    const lower = p.toLowerCase();
    const base = lower.slice(lower.lastIndexOf("/") + 1);
    return (base.startsWith("stamp") ? 0 : base.includes("stamp") ? 1 : lower.includes("stamp") ? 2 : 3) * 10000 + p.length;
  }
  assert.equal(matchFiles(paths, "stamp")[0], "src/util/StampUtility.js");
  assert.equal(matchFiles(paths, "").length, 5, "empty query lists everything (capped)");
  assert.deepEqual(matchFiles(paths, "zzz"), []);
});

test("makeFileIndex caches per box within ttl and dedupes concurrent reads", async () => {
  let calls = 0;
  let t = 0;
  const idx = makeFileIndex(
    async () => {
      calls++;
      return "a.ts\nb/c.ts\n";
    },
    { ttlMs: 1000, now: () => t }
  );
  const [r1, r2] = await Promise.all([idx("box", ""), idx("box", "c")]);
  assert.equal(calls, 1);
  assert.equal(r1.total, 2);
  assert.deepEqual(r2.files, ["b/c.ts"]);
  t = 2000;
  await idx("box", "");
  assert.equal(calls, 2, "re-indexed after ttl");
  assert.match(fileListCommand(), /node_modules/);
});

test("fileDetailsCommand keeps the exclusions and prints size/mtime/relative path", () => {
  const { fileDetailsCommand } = await_import;
  const cmd = fileDetailsCommand();
  assert.match(cmd, /node_modules/);
  assert.ok(cmd.includes("-printf '%s\\t%T@\\t%P\\n'"));
  // printf must come AFTER the last exclusion so it only fires on kept files.
  assert.ok(cmd.lastIndexOf("-not") < cmd.indexOf("-printf"));
});

test("parseFileDetails reads size, mtime and path; skips malformed lines and sentinels", () => {
  const { parseFileDetails } = await_import;
  const out = "1024\t1788350000.123\tsrc/app.ts\nbadline\n99\t1788350001\t.agent.question\n0\t1788350002\tREADME.md\n";
  assert.deepEqual(parseFileDetails(out), [
    { path: "src/app.ts", bytes: 1024, mtime: 1788350000 },
    { path: "README.md", bytes: 0, mtime: 1788350002 },
  ]);
});
