/**
 * Where a resume runs `claude -c`.
 *
 * `claude -c` continues the most recent session **in the current directory**. If a resume lands in a
 * different cwd than the first run used, Claude finds no session there and silently starts a fresh
 * one — the agent loses the whole conversation and answers a follow-up with "which PR did you mean?".
 * That is exactly what happened on a live single-repo box: the first run used /workspace/<repo> (the
 * plan carried the layout) while every resume path passed `repos: undefined` and got /workspace.
 *
 * So the rule under test: the cwd a resume computes from the box's own /workspace listing must equal
 * the cwd the first run computed from the plan's layout, for the same set of repos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WORKSPACE_DIRS_SH, workdirFromWorkspaceListing } from "../src/msb.ts";

test("a single-repo box resumes in the repo dir, not /workspace", () => {
  // The regression: this returned "/workspace", so `claude -c` started a new session every follow-up.
  assert.equal(workdirFromWorkspaceListing("atom-deal-service\n"), "/workspace/atom-deal-service");
});

test("a multi-repo box resumes in /workspace (the shared parent, as the first run used)", () => {
  assert.equal(workdirFromWorkspaceListing("api\nweb\n"), "/workspace");
});

test("a bare box resumes in /workspace", () => {
  // An unmatched glob comes back literally as `*`; treating it as a repo would cd into a dir that
  // does not exist and fail the exec outright.
  assert.equal(workdirFromWorkspaceListing("*\n"), "/workspace");
  assert.equal(workdirFromWorkspaceListing(""), "/workspace");
  assert.equal(workdirFromWorkspaceListing("\n  \n"), "/workspace");
});

test("listing noise (blank lines, stray whitespace) does not change the resume cwd", () => {
  // One repo plus shell noise must still be recognised as the single-repo case, or the fix silently
  // degrades back to /workspace on some boxes.
  assert.equal(workdirFromWorkspaceListing("\n  atom-deal-service  \n\n"), "/workspace/atom-deal-service");
});

test("the listing command asks for basenames of directories only", () => {
  // Files under /workspace (the .agent.* sentinels live there) must not be mistaken for repos: the
  // trailing slash in the glob is what excludes them, so pin it.
  assert.match(WORKSPACE_DIRS_SH, /\/workspace\/\*\//);
  assert.match(WORKSPACE_DIRS_SH, /basename/);
});
