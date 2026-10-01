import { test } from "node:test";
import assert from "node:assert/strict";
import { completeLines, repairPartialJson } from "../web/src/lib/viz-stream.ts";
import { parseChartSpec, parseStats, tidyFence } from "../web/src/lib/viz.ts";
import { parseSteps, parseTimeline } from "../web/src/lib/viz-extra.ts";

const CHART =
  '{"type":"bar","title":"Deal QA received calls","x":["31:00","34:10","34:15","34:20"],"series":[{"name":"calls","data":[1,6,4,123]}]}';

test("repairPartialJson: closes a prefix after its last finished value", () => {
  assert.equal(repairPartialJson('{"x":["a","b'), '{"x":["a"]}');
  assert.equal(repairPartialJson('{"a":1,"b":'), '{"a":1}');
  assert.equal(repairPartialJson('{"a":{'), '{"a":{}}');
  assert.equal(repairPartialJson('{"t":"a, b'), "{}");
  assert.equal(repairPartialJson('{"t":"q\\"x",'), '{"t":"q\\"x"}');
  assert.equal(repairPartialJson('{"ty'), "{}");
  assert.equal(repairPartialJson("  "), null);
});

test("streaming chart: every cut parses or waits, and never shows a value it has not finished", () => {
  const full = parseChartSpec(CHART)!;
  let drew = 0;
  for (let i = 1; i <= CHART.length; i++) {
    const fixed = repairPartialJson(CHART.slice(0, i));
    if (fixed) JSON.parse(fixed); // repaired text must always be valid JSON
    const spec = fixed ? parseChartSpec(fixed, { partial: true }) : null;
    if (!spec) continue;
    drew++;
    // A prefix of the final chart: same labels and values, in order, nothing extra.
    assert.deepEqual(spec.labels, full.labels.slice(0, spec.labels.length));
    assert.deepEqual(spec.series[0].data, full.series[0].data.slice(0, spec.labels.length));
  }
  assert.ok(drew > 0, "the chart should draw before the fence closes");
  // "123" must never be shown as 1 or 12 on the way in.
  for (let i = CHART.indexOf("123"); i < CHART.indexOf("123") + 3; i++) {
    const s = parseChartSpec(repairPartialJson(CHART.slice(0, i))!, { partial: true });
    assert.ok(!s || !s.series[0].data.includes(1) || s.labels.length < 4);
  }
});

test("completeLines keeps only finished lines", () => {
  assert.equal(completeLines("a: 1\nb: 2"), "a: 1");
  assert.equal(completeLines("a: 1\nb: 2\n"), "a: 1\nb: 2");
  assert.equal(completeLines("a: 1"), "");
});

test("streaming line fences: each cut is a prefix of the final rows", () => {
  const cases: [string, string, (s: string) => unknown[] | null][] = [
    ["stats", "Calls: 49 | +12%\np95: 210ms | -40ms!\nErrors: 3", parseStats],
    ["timeline", "10:00 | started ✓\n10:05 | tests ✗\n10:09 | retry …", parseTimeline],
    ["steps", "1. Clone ✓\n2. Build …\n3. Deploy", parseSteps],
  ];
  for (const [lang, src, parse] of cases) {
    const final = parse(tidyFence(lang, src))!;
    for (let i = 1; i <= src.length; i++) {
      const rows = parse(tidyFence(lang, completeLines(src.slice(0, i))));
      if (!rows) continue;
      assert.ok(rows.length <= final.length, lang);
      // Steps re-derive "upcoming" state from the rows seen, so compare titles/labels only.
      const key = (r: unknown) => JSON.stringify((r as Record<string, unknown>).label ?? (r as Record<string, unknown>).title ?? (r as Record<string, unknown>).time);
      assert.deepEqual(rows.map(key), final.slice(0, rows.length).map(key), `${lang} @${i}`);
    }
  }
});
