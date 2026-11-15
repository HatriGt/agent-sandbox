// The sandbox child for real: each test spawns the runner program with the isolation layers this
// machine supports (on Windows: vm + empty env + --permission; in a box also unshare -rn and
// ulimit -t) and drives it through the bridge with a stub call provider.
import { test } from "node:test";
import assert from "node:assert/strict";
import { childProgram, MAX_CALLS, probeSandbox, runInSandbox, writeChildProgram, type BridgeHooks, type CallReply } from "../src/code-mode/box/runner.ts";

const sandbox = probeSandbox();
const program = writeChildProgram();

function stub(over: Partial<BridgeHooks> = {}): BridgeHooks {
  let n = 0;
  return {
    nextN: () => ++n,
    call: async (_n, name, argsJson): Promise<CallReply> => {
      const json = JSON.stringify({ name, args: JSON.parse(argsJson) });
      return { json, chars: json.length, cut: false, shape: "{name, args}" };
    },
    recall: (k) => {
      if (k === 1) return JSON.stringify({ again: 1 });
      throw new Error(`no result #${k} is kept`);
    },
    saveFile: (name) => `/workspace/.agent-out/${name}`,
    ...over,
  };
}

const run = (code: string, hooks = stub(), timeoutMs = 10_000) => runInSandbox(code, { sandbox, program, hooks, timeoutMs });

test("runner: the child program is self-contained JavaScript", () => {
  assert.doesNotThrow(() => new Function(childProgram()));
  assert.equal(sandbox.permission, true, "node on this machine should support --permission");
});

test("runner: parallel calls, values parsed in the script, one line per call", async () => {
  const r = await run(`
    const [a, b] = await Promise.all([call("mcp__s__a", { x: 1 }), call("mcp__s__b")]);
    return { a: a.args.x, b: b.name };`);
  assert.equal(r.error, undefined);
  assert.deepEqual(JSON.parse(r.value!), { a: 1, b: "mcp__s__b" });
  assert.deepEqual(r.calls.map((c) => [c.n, c.name, c.state]), [[1, "mcp__s__a", "ok"], [2, "mcp__s__b", "ok"]]);
});

test("runner: at most 8 calls are in flight; the rest queue in order", async () => {
  let now = 0, max = 0;
  const order: number[] = [];
  const hooks = stub({
    call: async (n) => {
      order.push(n);
      max = Math.max(max, ++now);
      await new Promise((r) => setTimeout(r, 30));
      now--;
      return { json: String(n), chars: 1, cut: false, shape: "number" };
    },
  });
  const r = await run(`return (await Promise.all(Array.from({ length: 20 }, (_, i) => call("mcp__s__t", { i })))).length`, hooks);
  assert.equal(r.value, "20");
  assert.equal(max, 8);
  assert.deepEqual(order, Array.from({ length: 20 }, (_, i) => i + 1));
});

test("runner: recall answers from the host; a missing result is an error value in the script", async () => {
  const r = await run(`const a = await recall(1); let msg; try { await recall(9) } catch (e) { msg = e.message } return { a, msg }`);
  assert.deepEqual(JSON.parse(r.value!), { a: { again: 1 }, msg: "no result #9 is kept" });
});

test("runner: a failed call throws in the script and is reported failed", async () => {
  const hooks = stub({ call: async () => Promise.reject(new Error('refused: mcp__s__drop is denied by the rule "mcp__s__drop"')) });
  const r = await run(`try { await call("mcp__s__drop", {}) } catch (e) { return e.message }`, hooks);
  assert.match(JSON.parse(r.value!), /denied by the rule/);
  assert.equal(r.calls[0].state, "failed");
});

test("runner: a call still running when the script returns is aborted and reported unfinished", async () => {
  let aborted = false;
  const hooks = stub({
    call: (_n, _name, _a, signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => (aborted = true));
        setTimeout(() => resolve({ json: "1", chars: 1, cut: false, shape: "number" }), 300);
      }),
  });
  const r = await run(`call("mcp__s__slow", {}); return "early"`, hooks);
  assert.equal(r.value, '"early"');
  assert.equal(r.calls[0].state, "unfinished");
  assert.equal(aborted, true);
});

test("runner: a busy loop and a call that never answers are both stopped at the wall clock", async () => {
  const t0 = Date.now();
  const busy = await run(`while (true) {}`, stub(), 1500);
  assert.match(busy.error!, /ran longer than 2 s and was stopped/);
  const hang = await run(`await call("mcp__s__hang", {}); return 1`, stub({ call: () => new Promise(() => {}) }), 1500);
  assert.match(hang.error!, /ran longer/);
  assert.equal(hang.calls[0].state, "unfinished");
  assert.ok(Date.now() - t0 < 8000);
});

test("runner: console lines are captured in order; a flood is counted, not forwarded", async () => {
  const r = await run(`console.log("a", { b: 1 }); console.warn("w"); console.error("e"); return 1`);
  assert.deepEqual(r.logs, ['a {"b":1}', "[warn] w", "[error] e"]);
  const flood = await run(`for (let i = 0; i < 100000; i++) console.log("line " + i); return 1`);
  assert.equal(flood.value, "1");
  assert.ok(flood.logs.join("\n").length <= 6100);
  assert.ok(flood.droppedLogChars > 500_000);
});

test("runner: the script reaches nothing of the host — no process, require, fetch, timers or Function", async () => {
  const r = await run(`
    const probe = (f) => { try { return String(f()) } catch (e) { return e.name } };
    let viaError;
    try { await recall(9) } catch (e) { viaError = probe(() => e.constructor.constructor("return process")()) }
    return {
      types: [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof module, typeof Buffer],
      ctor: probe(() => this.constructor.constructor("return process")()),
      fromCall: probe(() => call.constructor("return process")()),
      evalCall: probe(() => eval("1 + 1")),
      viaError,
      globals: Object.keys(globalThis).sort(),
    };`);
  const v = JSON.parse(r.value!);
  assert.deepEqual(v.types, Array(6).fill("undefined"));
  assert.equal(v.ctor, "EvalError");
  assert.equal(v.fromCall, "EvalError");
  assert.equal(v.evalCall, "EvalError");
  assert.equal(v.viaError, "EvalError");
  assert.deepEqual(v.globals, ["call", "console", "recall", "saveFile", "sleep"]);
});

test("runner: a script that rewrites Promise and JSON cannot redirect the bridge", async () => {
  const r = await run(`
    Promise.prototype.then = function () { throw new Error("hijacked") };
    JSON.parse = () => "forged";
    const x = await call("mcp__s__t", { k: 1 });
    return x.args.k`);
  assert.equal(r.error, undefined);
  assert.equal(r.value, "1");
  // The bridge globals cannot be replaced either.
  const r2 = await run(`try { globalThis.call = () => 1 } catch (e) { return e.name } return typeof call`);
  assert.match(r2.value!, /TypeError|function/);
});

test("runner: errors carry their line; values that are not JSON say so", async () => {
  const r = await run(`const a = 1\nnope()`);
  assert.equal(r.error, "ReferenceError: nope is not defined (line 2)");
  const big = await run(`return 10n`);
  assert.match(big.error!, /not JSON/);
  const none = await run(`const a = 1`);
  assert.equal(none.value, undefined);
  assert.equal(none.error, undefined);
});

test("runner: sleep is answered by the child's own timer; saveFile goes to the host", async () => {
  const t0 = Date.now();
  const r = await run(`await sleep(120); return await saveFile("rows.csv", [{ a: 1 }])`);
  assert.ok(Date.now() - t0 >= 100);
  assert.equal(r.value, '"/workspace/.agent-out/rows.csv"');
});

test("runner: a runaway loop of calls is stopped at the per-run cap", async () => {
  const r = await run(`for (let i = 0; i <= ${MAX_CALLS}; i++) call("mcp__s__t", { i }).catch(() => {}); await sleep(5000)`, stub({ call: () => new Promise(() => {}) }));
  assert.match(r.error!, new RegExp(`more than ${MAX_CALLS} MCP calls`));
});

test("runner: object fields returned as undefined are counted (array holes and the top level are not)", async () => {
  const r = await run(`
    const rows = [{ key: "A", n: undefined }, { key: "B" }, { key: "C", n: undefined }];
    return { rows, list: [1, undefined], gone: undefined };`);
  assert.equal(r.error, undefined);
  assert.deepEqual(JSON.parse(r.value!), { rows: [{ key: "A" }, { key: "B" }, { key: "C" }], list: [1, null] });
  assert.deepEqual({ ...r.undef }, { n: 2, gone: 1 });
  const plain = await run("return { a: 1 }");
  assert.equal(plain.undef, undefined);
  // A script that replaces Array.isArray cannot change what is reported or returned.
  const odd = await run("Array.isArray = () => true; return { x: undefined, y: 2 }");
  assert.deepEqual(JSON.parse(odd.value!), { y: 2 });
  assert.deepEqual({ ...odd.undef }, { x: 1 });
});
