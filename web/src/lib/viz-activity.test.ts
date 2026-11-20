// Activity-card parsers (lib/viz-activity.ts): what each fence needs, what it tolerates, what stays code.
// Run from web/:  npx --yes tsx --tsconfig tsconfig.json --test src/lib/viz-activity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { activityTitle, parseActivity, parseDuration, parseFraction } from "./viz-activity";

test("durations: clocks, unit words, and nothing else", () => {
  assert.equal(parseDuration("2:48"), 168);
  assert.equal(parseDuration("1:02:05"), 3725);
  assert.equal(parseDuration("6h 14m"), 22440);
  assert.equal(parseDuration("4 min"), 240);
  assert.equal(parseDuration("90s"), 90);
  assert.equal(parseDuration("1.5h"), 5400);
  assert.equal(parseDuration("4 min left"), null);
  assert.equal(parseDuration("soon"), null);
});

test("fractions: percent, ratio, 'of', unit interval", () => {
  assert.equal(parseFraction("62%"), 0.62);
  assert.equal(parseFraction("3/5"), 0.6);
  assert.equal(parseFraction("3 of 4"), 0.75);
  assert.equal(parseFraction("0.4"), 0.4);
  assert.equal(parseFraction("140%"), 1);
  assert.equal(parseFraction("Checkout"), null);
});

test("timer: left over total gives the share passed; zero left is expired", () => {
  const t = parseActivity("timer", "title: Build · orders-api\nstatus: Compiling\nleft: 2:48\ntotal: 4:00\nends: 09:31");
  assert.ok(t && t.kind === "timer");
  assert.equal(t.title, "Build · orders-api");
  assert.equal(t.status, "Compiling");
  assert.equal(t.hero, "2:48");
  assert.equal(t.heroLabel, "left");
  assert.ok(Math.abs(t.frac! - 0.3) < 1e-9);
  assert.equal(t.expired, false);
  assert.equal(t.tone, "live");
  assert.equal(t.ends, "09:31");
  const up = parseActivity("countdown", "title: Parking · Oak St\nleft: 0:00");
  assert.ok(up && up.kind === "timer" && up.expired && up.tone === "fail" && up.frac === 1);
  const elapsed = parseActivity("timer", "elapsed: 0:04");
  assert.ok(elapsed && elapsed.kind === "timer" && elapsed.heroLabel === "elapsed" && elapsed.frac === null);
  assert.equal(parseActivity("timer", "title: nothing to time"), null);
});

test("timer: the first colon-less line is the headline, bullets and bold are tidied by the caller", () => {
  const t = parseActivity("timer", "Strong, 4 min\nleft: 2:48\ntotal: 4 min");
  assert.ok(t && t.kind === "timer" && t.status === "Strong, 4 min");
  assert.ok(Math.abs(t.frac! - 0.3) < 1e-9);
});

test("queue: position and length place the marker; 'next' is the head of the line", () => {
  const q = parseActivity("queue", "title: Merge queue · main\nposition: #12\nof: 40\nwait: 2 min\nend: Merge\ntickets: 2");
  assert.ok(q && q.kind === "queue");
  assert.equal(q.position, 12);
  assert.equal(q.of, 40);
  assert.equal(q.ahead, 11);
  assert.equal(q.wait, "2 min");
  assert.equal(q.end, "Merge");
  assert.ok(Math.abs(q.frac! - (1 - 11 / 40)) < 1e-9);
  assert.deepEqual(q.footer, [{ key: "tickets", value: "2" }]);
  const next = parseActivity("queue", "position: next\nstatus: You're next");
  assert.ok(next && next.kind === "queue" && next.position === 1 && next.positionText === "next" && next.frac === 0.92);
  const ready = parseActivity("queue", "position: 1\nstatus: Table ready");
  assert.ok(ready && ready.kind === "queue" && ready.tone === "ok");
  assert.equal(parseActivity("queue", "status: In line"), null);
  assert.equal(parseActivity("queue", "position: soon"), null);
});

test("journey: stops space themselves, progress may name a stop, the carrier rides in `by`", () => {
  const j = parseActivity("journey", "title: Deploy · orders-api\nstatus: Rolling out\nstops: Build, Test, Canary, Production\nprogress: Canary\nremaining: 2 min\ndeparted: 09:14\narrives: 09:31\nby: freestyle-a · 2 vCPU");
  assert.ok(j && j.kind === "journey");
  assert.deepEqual(
    j.stops.map((s) => [s.label, s.frac]),
    [
      ["Build", 0],
      ["Test", 1 / 3],
      ["Canary", 2 / 3],
      ["Production", 1],
    ]
  );
  assert.equal(j.frac, 2 / 3);
  assert.equal(j.from, "Build");
  assert.equal(j.to, "Production");
  assert.equal(j.remaining, "2 min");
  assert.equal(j.by, "freestyle-a · 2 vCPU");
  const pct = parseActivity("delivery", "from: Warehouse\nto: Door\nprogress: 80%");
  assert.ok(pct && pct.kind === "journey" && pct.frac === 0.8 && pct.stops.length === 0);
  assert.equal(parseActivity("journey", "stops: Build, Test\nprogress: Nowhere"), null);
  assert.equal(parseActivity("journey", "status: On the way"), null);
  const arrived = parseActivity("trip", "from: A\nto: B\nprogress: 100%");
  assert.ok(arrived && arrived.tone === "ok");
});

test("transfer: both ends required, a tag chips the header, progress must be a fraction", () => {
  const t = parseActivity("transfer", "title: Thread move · jrrrly\nfrom: VPS\nto: FS-A\nprogress: 62%\ngate: rsync\ndeparted: 09:05\narrives: in 35 s");
  assert.ok(t && t.kind === "transfer");
  assert.equal(t.from, "VPS");
  assert.equal(t.to, "FS-A");
  assert.equal(t.frac, 0.62);
  assert.equal(t.tag, "rsync");
  assert.equal(t.arrives, "in 35 s");
  assert.equal(parseActivity("flight", "from: LIS\nprogress: 10%"), null);
  assert.equal(parseActivity("flight", "from: LIS\nto: NRT\nprogress: somewhere"), null);
  const landed = parseActivity("migration", "from: v1\nto: v2\nstatus: done");
  assert.ok(landed && landed.tone === "ok" && landed.frac === null);
});

test("versus: a score line or two sides; live unless the status says it ended", () => {
  const v = parseActivity("versus", "title: Benchmark · p95\nscore: main 182 - 176 feature\nstatus: live\nevent: regression\nclock: run 12\nsamples: 400");
  assert.ok(v && v.kind === "versus");
  assert.deepEqual(v.home, { name: "main", score: "182" });
  assert.deepEqual(v.away, { name: "feature", score: "176" });
  assert.equal(v.live, true);
  assert.equal(v.event, "regression");
  assert.equal(v.clock, "run 12");
  assert.deepEqual(v.footer, [{ key: "samples", value: "400" }]);
  const sides = parseActivity("match", "home: Harbor 3\naway: Ridge 2\nstatus: final");
  assert.ok(sides && sides.kind === "versus" && !sides.live && sides.tone === "ok" && sides.home.score === "3" && sides.away.name === "Ridge");
  const units = parseActivity("scoreboard", "before: 410ms\nafter: 182ms");
  assert.ok(units && units.kind === "versus" && units.home.score === "410ms" && units.away.name === "after");
  assert.equal(parseActivity("versus", "home: Harbor 3"), null);
  assert.equal(parseActivity("versus", "score: Harbor beat Ridge"), null);
});

test("ring: a value, a share when max is known, elapsed time", () => {
  const r = parseActivity("ring", "title: Retry · fetch\nvalue: 3\nmax: 5\nstatus: Attempt 3 of 5 · 60 s backoff\ntime: 0:36");
  assert.ok(r && r.kind === "ring");
  assert.equal(r.value, "3");
  assert.equal(r.n, 3);
  assert.equal(r.max, 5);
  assert.equal(r.frac, 0.6);
  assert.equal(r.time, "0:36");
  const bare = parseActivity("counter", "count: 12 reps");
  assert.ok(bare && bare.kind === "ring" && bare.n === 12 && bare.max === null && bare.frac === null);
  const full = parseActivity("ring", "value: 4\nof: 4");
  assert.ok(full && full.tone === "ok");
  assert.equal(parseActivity("ring", "max: 5"), null);
});

test("stages: marks, a named current stage, or an inline percent", () => {
  const s = parseActivity("stages", "title: Wash · 30°\nstages: Wash ✓, Rinse ✓, Spin (40%)\nremaining: 16 min");
  assert.ok(s && s.kind === "stages");
  assert.deepEqual(
    s.stages.map((x) => [x.label, x.state, x.frac]),
    [
      ["Wash", "done", null],
      ["Rinse", "done", null],
      ["Spin", "active", 0.4],
    ]
  );
  assert.equal(s.status, "Spin");
  assert.equal(s.remaining, "16 min");
  const named = parseActivity("phases", "phases: Install | Build | Test | Deploy\ncurrent: Test\nprogress: 3/4");
  assert.ok(named && named.kind === "stages");
  assert.deepEqual(
    named.stages.map((x) => x.state),
    ["done", "done", "active", "todo"]
  );
  assert.equal(named.stages[2].frac, 0.75);
  const done = parseActivity("cycle", "stages: a ✓, b ✓");
  assert.ok(done && done.tone === "ok");
  assert.equal(parseActivity("stages", "stages: only"), null);
  assert.equal(parseActivity("stages", "stages: a, b\ncurrent: zzz"), null);
});

test("bounds and unknowns: a stray line or too many lines stay code; unclaimed keys become footer facts in order", () => {
  assert.equal(parseActivity("timer", "left: 2:00\nthis line has no key"), null);
  assert.equal(parseActivity("timer", Array.from({ length: 25 }, (_, i) => `k${i}: v`).join("\n")), null);
  assert.equal(parseActivity("yaml", "left: 2:00"), null);
  const t = parseActivity("timer", "left: 1:00\nzeta: 1\nalpha: 2\nnote: quiet");
  assert.ok(t && t.kind === "timer");
  assert.deepEqual(t.footer, [
    { key: "zeta", value: "1" },
    { key: "alpha", value: "2" },
  ]);
  assert.equal(t.note, "quiet");
});

test("activityTitle names an activity fence for the live-slot registry, and nothing else", () => {
  assert.equal(activityTitle("timer", "status: x\nTitle: Build · api\nleft: 1:00"), "Build · api");
  assert.equal(activityTitle("timer", "left: 1:00"), undefined);
  assert.equal(activityTitle("stats", "title: Build"), undefined);
});
