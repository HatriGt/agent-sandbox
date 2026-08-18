/**
 * Tests for the pure fleet-monitor shaping: parsing `msb ls --format json`, classifying boxes by
 * role, parsing run-state/metrics lines, and rendering the report. IO (gatherMonitor) is not tested
 * here — only the deterministic transforms it feeds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLsJson,
  classifyBox,
  parseRunState,
  parseMetrics,
  formatMonitor,
  type BoxView,
} from "../src/monitor.ts";

test("parseLsJson: parses the msb json array", () => {
  const out = parseLsJson(
    JSON.stringify([
      { name: "pool-1", status: "Running", image: "node", created_at: "2026-08-18T09:08:26Z" },
      { name: "delegate-2", status: "Running" },
    ])
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "pool-1");
  assert.equal(out[1].name, "delegate-2");
});

test("parseLsJson: tolerant of empty / non-json / non-array", () => {
  assert.deepEqual(parseLsJson(""), []);
  assert.deepEqual(parseLsJson("no sandboxes"), []);
  assert.deepEqual(parseLsJson("{}"), []);
  // entries missing a name are dropped
  assert.deepEqual(parseLsJson('[{"status":"Running"}]'), []);
});

test("classifyBox: pool free vs claimed vs session", () => {
  assert.equal(classifyBox("pool-abc", false), "pool-free");
  assert.equal(classifyBox("pool-abc", true), "pool-claimed");
  assert.equal(classifyBox("delegate-xyz", false), "session");
  // claim flag is ignored for non-pool boxes
  assert.equal(classifyBox("delegate-xyz", true), "session");
});

test("parseRunState: maps every sentinel line", () => {
  assert.deepEqual(parseRunState("run:running"), { state: "running" });
  assert.deepEqual(parseRunState("run:waiting — asked"), { state: "waiting" });
  assert.deepEqual(parseRunState("run:done exit=0"), { state: "done", exitCode: 0 });
  assert.deepEqual(parseRunState("run:done exit=1"), { state: "done", exitCode: 1 });
  assert.deepEqual(parseRunState("run:idle"), { state: "idle" });
  assert.deepEqual(parseRunState("garbage"), { state: "idle" });
});

test("parseMetrics: extracts cpu/mem/uptime from the table", () => {
  const table =
    "NAME       STATE      CPU          MEM                   DISK R/W /s    NET RX/TX /s    UPTIME\n" +
    "box-1      running    0.00 / 1c    63.4 MiB / 1.0 GiB    0 B / 0 B      0 B / 0 B       43m18s";
  const m = parseMetrics(table);
  assert.equal(m.cpu, "0.00 / 1c");
  assert.equal(m.mem, "63.4 MiB / 1.0 GiB");
  assert.equal(m.uptime, "43m18s");
});

test("parseMetrics: empty / header-only returns {}", () => {
  assert.deepEqual(parseMetrics(""), {});
  assert.deepEqual(parseMetrics("NAME STATE CPU"), {});
});

test("formatMonitor: empty fleet", () => {
  assert.equal(formatMonitor([]), "No sandboxes are up.");
});

test("formatMonitor: summary counts + task + waiting question", () => {
  const views: BoxView[] = [
    {
      name: "delegate-1",
      role: "session",
      boxStatus: "Running",
      runState: "running",
      task: "publish latest changes to npm",
      uptime: "5m",
      cpu: "0.10 / 1c",
      mem: "120 MiB / 1.0 GiB",
    },
    {
      name: "pool-claimed-1",
      role: "pool-claimed",
      boxStatus: "Running",
      runState: "waiting",
      task: "add caching layer",
      question: "Redis or in-memory?",
    },
    { name: "pool-free-1", role: "pool-free", boxStatus: "Running", runState: "idle" },
  ];
  const out = formatMonitor(views);
  // 3 up, 2 sessions (session + claimed), 1 pool free, 1 running, 1 waiting
  assert.match(out, /3 sandbox\(es\) up/);
  assert.match(out, /2 session\(s\)/);
  assert.match(out, /1 warm pool free/);
  assert.match(out, /1 running, 1 waiting/);
  // task + question surfaced
  assert.match(out, /publish latest changes to npm/);
  assert.match(out, /question: Redis or in-memory\?/);
  // sessions render before the free pool box
  assert.ok(out.indexOf("delegate-1") < out.indexOf("pool-free-1"));
});
