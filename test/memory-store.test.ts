import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEMORY_LIMITS,
  addNotes,
  deleteNote,
  emptyMemoryStore,
  parseMemoryStore,
  parseRemember,
  questionNoteText,
  rememberRun,
  renderMemoryMd,
  serializeMemoryStore,
  updateNote,
  viewMemory,
  type MemoryNote,
} from "../src/memory-store.ts";

test("parseRemember: one fact per line, trimmed, list markers dropped, empties ignored", () => {
  const log = "did things\n<!-- remember:\n  - Tests run with `pnpm test`  \n\n* The API lives in packages/api\n\n3. Operator prefers squash merges\n-->\nbye";
  assert.deepEqual(parseRemember(log), ["Tests run with `pnpm test`", "The API lives in packages/api", "Operator prefers squash merges"]);
});

test("parseRemember: dedupes by normalised text, across several blocks", () => {
  const log = "<!-- remember: Use pnpm. -->\nmore\n<!-- remember:\nuse pnpm\nUSE  PNPM!\nNode 20 is required\n-->";
  assert.deepEqual(parseRemember(log), ["Use pnpm.", "Node 20 is required"]);
});

test("parseRemember: nothing on a log without the marker, or an empty one", () => {
  assert.deepEqual(parseRemember("<!-- watch: logs | every 30s -->\nall good"), []);
  assert.deepEqual(parseRemember("<!-- remember:   \n\n -->"), []);
  assert.deepEqual(parseRemember(""), []);
});

test("parseRemember: clips over-long facts and caps the per-run count", () => {
  const long = "x".repeat(MEMORY_LIMITS.maxNoteChars + 50);
  assert.equal(parseRemember(`<!-- remember: ${long} -->`)[0].length, MEMORY_LIMITS.maxNoteChars);
  const many = Array.from({ length: MEMORY_LIMITS.maxPerRun + 10 }, (_, i) => `fact number ${i}`).join("\n");
  assert.equal(parseRemember(`<!-- remember:\n${many}\n-->`).length, MEMORY_LIMITS.maxPerRun);
});

test("questionNoteText: an answered question becomes 'asked X → operator chose Y'; unanswered is dropped", () => {
  assert.equal(questionNoteText({ question: "Postgres or\n  SQLite?", answer: "SQLite" }), "asked Postgres or SQLite? → operator chose SQLite");
  assert.equal(questionNoteText({ question: "Which DB?" }), null);
  assert.equal(questionNoteText({ question: "   ", answer: "x" }), null);
});

test("addNotes: caps evict the oldest UNPINNED notes, pinned survive", () => {
  const list: MemoryNote[] = [];
  addNotes(list, ["first", "second", "third"], { source: "run-1", now: 1000 }, 10);
  updateNote({ enabled: true, global: list, repos: {} }, list[0].id, { pinned: true });
  addNotes(list, ["fourth", "fifth"], { source: "run-2", now: 2000 }, 3);
  assert.deepEqual(
    list.map((n) => n.text),
    ["first", "fourth", "fifth"]
  );
  assert.equal(list[0].pinned, true);
});

test("addNotes: everything pinned means nothing is evicted; known facts are not re-added", () => {
  const list: MemoryNote[] = [];
  addNotes(list, ["a", "b"], { source: "r", now: 1 }, 5);
  for (const n of list) n.pinned = true;
  const added = addNotes(list, ["A.", "c"], { source: "r2", now: 2 }, 3);
  assert.equal(added, 1);
  assert.deepEqual(
    list.map((n) => n.text),
    ["a", "b", "c"]
  );
  // Pinned notes fill the cap: the newcomer is the only unpinned one, so it is what goes.
  addNotes(list, ["d"], { source: "r3", now: 3 }, 2);
  assert.deepEqual(
    list.map((n) => n.text),
    ["a", "b"]
  );
});

test("rememberRun: sentinel facts + answered questions file under the single repo; several repos go global", () => {
  const store = emptyMemoryStore();
  const log = "<!-- remember:\nCI runs on Node 20\n-->";
  const n = rememberRun(store, { box: "box-a", log, questions: [{ question: "Keep the old API?", answer: "yes" }, { question: "open?" }], repos: ["Acme/Widgets"] });
  assert.equal(n, 2);
  assert.deepEqual(
    store.repos["acme/widgets"].map((x) => x.text),
    ["CI runs on Node 20", "asked Keep the old API? → operator chose yes"]
  );
  assert.equal(store.repos["acme/widgets"][0].source, "box-a");
  assert.equal(store.repos["acme/widgets"][0].repo, "acme/widgets");
  assert.equal(store.global.length, 0);

  const multi = emptyMemoryStore();
  assert.equal(rememberRun(multi, { box: "b", log, repos: ["a/x", "a/y"] }), 1);
  assert.equal(multi.global[0].text, "CI runs on Node 20");
  assert.equal(multi.global[0].repo, undefined);
});

test("rememberRun: a second finish of the same log stores nothing new; disabled stores nothing", () => {
  const store = emptyMemoryStore();
  const log = "<!-- remember: fact one -->";
  assert.equal(rememberRun(store, { box: "b", log, repos: [] }), 1);
  assert.equal(rememberRun(store, { box: "b", log, repos: [] }), 0);
  const off = { ...emptyMemoryStore(), enabled: false };
  assert.equal(rememberRun(off, { box: "b", log, repos: [] }), 0);
});

test("rememberRun: per-repo and global caps hold", () => {
  const store = emptyMemoryStore();
  const facts = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p} ${i}`);
  for (let r = 0; r < 4; r++) rememberRun(store, { box: `b${r}`, log: `<!-- remember:\n${facts(20, `run${r}`).join("\n")}\n-->`, repos: ["o/r"], now: r });
  assert.equal(store.repos["o/r"].length, MEMORY_LIMITS.maxPerRepo);
  assert.equal(store.repos["o/r"][0].text, "run2 10"); // the oldest went first
  for (let r = 0; r < 5; r++) rememberRun(store, { box: `g${r}`, log: `<!-- remember:\n${facts(20, `g${r}`).join("\n")}\n-->`, repos: [], now: r });
  assert.equal(store.global.length, MEMORY_LIMITS.maxGlobal);
});

test("updateNote / deleteNote / viewMemory", () => {
  const store = emptyMemoryStore();
  rememberRun(store, { box: "b", log: "<!-- remember:\none\ntwo\n-->", repos: ["o/r"], now: 10 });
  rememberRun(store, { box: "c", log: "<!-- remember: global -->", repos: [], now: 20 });
  const all = viewMemory(store);
  assert.deepEqual(
    all.map((n) => n.text),
    ["global", "one", "two"]
  ); // newest first
  const id = store.repos["o/r"][0].id;
  const edited = updateNote(store, id, { text: "  one   edited ", pinned: true });
  assert.equal(edited.text, "one edited");
  assert.equal(edited.pinned, true);
  updateNote(store, id, { pinned: false });
  assert.equal(store.repos["o/r"][0].pinned, undefined);
  assert.throws(() => updateNote(store, id, { text: "   " }), /empty/);
  assert.throws(() => updateNote(store, "nope", { text: "x" }), /no longer exists/);
  assert.equal(deleteNote(store, id), true);
  assert.equal(deleteNote(store, id), false);
  assert.deepEqual(
    store.repos["o/r"].map((n) => n.text),
    ["two"]
  );
});

test("renderMemoryMd: global + attached repos only, pinned first, null when nothing applies", () => {
  const store = emptyMemoryStore();
  assert.equal(renderMemoryMd(store, ["o/r"]), null);
  rememberRun(store, { box: "b", log: "<!-- remember:\nolder\nnewer\n-->", repos: ["o/r"], now: 10 });
  store.repos["o/r"][1].pinned = true;
  rememberRun(store, { box: "b", log: "<!-- remember: other repo -->", repos: ["o/other"], now: 11 });
  rememberRun(store, { box: "b", log: "<!-- remember: everywhere -->", repos: [], now: 12 });
  const md = renderMemoryMd(store, ["O/R"])!;
  assert.match(md, /may be stale/);
  assert.match(md, /## For this operator \(any repo\)\n\n- everywhere/);
  assert.match(md, /## O\/R\n\n- newer\n- older/);
  assert.doesNotMatch(md, /other repo/);
  assert.equal(renderMemoryMd({ ...store, enabled: false }, ["o/r"]), null);
});

test("store round-trips and tolerates garbage", () => {
  const store = emptyMemoryStore();
  store.enabled = false;
  rememberRun({ ...store, enabled: true }, { box: "b", log: "<!-- remember: x -->", repos: ["o/r"] });
  const back = parseMemoryStore(serializeMemoryStore(store));
  assert.equal(back.enabled, false);
  assert.deepEqual(back.repos, store.repos);
  assert.deepEqual(parseMemoryStore("not json"), emptyMemoryStore());
  assert.deepEqual(parseMemoryStore('{"global":"nope","repos":{"a":[{"id":1}]}}'), { enabled: true, global: [], repos: { a: [] } });
});
