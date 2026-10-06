import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCodeRef, pathResolver, symbolRefs } from "../web/src/lib/code-refs.ts";

test("parseCodeRef accepts paths with optional line or range", () => {
  assert.deepEqual(parseCodeRef("web/src/lib/viz.ts"), { path: "web/src/lib/viz.ts" });
  assert.deepEqual(parseCodeRef("viz.ts:42"), { path: "viz.ts", line: 42 });
  assert.deepEqual(parseCodeRef("src/x.ts:10-20"), { path: "src/x.ts", line: 10, endLine: 20 });
  assert.deepEqual(parseCodeRef("src/x.ts#L42"), { path: "src/x.ts", line: 42 });
  assert.deepEqual(parseCodeRef("src/x.ts#L10-L20"), { path: "src/x.ts", line: 10, endLine: 20 });
  assert.deepEqual(parseCodeRef("src/x.ts:7:3"), { path: "src/x.ts", line: 7 });
  assert.deepEqual(parseCodeRef("./Makefile"), null); // bare word, even with ./
  assert.deepEqual(parseCodeRef("src/Makefile"), { path: "src/Makefile" });
  assert.deepEqual(parseCodeRef("/workspace/app/main.py:3"), { path: "app/main.py", line: 3 });
  assert.deepEqual(parseCodeRef("src/x.ts:20-10"), { path: "src/x.ts", line: 20 });
});

test("parseCodeRef rejects look-alikes", () => {
  for (const s of ["https://example.com/a.ts", "mailto:a@b.c", "npm run build", "foo", "README", "1.2.3", "v2.0.1", "3.14", "a/../b.ts", "x.ts:abc", "", "foo()", "/abs/path.ts", "a b/c.ts"]) {
    assert.equal(parseCodeRef(s), null, s);
  }
});

test("symbolRefs binds names from links and `name` (`path:line`) / `name` in `path:line`", () => {
  const md = [
    "The parser is [parseDag](web/src/lib/viz-extra.ts:515).",
    "Then `renderFlow` (`web/src/components/viz/Flow.tsx:40`) draws it, and `layout` in `src/layout.ts:9-12`.",
    "Later `parseDag` is called again; `[x](https://a.b/c.ts)` is a URL.",
    "[parseDag](other.ts:1) rebinding is ignored.",
  ].join("\n");
  const m = symbolRefs(md);
  assert.deepEqual(m.get("parseDag"), { path: "web/src/lib/viz-extra.ts", line: 515 });
  assert.deepEqual(m.get("renderFlow"), { path: "web/src/components/viz/Flow.tsx", line: 40 });
  assert.deepEqual(m.get("layout"), { path: "src/layout.ts", line: 9, endLine: 12 });
  assert.equal(m.has("x"), false);
});

test("symbolRefs ignores names that are themselves paths or prose", () => {
  const m = symbolRefs("[see here](src/a.ts:1) and [src/b.ts](src/b.ts:2)");
  assert.equal(m.size, 0);
});

test("pathResolver: exact, unique suffix, ambiguous and missing", () => {
  const r = pathResolver(["repo/web/src/lib/viz.ts", "repo/web/src/components/viz/index.ts", "repo/src/index.ts", "repo/README.md"]);
  assert.equal(r("repo/README.md"), "repo/README.md");
  assert.equal(r("viz.ts"), "repo/web/src/lib/viz.ts");
  assert.equal(r("lib/viz.ts"), "repo/web/src/lib/viz.ts");
  assert.equal(r("index.ts"), null); // two matches → no link
  assert.equal(r("viz/index.ts"), "repo/web/src/components/viz/index.ts");
  assert.equal(r("iz.ts"), null); // suffix must start at a segment boundary
  assert.equal(r("nope.ts"), null);
});
