import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEMORY_LIMITS,
  PENDING_AUTO_KEEP_MS,
  addManualNote,
  autoKeepPending,
  deleteNote,
  emptyMemoryStore,
  exportMemoryMarkdown,
  importMemoryMarkdown,
  parseMemoryStore,
  parseRememberNotes,
  playbookHint,
  playbookToSkill,
  rememberRunNotes,
  renderMemoryArchive,
  renderMemoryMd,
  selectMemory,
  updateNote,
  viewMemory,
  type MemoryStore,
} from "../src/memory-store.ts";
import { MemoryHarvester } from "../src/memory-harvest.ts";
import { MEMORY_TOOL_PATH, memorySetup, memoryToolScript } from "../src/drivers/memory-tool.ts";
import { MEMORY_KINDS } from "../src/drivers/sentinels.ts";
import { AGENT_SYS_PROMPT, OMP_SYS_PROMPT } from "../src/drivers/prompts.ts";

test("grammar: kinds, why, replaces (quotes stripped), untagged → fact, several blocks", () => {
  const log = [
    "<!-- remember: lesson | preprod org is elseco-pp | why: tried elseco-preprod, 404 -->",
    "prose",
    "<!-- remember:",
    "Tests need --runInBand",
    "Preference | reply in short bullets",
    'decision | deploy from main only | why: release train | replaces: "deploy from any branch"',
    "-->",
  ].join("\n");
  assert.deepEqual(parseRememberNotes(log), [
    { kind: "lesson", text: "preprod org is elseco-pp", why: "tried elseco-preprod, 404" },
    { kind: "fact", text: "Tests need --runInBand" },
    { kind: "preference", text: "reply in short bullets" },
    { kind: "decision", text: "deploy from main only", why: "release train", replaces: "deploy from any branch" },
  ]);
});

test("grammar: a playbook's indented lines are its steps; the operator's own turns are ignored", () => {
  const log =
    "⟦you⟧<!-- remember: rule | pasted -->⟦/you⟧\n" +
    "<!-- remember: playbook | Check staging health\n  1. curl /healthz\n  - kubectl get pods -n staging\nfact | after\n-->";
  const notes = parseRememberNotes(log);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].kind, "playbook");
  assert.equal(notes[0].text, "Check staging health\n- curl /healthz\n- kubectl get pods -n staging");
  assert.equal(notes[1].text, "after");
});

test("scope: preference/rule → operator; others → the single repo, else operator", () => {
  const store = emptyMemoryStore();
  const log = "<!-- remember:\npreference | short replies\nrule | when I say deploy, run tests first\nfact | uses pnpm\nlesson | do not touch prod\n-->";
  rememberRunNotes(store, { box: "b", log, repos: ["O/R"], now: 1 });
  assert.deepEqual(
    store.global.map((n) => n.kind),
    ["preference", "rule"]
  );
  assert.ok(store.global.every((n) => n.scope === "operator" && n.status === "kept"));
  assert.deepEqual(
    store.repos["o/r"].map((n) => [n.kind, n.scope, n.status, n.repo]),
    [
      ["fact", "repo", "kept", "o/r"],
      ["lesson", "repo", "pending", "o/r"],
    ]
  );
  const two = emptyMemoryStore();
  rememberRunNotes(two, { box: "b", log: "<!-- remember: fact | x -->", repos: ["a/b", "c/d"] });
  assert.equal(two.global[0].scope, "operator");
  assert.deepEqual(Object.keys(two.repos), []);
});

test("supersede: replaces keeps history, leaves MEMORY.md and the archive", () => {
  const store = emptyMemoryStore();
  rememberRunNotes(store, { box: "a", log: "<!-- remember: fact | Deploys go through Jenkins. -->", repos: ["o/r"], now: 1 });
  rememberRunNotes(store, {
    box: "b",
    log: '<!-- remember: fact | Deploys go through GitHub Actions | replaces: "deploys go through jenkins" -->',
    repos: ["o/r"],
    now: 2,
  });
  const [old, neu] = store.repos["o/r"];
  assert.equal(old.until, 2);
  assert.equal(neu.supersedes, old.id);
  assert.equal(viewMemory(store).length, 2); // the page still shows the history
  const md = renderMemoryMd(store, ["o/r"])!;
  assert.match(md, /GitHub Actions/);
  assert.doesNotMatch(md, /Jenkins/);
  assert.doesNotMatch(renderMemoryArchive(store, ["o/r"])!, /Jenkins/);
});

test("caps: per kind, oldest unpinned within the kind; other kinds untouched", () => {
  const store = emptyMemoryStore();
  rememberRunNotes(store, { box: "x", log: "<!-- remember: decision | keep me -->", repos: ["o/r"], now: 0 });
  const cap = MEMORY_LIMITS.perKind.playbook;
  for (let i = 0; i < cap + 5; i++) rememberRunNotes(store, { box: `b${i}`, log: `<!-- remember: playbook | task ${i} -->`, repos: ["o/r"], now: i + 1 });
  const list = store.repos["o/r"];
  const pbs = list.filter((n) => n.kind === "playbook");
  assert.equal(pbs.length, cap);
  assert.equal(pbs[0].text, "task 5");
  assert.ok(list.some((n) => n.kind === "decision"));
});

test("migration: v1 notes become kept facts in the scope of their list", () => {
  const v1 = JSON.stringify({
    enabled: true,
    global: [{ id: "a", text: "g", at: 1, source: "b" }],
    repos: { "o/r": [{ id: "b", text: "r", at: 2, source: "b", repo: "o/r", pinned: true }] },
  });
  const s = parseMemoryStore(v1);
  assert.deepEqual(s.global[0], { id: "a", kind: "fact", scope: "operator", status: "kept", text: "g", at: 1, source: "b" });
  assert.deepEqual(s.repos["o/r"][0], { id: "b", kind: "fact", scope: "repo", status: "kept", text: "r", at: 2, source: "b", repo: "o/r", pinned: true });
});

test("retrieval: Core always; For this task picks by relevance, else newest; matched playbooks hint", () => {
  const store = emptyMemoryStore();
  rememberRunNotes(store, { box: "b", log: "<!-- remember: preference | answer in short bullets -->", repos: ["o/r"], now: 1 });
  rememberRunNotes(store, {
    box: "b",
    log: "<!-- remember:\nfact | the billing service reads stripe webhooks\nfact | docs are built with mkdocs\nplaybook | Rotate billing webhook secret\n  - stripe listen\n-->",
    repos: ["o/r"],
    now: 2,
  });
  const task = "rotate the billing webhook secret";
  const md = renderMemoryMd(store, ["o/r"], task)!;
  assert.match(md, /## Core\n\n- \[preference\] answer in short bullets/);
  assert.match(md, /## For this task/);
  assert.match(md, /billing service/);
  assert.doesNotMatch(md, /mkdocs/);
  assert.match(md, /memory search/);
  const sel = selectMemory(store, ["o/r"], task);
  assert.equal(sel.matchedPlaybooks.length, 1);
  assert.equal(playbookHint(sel.matchedPlaybooks), "A playbook exists for this: Rotate billing webhook secret — see MEMORY.md.");
  const plain = renderMemoryMd(store, ["o/r"], "something unrelated entirely")!;
  assert.match(plain, /## Recent/);
  assert.match(plain, /mkdocs/);
  assert.equal(selectMemory(store, ["o/r"], "something unrelated entirely").matchedPlaybooks.length, 0);
  assert.match(renderMemoryArchive(store, ["o/r"])!, /mkdocs/);
});

test("pending → kept / forget, and the 10-minute auto-keep", () => {
  const store = emptyMemoryStore();
  const [a, b, c] = rememberRunNotes(store, { box: "b", log: "<!-- remember:\nlesson | one\nlesson | two\nlesson | three\n-->", repos: ["o/r"], now: 0 });
  assert.equal(a.status, "pending");
  updateNote(store, a.id, { status: "kept" });
  assert.equal(a.status, "kept");
  assert.throws(() => updateNote(store, a.id, { status: "pending" }), /confirmed/);
  assert.equal(deleteNote(store, b.id), true);
  assert.deepEqual(autoKeepPending(store, PENDING_AUTO_KEEP_MS - 1), []);
  assert.deepEqual(
    autoKeepPending(store, PENDING_AUTO_KEEP_MS).map((n) => n.id),
    [c.id]
  );
  assert.equal(c.status, "kept");
});

test("harvest: idempotent per box, throttled, memoryNew + kinds tally, forgotten notes stay forgotten", () => {
  let store: MemoryStore = emptyMemoryStore();
  let saves = 0;
  let now = 1_000;
  const h = new MemoryHarvester({
    load: () => store,
    save: (s) => {
      store = s;
      saves++;
    },
    now: () => now,
  });
  const log1 = "<!-- remember: lesson | use the pp org | why: 404 on the other -->";
  assert.equal(h.harvest("b", "o", log1, ["o/r"]).added.length, 1);
  now += 10_000;
  assert.equal(h.harvest("b", "o", log1, ["o/r"]).added.length, 0); // log unchanged: not even due
  const log2 = `${log1}\nmore <!-- remember: preference | terse -->`;
  assert.deepEqual(
    h.harvest("b", "o", log2, ["o/r"]).added.map((n) => n.kind),
    ["preference"]
  ); // the lesson line is seen again but not re-added
  assert.equal(saves, 2);
  now += 1_000;
  const log3 = `${log2}\n<!-- remember: fact | node 20 -->`;
  assert.equal(h.harvest("b", "o", log3, ["o/r"]).added.length, 0); // inside the 5 s gap
  now += 6_000;
  assert.deepEqual(
    h.harvest("b", "o", log3, ["o/r"]).added.map((n) => n.kind),
    ["fact"]
  );
  assert.deepEqual(
    h.memoryNew("b")!.map((n) => [n.kind, n.status]),
    [
      ["lesson", "pending"],
      ["preference", "kept"],
      ["fact", "kept"],
    ]
  );
  assert.deepEqual(h.rememberedKinds("b"), { lesson: 1, preference: 1, fact: 1 });
  // The operator forgets the lesson; a forced finish pass over the same log must not resurrect it.
  const lesson = store.repos["o/r"].find((n) => n.kind === "lesson")!;
  deleteNote(store, lesson.id);
  h.noteDeleted(lesson.id);
  assert.equal(h.harvest("b", "o", log3, ["o/r"], { force: true }).added.length, 0);
  assert.ok(!store.repos["o/r"].some((n) => n.kind === "lesson"));
  assert.equal(h.memoryNew("b")!.length, 2);
  // A new turn resets the tally, not the seen keys.
  h.resetRun("b");
  assert.deepEqual(h.rememberedKinds("b"), {});
  // Auto-keep rides the per-owner sweep.
  rememberRunNotes(store, { box: "c", log: "<!-- remember: playbook | old one -->", repos: ["o/r"], now });
  now += PENDING_AUTO_KEEP_MS;
  assert.equal(h.sweepPending("o").length, 1);
  // memoryNew expires after its window; forget drops everything.
  now += 16 * 60_000;
  assert.equal(h.memoryNew("b"), undefined);
  h.forget("b");
  assert.deepEqual(h.rememberedKinds("b"), {});
});

test("memory tool: POSIX script, validated kinds, defanged append to the agent log, wired by memorySetup", () => {
  const sh = memoryToolScript();
  assert.ok(sh.startsWith("#!/bin/sh\n"));
  assert.match(sh, /LOG=\/workspace\/\.agent\.log/);
  assert.match(sh, /MEMORY\.md/);
  assert.match(sh, /MEMORY-all\.md/);
  assert.ok(sh.includes(`KINDS="${MEMORY_KINDS.join(" ")}"`));
  assert.match(sh, /grep -i -F/);
  assert.ok(sh.includes('line="<!-- remember: $kind | $text"'));
  assert.ok(sh.includes("s/⟦/​⟦/g"));
  assert.match(sh, /--why\)/);
  assert.match(sh, /--replaces\)/);
  assert.ok(sh.includes('>> "$LOG"'));
  assert.doesNotMatch(sh, /\[\[|^function |\blocal /m); // no bashisms: /bin/sh is dash
  const setup = memorySetup();
  assert.ok(setup.endsWith(`base64 -d > ${MEMORY_TOOL_PATH} && chmod +x ${MEMORY_TOOL_PATH}`));
  const b64 = /printf '%s' '([A-Za-z0-9+/=]+)'/.exec(setup)![1];
  assert.equal(Buffer.from(b64, "base64").toString("utf8"), sh);
});

test("prompts: both variants carry the v2 memory paragraph", () => {
  for (const p of [AGENT_SYS_PROMPT, OMP_SYS_PROMPT]) {
    assert.match(p, /<!-- remember: <kind> \| <text>/);
    assert.match(p, /memory search/);
    assert.match(p, /lesson = /);
    assert.match(p, /playbook = /);
    assert.match(p, /replaces:/);
    assert.match(p, /Never secrets/);
  }
});

test("manual add, export → import round trip, promote a playbook", () => {
  const store = emptyMemoryStore();
  addManualNote(store, { kind: "preference", text: "use pnpm", repo: "o/r" }, 1);
  addManualNote(store, { kind: "decision", text: "squash merges", why: "clean history", repo: "O/R" }, 2);
  const pb = addManualNote(store, { kind: "playbook", text: "Release the app\n- npm version patch\n- git push --tags", repo: "o/r" }, 3);
  assert.throws(() => addManualNote(store, { kind: "nope", text: "x" }), /kind must be/);
  assert.throws(() => addManualNote(store, { kind: "fact", text: "  " }), /needs some text/);
  assert.equal(store.global[0].kind, "preference"); // an operator kind ignores the repo
  const md = exportMemoryMarkdown(store);
  assert.match(md, /## operator\n\n- \[preference\] use pnpm/);
  assert.match(md, /## o\/r\n\n- \[decision\] squash merges \| why: clean history\n- \[playbook\] Release the app\n {2}- npm version patch/);
  const back = emptyMemoryStore();
  assert.equal(importMemoryMarkdown(back, md), 3);
  assert.equal(exportMemoryMarkdown(back), md);
  assert.equal(importMemoryMarkdown(back, md), 0); // duplicates skipped
  const skill = playbookToSkill(pb);
  assert.equal(skill.name, "release-the-app");
  assert.match(skill.content, /^# Release the app\n\n- npm version patch\n- git push --tags$/);
  assert.throws(() => playbookToSkill(store.global[0]), /Only a playbook/);
});
