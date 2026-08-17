/**
 * Phase 1 / Step 1 — shared tool handlers (TDD).
 * registerTools wires the same handlers for both stdio (index.ts) and HTTP (http.ts). We inject
 * fake deps so we can assert behavior (esp. ask-if-missing) with no VPS/msb.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerTools } from "../src/handlers.ts";
import type { Config } from "../src/config.ts";

/** Minimal fake MCP server capturing registered tools. */
function fakeServer() {
  const tools: Record<string, { schema: unknown; handler: Function }> = {};
  return {
    tool(name: string, _desc: string, schema: unknown, handler: Function) {
      tools[name] = { schema, handler };
    },
    tools,
  };
}

const cfg = { maxBoxes: 5 } as unknown as Config;

function textOf(res: any): string {
  return res.content.map((c: any) => c.text).join("\n");
}

test("registers the core tools", () => {
  const s = fakeServer();
  registerTools(s as any, cfg, {} as any);
  for (const name of ["delegate", "status", "resume", "teardown", "pool_status"]) {
    assert.ok(s.tools[name], `missing tool: ${name}`);
  }
});

test("delegate: git source missing repo -> asks, does NOT call runDelegation", async () => {
  const s = fakeServer();
  let called = false;
  registerTools(s as any, cfg, {
    countBoxes: async () => 0,
    runDelegation: async () => {
      called = true;
      return { box: "x", warm: false, output: "" };
    },
  } as any);

  const res = await s.tools.delegate.handler({ source: "git", task: "do it" });
  assert.match(textOf(res), /repo/i);
  assert.equal(called, false, "runDelegation must not run when info is missing");
});

test("delegate: valid input -> calls runDelegation and returns its output", async () => {
  const s = fakeServer();
  let seen: any = null;
  registerTools(s as any, cfg, {
    countBoxes: async () => 0,
    runDelegation: async (_cfg: any, plan: any) => {
      seen = plan;
      return { box: "box-1", warm: true, output: "SMOKE_OK" };
    },
  } as any);

  const res = await s.tools.delegate.handler({ source: "git", repo: "o/n", task: "t", ref: "main" });
  assert.equal(seen.repo, "o/n");
  assert.equal(seen.ref, "main");
  assert.match(textOf(res), /box-1/);
  assert.match(textOf(res), /warm/);
  assert.match(textOf(res), /SMOKE_OK/);
});

test("delegate: defaults source to local when omitted (Mac/stdio path)", async () => {
  const s = fakeServer();
  let seen: any = null;
  registerTools(s as any, cfg, {
    countBoxes: async () => 0,
    runDelegation: async (_cfg: any, plan: any) => {
      seen = plan;
      return { box: "b", warm: false, output: "" };
    },
  } as any);

  await s.tools.delegate.handler({ repo: "/Users/me/proj", task: "t" });
  assert.equal(seen.source, "local");
});
