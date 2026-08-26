import { test } from "node:test";
import assert from "node:assert/strict";
import { matchFiles, parseFileList, makeFileIndex, fileListCommand } from "../src/files.ts";

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
