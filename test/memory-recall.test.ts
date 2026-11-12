/**
 * Memory recall and episodes: what a run is handed is counted and recorded, finished runs leave a
 * short history per repo, and the caps keep the notes runs reach for. See src/memory-store.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addParsedNotes,
  emptyMemoryStore,
  forgetEpisode,
  keepRank,
  markUsed,
  MEMORY_LIMITS,
  parseMemoryStore,
  receiptOf,
  recordEpisode,
  recordReceipt,
  renderMemoryMd,
  selectMemory,
  serializeMemoryStore,
  type MemoryNote,
} from "../src/memory-store.ts";

const REPO = "acme/shop";
const DAY = 86_400_000;

function storeWith(notes: Array<{ kind: MemoryNote["kind"]; text: string; area?: string }>, now = 1_000_000) {
  const store = emptyMemoryStore();
  store.repos[REPO] = [];
  addParsedNotes(store.repos[REPO], notes, { source: "box-a", scope: "repo", repo: REPO, now, status: () => "kept" });
  return store;
}

test("a note the task matches is picked; the newest-notes fallback is served but not picked", () => {
  const store = storeWith([
    { kind: "fact", text: "Invoices are rounded with bankers rounding in the billing module" },
    { kind: "fact", text: "The search index rebuilds nightly from the catalogue" },
  ]);
  const hit = selectMemory(store, [REPO], "fix the invoice rounding in billing");
  assert.equal(hit.matched, true);
  assert.deepEqual(hit.picked.map((n) => n.text.slice(0, 8)), ["Invoices"]);
  const miss = selectMemory(store, [REPO], "zzz qqq");
  assert.equal(miss.matched, false);
  assert.equal(miss.picked.length, 0);
  assert.equal(miss.relevant.length, 2, "the newest are still served");
});

test("a matched area page counts its notes as picked", () => {
  const store = storeWith([{ kind: "domain", text: "An invoice is issued when an order ships", area: "billing/invoicing" }]);
  const sel = selectMemory(store, [REPO], "change how invoicing works");
  assert.equal(sel.picked.length, 1);
  const r = receiptOf(sel, 5);
  assert.deepEqual(r.areas, ["billing/invoicing"]);
  assert.equal(r.picked, 1);
  assert.equal(r.matched, true);
  assert.equal(r.notes[0].kind, "domain");
});

test("markUsed counts a recall on any kind", () => {
  const store = storeWith([{ kind: "fact", text: "Deploys go out from the release branch only" }]);
  const [n] = store.repos[REPO];
  assert.equal(markUsed([n], 77), true);
  assert.equal(n.uses, 1);
  assert.equal(n.lastUsed, 77);
  assert.equal(markUsed([]), false);
});

test("the caps drop the note nobody recalled, not the oldest one", () => {
  const list: MemoryNote[] = [];
  const cap = MEMORY_LIMITS.perKind.playbook;
  for (let i = 0; i < cap; i++) {
    addParsedNotes(list, [{ kind: "playbook", text: `Playbook number ${i} about topic${i}\n1. step` }], { source: "b", scope: "repo", repo: REPO, now: 1000 + i, status: () => "kept" });
  }
  // The oldest one is the one runs keep using.
  list[0].uses = 3;
  list[0].lastUsed = 5000;
  addParsedNotes(list, [{ kind: "playbook", text: "Playbook brand new about release\n1. step" }], { source: "b", scope: "repo", repo: REPO, now: 9000, status: () => "kept" });
  const titles = list.filter((n) => !n.until).map((n) => n.text.split("\n")[0]);
  assert.equal(titles.length, cap);
  assert.ok(titles.includes("Playbook number 0 about topic0"), "the used note stays");
  assert.ok(!titles.includes("Playbook number 1 about topic1"), "the oldest unused note goes");
  assert.ok(keepRank(list[0]) > 5000);
});

test("a near-copy outside any area revises the old note instead of sitting beside it", () => {
  const store = storeWith([{ kind: "fact", text: "The staging database is refreshed from production every Sunday night" }]);
  const added = addParsedNotes(
    store.repos[REPO],
    [{ kind: "fact", text: "The staging database is refreshed from production every Sunday night at two" }],
    { source: "box-b", scope: "repo", repo: REPO, now: 2_000_000 }
  );
  assert.equal(added.length, 1);
  assert.ok(added[0].supersedes, "it supersedes the older wording");
  assert.equal(store.repos[REPO].filter((n) => !n.until).length, 1);
  // Something merely related stays a note of its own.
  const other = addParsedNotes(store.repos[REPO], [{ kind: "fact", text: "The staging queue workers restart on every deploy" }], { source: "box-b", scope: "repo", repo: REPO, now: 3_000_000 });
  assert.equal(other[0].supersedes, undefined);
});

test("a finished run leaves one episode per box, updated by later turns", () => {
  const store = emptyMemoryStore();
  assert.equal(recordEpisode(store, [REPO], { box: "box-a", task: "Fix the invoice rounding bug", state: "done", summary: "Switched to bankers rounding. <!-- remember: fact | x -->", files: ["src/billing.ts"], now: 10 * DAY }), true);
  assert.equal(recordEpisode(store, [REPO], { box: "box-a", task: "also add a test", state: "done", summary: "Added a test.", now: 11 * DAY }), true);
  const [e] = store.episodes![REPO];
  assert.equal(store.episodes![REPO].length, 1);
  assert.equal(e.task, "Fix the invoice rounding bug");
  assert.equal(e.summary, "Added a test.");
  assert.equal(e.turns, 2);
  assert.equal(recordEpisode(store, [], { box: "box-b", task: "x", state: "done" }), false, "no repo, nothing to file under");
  store.enabled = false;
  assert.equal(recordEpisode(store, [REPO], { box: "box-c", task: "x", state: "done" }), false, "memory off");
});

test("episodes are capped per repo and survive a save", () => {
  const store = emptyMemoryStore();
  for (let i = 0; i < MEMORY_LIMITS.episodesPerRepo + 5; i++) recordEpisode(store, [REPO], { box: `box-${i}`, task: `task ${i}`, state: i % 2 ? "failed" : "done", now: i * DAY });
  assert.equal(store.episodes![REPO].length, MEMORY_LIMITS.episodesPerRepo);
  assert.equal(store.episodes![REPO][0].box, "box-5");
  recordReceipt(store, "box-1", { at: 1, core: 0, areas: [], notes: [], picked: 0, episodes: 2, matched: false });
  const back = parseMemoryStore(serializeMemoryStore(store));
  assert.deepEqual(back.episodes, store.episodes);
  assert.deepEqual(back.receipts, store.receipts);
});

test("MEMORY.md lists recent work, similar tasks first, never the box's own run", () => {
  const store = emptyMemoryStore();
  recordEpisode(store, [REPO], { box: "box-a", task: "Fix the invoice rounding bug", state: "failed", summary: "Tests still fail on negative totals.", now: 10 * DAY });
  recordEpisode(store, [REPO], { box: "box-b", task: "Upgrade the search library", state: "done", now: 12 * DAY });
  recordEpisode(store, [REPO], { box: "box-me", task: "Fix invoice rounding again", state: "done", now: 13 * DAY });
  const md = renderMemoryMd(store, [REPO], "fix the invoice rounding bug for negative totals", { box: "box-me" })!;
  assert.match(md, /## Recent work in this repo/);
  const lines = md.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /failed · similar task · "Fix the invoice rounding bug" — Tests still fail/);
  assert.match(lines[1], /done · "Upgrade the search library"/);
  assert.equal(forgetEpisode(store, "box-a"), true);
  assert.equal(forgetEpisode(store, "box-a"), false);
});

test("receipts are capped by box, oldest first", () => {
  const store = emptyMemoryStore();
  for (let i = 0; i < MEMORY_LIMITS.receipts + 3; i++) recordReceipt(store, `box-${i}`, { at: i, core: 1, areas: [], notes: [], picked: 0, episodes: 0, matched: false });
  assert.equal(Object.keys(store.receipts!).length, MEMORY_LIMITS.receipts);
  assert.equal(store.receipts!["box-0"], undefined);
});
