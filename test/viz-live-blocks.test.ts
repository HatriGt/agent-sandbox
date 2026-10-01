/**
 * Live blocks (web/src/lib/viz-identity.ts): a visual fence re-emitted under the same name in one
 * run renders once — latest version at the first position — and later copies collapse to a row.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildLiveRegistry, fenceIdentity, normalizeName, rewriteLiveBlocks, scanFences, splitLiveTag } from "../web/src/lib/viz-identity.ts";
import { splitOpenFence, stabilizeMarkdown } from "../web/src/lib/markdown-stream.ts";

const f = (lang: string, body: string) => "```" + lang + "\n" + body + "\n```\n";
const stats = (n: number) => `**Backend traffic**\n\n${f("stats", `Calls: ${n}\nErrors: 0`)}`;

test("identity: meta id, meta title, chart title, heading above; untitled never merges", () => {
  const [a] = scanFences(f("stats id=traffic", "Calls: 1"));
  assert.equal(fenceIdentity(a), "stats|id:traffic");
  const [b] = scanFences(f('kv title="Build info"', "a: 1"));
  assert.equal(fenceIdentity(b), "kv|t:build info");
  const [c] = scanFences(f("chart", '{"type":"bar","title":"Calls per bucket","x":[1]}'));
  assert.equal(fenceIdentity(c), "chart|t:calls per bucket");
  const [d] = scanFences("### Backend calls (10:02)\n" + f("log", "x"));
  assert.equal(fenceIdentity(d), "log|t:backend calls");
  const [e] = scanFences("Some prose.\n\n" + f("stats", "Calls: 1"));
  assert.equal(fenceIdentity(e), null);
  assert.equal(normalizeName("Backend traffic:"), "backend traffic");
});

test("identity includes the language", () => {
  const [a] = scanFences("**X**\n" + f("stats", "a: 1"));
  const [b] = scanFences("**X**\n" + f("kv", "a: 1"));
  assert.notEqual(fenceIdentity(a), fenceIdentity(b));
});

test("merge: latest at the first slot, later copies become rows, runs do not merge", () => {
  const reg = buildLiveRegistry([
    { key: "s0", text: "Watching.\n\n" + stats(1), at: 1 },
    { key: "s1", text: stats(2), at: 2 },
    { key: "s2", text: stats(3), at: 3 },
    { key: "b", text: "", boundary: true },
    { key: "s3", text: stats(9), at: 4 },
  ]);
  assert.equal(reg.slots.length, 2);
  assert.equal(reg.slots[0].versions.length, 3);
  assert.equal(reg.slots[0].latest, 2);
  assert.equal(reg.slots[1].run, 1);
  assert.equal(reg.lastRun, 1);
  assert.deepEqual(reg.roles.get("s0:0"), { kind: "live", slot: 0 });
  assert.deepEqual(reg.roles.get("s2:0"), { kind: "copy", slot: 0, version: 2 });

  const first = rewriteLiveBlocks("Watching.\n\n" + stats(1), "s0", reg);
  assert.match(first, /```stats__live0\nCalls: 3\nErrors: 0\n```/);
  const copy = rewriteLiveBlocks(stats(3), "s2", reg);
  assert.match(copy, /```vizwas\n0 2\n```/);
  assert.doesNotMatch(copy, /Calls/);
  assert.doesNotMatch(copy, /Backend traffic/, "the naming heading folds into the row");
  // Its own run: shows itself.
  assert.match(rewriteLiveBlocks(stats(9), "s3", reg), /stats__live1\nCalls: 9/);
});

test("an incomplete later version never replaces a complete one", () => {
  const open = "**Backend traffic**\n```stats\nCalls: 7";
  const reg = buildLiveRegistry([
    { key: "a", text: stats(1) },
    { key: "b", text: open },
  ]);
  assert.equal(reg.slots[0].latest, 0);
  assert.match(rewriteLiveBlocks(stats(1), "a", reg), /Calls: 1/);
  // The stabilised, mid-reveal slice of the open copy still collapses.
  const slice = stabilizeMarkdown(open);
  assert.match(rewriteLiveBlocks(slice, "b", reg), /```vizwas\n0 1\n```/);
});

test("same say re-emitting twice; open first slot keeps its open tag", () => {
  const text = stats(1) + "\nchecking…\n\n" + stats(5);
  const reg = buildLiveRegistry([{ key: "a", text }]);
  const out = rewriteLiveBlocks(text, "a", reg);
  assert.equal((out.match(/Calls: 5/g) ?? []).length, 1);
  assert.match(out, /vizwas\n0 1/);
  const solo = buildLiveRegistry([{ key: "a", text: "**T**\n```stats\nCalls: 1" }]);
  const live = rewriteLiveBlocks(stabilizeMarkdown("**T**\n```stats\nCalls: 1"), "a", solo);
  const lang = live.match(/```(\S+)/)![1];
  const { language, open } = splitOpenFence(lang);
  assert.equal(open, true);
  assert.deepEqual(splitLiveTag(language), { language: "stats", slot: 0 });
});

test("fences inside other fences are not counted", () => {
  const fs = scanFences("~~~md\n```stats\na: 1\n```\n~~~\n" + f("kv", "b: 2"));
  assert.deepEqual(fs.map((x) => x.lang), ["md", "kv"]);
});
