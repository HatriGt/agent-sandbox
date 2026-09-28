import { test } from "node:test";
import assert from "node:assert/strict";
import { toSkillName, listRepoSkills, fetchRepoFile, fetchRepoSkillDir } from "../src/github-skills.js";

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
