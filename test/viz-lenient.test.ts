import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChartSpec, parseFlow, parseStats, tidyFence } from "../web/src/lib/viz.ts";
import { parseFunnel, parseKv, parseProgress, parseSteps, parseTimeline } from "../web/src/lib/viz-extra.ts";

test("chart: the agent's `x` spelling renders (real transcript)", () => {
  const src =
    '{"type":"bar","title":"Deal QA received calls — 5s buckets (2026-10-01 UTC)","x":["31:00","34:10","34:15"],"series":[{"name":"calls","data":[1,6,4]}]}';
  const c = parseChartSpec(src);
  assert.deepEqual(c?.labels, ["31:00", "34:10", "34:15"]);
  assert.deepEqual(c?.series[0].data, [1, 6, 4]);
});

test("chart: aliases — pie, series map, point lists, numeric strings, kind", () => {
  assert.equal(parseChartSpec('{"type":"pie","labels":["a","b"],"values":[1,2]}')?.type, "donut");
  assert.deepEqual(parseChartSpec('{"type":"line","labels":["a","b"],"series":{"p95":[1,2],"p50":[0,1]}}')?.series.map((s) => s.name), ["p95", "p50"]);
  const pts = parseChartSpec('{"kind":"Line","data":[{"x":"mon","y":"1,200"},{"x":"tue","y":"12%"}]}');
  assert.deepEqual(pts?.labels, ["mon", "tue"]);
  assert.deepEqual(pts?.series[0].data, [1200, 12]);
  assert.deepEqual(parseChartSpec('{"type":"bar","categories":["a"],"y":[3]}')?.series[0].data, [3]);
});

test("chart: still rejects what it cannot honestly draw", () => {
  assert.equal(parseChartSpec('{"type":"bar","x":["a","b"],"y":[1]}'), null); // length mismatch: never pad
  assert.equal(parseChartSpec('{"type":"radar","labels":["a"],"values":[1]}'), null);
  assert.equal(parseChartSpec('{"type":"bar","labels":["a"],"values":["n/a"]}'), null);
  assert.equal(parseChartSpec("[1,2]"), null);
});

const T = <R>(lang: string, f: (s: string) => R) => (s: string) => f(tidyFence(lang, s));

test("line fences: markdown bullets, bold labels and = / | separators", () => {
  assert.deepEqual(T("stats", parseStats)("- **Requests**: 1,234\n- p95 = 210ms")?.map((s) => [s.label, s.value]), [["Requests", "1,234"], ["p95", "210ms"]]);
  assert.equal(T("stats", parseStats)("- p95: 210ms | -40ms!")?.[0].delta, "-40ms");
  assert.equal(T("progress", parseProgress)("- docs | 40%")?.[0].frac, 0.4);
  assert.deepEqual(T("kv", parseKv)("host = a\nport = 80"), [{ key: "host", value: "a" }, { key: "port", value: "80" }]);
  assert.equal(T("funnel", parseFunnel)("visits | 1,000\nsignups | 120")?.[0].value, 1000);
});

test("timeline, steps, flow: common agent spellings", () => {
  assert.deepEqual(T("timeline", parseTimeline)("10:00 - started\n- 10:05 — tests ✗")?.map((e) => [e.time, e.text, e.state]), [["10:00", "started", "plain"], ["10:05", "tests", "fail"]]);
  assert.deepEqual(T("steps", parseSteps)("- [x] Clone\n- [ ] Build\n- Deploy")?.map((s) => s.state), ["done", "todo", "todo"]);
  assert.deepEqual(T("flow", parseFlow)("build --> test ==> deploy")?.[0].map((s) => s.name), ["build", "test", "deploy"]);
});

test("tidyFence leaves other fences untouched", () => {
  const src = "- a = b\n**c**";
  assert.equal(tidyFence("json", src), src);
  assert.equal(tidyFence("log", src), src);
});
