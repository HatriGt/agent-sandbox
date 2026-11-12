import { test } from "node:test";
import assert from "node:assert/strict";
import { changeText, fetchLatestVersions, imageChanges, outdatedPackages, packageNameOf, parseBakedManifest, provisionOf, rebakeDueText } from "../src/package-watch.ts";

test("imageChanges: newer releases, list packages to add, baked packages to drop", () => {
  const baked = { "@anthropic-ai/claude-code": "2.1.273", "mcp-remote": "0.1.37", "btp-mcp-server": "1.0.1", npm: "11.0.0" };
  const latest = { "@anthropic-ai/claude-code": "2.1.322", "mcp-remote": "0.1.37", "@upstash/context7-mcp": "4.6.0", "btp-mcp-server": "1.0.2" };
  const c = imageChanges(baked, latest, ["mcp-remote", "@upstash/context7-mcp", "nope"]);
  assert.deepEqual(c, [
    { name: "@anthropic-ai/claude-code", baked: "2.1.273", latest: "2.1.322" },
    { name: "@upstash/context7-mcp", baked: "", latest: "4.6.0" },
    { name: "btp-mcp-server", baked: "1.0.1", latest: "" },
  ]);
  assert.deepEqual(c.map(changeText), ["@anthropic-ai/claude-code 2.1.273 → 2.1.322", "@upstash/context7-mcp 4.6.0 added", "btp-mcp-server removed"]);
  assert.deepEqual(imageChanges({ "mcp-remote": "1" }, { "mcp-remote": "1" }, ["mcp-remote"]), []);
});

test("parseBakedManifest reads npm ls -g --json", () => {
  const m = parseBakedManifest(JSON.stringify({ name: "lib", dependencies: { "@cap-js/mcp-server": { version: "0.1.0" }, "mcp-remote": { version: "0.1.37" }, broken: {} } }));
  assert.deepEqual(m, { "@cap-js/mcp-server": "0.1.0", "mcp-remote": "0.1.37" });
  assert.deepEqual(parseBakedManifest("not json"), {});
  assert.deepEqual(parseBakedManifest("{}"), {});
});

test("packageNameOf keeps the scope and drops the version", () => {
  assert.equal(packageNameOf("@cap-js/mcp-server@0.1.0"), "@cap-js/mcp-server");
  assert.equal(packageNameOf("mcp-remote@latest"), "mcp-remote");
  assert.equal(packageNameOf("mcp-remote"), "mcp-remote");
});

test("provisionOf: baked, per-run (not baked or pinned elsewhere), dropped (last run left it out)", () => {
  const baked = { "mcp-remote": "0.1.37", "chrome-devtools-mcp": "0.9.0" };
  assert.equal(provisionOf("mcp-remote", baked, undefined), "baked");
  assert.equal(provisionOf("mcp-remote@latest", baked, undefined), "baked");
  assert.equal(provisionOf("mcp-remote@0.1.37", baked, undefined), "baked");
  assert.equal(provisionOf("mcp-remote@0.2.0", baked, undefined), "per-run");
  assert.equal(provisionOf("btp-mcp-server", baked, undefined), "per-run");
  const last = { at: 1, box: "b", skipped: ["btp-mcp-server"], failed: [], dropped: ["btp-mcp-server", "chrome-devtools-mcp"] };
  assert.equal(provisionOf("btp-mcp-server", baked, last), "dropped");
  assert.equal(provisionOf("chrome-devtools-mcp@latest", baked, last), "dropped");
  assert.equal(provisionOf("mcp-remote", baked, last), "baked");
});

test("outdatedPackages compares to latest; unknown latest is not outdated", () => {
  const baked = { a: "1.0.0", b: "2.0.0", c: "3.0.0" };
  assert.deepEqual(outdatedPackages(baked, { a: "1.0.0", b: "2.1.0", c: undefined }), [{ name: "b", baked: "2.0.0", latest: "2.1.0" }]);
  assert.deepEqual(outdatedPackages(baked, { a: "9", b: "9" }, ["b@2.0.0"]), [{ name: "b", baked: "2.0.0", latest: "9" }]);
  assert.match(rebakeDueText([{ name: "b", baked: "2.0.0", latest: "2.1.0" }], "https://x/"), /^Sandbox image can be updated \(b 2\.0\.0 → 2\.1\.0\).*Update it from https:\/\/x\/dashboard\/#\/sandboxes$/);
});

test("fetchLatestVersions hits the registry per name and swallows failures", async () => {
  const urls: string[] = [];
  const r = await fetchLatestVersions(["@cap-js/mcp-server", "nope", "boom"], async (u) => {
    urls.push(u);
    if (u.includes("nope")) return { ok: false, json: async () => ({}) };
    if (u.includes("boom")) throw new Error("net");
    return { ok: true, json: async () => ({ version: "0.2.0" }) };
  });
  assert.deepEqual(r, { "@cap-js/mcp-server": "0.2.0" });
  assert.ok(urls.includes("https://registry.npmjs.org/%40cap-js/mcp-server/latest"));
});
