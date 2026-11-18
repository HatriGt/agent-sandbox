import { test } from "node:test";
import assert from "node:assert/strict";
import { toSkillName, listRepoSkills, fetchRepoFile, fetchRepoSkillDir, gitBlobSha, upstreamFingerprint, checkSkillSources, fetchSkillUpdate } from "../src/github-skills.js";
import type { SkillDef, SkillSource } from "../src/skill-store.js";

/** Run fn with global fetch stubbed: handler(url, headers) -> JSON-serialisable body. */
async function withFetch<T>(handler: (url: string, headers: Record<string, string>) => unknown, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = handler(String(input), (init?.headers ?? {}) as Record<string, string>);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const TREE = {
  tree: [
    { path: "library/skills/sap/create-deal/SKILL.md", type: "blob", sha: "s1", size: 10 },
    { path: "library/skills/sap/create-deal/scripts/run.mjs", type: "blob", sha: "s2", size: 20 },
    { path: "library/skills/sap/create-deal/docs/api.md", type: "blob", sha: "s3", size: 30 },
    { path: "library/skills/sap/solo/SKILL.md", type: "blob", sha: "s4", size: 5 },
    { path: "skills/loose-note.md", type: "blob", sha: "s5", size: 7 },
    { path: "skills/README.md", type: "blob", sha: "s6", size: 7 },
  ],
};

/**
 * The proxy's guard rails. These reject BEFORE any network call, so the assertions below are
 * offline — the point is that a malformed owner/repo/path never reaches GitHub with our IP on it.
 */

test("toSkillName slugifies folders and filenames", () => {
  assert.equal(toSkillName("frontend-design"), "frontend-design");
  assert.equal(toSkillName("Frontend Design.md"), "frontend-design");
  assert.equal(toSkillName("PDF_Processing.SKILL.md"), "pdf-processing");
  assert.equal(toSkillName("!!!"), "imported-skill");
});

test("listRepoSkills rejects a malformed owner or repo before fetching", async () => {
  await assert.rejects(() => listRepoSkills("anthropics", "sk ills"), /owner\/repo/);
  await assert.rejects(() => listRepoSkills("../etc", "skills"), /owner\/repo/);
  await assert.rejects(() => listRepoSkills("anthropics", "skills", "a branch"), /branch/i);
});

test("fetchRepoFile rejects traversal and non-markdown paths", async () => {
  const ok = ["anthropics", "skills", "main"] as const;
  await assert.rejects(() => fetchRepoFile(...ok, "../../etc/passwd.md"), /Invalid file path/);
  await assert.rejects(() => fetchRepoFile(...ok, "/etc/passwd.md"), /Invalid file path/);
  await assert.rejects(() => fetchRepoFile(...ok, "skills/x/run.sh"), /markdown/);
});

test("listRepoSkills groups skill folders (with counts and bytes) and keeps unclaimed loose markdown", async () => {
  const r = await withFetch(
    (url) => (url.includes("/git/trees/") ? TREE : { default_branch: "main" }),
    () => listRepoSkills("o", "r")
  );
  assert.equal(r.branch, "main");
  const byName = Object.fromEntries(r.entries.map((e) => [e.name, e]));
  assert.equal(byName["create-deal"].kind, "dir");
  assert.equal(byName["create-deal"].fileCount, 3);
  assert.equal(byName["create-deal"].totalBytes, 60);
  assert.equal(byName["solo"].fileCount, 1);
  assert.equal(byName["loose-note"].kind, "file");
  assert.equal(r.entries.some((e) => /readme/i.test(e.path)), false);
});

test("listRepoSkills sends the token as a bearer header; anonymous sends none", async () => {
  const seen: (string | undefined)[] = [];
  await withFetch(
    (url, headers) => {
      seen.push((headers as Record<string, string>).Authorization);
      return url.includes("/git/trees/") ? TREE : { default_branch: "main" };
    },
    () => listRepoSkills("o", "r", undefined, undefined, "tok123")
  );
  assert.ok(seen.every((h) => h === "Bearer tok123"));
  seen.length = 0;
  await withFetch(
    (url, headers) => {
      seen.push((headers as Record<string, string>).Authorization);
      return url.includes("/git/trees/") ? TREE : { default_branch: "main" };
    },
    () => listRepoSkills("o", "r")
  );
  assert.ok(seen.every((h) => h === undefined));
});

test("listRepoSkills surfaces a truncated tree as a 'narrow the URL' error", async () => {
  await assert.rejects(
    () =>
      withFetch(
        (url) => (url.includes("/git/trees/") ? { tree: [], truncated: true } : { default_branch: "main" }),
        () => listRepoSkills("o", "r")
      ),
    /too large to list/
  );
});

test("fetchRepoSkillDir returns SKILL.md + decoded blobs with dir-relative paths", async () => {
  const r = await withFetch(
    (url) => {
      if (url.includes("/git/trees/")) return TREE;
      if (url.includes("/git/blobs/s1")) return { content: Buffer.from("---\nname: create-deal\n---\nbody").toString("base64"), encoding: "base64" };
      if (url.includes("/git/blobs/s2")) return { content: Buffer.from("console.log(1)").toString("base64"), encoding: "base64" };
      if (url.includes("/git/blobs/s3")) return { content: Buffer.from("# api").toString("base64"), encoding: "base64" };
      return { default_branch: "main" };
    },
    () => fetchRepoSkillDir("o", "r", "main", "library/skills/sap/create-deal")
  );
  assert.match(r.skillMd, /^---\nname: create-deal/);
  assert.deepEqual(r.files.map((f) => f.path), ["docs/api.md", "scripts/run.mjs"]);
  assert.equal(r.files[1].content, "console.log(1)");
  assert.deepEqual(r.skipped, []);
});

test("fetchRepoSkillDir demands a SKILL.md in the folder", async () => {
  await assert.rejects(
    () =>
      withFetch(
        (url) => (url.includes("/git/trees/") ? TREE : { default_branch: "main" }),
        () => fetchRepoSkillDir("o", "r", "main", "skills")
      ),
    /No SKILL\.md/
  );
});

/* ───────────────────────────── provenance + updates ───────────────────────────── */

const DEAL_DIR = "library/skills/sap/create-deal";
const dealBlobs = (url: string) => {
  if (url.includes("/git/blobs/s1")) return { content: Buffer.from("---\nname: create-deal\ndescription: Use for deals.\n---\nbody v1").toString("base64"), encoding: "base64" };
  if (url.includes("/git/blobs/s2x")) return { content: Buffer.from("console.log(2)").toString("base64"), encoding: "base64" };
  if (url.includes("/git/blobs/s2")) return { content: Buffer.from("console.log(1)").toString("base64"), encoding: "base64" };
  if (url.includes("/git/blobs/s3")) return { content: Buffer.from("# api").toString("base64"), encoding: "base64" };
  return null;
};
/** TREE with the script's blob changed upstream — what a new commit to the skill folder looks like. */
const TREE_V2 = { tree: TREE.tree.map((t) => (t.sha === "s2" ? { ...t, sha: "s2x" } : t)) };

test("gitBlobSha matches git's blob hash", () => {
  assert.equal(gitBlobSha("hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a");
});

test("upstreamFingerprint: a folder digest moves when any file inside changes; a file is its blob sha; gone is null", () => {
  const dir = { path: DEAL_DIR, entry: "dir" as const };
  const v1 = upstreamFingerprint(TREE.tree, dir);
  const v2 = upstreamFingerprint(TREE_V2.tree, dir);
  assert.ok(v1 && v2 && v1 !== v2);
  assert.equal(upstreamFingerprint(TREE.tree, dir), v1);
  assert.equal(upstreamFingerprint(TREE.tree, { path: "skills/loose-note.md", entry: "file" }), "s5");
  assert.equal(upstreamFingerprint(TREE.tree, { path: "skills", entry: "dir" }), null, "no SKILL.md under skills/");
  assert.equal(upstreamFingerprint(TREE.tree, { path: "nope.md", entry: "file" }), null);
});

test("fetchRepoSkillDir records where the import came from, with the folder's fingerprint", async () => {
  const r = await withFetch(
    (url) => (url.includes("/git/trees/") ? TREE : (dealBlobs(url) ?? { default_branch: "main" })),
    () => fetchRepoSkillDir("o", "r", "main", DEAL_DIR)
  );
  assert.equal(r.source.kind, "github");
  assert.deepEqual([r.source.owner, r.source.repo, r.source.branch, r.source.path, r.source.entry], ["o", "r", "main", DEAL_DIR, "dir"]);
  assert.equal(r.source.fingerprint, upstreamFingerprint(TREE.tree, { path: DEAL_DIR, entry: "dir" }));
});

const imported = (name: string, source: Partial<SkillSource>): SkillDef => ({
  name,
  description: "d",
  content: "c",
  enabled: true,
  addedAt: 1,
  updatedAt: 1,
  source: { kind: "github", owner: "o", repo: "r", branch: "main", path: DEAL_DIR, entry: "dir", fingerprint: upstreamFingerprint(TREE.tree, { path: DEAL_DIR, entry: "dir" })!, importedAt: 1, ...source },
});

test("checkSkillSources reads one tree per repository and reports which skills moved on", async () => {
  const trees: string[] = [];
  const skills = [
    imported("create-deal", {}),
    imported("solo", { path: "library/skills/sap/solo", fingerprint: upstreamFingerprint(TREE_V2.tree, { path: "library/skills/sap/solo", entry: "dir" })! }),
    imported("gone", { path: "skills/vanished.md", entry: "file", fingerprint: "s9" }),
    { ...imported("local", {}), source: undefined },
  ];
  const r = await withFetch(
    (url) => {
      if (url.includes("/git/trees/")) trees.push(url);
      return url.includes("/git/trees/") ? TREE_V2 : { default_branch: "main" };
    },
    () => checkSkillSources(skills, async () => undefined)
  );
  assert.equal(trees.length, 1, "three imported skills from one repository: one tree read");
  assert.equal(r["create-deal"].available, true);
  assert.equal(r["solo"].available, false, "unchanged upstream");
  assert.deepEqual(r["gone"], { available: false, latest: null });
  assert.equal("local" in r, false, "a skill without a source is not checked");
});

test("fetchSkillUpdate: null when the repository still holds the imported version, the parsed new version otherwise", async () => {
  const same = await withFetch(
    (url) => (url.includes("/git/trees/") ? TREE : (dealBlobs(url) ?? { default_branch: "main" })),
    () => fetchSkillUpdate(imported("create-deal", {}).source!)
  );
  assert.equal(same, null);
  const next = await withFetch(
    (url) => (url.includes("/git/trees/") ? TREE_V2 : (dealBlobs(url) ?? { default_branch: "main" })),
    () => fetchSkillUpdate(imported("create-deal", {}).source!)
  );
  assert.ok(next);
  assert.equal(next.description, "Use for deals.");
  assert.equal(next.content, "body v1");
  assert.equal(next.files.find((f) => f.path === "scripts/run.mjs")?.content, "console.log(2)");
  assert.equal(next.source.fingerprint, upstreamFingerprint(TREE_V2.tree, { path: DEAL_DIR, entry: "dir" }));
  assert.notEqual(next.source.fingerprint, imported("create-deal", {}).source!.fingerprint);
});

test("fetchSkillUpdate says so when the skill folder left the repository", async () => {
  await assert.rejects(
    () =>
      withFetch(
        (url) => (url.includes("/git/trees/") ? { tree: [] } : { default_branch: "main" }),
        () => fetchSkillUpdate(imported("create-deal", {}).source!)
      ),
    /no longer in o\/r on main/
  );
});
