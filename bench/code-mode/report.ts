/**
 * Code-mode bench, analysis: reads the raw stream-json that bench.ts pulled and prints the §7 table.
 *
 *   npx tsx bench/code-mode/report.ts bench/code-mode/out/<box>            # the table + deltas
 *   npx tsx bench/code-mode/report.ts bench/code-mode/out/<box> --json     # per-run rows as JSON
 *   npx tsx bench/code-mode/report.ts bench/code-mode/out/<box> --show T3-B-1   # one transcript
 *
 * Per run, from the frames of the top-level agent only (parent_tool_use_id null):
 *   requests  distinct assistant message ids that carry usage (one API request each)
 *   context   Σ(input + cache_creation + cache_read) over those requests = context volume billed
 *   output    Σ output_tokens over those requests
 *   cost      the ledger's formula: costUsd({in: input+cw+cr of the result frame, out}, model)
 *             (src/outcome.ts → src/cost.ts), at BENCH_PRICE (default Opus list $5/$25 per M) since
 *             the production alias has no entry in KNOWN_PRICES; plus a cache-aware figure
 *             (cache read 0.1×, cache write 1.25× of the input price).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { costUsd } from "../../src/cost.js";
import { answerOf, TASKS } from "./tasks.mjs";

type Frame = Record<string, any>;
interface Run {
  key: string;
  task: string;
  mode: string;
  rep: number;
  requests: number;
  context: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  fresh: number;
  turns: number;
  wallS: number;
  tools: Record<string, number>;
  correct: boolean;
  answer: string;
  costLedger: number;
  costCache: number;
  resultUsage: { in: number; out: number };
  error?: string;
  /** Successful writes the fake servers logged (T10/T11 check them). */
  writes: number;
}

const dir = process.argv[2];
if (!dir) throw new Error("usage: report.ts <pulled dir> [--json | --show T1-A-1]");
const OUT = join(dir, process.env.BENCH_OUT || "out");
const cfg = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
const model: string = cfg.env.ANTHROPIC_MODEL;
const [pin, pout] = (process.env.BENCH_PRICE || "5/25").split("/").map(Number);
const priceEnv = { ...process.env, MSB_MODEL_PRICES: JSON.stringify({ [model]: { in: pin, out: pout } }) };
const walls = new Map<string, number>();
for (const l of readFileSync(join(OUT, "runs.jsonl"), "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(l);
  walls.set(`${r.task}-${r.mode}-${r.rep}`, r.wallMs);
}

const frames = (file: string): Frame[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });

function analyse(file: string): Run {
  const key = file.replace(/\.jsonl$/, "");
  const [task, mode, rep] = key.split("-");
  const fs = frames(join(OUT, file));
  const byMsg = new Map<string, any>();
  const tools: Record<string, number> = {};
  const seenTool = new Set<string>();
  for (const f of fs) {
    if (f.type !== "assistant" || f.parent_tool_use_id) continue;
    const m = f.message;
    if (m?.usage) {
      const prev = byMsg.get(m.id);
      // The CLI repeats a message per content block; the usage is the same request's, output may grow.
      if (!prev || (m.usage.output_tokens ?? 0) >= (prev.output_tokens ?? 0)) byMsg.set(m.id, m.usage);
    }
    for (const c of m?.content ?? []) {
      if (c.type === "tool_use" && !seenTool.has(c.id)) {
        seenTool.add(c.id);
        tools[c.name] = (tools[c.name] ?? 0) + 1;
      }
    }
  }
  const us = [...byMsg.values()];
  const sum = (k: string) => us.reduce((a, u) => a + (u[k] ?? 0), 0);
  const fresh = sum("input_tokens");
  const cacheWrite = sum("cache_creation_input_tokens");
  const cacheRead = sum("cache_read_input_tokens");
  // Assistant frames carry the usage of message_start (output still ~0); the final output count
  // arrives in the stream_event message_delta frames (--include-partial-messages).
  const output = fs.filter((f) => f.type === "stream_event" && !f.parent_tool_use_id && f.event?.type === "message_delta").reduce((a, f) => a + (f.event.usage?.output_tokens ?? 0), 0);
  // A follow-up task (T12) holds two sessions' frames, so two result frames: usage is their sum,
  // the answer the last one's, and the check sees every turn's answer.
  const results = fs.filter((f) => f.type === "result");
  const res = results[results.length - 1];
  const ru = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"].reduce(
    (o, k) => ({ ...o, [k]: results.reduce((s, r) => s + (r.usage?.[k] ?? 0), 0) }),
    {} as Record<string, number>
  );
  const resultIn = ru.input_tokens + ru.cache_creation_input_tokens + ru.cache_read_input_tokens;
  const resultOut = ru.output_tokens;
  const t = TASKS.find((x) => x.id === task)!;
  const answers = results.map((r) => answerOf(r.result ?? ""));
  const answer = answers[answers.length - 1] ?? "";
  const logFile = join(OUT, `${key}.log.jsonl`);
  const log = existsSync(logFile) ? frames(logFile) : [];
  const want = t.followUp ? 2 : 1;
  return {
    key,
    task,
    mode,
    rep: Number(rep),
    requests: us.length,
    context: fresh + cacheWrite + cacheRead,
    output,
    cacheRead,
    cacheWrite,
    fresh,
    turns: results.reduce((s, r) => s + (r.num_turns ?? 0), 0),
    wallS: (walls.get(key) ?? res?.duration_ms ?? 0) / 1000,
    tools,
    correct: results.length === want && results.every((r) => !r.is_error) && t.check(answer, { answers, log }),
    answer,
    costLedger: costUsd({ inputTokens: resultIn, outputTokens: resultOut }, model, priceEnv) ?? NaN,
    costCache: (ru.input_tokens * pin + (ru.cache_creation_input_tokens ?? 0) * pin * 1.25 + (ru.cache_read_input_tokens ?? 0) * pin * 0.1 + resultOut * pout) / 1e6,
    resultUsage: { in: resultIn, out: resultOut },
    error: results.length < want ? `${results.length}/${want} result frames` : results.find((r) => r.is_error) ? String(results.find((r) => r.is_error).subtype) : undefined,
    writes: log.filter((e) => e.ok).length,
  };
}

function show(key: string) {
  for (const f of frames(join(OUT, `${key}.jsonl`))) {
    if (f.parent_tool_use_id) continue;
    if (f.type === "assistant")
      for (const c of f.message.content ?? []) {
        if (c.type === "text") console.log(`TEXT  ${c.text.slice(0, 600)}`);
        if (c.type === "tool_use") console.log(`CALL  ${c.name} ${typeof c.input?.code === "string" ? "\n" + c.input.code : JSON.stringify(c.input).slice(0, 400)}`);
      }
    if (f.type === "user")
      for (const c of f.message?.content ?? []) {
        if (c.type === "tool_result") {
          const text = typeof c.content === "string" ? c.content : (c.content ?? []).map((x: any) => x.text ?? "").join("");
          console.log(`RES${c.is_error ? "!" : " "} ${text.slice(0, 700).replace(/\n/g, "\n      ")}`);
        }
      }
    if (f.type === "result") console.log(`DONE  turns=${f.num_turns} ${f.subtype} ${String(f.result).slice(-200)}`);
  }
}

const runs = readdirSync(OUT)
  .filter((f) => /^T\d+-[A-Z0-9]+-\d+\.jsonl$/.test(f))
  .map(analyse);

const showAt = process.argv.indexOf("--show");
if (showAt > 0) {
  show(process.argv[showAt + 1]);
  process.exit(0);
}
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(runs, null, 1));
  process.exit(0);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0));
const pct = (b: number, a: number) => (a ? `${b >= a ? "+" : ""}${(((b - a) / a) * 100).toFixed(0)}%` : "–");

const MODE_ORDER = ["A", "A2", "B", "B2", "BL", "BX", "BP", "CL"];
const modes = [...new Set(runs.map((r) => r.mode))].sort((a, b) => (MODE_ORDER.indexOf(a) + 99) % 99 - (MODE_ORDER.indexOf(b) + 99) % 99 || a.localeCompare(b));
const tasks = [...new Set(runs.map((r) => r.task))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
type Agg = { n: number; ok: number; ctxMean: number; ctxMed: number; out: number; req: number; wallMean: number; wallMed: number; cost: number; costCache: number; tools: string };
const agg = new Map<string, Agg>();
console.log(`model ${model}; cost at $${pin}/$${pout} per M (ledger formula), cache-aware in brackets\n`);
console.log("| task | mode | runs | correct | context mean | context median | output | requests | wall mean s | wall median s | cost (cache-aware) | tool calls per run |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const t of tasks)
  for (const m of modes) {
    const g = runs.filter((r) => r.task === t && r.mode === m);
    if (!g.length) continue;
    const toolTotals: Record<string, number> = {};
    for (const r of g) for (const [n, c] of Object.entries(r.tools)) toolTotals[n] = (toolTotals[n] ?? 0) + c;
    const tools = Object.entries(toolTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([n, c]) => `${n.replace(/^mcp__/, "")} ${(c / g.length).toFixed(1)}`)
      .join(", ");
    const a: Agg = {
      n: g.length,
      ok: g.filter((r) => r.correct).length,
      ctxMean: mean(g.map((r) => r.context)),
      ctxMed: median(g.map((r) => r.context)),
      out: mean(g.map((r) => r.output)),
      req: mean(g.map((r) => r.requests)),
      wallMean: mean(g.map((r) => r.wallS)),
      wallMed: median(g.map((r) => r.wallS)),
      cost: mean(g.map((r) => r.costLedger)),
      costCache: mean(g.map((r) => r.costCache)),
      tools,
    };
    agg.set(`${t}-${m}`, a);
    console.log(
      `| ${t} | ${m} | ${a.n} | ${a.ok}/${a.n} | ${k(a.ctxMean)} | ${k(a.ctxMed)} | ${k(a.out)} | ${a.req.toFixed(1)} | ${a.wallMean.toFixed(1)} | ${a.wallMed.toFixed(1)} | $${a.cost.toFixed(3)} ($${a.costCache.toFixed(3)}) | ${tools} |`
    );
  }

console.log("\nDeltas against A (means; context median in brackets):\n");
console.log("| task | mode | context | output | requests | wall | cost | cost cache-aware | correct |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const t of tasks) {
  const a = agg.get(`${t}-A`);
  if (!a) continue;
  for (const m of modes.filter((x) => x !== "A")) {
    const b = agg.get(`${t}-${m}`);
    if (!b) continue;
    console.log(
      `| ${t} | ${m} | ${pct(b.ctxMean, a.ctxMean)} (${pct(b.ctxMed, a.ctxMed)}) | ${pct(b.out, a.out)} | ${pct(b.req, a.req)} | ${pct(b.wallMean, a.wallMean)} | ${pct(b.cost, a.cost)} | ${pct(b.costCache, a.costCache)} | ${b.ok}/${b.n} vs ${a.ok}/${a.n} |`
    );
  }
}

const pools: [string, string[]][] = [
  ["MCP-heavy tasks (T1–T4)", ["T1", "T2", "T3", "T4"]],
  ["New scenarios (T7–T12)", ["T7", "T8", "T9", "T10", "T11", "T12"]],
  ["Every MCP task (all but T6)", tasks.filter((t) => t !== "T6")],
];
for (const [title, pool] of pools) {
  // Pooled over the tasks every listed mode ran, so a mode missing a task does not skew its mean.
  const common = pool.filter((t) => modes.every((m) => runs.some((r) => r.task === t && r.mode === m)));
  if (!common.length) continue;
  console.log(`\n${title} pooled over ${common.join(", ")}, means per run:\n`);
  for (const m of modes) {
    const g = runs.filter((r) => r.mode === m && common.includes(r.task));
    console.log(
      `- ${m}: ${g.filter((r) => r.correct).length}/${g.length} correct, context ${k(mean(g.map((r) => r.context)))}, output ${k(mean(g.map((r) => r.output)))}, requests ${mean(g.map((r) => r.requests)).toFixed(1)}, wall ${mean(g.map((r) => r.wallS)).toFixed(1)} s, cost $${mean(g.map((r) => r.costLedger)).toFixed(3)} ($${mean(g.map((r) => r.costCache)).toFixed(3)})`
    );
  }
}

console.log("\nOutliers (context > 2× or < 0.5× its group's median) and failures:\n");
for (const r of runs) {
  const a = agg.get(`${r.task}-${r.mode}`)!;
  const odd = r.context > 2 * a.ctxMed || r.context < 0.5 * a.ctxMed;
  if (odd || !r.correct)
    console.log(`- ${r.key}: context ${k(r.context)} (median ${k(a.ctxMed)}), ${r.requests} req, ${r.wallS.toFixed(0)} s, ${r.correct ? "correct" : `WRONG answer ${JSON.stringify(r.answer)}`}${r.error ? ` [${r.error}]` : ""}${r.writes ? `, ${r.writes} writes` : ""}; tools ${JSON.stringify(r.tools)}`);
}
