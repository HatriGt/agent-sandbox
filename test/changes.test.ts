import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChanges, safeRelPath, shapePull } from "../src/changes.ts";

test("parseChanges: numstat + status + untracked per repo, loose files outside repos", () => {
  const out = [
    "@@repo queue-service",
    "42\t0\tsrc/logo.tsx",
    "258\t134\tsrc/Hub.tsx",
    "-\t-\tassets/icon.png",
    "@@status M\tsrc/logo.tsx",
    "@@status M\tsrc/Hub.tsx",
    "@@status D\tassets/icon.png",
    "@@untracked 12 src/new.ts",
    "@@repo shared-types",
    "@@loose",
    "@@loosefile 40 report.md",
  ].join("\n");
  const files = parseChanges(out);
  assert.deepEqual(
    files.map((f) => [f.path, f.status, f.additions, f.deletions, f.repo]),
    [
      ["queue-service/assets/icon.png", "deleted", 0, 0, "queue-service"],
      ["queue-service/src/Hub.tsx", "modified", 258, 134, "queue-service"],
      ["queue-service/src/logo.tsx", "modified", 42, 0, "queue-service"],
      ["queue-service/src/new.ts", "untracked", 12, 0, "queue-service"],
      ["report.md", "added", 40, 0, undefined],
    ]
  );
  assert.deepEqual(parseChanges(""), []);
});

test("safeRelPath confines to /workspace", () => {
  assert.equal(safeRelPath("/workspace/repo/src/a.ts"), "repo/src/a.ts");
  assert.equal(safeRelPath("repo/a.ts"), "repo/a.ts");
  assert.throws(() => safeRelPath("/workspace/../etc/passwd"));
  assert.throws(() => safeRelPath("repo/./x"));
  assert.throws(() => safeRelPath(""));
});

test("shapePull maps GitHub states", () => {
  const base = { title: "Fix retry", additions: 42, deletions: 12, changed_files: 3, head: { ref: "fix/retry" }, base: { ref: "main" }, user: { login: "hatrigt" }, html_url: "https://github.com/a/b/pull/1" };
  assert.equal(shapePull("a/b", 1, { ...base, state: "open" }).state, "open");
  assert.equal(shapePull("a/b", 1, { ...base, state: "open", draft: true }).state, "draft");
  assert.equal(shapePull("a/b", 1, { ...base, state: "closed", merged_at: "2026-01-01" }).state, "merged");
  assert.equal(shapePull("a/b", 1, { ...base, state: "closed" }).state, "closed");
  const p = shapePull("a/b", 1, { ...base, state: "open" });
  assert.deepEqual([p.head, p.base, p.author, p.changedFiles], ["fix/retry", "main", "hatrigt", 3]);
});
