// Plain-node check of src/lib/sidechat.ts: the reducer, the store, hydration and persistence.
// Run: node scripts/check-sidechat.mjs   (Node 24 strips the types; no bundler, no RN)
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const storage = new Map();
let resolveAsk = null;
globalThis.__sidechat = {
  storage,
  askImpl: () => new Promise((resolve, reject) => (resolveAsk = { resolve, reject })),
};

const stub = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const stubs = {
  react: stub(`
    export const useCallback = (f) => f;
    export const useMemo = (f) => f();
    export const useSyncExternalStore = (subscribe, get) => { subscribe(() => {}); return get(); };
  `),
  "@react-native-async-storage/async-storage": stub(`
    const s = globalThis.__sidechat.storage;
    export default {
      getItem: async (k) => s.get(k) ?? null,
      setItem: async (k, v) => { s.set(k, v); },
      removeItem: async (k) => { s.delete(k); },
    };
  `),
  "@/lib/api": stub(`export const api = { ask: (box, q) => globalThis.__sidechat.askImpl(box, q) };`),
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in stubs) return { url: stubs[specifier], shortCircuit: true };
    return next(specifier, context);
  },
});

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const mod = await import(pathToFileURL(path.join(here, "..", "src", "lib", "sidechat.ts")).href);
const { reduce, EMPTY, MAX_TURNS, unreadCount, useSideChat, forgetSideChat, RELOADED_ERROR } = mod;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pend = (id, question = "q" + id, askedAt = 1) => ({ id, question, askedAt });
const answered = (id, at, extra = {}) => ({ ...pend(id), at, kind: "answered", answer: "a" + id, partial: false, continued: true, ...extra });

assert.equal(reduce(EMPTY, { type: "open" }).open, true, "open");
assert.equal(reduce(reduce(EMPTY, { type: "open" }), { type: "close" }).open, false, "close");
assert.equal(reduce(EMPTY, { type: "toggle" }).open, true, "toggle");
assert.equal(reduce(EMPTY, { type: "close" }), EMPTY, "close on closed is identity");
assert.equal(reduce(EMPTY, { type: "draft", text: "hi" }).draft, "hi", "draft");

const typed = reduce(EMPTY, { type: "draft", text: "what changed?" });
const asked = reduce(typed, { type: "asked", turn: pend("t1") });
assert.deepEqual([asked.pending?.id, asked.open, asked.draft], ["t1", true, ""], "ask fills the slot, opens, clears the draft");
assert.equal(reduce(asked, { type: "asked", turn: pend("t2") }), asked, "second ask while pending is ignored");

assert.equal(reduce(asked, { type: "settled", turn: answered("stale", 5) }), asked, "stale settle ignored");
assert.equal(reduce(EMPTY, { type: "settled", turn: answered("t1", 5) }), EMPTY, "settle with nothing pending ignored");
const settled = reduce(asked, { type: "settled", turn: answered("t1", 5) });
assert.equal(settled.pending, null, "settle empties the slot");
assert.deepEqual(settled.turns.map((t) => t.id), ["t1"], "settle appends the turn");

assert.equal(unreadCount(settled), 1, "unread before read");
assert.equal(unreadCount(reduce(settled, { type: "read", at: 5 })), 0, "read at the landing instant clears it");
assert.equal(unreadCount(reduce(settled, { type: "read", at: 4 })), 1, "read before the landing instant does not");

const busy = reduce(settled, { type: "asked", turn: pend("t2") });
const fresh = reduce(busy, { type: "forget" });
assert.deepEqual([fresh.turns.length, fresh.pending?.id], [0, "t2"], "forget drops turns and keeps the pending slot");
assert.equal(reduce(fresh, { type: "settled", turn: answered("t2", 9) }).turns.length, 1, "the pending answer still lands after forget");

let many = EMPTY;
for (let i = 0; i < MAX_TURNS + 3; i++) {
  many = reduce(many, { type: "asked", turn: pend("m" + i) });
  many = reduce(many, { type: "settled", turn: answered("m" + i, i + 1) });
}
assert.equal(many.turns.length, MAX_TURNS, "capped at MAX_TURNS");
assert.equal(many.turns[0].id, "m3", "oldest evicted first");

let h = useSideChat("box-a");
assert.equal(h.chat, EMPTY, "untouched box is EMPTY");
h.ask("   ");
assert.equal(useSideChat("box-a").chat.pending, null, "blank question is a no-op");
h.ask("why is it stuck?");
h = useSideChat("box-a");
assert.deepEqual([h.chat.open, h.chat.pending?.question], [true, "why is it stuck?"], "ask opens the sheet with the pending turn");
h.ask("second");
assert.equal(useSideChat("box-a").chat.pending?.question, "why is it stuck?", "no second ask while pending");
resolveAsk.resolve({ answer: "a test", timedOut: true, continued: false, driverState: "running" });
await sleep(0);
h = useSideChat("box-a");
assert.equal(h.chat.pending, null, "wire reply settles the slot");
assert.deepEqual(h.chat.turns.map((t) => [t.kind, t.answer, t.partial, t.continued, t.driverState]), [["answered", "a test", true, false, "running"]], "wire fields map to the domain");
assert.equal(h.unread, 0, "landed in an open sheet, so already read");

h.ask("and which file?");
useSideChat("box-a").close();
resolveAsk.reject(new Error("box went away"));
await sleep(0);
h = useSideChat("box-a");
assert.deepEqual([h.chat.open, h.unread, h.chat.turns[1].kind, h.chat.turns[1].error], [false, 1, "failed", "box went away"], "a failure landing in a closed sheet is unread");
h.open();
assert.equal(useSideChat("box-a").unread, 0, "opening marks read");

await sleep(400);
const saved = JSON.parse(storage.get("asb-sidechat:box-a"));
assert.equal(saved.turns.length, 2, "persisted under the box key after the debounce");

storage.set("asb-sidechat:box-b", JSON.stringify({ turns: [answered("old", 2)], pending: pend("lost", "did it pass?", 3), open: true, readAt: 2, draft: "typed" }));
useSideChat("box-b");
await sleep(0);
h = useSideChat("box-b");
assert.deepEqual(h.chat.turns.map((t) => [t.id, t.kind]), [["old", "answered"], ["lost", "failed"]], "a persisted pending turn hydrates as failed");
assert.equal(h.chat.turns[1].error, RELOADED_ERROR, "with the reload message");
assert.deepEqual([h.chat.open, h.chat.draft, h.unread], [false, "typed", 1], "hydration keeps the draft, never reopens the sheet");

storage.set("asb-sidechat:box-c", "{not json");
useSideChat("box-c");
await sleep(0);
assert.equal(useSideChat("box-c").chat, EMPTY, "garbage in storage hydrates as EMPTY");

forgetSideChat("box-a");
await sleep(0);
assert.equal(useSideChat("box-a").chat, EMPTY, "forget drops memory");
assert.equal(storage.has("asb-sidechat:box-a"), false, "forget drops storage");
forgetSideChat("never-seen");

console.log("sidechat: all checks passed");
