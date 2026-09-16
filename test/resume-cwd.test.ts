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
 *
 * Second live incident, same symptom: the listing is a proxy for "where the first run ran", and the
 * proxy broke when attach_repo added a second repo mid-thread — the listing flipped from one name to
 * two, the derived cwd flipped from /workspace/<repo> to /workspace, and the next follow-up resumed
 * as a fresh session. Hence WORKDIR_MARK: the first run persists its actual cwd, and the probe
 * prefers it over the listing. The listing remains the fallback for boxes bootstrapped before the mark.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WORKSPACE_DIRS_SH, WORKDIR_PROBE_SH, workdirFromWorkspaceListing, workdirFromProbe } from "../src/msb.ts";

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

test("a persisted workdir mark wins over the live repo listing", () => {
  // The attach_repo regression: first run in /workspace/elseco-deal-service, then a second repo is
  // attached. The listing now says two repos (→ /workspace), but the session lives where the mark says.
  assert.equal(
    workdirFromProbe("/workspace/elseco-deal-service\n---\natom-deal-service\nelseco-deal-service\n"),
    "/workspace/elseco-deal-service"
  );
  // A marked multi-repo box resumes in /workspace even if repos were later removed from the listing.
  assert.equal(workdirFromProbe("/workspace\n---\napi\n"), "/workspace");
});

test("a box without the mark (older controller) falls back to the listing rule", () => {
  assert.equal(workdirFromProbe("---\natom-deal-service\n"), "/workspace/atom-deal-service");
  assert.equal(workdirFromProbe("---\napi\nweb\n"), "/workspace");
  assert.equal(workdirFromProbe("---\n*\n"), "/workspace");
  assert.equal(workdirFromProbe("---\n"), "/workspace");
});

test("a corrupt or non-/workspace mark is ignored, not trusted as a cwd", () => {
  // cd'ing into garbage would fail the exec and eat the user's message; the listing rule is safer.
  assert.equal(workdirFromProbe("cat: error\n---\natom-deal-service\n"), "/workspace/atom-deal-service");
  assert.equal(workdirFromProbe("/etc\n---\napi\nweb\n"), "/workspace");
  assert.equal(workdirFromProbe("/workspace/a/b\n---\napi\n"), "/workspace/api");
});

test("the probe reads the mark and the listing in one exec", () => {
  // One round-trip: mark first, `---` separator, then the listing. Splitting them into two execs
  // would let the mark and the listing describe different moments of the same box.
  assert.match(WORKDIR_PROBE_SH, /\.agent\.workdir/);
  assert.match(WORKDIR_PROBE_SH, /---/);
  assert.ok(WORKDIR_PROBE_SH.includes(WORKSPACE_DIRS_SH));
});

test("the listing command asks for basenames of directories only", () => {
  // Files under /workspace (the .agent.* sentinels live there) must not be mistaken for repos: the
  // trailing slash in the glob is what excludes them, so pin it.
  assert.match(WORKSPACE_DIRS_SH, /\/workspace\/\*\//);
  assert.match(WORKSPACE_DIRS_SH, /basename/);
});
