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
  parseAutomateRejects,
  parseWhen,
  renderTemplate,
  safeEqual,
  templateContext,
  verifyGithubSignature,
  MAX_FIRES_PER_HOUR,
  shouldDestroyBox,
} from "../src/triggers.ts";
import { claimDelivery, createTrigger, getTrigger, getTriggerById, revealSecret } from "../src/trigger-store.ts";
import { makeDispatcher } from "../src/trigger-dispatch.ts";
import { PRE_PUSH_HOOK, refusePush } from "../src/pr-only.ts";
import { archiveRun, ledgerTotals, listLedger } from "../src/run-archive.ts";
import type { RunDigest } from "../src/digest.ts";

const box = makeSecretBox(crypto.randomBytes(32));

test("cron: parse, next fire in UTC and in the owner's timezone", () => {
  const c = parseCron("0 2 * * 1-5");
  // Wed 2026-09-30 10:00Z â†’ next weekday 02:00 UTC is Thu 2026-10-01 02:00Z.
  const from = Date.UTC(2026, 8, 30, 10, 0);
  assert.equal(nextFire(c, from, "UTC"), Date.UTC(2026, 9, 1, 2, 0));
  // 02:00 in Berlin (CEST, UTC+2) is 00:00Z.
  assert.equal(nextFire(c, from, "Europe/Berlin"), Date.UTC(2026, 9, 1, 0, 0));
  // Friday evening â†’ Monday.
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
  // Generic: short body window â€” the same ping later is legitimate.
  const g = deliveryKeys({}, Buffer.from("ping"));
  assert.ok(claimDelivery(db, "t3", g, 0, 7 * 86400_000, 60_000));
  assert.ok(!claimDelivery(db, "t3", g, 30_000, 7 * 86400_000, 60_000));
  assert.ok(claimDelivery(db, "t3", g, 120_000, 7 * 86400_000, 60_000));
});

test("admission: disabled and storm cap; runs already going never block a new fire", () => {
  assert.deepEqual(admit({ enabled: true }, [], 0), { ok: true });
  assert.equal(admit({ enabled: false }, [], 0).ok, false);
  const now = 10 * 3600_000;
  const recent = Array.from({ length: MAX_FIRES_PER_HOUR }, (_, i) => now - i * 1000);
  assert.equal(admit({ enabled: true }, recent, now).ok, false);
  assert.equal(admit({ enabled: true }, recent, now + 3600_000).ok, true);
});

test("normalize: safe defaults and validation", () => {
  const g = normalizeTrigger({ name: "Fix", kind: "github", repo: "o/r", taskTemplate: "t", spec: { event: "issue_labeled" } });
  assert.ok(g.ok);
  if (g.ok) {
    assert.equal(g.trigger.prComment, true);
    assert.equal(g.trigger.spec.label, "agent");
  }
  const s = normalizeTrigger({ name: "Nightly", kind: "schedule", taskTemplate: "t", spec: { cron: "@daily", timezone: "Europe/Berlin" } });
  assert.ok(s.ok && s.trigger.prComment === false);
  assert.equal(normalizeTrigger({ name: "x", kind: "schedule", taskTemplate: "t", spec: { cron: "bad" } }).ok, false);
  assert.equal(normalizeTrigger({ name: "x", kind: "github", taskTemplate: "t", spec: { event: "issue_labeled" } }).ok, false);
});

test("github filter: repo, label, trusted commenter, bots, forks", () => {
  const repo = { full_name: "o/r" };
  assert.equal(matchGithub({ event: "issue_labeled", label: "agent" }, ["o/r"], "issues", { action: "labeled", label: { name: "agent" }, issue: { number: 3 }, repository: repo }).match, true);
  assert.equal(matchGithub({ event: "issue_labeled", label: "agent" }, ["o/r"], "issues", { action: "labeled", label: { name: "bug" }, issue: { number: 3 }, repository: repo }).match, false);
  assert.equal(matchGithub({ event: "issue_labeled" }, ["o/r"], "issues", { action: "labeled", label: { name: "agent" }, repository: { full_name: "x/y" } }).match, false);
  const comment = (assoc: string, sender = "User") => ({ action: "created", comment: { body: "/agent fix it", author_association: assoc }, issue: { number: 4 }, repository: repo, sender: { type: sender } });
  const m = matchGithub({ event: "issue_comment", command: "/agent" }, ["o/r"], "issue_comment", comment("MEMBER"));
  assert.ok(m.match && m.command === "fix it");
  assert.equal(matchGithub({ event: "issue_comment" }, ["o/r"], "issue_comment", comment("NONE")).match, false);
  assert.equal(matchGithub({ event: "issue_comment" }, ["o/r"], "issue_comment", comment("OWNER", "Bot")).match, false);
  const pr = (head: string) => ({ action: "opened", pull_request: { number: 9, head: { repo: { full_name: head } } }, repository: repo });
  assert.equal(matchGithub({ event: "pr_opened" }, ["o/r"], "pull_request", pr("fork/r")).match, false);
  assert.equal(matchGithub({ event: "pr_opened", allowForks: true }, ["o/r"], "pull_request", pr("fork/r")).match, true);
  assert.equal(matchGithub({ event: "pr_opened" }, ["o/r"], "pull_request", pr("o/r")).match, true);
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

test("dispatcher: fires through startRun with trigger provenance; overlapping events each get their own box", async () => {
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
  const match = matchGithub(n.trigger.spec, ["o/r"], "issues", payload);
  assert.ok(match.match);
  if (!match.match) return;
  const r1 = await d.fire(row, { payload, event: "issues", match });
  assert.equal(r1.outcome, "started");
  assert.ok(calls[0].task.startsWith("Fix #12"));
  assert.equal(calls[0].startedBy.kind, "trigger");
  assert.equal(calls[0].startedBy.subject.number, 12);
  assert.deepEqual(calls[0].repos, [{ repo: "o/r" }]);
  const r2 = await d.fire(getTriggerById(db, row.id)!, { payload, event: "issues", match });
  assert.equal(r2.outcome, "started", "a second event while the first run is going starts its own box");
  assert.equal(r2.box, "box-2");
  assert.equal(d.activeCount(row.id), 2);
  await d.onRunFinished("box-1", digest({ box: "box-1" }), calls[0].startedBy, 1);
  assert.equal(comments.length, 1, "receipt comment on by default for GitHub triggers");
  assert.equal(comments[0].number, 12);
  assert.equal(d.activeCount(row.id), 1);
});

test("dispatcher: in-flight and storm counts survive a controller restart; reconcile frees dead boxes", async () => {
  const db = openMemoryDb();
  const n = normalizeTrigger({ name: "Nightly", kind: "schedule", taskTemplate: "go", spec: { cron: "0 2 * * *" } });
  assert.ok(n.ok);
  if (!n.ok) return;
  const { row } = createTrigger(db, box, "u1", n.trigger);
  let t = 1_000_000_000_000;
  let i = 0;
  let live = new Set<string>();
  const mk = () =>
    makeDispatcher({
      db,
      log: () => {},
      now: () => t,
      liveBoxes: async () => live,
      startRun: async () => {
        const b = `box-${++i}`;
        live.add(b);
        return { ok: true, box: b };
      },
    });
  const d1 = mk();
  assert.equal((await d1.fire(row, { manual: true })).outcome, "started");
  // "Restart": a fresh dispatcher over the same DB still sees the held slot.
  const d2 = mk();
  assert.equal(d2.activeCount(row.id), 1);
  assert.equal((await d2.fire(row, { manual: true })).outcome, "started", "no cap: a second run starts alongside");
  assert.equal(d2.activeCount(row.id), 2);
  // The box vanished while the controller was down: reconcile (past the grace window) frees it.
  live = new Set();
  t += 180_000;
  await d2.reconcile();
  assert.equal(d2.activeCount(row.id), 0);
  // A listing failure must not free slots.
  assert.equal((await d2.fire(row, { manual: true })).outcome, "started");
  const d3 = makeDispatcher({ db, log: () => {}, now: () => t + 600_000, liveBoxes: async () => { throw new Error("msb ls failed"); }, startRun: async () => ({ ok: true, box: "x" }) });
  await d3.reconcile();
  assert.equal(d3.activeCount(row.id), 1);
  // Storm cap counts persisted attempts: finish each run and keep firing until the cap bites.
  const d4 = mk();
  let last = "";
  for (let k = 0; k < 20; k++) {
    for (const b of [...live]) await d4.onRunFinished(b, digest({ box: b }), undefined);
    d4.forget("x");
    last = (await d4.fire(row, { manual: true })).outcome;
    t += 1000;
  }
  assert.equal(last, "skipped", "storm cap holds across dispatcher instances");
});

test("box policy: destroy only finished runs, per the automation's setting; normalize keeps it", async () => {
  assert.equal(shouldDestroyBox(undefined, "done"), true, "unset = destroy after a clean finish");
  assert.equal(shouldDestroyBox(undefined, "failed"), false);
  assert.equal(shouldDestroyBox("keep", "done"), false);
  assert.equal(shouldDestroyBox("done", "done"), true);
  assert.equal(shouldDestroyBox("done", "failed"), false, "a failed box is kept to inspect");
  assert.equal(shouldDestroyBox("always", "failed"), true);
  assert.equal(shouldDestroyBox("always", "waiting"), false, "a run paused on a question has not finished");
  const n = normalizeTrigger({ name: "Review", kind: "watch", repo: "o/r", taskTemplate: "t", spec: { watch: ["pr_opened"], destroy: "always" } });
  assert.ok(n.ok);
  if (!n.ok) return;
  assert.equal(n.trigger.spec.destroy, "always");
  const bad = normalizeTrigger({ name: "Review", kind: "watch", repo: "o/r", taskTemplate: "t", spec: { watch: ["pr_opened"], destroy: "nuke" } });
  assert.ok(bad.ok && bad.trigger.spec.destroy === undefined);
  const keep = normalizeTrigger({ name: "Review", kind: "watch", repo: "o/r", taskTemplate: "t", spec: { watch: ["pr_opened"], destroy: "keep" } });
  assert.ok(keep.ok && keep.trigger.spec.destroy === "keep", "an explicit keep is stored, since unset now destroys");
  const db = openMemoryDb();
  const { row } = createTrigger(db, box, "u1", n.trigger);
  const d = makeDispatcher({ db, log: () => {}, startRun: async () => ({ ok: true, box: "b1" }) });
  assert.equal((await d.fire(row, { manual: true })).box, "b1");
  assert.deepEqual(await d.onRunFinished("b1", digest({ box: "b1", state: "failed" }), undefined, 1), { destroy: true });
  assert.deepEqual(await d.onRunFinished("stranger", digest({ box: "stranger" }), undefined, 2), { destroy: false }, "a box no automation started is never destroyed");
});

test("PR-only: default branch and deletions refused; feature branches pass", () => {
  assert.ok(refusePush("refs/heads/main", "abc"));
  assert.ok(refusePush("refs/heads/master", "abc"));
  assert.ok(refusePush("refs/heads/develop", "abc", "develop"));
  assert.ok(refusePush("refs/heads/agent/fix-12", "0000000000000000000000000000000000000000"));
  assert.equal(refusePush("refs/heads/agent/fix-12", "abc", "main"), null);
  assert.equal(refusePush("main-fix", "abc", "main"), null);
});

test("PR-only: the pre-push hook refuses the default branch in a real repo", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, chmodSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "asb-prhook-"));
  const hook = join(dir, "pre-push");
  writeFileSync(hook, PRE_PUSH_HOOK);
  chmodSync(hook, 0o755);
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd, stdio: "pipe" });
  const remote = join(dir, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  const work = join(dir, "work");
  execFileSync("git", ["init", "-q", "-b", "main", work]);
  git(work, "commit", "-q", "--allow-empty", "-m", "x");
  git(work, "remote", "add", "origin", remote);
  git(work, "config", "core.hooksPath", dir);
  assert.throws(() => git(work, "push", "-q", "origin", "HEAD:main"), /refused push to main/);
  git(work, "push", "-q", "origin", "HEAD:agent/fix");
  assert.throws(() => git(work, "push", "-q", "origin", ":agent/fix"), /delete/);

  // Chaining: the repo's own .git/hooks/pre-push runs after the guard, with the same stdin.
  const { existsSync, readFileSync, rmSync, mkdirSync } = await import("node:fs");
  const own = join(work, ".git", "hooks", "pre-push");
  writeFileSync(own, `#!/bin/sh\ncat > "$(git rev-parse --git-dir)/chained.txt"\nexit 0\n`);
  chmodSync(own, 0o755);
  git(work, "push", "-q", "origin", "HEAD:agent/two");
  assert.match(readFileSync(join(work, ".git", "chained.txt"), "utf8"), /refs\/heads\/agent\/two/);
  writeFileSync(own, `#!/bin/sh\necho repo-hook-says-no >&2\nexit 1\n`);
  assert.throws(() => git(work, "push", "-q", "origin", "HEAD:agent/three"), /repo-hook-says-no/);
  // Husky: .husky/pre-push is chained when there is no .git/hooks one.
  rmSync(own);
  mkdirSync(join(work, ".husky"));
  writeFileSync(join(work, ".husky", "pre-push"), `echo husky-says-no >&2\nexit 1\n`);
  assert.throws(() => git(work, "push", "-q", "origin", "HEAD:agent/four"), /husky-says-no/);
  assert.equal(existsSync(join(work, ".git", "hooks", "pre-push")), false);
});

test("PR-only: fails closed — a guard that will not install tears the box down with a reason", async () => {
  const { guardOrStop } = await import("../src/pr-only.ts");
  const torn: string[] = [];
  let tries = 0;
  const r = await guardOrStop(
    "box-1",
    async () => {
      tries++;
      throw new Error("exec failed");
    },
    async (b) => void torn.push(b),
    () => {}
  );
  assert.equal(r.ok, false);
  assert.match((r as { question: string }).question, /PR-only guard could not be installed.*exec failed/);
  assert.deepEqual(torn, ["box-1"]);
  assert.equal(tries, 2);
  const ok = await guardOrStop("box-2", async () => {}, async (b) => void torn.push(b), () => {});
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(torn, ["box-1"]);
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

test("parseWhen reads the ways an agent phrases a delay", () => {
  const now = Date.UTC(2026, 9, 3, 12, 0);
  const at = (w: string) => (parseWhen(w, now) as { at: number } | null)?.at;
  const DAY = 86_400_000;
  assert.equal(at("in 5d"), now + 5 * DAY);
  assert.equal(at("5 days from now"), now + 5 * DAY);
  assert.equal(at("after 2 hours"), now + 2 * 3_600_000);
  assert.equal(at("in 1 week"), now + 7 * DAY);
  assert.equal(at("an hour"), now + 3_600_000);
  assert.equal(at("+30m"), now + 30 * 60_000);
  assert.equal(at("tomorrow"), Date.UTC(2026, 9, 4, 9, 0));
  assert.equal(at("tomorrow at 2:30pm"), Date.UTC(2026, 9, 4, 14, 30));
  assert.equal(parseWhen("someday", now), null);
  assert.equal(parseWhen("in 0d", now), null);
});

test("parseAutomateRejects names the markers that could not be scheduled", () => {
  const log = [
    "<!-- schedule?: when it feels right | Merge the PR. -->",
    "<!-- automate: in 2h | Summarize CI. -->",
    "<!-- schedule: in 2h | Check CI again. -->",
  ].join("\n");
  const r = parseAutomateRejects(log);
  assert.equal(r.length, 2);
  assert.equal(r[0].task, "Merge the PR.");
  assert.match(r[0].reason, /not a time/);
  assert.match(r[1].reason, /repeating/);
});
