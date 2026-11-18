import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changesSh, parseChanges, readDiffSh, discardFileSh, discardHunkSh, buildHunkPatch, fullDiffSh } from "../src/changes.ts";

/**
 * The change scan against a real workspace on disk: a repo at the top (as a run starts with), a
 * repo the agent cloned itself under `.work/` (as in the bug: its 90 files all showed as "new"),
 * loose files beside both. The box's own `sh` runs it here — skipped when no POSIX sh or git is
 * on PATH (Git Bash on Windows provides both).
 */
function haveTools(): boolean {
  try {
    execFileSync("sh", ["-c", "command -v git find sed wc >/dev/null"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "asb-changes-")).replace(/\\/g, "/");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" });
  const initRepo = (p: string, files: Record<string, string>) => {
    mkdirSync(p, { recursive: true });
    git(p, "init", "-q", ".");
    git(p, "config", "user.email", "t@t");
    git(p, "config", "user.name", "t");
    git(p, "config", "core.autocrlf", "false");
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(join(p, f, ".."), { recursive: true });
      writeFileSync(join(p, f), body);
    }
    git(p, "add", "-A");
    git(p, "commit", "-qm", "init");
  };
  // The run's own repo.
  initRepo(join(dir, "app"), { "src/a.ts": "one\ntwo\nthree\n", "README.md": "hi\n" });
  writeFileSync(join(dir, "app/src/a.ts"), "one\n2\nthree\n");
  writeFileSync(join(dir, "app/src/new.ts"), "x\ny\n");
  // A clone the agent made under a scratch folder: 3 committed files, one of them edited.
  initRepo(join(dir, ".work/clone"), { "server.js": "a\nb\nc\nd\n", "package.json": "{}\n", "lib/util.js": "u\n" });
  writeFileSync(join(dir, ".work/clone/server.js"), "a\nB\nc\nd\n");
  // Loose files: beside the clone, and at the top.
  writeFileSync(join(dir, ".work/notes.md"), "n1\nn2\nn3\n");
  writeFileSync(join(dir, "report.md"), "r\n");
  writeFileSync(join(dir, ".agent.log"), "ignored\n");
  // The controller's own folder in the workspace (setup sentinel, install logs): never a change.
  mkdirSync(join(dir, ".asb"), { recursive: true });
  writeFileSync(join(dir, ".asb/setup.json"), "{}\n");
  mkdirSync(join(dir, "node_modules/x"), { recursive: true });
  writeFileSync(join(dir, "node_modules/x/index.js"), "nope\n");
  return dir;
}

const sh = (script: string, input?: string) => execFileSync("sh", ["-c", script], { encoding: "utf8", ...(input !== undefined ? { input } : {}) });

test("changesSh: a clone the agent made under .work is a repo (its git diff), not 90 new files", (t) => {
  if (!haveTools()) return t.skip("sh/git not available");
  const dir = makeWorkspace();
  try {
    const files = parseChanges(sh(changesSh(dir)));
    assert.deepEqual(
      files.map((f) => [f.path, f.status, f.additions, f.deletions, f.repo]),
      [
        [".work/clone/server.js", "modified", 1, 1, ".work/clone"],
        [".work/notes.md", "added", 3, 0, undefined],
        ["app/src/a.ts", "modified", 1, 1, "app"],
        ["app/src/new.ts", "untracked", 2, 0, "app"],
        ["report.md", "added", 1, 0, undefined],
      ]
    );
    // The full diff names the nested repo's files workspace-relative too.
    const full = sh(fullDiffSh(dir));
    assert.match(full, /@@repo \.work\/clone/);
    assert.match(full, /@@repo app/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readDiffSh / discardFileSh / discardHunkSh resolve the owning repo at any depth", (t) => {
  if (!haveTools()) return t.skip("sh/git not available");
  const dir = makeWorkspace();
  try {
    // Diff of a file in the nested clone, with its HEAD original.
    const out = sh(readDiffSh(".work/clone/server.js", dir));
    assert.match(out, /^-b$/m);
    assert.match(out, /^\+B$/m);
    assert.match(out, /\n@@ORIGINAL\na\nb\nc\nd\n/);
    // A loose file beside it is "untracked".
    assert.match(sh(readDiffSh(".work/notes.md", dir)), /^@@UNTRACKED/);
    // One hunk reverted through the clone's git: the patch is workspace-relative, -p strips the
    // repo directories (.work/clone → a/ + 2 components).
    const hunk = "@@ -1,4 +1,4 @@\n a\n-b\n+B\n c\n d\n";
    const patch = Buffer.from(buildHunkPatch(".work/clone/server.js", hunk), "utf8").toString("base64");
    const h = sh(discardHunkSh(".work/clone/server.js", dir), patch);
    assert.match(h, /@@DISCARDED/);
    assert.equal(readFileSync(join(dir, ".work/clone/server.js"), "utf8"), "a\nb\nc\nd\n");
    // Whole-file revert in the top repo, and delete of an untracked one.
    assert.match(sh(discardFileSh("app/src/a.ts", dir)), /@@DISCARDED/);
    assert.equal(readFileSync(join(dir, "app/src/a.ts"), "utf8"), "one\ntwo\nthree\n");
    assert.match(sh(discardFileSh("app/src/new.ts", dir)), /@@DISCARDED/);
    assert.equal(existsSync(join(dir, "app/src/new.ts")), false);
    // A loose file outside every repo is simply deleted.
    assert.match(sh(discardFileSh("report.md", dir)), /@@DISCARDED/);
    assert.equal(existsSync(join(dir, "report.md")), false);
    assert.deepEqual(
      parseChanges(sh(changesSh(dir))).map((f) => f.path),
      [".work/notes.md"]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
