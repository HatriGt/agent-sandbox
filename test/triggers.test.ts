import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openMemoryDb } from "../src/db.ts";
import { makeSecretBox } from "../src/secretbox.ts";
import {
  admit,
  deliveryKeys,
  describeCron,
  escapeValue,
  isValidTimezone,
  matchGithub,
  nextFire,
  normalizeTrigger,
  parseCron,
  renderTemplate,
  safeEqual,
  templateContext,
  verifyGithubSignature,
  MAX_FIRES_PER_HOUR,
} from "../src/triggers.ts";
import { claimDelivery, createTrigger, getTrigger, getTriggerById, revealSecret } from "../src/trigger-store.ts";
import { makeDispatcher } from "../src/trigger-dispatch.ts";
import { archiveRun, ledgerTotals, listLedger } from "../src/run-archive.ts";
import type { RunDigest } from "../src/digest.ts";

const box = makeSecretBox(crypto.randomBytes(32));

test("cron: parse, next fire in UTC and in the owner's timezone", () => {
  const c = parseCron("0 2 * * 1-5");
  // Wed 2026-09-30 10:00Z → next weekday 02:00 UTC is Thu 2026-10-01 02:00Z.
  const from = Date.UTC(2026, 8, 30, 10, 0);
  assert.equal(nextFire(c, from, "UTC"), Date.UTC(2026, 9, 1, 2, 0));
  // 02:00 in Berlin (CEST, UTC+2) is 00:00Z.
  assert.equal(nextFire(c, from, "Europe/Berlin"), Date.UTC(2026, 9, 1, 0, 0));
  // Friday evening → Monday.
  assert.equal(nextFire(c, Date.UTC(2026, 9, 2, 12, 0), "UTC"), Date.UTC(2026, 9, 5, 2, 0));
  assert.equal(nextFire(parseCron("*/15 * * * *"), Date.UTC(2026, 8, 30, 10, 7), "UTC"), Date.UTC(2026, 8, 30, 10, 15));
  assert.throws(() => parseCron("61 * * * *"));
  assert.throws(() => parseCron("nope"));
  assert.ok(isValidTimezone("America/New_York"));
  assert.ok(!isValidTimezone("Mars/Olympus"));
});

test("cron: described in words", () => {
  assert.match(describeCron("0 2 * * 1-5"), /Weekdays 02:00/);
  assert.match(describeCron("*/15 * * * *"), /15 minutes/);
});

test("templating: fills from the payload, escapes values, blocks prototype walks", () => {
  const NUL = String.fromCharCode(0);
  const LS = String.fromCharCode(0x2028);
  const ctx = templateContext({ issue: { number: 7, title: `Crash {{secret}}${NUL} on${LS} boot`, body: "b" }, repository: { full_name: "o/r" } });
  const r = renderTemplate("Fix #{{issue.number}}: {{issue.title}} in {{repo.full_name}} {{nope.x}}", ctx);
  assert.ok(r.text.startsWith("Fix #7: Crash "));
  assert.ok(!r.text.includes("{{secret}}"), "a value cannot inject a new placeholder");
  assert.ok(!r.text.includes(NUL) && !r.text.includes(LS));
  assert.ok(r.text.includes("o/r"));
  assert.deepEqual(r.missing, ["nope.x"]);
  const p = renderTemplate("{{issue.__proto__}}{{issue.constructor}}", ctx);
  assert.ok(!p.text.includes("function") && !p.text.includes("Object"));
  assert.ok(escapeValue("x".repeat(10_000)).length < 4100);
});

test("signature: X-Hub-Signature-256 over the raw body", () => {
  const body = Buffer.from('{"a":1}');
  const sig = "sha256=" + crypto.createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.ok(verifyGithubSignature("s3cret", body, sig));
  assert.ok(!verifyGithubSignature("wrong", body, sig));
  assert.ok(!verifyGithubSignature("s3cret", Buffer.from('{"a":2}'), sig));
  assert.ok(!verifyGithubSignature("s3cret", body, undefined));
  assert.ok(!verifyGithubSignature("s3cret", body, sig.replace("sha256=", "sha1=")));
});

test("secret compare: constant-time and length-safe", () => {
  assert.ok(safeEqual("abc", "abc"));
  assert.ok(!safeEqual("abc", "abd"));
  assert.ok(!safeEqual("abc", "abcd"));
  assert.ok(!safeEqual("", "a"));
});

test("dedupe: delivery id and body hash are claimed once", () => {
  const db = openMemoryDb();
  const keys = deliveryKeys({ "x-github-delivery": "d-1" }, Buffer.from("{}"));
  assert.equal(keys.length, 2);
  assert.ok(claimDelivery(db, "t1", keys, 1000));
  assert.ok(!claimDelivery(db, "t1", keys, 2000), "replay rejected");
  assert.ok(!claimDelivery(db, "t1", deliveryKeys({ "x-github-delivery": "d-2" }, Buffer.from("{}")), 3000), "same body, new id rejected");
  assert.ok(claimDelivery(db, "t2", keys, 3000), "per trigger");
  // Generic: short body window — the same ping later is legitimate.
  const g = deliveryKeys({}, Buffer.from("ping"));
  assert.ok(claimDelivery(db, "t3", g, 0, 7 * 86400_000, 60_000));
  assert.ok(!claimDelivery(db, "t3", g, 30_000, 7 * 86400_000, 60_000));
  assert.ok(claimDelivery(db, "t3", g, 120_000, 7 * 86400_000, 60_000));
});

test("admission: concurrency cap (default 1), disabled, storm cap", () => {
  assert.deepEqual(admit({ enabled: true, concurrency: 1 }, 0, [], 0), { ok: true });
  assert.equal(admit({ enabled: true, concurrency: 1 }, 1, [], 0).ok, false);
  assert.equal(admit({ enabled: true, concurrency: 2 }, 1, [], 0).ok, true);
  assert.equal(admit({ enabled: false, concurrency: 1 }, 0, [], 0).ok, false);
  const now = 10 * 3600_000;
  const recent = Array.from({ length: MAX_FIRES_PER_HOUR }, (_, i) => now - i * 1000);
  assert.equal(admit({ enabled: true, concurrency: 5 }, 0, recent, now).ok, false);
  assert.equal(admit({ enabled: true, concurrency: 5 }, 0, recent, now + 3600_000).ok, true);
});

test("normalize: safe defaults and validation", () => {
  const g = normalizeTrigger({ name: "Fix", kind: "github", repo: "o/r", taskTemplate: "t", spec: { event: "issue_labeled" } });
  assert.ok(g.ok);
  if (g.ok) {
    assert.equal(g.trigger.concurrency, 1);
    assert.equal(g.trigger.prComment, true);
    assert.equal(g.trigger.spec.label, "agent");
    assert.equal(g.trigger.budget.maxMinutes, 60);
  }
  const s = normalizeTrigger({ name: "Nightly", kind: "schedule", taskTemplate: "t", spec: { cron: "@daily", timezone: "Europe/Berlin" } });
  assert.ok(s.ok && s.trigger.prComment === false);
  assert.equal(normalizeTrigger({ name: "x", kind: "schedule", taskTemplate: "t", spec: { cron: "bad" } }).ok, false);
  assert.equal(normalizeTrigger({ name: "x", kind: "github", taskTemplate: "t", spec: { event: "issue_labeled" } }).ok, false);
  assert.equal(normalizeTrigger({ name: "x", kind: "schedule", taskTemplate: "t", spec: { cron: "@daily" }, concurrency: 99 }).ok && true, true);
});

test("github filter: repo, label, trusted commenter, bots, forks", () => {
  const repo = { full_name: "o/r" };
  assert.equal(matchGithub({ event: "issue_labeled", label: "agent" }, "o/r", "issues", { action: "labeled", label: { name: "agent" }, issue: { number: 3 }, repository: repo }).match, true);
  assert.equal(matchGithub({ event: "issue_labeled", label: "agent" }, "o/r", "issues", { action: "labeled", label: { name: "bug" }, issue: { number: 3 }, repository: repo }).match, false);
  assert.equal(matchGithub({ event: "issue_labeled" }, "o/r", "issues", { action: "labeled", label: { name: "agent" }, repository: { full_name: "x/y" } }).match, false);
  const comment = (assoc: string, sender = "User") => ({ action: "created", comment: { body: "/agent fix it", author_association: assoc }, issue: { number: 4 }, repository: repo, sender: { type: sender } });
  const m = matchGithub({ event: "issue_comment", command: "/agent" }, "o/r", "issue_comment", comment("MEMBER"));
  assert.ok(m.match && m.command === "fix it");
  assert.equal(matchGithub({ event: "issue_comment" }, "o/r", "issue_comment", comment("NONE")).match, false);
  assert.equal(matchGithub({ event: "issue_comment" }, "o/r", "issue_comment", comment("OWNER", "Bot")).match, false);
  const pr = (head: string) => ({ action: "opened", pull_request: { number: 9, head: { repo: { full_name: head } } }, repository: repo });
  assert.equal(matchGithub({ event: "pr_opened" }, "o/r", "pull_request", pr("fork/r")).match, false);
  assert.equal(matchGithub({ event: "pr_opened", allowForks: true }, "o/r", "pull_request", pr("fork/r")).match, true);
  assert.equal(matchGithub({ event: "pr_opened" }, "o/r", "pull_request", pr("o/r")).match, true);
});

test("store: secret sealed at rest, owner-scoped reads", () => {
  const db = openMemoryDb();
  const n = normalizeTrigger({ name: "Fix", kind: "github", repo: "o/r", taskTemplate: "t", spec: { event: "issue_labeled" } });
  assert.ok(n.ok);
  if (!n.ok) return;
  const { row, secret } = createTrigger(db, box, "u1", n.trigger);
  const raw = db.prepare(`SELECT secret_enc FROM triggers WHERE id = ?`).get(row.id) as { secret_enc: string };
  assert.ok(!raw.secret_enc.includes(secret));
  assert.equal(revealSecret(db, box, row.id), secret);
  assert.ok(getTrigger(db, "u1", row.id));
  assert.equal(getTrigger(db, "u2", row.id), undefined);
});

const digest = (over: Partial<RunDigest> = {}): RunDigest => ({
  box: "b1",
  task: "t",
  state: "done",
  exitCode: 0,
  startedAt: 1000,
  endedAt: 2000,
  plan: [],
  files: [],
  failedCommands: [],
  questions: [],
  headline: "done",
  ...over,
});

test("dispatcher: fires through startRun with trigger provenance, holds the concurrency slot until finish", async () => {
  const db = openMemoryDb();
  const n = normalizeTrigger({ name: "Fix", kind: "github", repo: "o/r", taskTemplate: "Fix #{{issue.number}}", spec: { event: "issue_labeled" } });
  assert.ok(n.ok);
  if (!n.ok) return;
  const { row } = createTrigger(db, box, "u1", n.trigger);
  const calls: any[] = [];
  const comments: any[] = [];
  let i = 0;
  const d = makeDispatcher({
    db,
    log: () => {},
    startRun: async (input) => {
      calls.push(input);
      return { ok: true, box: `box-${++i}` };
    },
    postComment: async (owner, repo, number, body) => void comments.push({ owner, repo, number, body }),
  });
  const payload = { action: "labeled", label: { name: "agent" }, issue: { number: 12 }, repository: { full_name: "o/r" } };
  const match = matchGithub(n.trigger.spec, "o/r", "issues", payload);
  assert.ok(match.match);
  if (!match.match) return;
  const r1 = await d.fire(row, { payload, event: "issues", match });
  assert.equal(r1.outcome, "started");
  assert.ok(calls[0].task.startsWith("Fix #12"));
  assert.equal(calls[0].startedBy.kind, "trigger");
  assert.equal(calls[0].startedBy.subject.number, 12);
  assert.deepEqual(calls[0].repos, [{ repo: "o/r" }]);
  const r2 = await d.fire(getTriggerById(db, row.id)!, { payload, event: "issues", match });
  assert.equal(r2.outcome, "skipped", "concurrency 1 holds the second fire");
  assert.equal(calls.length, 1);
  await d.onRunFinished("box-1", digest({ box: "box-1" }), calls[0].startedBy, 1);
  assert.equal(comments.length, 1, "receipt comment on by default for GitHub triggers");
  assert.equal(comments[0].number, 12);
  const r3 = await d.fire(getTriggerById(db, row.id)!, { payload, event: "issues", match });
  assert.equal(r3.outcome, "started");
});

test("ledger: totals from stored columns; cost null when no run reported one", () => {
  const db = openMemoryDb();
  archiveRun(db, { box: "a", owner: "u1", digest: digest({ box: "a", endedAt: 1, provenance: { agent: "claude", startedBy: { kind: "manual" } } as any, verified: { pass: true } as any, usage: { inputTokens: 10, outputTokens: 5 } as any }) });
  archiveRun(db, { box: "b", owner: "u1", digest: digest({ box: "b", endedAt: 2, state: "failed", provenance: { startedBy: { kind: "trigger", triggerId: "t1", name: "n", source: "schedule" } } as any, verified: { pass: false } as any }) });
  archiveRun(db, { box: "c", owner: "u2", digest: digest({ box: "c", endedAt: 3 }) });
  const t = ledgerTotals(db, "u1");
  assert.equal(t.runs, 2);
  assert.equal(t.checked, 2);
  assert.equal(t.passed, 1);
  assert.equal(t.inputTokens, 10);
  assert.equal(t.costUsd, null);
  assert.equal(ledgerTotals(db, "u1", { startedBy: "trigger" }).runs, 1);
  assert.equal(ledgerTotals(db, "u1", { triggerId: "t1" }).runs, 1);
  assert.equal(ledgerTotals(db, "u1", { verified: "yes" }).runs, 1);
  assert.equal(listLedger(db, "u1", { state: "failed" }).length, 1);
});
