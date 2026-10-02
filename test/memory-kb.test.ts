/**
 * Memory v3 — the per-repo knowledge base: areas, anchors, links, reaffirm/revise, drift flags,
 * the MEMORY.md index and area pages, the box tool's verbs. See src/memory-store.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addManualNote,
  areaIndex,
  areaKey,
  deleteNote,
  emptyMemoryStore,
  exportMemoryMarkdown,
  importMemoryMarkdown,
  markStaleByPaths,
  parseMemoryStore,
  parseNoteLine,
  pathMatches,
  rememberRunNotes,
  renderMemoryArchive,
  renderMemoryMd,
  selectMemory,
  serializeMemoryStore,
  textOverlap,
  updateNote,
} from "../src/memory-store.ts";
import { memoryToolScript } from "../src/drivers/memory-tool.ts";
import { parseTrace } from "../src/trace.ts";

const REPO = ["Acme/Shop"];
const run = (store = emptyMemoryStore(), log: string, box = "b1", now?: number) => rememberRunNotes(store, { box, log, repos: REPO, ...(now ? { now } : {}) });

test("grammar: area, paths and links parse and tidy; preferences never carry them", () => {
  const n = parseNoteLine('domain | an invoice is issued on the 1st for annual plans | area: Billing / Invoicing | paths: src/billing/invoice.ts, ./src/api/invoices/* | links: orders/refunds, billing/invoicing, Billing/Tax | why: product rule');
  assert.ok(n);
  assert.equal(n.kind, "domain");
  assert.equal(n.area, "billing/invoicing");
  assert.deepEqual(n.paths, ["src/billing/invoice.ts", "src/api/invoices/*"]);
  assert.deepEqual(n.links, ["orders/refunds", "billing/tax"]);
  assert.equal(n.why, "Product rule.");
  const pref = parseNoteLine("preference | short replies | area: billing");
  assert.equal(pref?.area, undefined);
});

test("areaKey: lowercase, two levels, junk stripped", () => {
  assert.equal(areaKey("Billing / Invoicing"), "billing/invoicing");
  assert.equal(areaKey("a/b/c"), "a/b");
  assert.equal(areaKey("  Auth!! "), "auth");
  assert.equal(areaKey(""), "");
  assert.equal(areaKey(42), "");
});

test("pathMatches: file, directory prefix, * within a segment, ** across", () => {
  assert.ok(pathMatches("src/billing/invoice.ts", "src/billing/invoice.ts"));
  assert.ok(pathMatches("src/billing", "src/billing/deep/x.ts"));
  assert.ok(!pathMatches("src/billing", "src/billingx/x.ts"));
  assert.ok(pathMatches("src/api/invoices/*", "src/api/invoices/list.ts"));
  assert.ok(!pathMatches("src/api/invoices/*", "src/api/invoices/v2/list.ts"));
  assert.ok(pathMatches("src/**/invoice*.ts", "src/a/b/invoice-pdf.ts"));
  assert.ok(pathMatches("*.md", "README.md"));
});

test("a note written again is reaffirmed, not duplicated — anchors merge and the stale flag clears", () => {
  const store = emptyMemoryStore();
  const [a] = run(store, "<!-- remember: domain | Refunds go back to the original payment method | area: orders/refunds | paths: src/refund.ts -->", "b1", 1000);
  assert.equal(store.repos["acme/shop"].length, 1);
  assert.deepEqual(markStaleByPaths(store, "Acme/Shop", ["src/refund.ts"], { box: "b2", now: 2000 }).map((n) => n.id), [a.id]);
  assert.ok(a.stale);
  const again = run(store, '<!-- remember: domain | refunds go back to the original payment method. | area: orders/refunds | paths: src/refund.ts, src/api/refunds.ts | links: billing/invoicing | replaces: "Refunds go back to the original payment method" -->', "b3", 3000);
  assert.deepEqual(again, [], "a reaffirmation is silent");
  assert.equal(store.repos["acme/shop"].length, 1);
  assert.equal(a.stale, undefined);
  assert.equal(a.at, 3000);
  assert.equal(a.source, "b3");
  assert.deepEqual(a.paths, ["src/refund.ts", "src/api/refunds.ts"]);
  assert.deepEqual(a.links, ["billing/invoicing"]);
});

test("same-area rewrite without replaces: supersedes the old note as a pending revision; forgetting it restores the old one", () => {
  const store = emptyMemoryStore();
  const [old] = run(store, "<!-- remember: domain | Annual plans are invoiced on the first day of each month | area: billing/invoicing | paths: src/billing/invoice.ts -->", "b1", 1000);
  assert.ok(textOverlap(old.text, "Annual plans are invoiced on the first day of each quarter, not month") >= 0.6);
  const [rev] = run(store, "<!-- remember: domain | Annual plans are invoiced on the first day of each quarter, not month | area: billing/invoicing -->", "b2", 2000);
  assert.equal(rev.supersedes, old.id);
  assert.equal(rev.status, "pending");
  assert.match(rev.why ?? "", /^Revises: Annual plans/);
  assert.deepEqual(rev.paths, ["src/billing/invoice.ts"], "anchors are inherited");
  assert.equal(old.until, 2000);
  // Unrelated knowledge in the same area is simply added.
  const [other] = run(store, "<!-- remember: domain | Invoices are numbered INV-<year>-<seq> | area: billing/invoicing -->", "b2", 2100);
  assert.equal(other.supersedes, undefined);
  assert.equal(other.status, "kept");
  // Veto: the operator forgets the proposed rewrite → the old note is active again.
  assert.ok(deleteNote(store, rev.id));
  assert.equal(old.until, undefined);
});

test("explicit replaces: with an area resolves within that area first", () => {
  const store = emptyMemoryStore();
  run(store, "<!-- remember: fact | Tests need Node 20 | area: ci -->\n<!-- remember: fact | Tests need Node 20 | area: web -->", "b1", 1000);
  assert.equal(store.repos["acme/shop"].filter((n) => n.until === undefined).length, 1, "same kind+text is one note whatever the area");
  const [n] = run(store, '<!-- remember: fact | Tests need Node 22 | area: ci | replaces: "Tests need Node 20" -->', "b2", 2000);
  assert.equal(n.supersedes, store.repos["acme/shop"][0].id);
});

test("drift: a run that touches an anchored file flags the note unless it wrote it; the operator can mark it verified", () => {
  const store = emptyMemoryStore();
  const [a] = run(store, "<!-- remember: domain | Carts expire after 30 days | area: orders/cart | paths: src/cart/** -->", "b1", 1000);
  assert.deepEqual(markStaleByPaths(store, "Acme/Shop", ["src/cart/expiry.ts"], { box: "b1", now: 1500 }), [], "the author run never flags its own note");
  const flagged = markStaleByPaths(store, "Acme/Shop", ["README.md", "src/cart/expiry.ts"], { box: "b2", now: 2000 });
  assert.deepEqual(flagged.map((n) => n.id), [a.id]);
  assert.deepEqual(a.stale, { at: 2000, box: "b2", paths: ["src/cart/expiry.ts"] });
  assert.deepEqual(markStaleByPaths(store, "Acme/Shop", ["src/cart/expiry.ts"], { box: "b3", now: 3000 }), [], "already flagged");
  updateNote(store, a.id, { verified: true });
  assert.equal(a.stale, undefined);
  const md = renderMemoryMd(store, REPO, "cart");
  assert.ok(md && !md.includes("⚠ unverified"));
  markStaleByPaths(store, "Acme/Shop", ["src/cart/x.ts"], { box: "b4", now: 4000 });
  assert.match(renderMemoryMd(store, REPO, "cart") ?? "", /⚠ unverified since 1970-01-01 \(changed: src\/cart\/x\.ts\) — reaffirm it with replaces: "Carts expire after 30 days\."/);
});

test("MEMORY.md: the knowledge base index is always there; the areas the task is about are shown in full", () => {
  const store = emptyMemoryStore();
  run(
    store,
    [
      "<!-- remember: domain | An invoice is issued on the 1st for annual plans | area: billing/invoicing | paths: src/billing/invoice.ts | links: billing/tax -->",
      "<!-- remember: decision | Invoices are PDFs rendered server-side | area: billing/invoicing | why: clients asked for attachments -->",
      "<!-- remember: domain | VAT is applied by the customer's country | area: billing/tax | paths: src/billing/tax.ts -->",
      "<!-- remember: domain | A refund reopens the order for 24 hours | area: orders/refunds | paths: src/orders/refund.ts | links: billing/invoicing -->",
      "<!-- remember: fact | CI runs on Node 20 -->",
    ].join("\n"),
    "b1",
    1000
  );
  const idx = areaIndex(store, REPO);
  assert.deepEqual(idx.map((a) => a.area), ["billing/invoicing", "billing/tax", "orders/refunds"]);
  assert.deepEqual(idx[0].links, ["billing/tax"]);
  assert.deepEqual(idx[0].kinds, { domain: 1, decision: 1 });
  const sel = selectMemory(store, REPO, "Change the refund flow in src/orders/refund.ts so a refund reopens the order for 48 hours");
  assert.deepEqual(sel.areaPages.map((a) => a.area), ["orders/refunds"]);
  assert.deepEqual(sel.relevant.map((n) => n.text), ["CI runs on Node 20."], "area notes are served as pages, loose notes as before");
  const md = renderMemoryMd(store, REPO, "refund flow")!;
  assert.match(md, /## Knowledge base — acme\/shop/);
  assert.match(md, /- billing\/invoicing · 2 notes \(1 domain, 1 decision\) · paths src\/billing\/invoice\.ts · links billing\/tax/);
  assert.match(md, /### orders\/refunds\nCode: src\/orders\/refund\.ts\nRelated: billing\/invoicing\n\n- \[domain · orders\/refunds\] A refund reopens the order for 24 hours\. \{paths: src\/orders\/refund\.ts\} \{links: billing\/invoicing\}/);
  assert.ok(!md.includes("### billing/tax"), "only the areas the task is about are expanded");
  // No task → the most recently updated area is shown so the file is never just an index.
  const sel2 = selectMemory(store, REPO);
  assert.equal(sel2.areaPages.length, 1);
  const all = renderMemoryArchive(store, REPO)!;
  assert.match(all, /## Areas\n\n- billing\/invoicing/);
  assert.match(all, /- \[domain · billing\/tax\] VAT is applied by the customer's country\. \(acme\/shop\) \{paths: src\/billing\/tax\.ts\}/);
});

test("export → import keeps area, paths and links; the store round-trips them", () => {
  const store = emptyMemoryStore();
  addManualNote(store, { kind: "domain", text: "orders ship within 2 days", repo: "Acme/Shop", area: "Orders/Shipping", paths: "src/ship.ts, src/api/ship.ts", links: "orders/cart" });
  const md = exportMemoryMarkdown(store);
  assert.match(md, /- \[domain\] Orders ship within 2 days\. \| area: orders\/shipping \| paths: src\/ship\.ts, src\/api\/ship\.ts \| links: orders\/cart/);
  const other = emptyMemoryStore();
  assert.equal(importMemoryMarkdown(other, md), 1);
  const n = other.repos["acme/shop"][0];
  assert.equal(n.area, "orders/shipping");
  assert.deepEqual(n.paths, ["src/ship.ts", "src/api/ship.ts"]);
  assert.deepEqual(n.links, ["orders/cart"]);
  const back = parseMemoryStore(serializeMemoryStore(other));
  assert.deepEqual(back.repos["acme/shop"][0].links, ["orders/cart"]);
  updateNote(other, n.id, { area: "orders/fulfilment", paths: "", links: "orders/fulfilment, billing" });
  assert.equal(n.area, "orders/fulfilment");
  assert.equal(n.paths, undefined);
  assert.deepEqual(n.links, ["billing"], "a link to itself is dropped");
});

test("the box tool knows the new verbs and flags; a domain note needs an area", () => {
  const script = memoryToolScript();
  assert.match(script, /\n  areas\)\n/);
  assert.match(script, /\n  area\)\n/);
  assert.match(script, /--area\) /);
  assert.match(script, /--paths\) /);
  assert.match(script, /--links\) /);
  assert.match(script, /a domain note needs --area/);
});

test("the thread row carries the area and whether the note updated an older one", () => {
  const ev = parseTrace('Learned it.\n<!-- remember: domain | A refund reopens the order | area: Orders/Refunds | paths: src/x.ts | replaces: "A refund closes the order" -->');
  const mem = ev.filter((e) => e.kind === "memory");
  assert.equal(mem.length, 1);
  assert.deepEqual(mem[0], { kind: "memory", note: "domain", text: "A refund reopens the order", area: "orders/refunds", updated: true });
});

test("a note that is only a placeholder or quotes the grammar is dropped", () => {
  assert.equal(parseNoteLine("fact | …"), null);
  assert.equal(parseNoteLine("fact | <kind> | <text> [| why: …]"), null);
  assert.equal(parseNoteLine("domain | Notes use '<!-- remember: <kind> | <text> -->' | area: memory"), null);
  assert.ok(parseNoteLine("fact | CI runs on Node 20"));
});
