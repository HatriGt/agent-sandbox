import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchFiles,
  parseFileList,
  makeFileIndex,
  fileListCommand,
  fileDetailsCommand,
  parseFileDetails,
  searchCommand,
  parseSearchOutput,
  searchExitStatus,
  searchStderr,
  EXCLUDED_DIRS,
  EXCLUDED_NAMES,
  SEARCH_LINE_CAP,
} from "../src/files.ts";
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

test("the index and the search exclude the same trees and names", () => {
  for (const cmd of [fileListCommand(), fileDetailsCommand()]) {
    for (const d of EXCLUDED_DIRS) assert.ok(cmd.includes(`-not -path '*/${d}/*'`), `${d} in find`);
    for (const n of EXCLUDED_NAMES) assert.ok(cmd.includes(`-not -name '${n}'`), `${n} in find`);
  }
  const grep = searchCommand({ regex: false, caseSensitive: false });
  for (const d of EXCLUDED_DIRS) assert.ok(grep.includes(`--exclude-dir='${d}'`), `${d} in grep`);
  for (const n of EXCLUDED_NAMES) assert.ok(grep.includes(`--exclude='${n}'`), `${n} in grep`);
});

test("searchCommand reads the pattern from stdin and sets only the asked-for flags", () => {
  const literal = searchCommand({ regex: false, caseSensitive: false });
  assert.match(literal, /grep -rnIZ --color=never -i -F /);
  assert.match(literal, / -f - \./, "pattern on stdin, never in argv");
  assert.match(literal, new RegExp(`head -n ${SEARCH_LINE_CAP + 1}$`), "one line past the cap tells truncation");
  const regex = searchCommand({ regex: true, caseSensitive: true });
  assert.match(regex, /grep -rnIZ --color=never -E /);
  assert.doesNotMatch(regex, / -i /);
  assert.doesNotMatch(regex, / -F /);
});

test("parseSearchOutput reads NUL-separated hits, strips ./ and copes with ':' in a path", () => {
  const out = "./src/a.ts\0" + "12:const x = 1\n" + "./notes/a:b.md\0" + "3:see http://x\n" + "noise without a separator\n" + "./win.txt\0" + "7:crlf line\r\n";
  assert.deepEqual(parseSearchOutput(out), {
    matches: [
      { path: "src/a.ts", line: 12, text: "const x = 1" },
      { path: "notes/a:b.md", line: 3, text: "see http://x" },
      { path: "win.txt", line: 7, text: "crlf line" },
    ],
    truncated: false,
  });
  assert.deepEqual(parseSearchOutput(""), { matches: [], truncated: false });
});

test("parseSearchOutput caps at SEARCH_LINE_CAP and reports the cut", () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `./f.ts\0${i + 1}:x`).join("\n") + "\n";
  const exact = parseSearchOutput(lines(SEARCH_LINE_CAP));
  assert.equal(exact.matches.length, SEARCH_LINE_CAP);
  assert.equal(exact.truncated, false);
  const over = parseSearchOutput(lines(SEARCH_LINE_CAP + 1));
  assert.equal(over.matches.length, SEARCH_LINE_CAP);
  assert.equal(over.truncated, true);
});

test("grep's status and message come back from stderr", () => {
  assert.equal(searchExitStatus("grep: Unmatched ( or \\(\n__GREP_EXIT=2\n"), 2);
  assert.equal(searchStderr("grep: Unmatched ( or \\(\n__GREP_EXIT=2\n"), "grep: Unmatched ( or \\(");
  assert.equal(searchExitStatus("__GREP_EXIT=1\n"), 1);
  assert.equal(searchExitStatus(""), null);
});

test("fileIndex.invalidate drops the cached listing and ignores a find that was already running", async () => {
  const pending: Array<(s: string) => void> = [];
  const idx = makeFileIndex(() => new Promise<string>((resolve) => pending.push(resolve)), { ttlMs: 60_000 });
  const first = idx("box", "");
  idx.invalidate("box");
  const second = idx("box", "");
  assert.equal(pending.length, 2, "the read after invalidate runs its own find");
  pending[0]("old.ts\n");
  pending[1]("new.ts\n");
  assert.deepEqual((await first).files, ["old.ts"]);
  assert.deepEqual((await second).files, ["new.ts"]);
  assert.deepEqual((await idx("box", "")).files, ["new.ts"], "the stale find did not overwrite the cache");
  assert.equal(pending.length, 2);
});
