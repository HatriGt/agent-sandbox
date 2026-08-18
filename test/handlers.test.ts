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

test("delegate: local with no repo falls back to cfg.workspaceDir (IDE-provided)", async () => {
  const s = fakeServer();
  let seen: any = null;
  const cfgWs = { maxBoxes: 5, workspaceDir: "/Users/me/openproj" } as unknown as Config;
  registerTools(s as any, cfgWs, {
    countBoxes: async () => 0,
    runDelegation: async (_cfg: any, plan: any) => {
      seen = plan;
      return { box: "b", warm: false, output: "" };
    },
  } as any);

  const res = await s.tools.delegate.handler({ task: "do it" }); // no repo
  assert.equal(seen?.repo, "/Users/me/openproj");
  assert.match(textOf(res), /b/);
});

test("delegate: local with no repo AND no workspaceDir -> asks", async () => {
  const s = fakeServer();
  registerTools(s as any, cfg, { countBoxes: async () => 0, runDelegation: async () => ({ box: "b", warm: false, output: "" }) } as any);
  const res = await s.tools.delegate.handler({ task: "do it" }); // no repo, cfg has no workspaceDir
  assert.match(textOf(res), /repo|path/i);
});

test("delegate: repos[] passes the full list through to runDelegation", async () => {
  const s = fakeServer();
  let seen: any = null;
  registerTools(s as any, cfg, {
    countBoxes: async () => 0,
    runDelegation: async (_cfg: any, plan: any) => {
      seen = plan;
      return { box: "b", warm: false, output: "" };
    },
  } as any);

  await s.tools.delegate.handler({
    source: "git",
    repos: [{ repo: "o/frontend" }, { repo: "o/backend", ref: "develop" }],
    task: "wire api",
  });
  assert.deepEqual(
    seen.repos.map((r: any) => r.repo),
    ["o/frontend", "o/backend"]
  );
  assert.deepEqual(
    seen.repos.map((r: any) => r.name),
    ["frontend", "backend"]
  );
});

test("resume: forwards optional secrets to deps.resume", async () => {
  const s = fakeServer();
  let seen: any = null;
  registerTools(s as any, cfg, {
    resume: async (_cfg: any, session: string, message: string, secrets?: any) => {
      seen = { session, message, secrets };
      return "continued";
    },
  } as any);

  await s.tools.resume.handler({
    session: "box-1",
    message: "here is the token",
    secrets: { GITHUB_TOKEN: "ghp_x", DB_URL: "postgres://u:p@h/db" },
  });
  assert.equal(seen.session, "box-1");
  assert.deepEqual(seen.secrets, { GITHUB_TOKEN: "ghp_x", DB_URL: "postgres://u:p@h/db" });
});

test("resume: works with no secrets (back-compat)", async () => {
  const s = fakeServer();
  let seen: any = null;
  registerTools(s as any, cfg, {
    resume: async (_cfg: any, _session: string, _message: string, secrets?: any) => {
      seen = secrets;
      return "ok";
    },
  } as any);

  await s.tools.resume.handler({ session: "b", message: "go on" });
  assert.equal(seen, undefined);
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
