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

/** Default fake: every git repo resolves cleanly (no token/choice needed). */
const okAccess = async () => ({ ok: true, ownerTokens: {}, primaryToken: undefined });

test("registers the core tools", () => {
  const s = fakeServer();
  registerTools(s as any, cfg, {} as any);
  for (const name of ["delegate", "status", "resume", "teardown", "pool_status", "gh_token_add"]) {
    assert.ok(s.tools[name], `missing tool: ${name}`);
  }
});

test("delegate: git source, task-only (no repo) -> runs with empty repos", async () => {
  const s = fakeServer();
  let seen: any = null;
  registerTools(s as any, cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: okAccess,
    runDelegation: async (_cfg: any, plan: any) => {
      seen = plan;
      return { box: "task-box", warm: false, output: "REPORT_OK" };
    },
  } as any);

  const res = await s.tools.delegate.handler({ source: "git", task: "write a report about X" });
  assert.deepEqual(seen.repos, [], "task-only => empty repos");
  assert.equal(seen.task, "write a report about X");
  assert.match(textOf(res), /task-box/);
  assert.match(textOf(res), /REPORT_OK/);
});

test("delegate: valid input -> calls runDelegation and returns its output", async () => {
  const s = fakeServer();
  let seen: any = null;
  registerTools(s as any, cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: okAccess,
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
    resolveGitAccess: okAccess,
    runDelegation: async (_cfg: any, plan: any) => {
      seen = plan;
      return { box: "b", warm: false, output: "" };
    },
  } as any);

  const res = await s.tools.delegate.handler({ task: "do it" }); // no repo
  assert.equal(seen?.repo, "/Users/me/openproj");
  assert.match(textOf(res), /b/);
});

test("delegate: local with no repo AND no workspaceDir -> task-only (no repo needed)", async () => {
  const s = fakeServer();
  let seen: any = null;
  registerTools(s as any, cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: okAccess,
    runDelegation: async (_cfg: any, plan: any) => {
      seen = plan;
      return { box: "b", warm: false, output: "" };
    },
  } as any);
  const res = await s.tools.delegate.handler({ task: "do it" }); // no repo, cfg has no workspaceDir
  assert.deepEqual(seen.repos, [], "no repo + no workspaceDir => task-only");
  assert.match(textOf(res), /b/);
});

test("delegate: repos[] passes the full list through to runDelegation", async () => {
  const s = fakeServer();
  let seen: any = null;
  registerTools(s as any, cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: okAccess,
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
    resolveGitAccess: okAccess,
    runDelegation: async (_cfg: any, plan: any) => {
      seen = plan;
      return { box: "b", warm: false, output: "" };
    },
  } as any);

  await s.tools.delegate.handler({ repo: "/Users/me/proj", task: "t" });
  assert.equal(seen.source, "local");
});

test("gh_token_add: forwards token + optional repo and returns the summary", async () => {
  const s = fakeServer();
  let seen: any = null;
  registerTools(s as any, cfg, {
    addGhToken: async (_cfg: any, token: string, repo?: string) => {
      seen = { token, repo };
      return "Stored GitHub account 'alice' (classic).";
    },
  } as any);

  const res = await s.tools.gh_token_add.handler({ token: "ghp_x", repo: "atom-insurance/foo" });
  assert.deepEqual(seen, { token: "ghp_x", repo: "atom-insurance/foo" });
  assert.match(textOf(res), /alice/);
});

test("delegate git: resolveGitAccess need_token -> returns the question, does NOT run", async () => {
  const s = fakeServer();
  let ran = false;
  registerTools(s as any, cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: async () => ({ ok: false, question: "No stored GitHub account can access o/n." }),
    runDelegation: async () => {
      ran = true;
      return { box: "b", warm: false, output: "" };
    },
  } as any);

  const res = await s.tools.delegate.handler({ source: "git", repo: "o/n", task: "t" });
  assert.equal(ran, false);
  assert.match(textOf(res), /No stored GitHub account/);
});

test("delegate git: forwards githubToken/githubAccount + resolved creds to runDelegation", async () => {
  const s = fakeServer();
  let seenOpts: any = null;
  let seenCreds: any = null;
  registerTools(s as any, cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: async (_cfg: any, _plan: any, opts: any) => {
      seenOpts = opts;
      return {
        ok: true,
        ownerTokens: { o: "tok-o" },
        ownerLogins: { o: "alice" },
        primaryToken: "tok-o",
        primaryLogin: "alice",
      };
    },
    runDelegation: async (_cfg: any, _plan: any, _dom: any, creds: any) => {
      seenCreds = creds;
      return { box: "b", warm: false, output: "" };
    },
  } as any);

  await s.tools.delegate.handler({
    source: "git",
    repo: "o/n",
    task: "t",
    githubToken: "ghp_x",
    githubAccount: "alice",
  });
  assert.deepEqual(seenOpts, { githubToken: "ghp_x", githubAccount: "alice" });
  assert.deepEqual(seenCreds, {
    ownerTokens: { o: "tok-o" },
    ownerLogins: { o: "alice" },
    primaryToken: "tok-o",
    primaryLogin: "alice",
  });
});

test("delegate local: resolves access too (for per-repo identity/token)", async () => {
  const s = fakeServer();
  let accessCalled = false;
  let seenCreds: any = "unset";
  registerTools(s as any, cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: async () => {
      accessCalled = true;
      return { ok: true, ownerTokens: { o: "t" }, ownerLogins: { o: "alice" }, primaryLogin: "alice" };
    },
    runDelegation: async (_cfg: any, _plan: any, _dom: any, creds: any) => {
      seenCreds = creds;
      return {
        box: "box-async",
        warm: false,
        output: "Task launched in the background. Poll with status(session) for progress and result.",
      };
    },
  } as any);

  const res = await s.tools.delegate.handler({ source: "local", repo: "/Users/me/p", task: "t" });
  assert.equal(accessCalled, true, "local source now resolves access for identity + token");
  assert.equal(seenCreds.primaryLogin, "alice", "resolved creds flow to runDelegation for local");
  assert.match(textOf(res), /box-async/);
});

test("delegate local: unresolved access is NON-fatal (still delegates, no creds)", async () => {
  const s = fakeServer();
  let seenCreds: any = "unset";
  registerTools(s as any, cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: async () => ({ ok: false, question: "No stored GitHub account can access o/n." }),
    runDelegation: async (_cfg: any, _plan: any, _dom: any, creds: any) => {
      seenCreds = creds;
      return { box: "box-local", warm: false, output: "launched" };
    },
  } as any);

  const res = await s.tools.delegate.handler({ source: "local", repo: "/Users/me/p", task: "t" });
  // local: a need-token/choose outcome does NOT block; delegation proceeds with no injected creds.
  assert.equal(seenCreds, undefined);
  assert.match(textOf(res), /box-local/);
});

test("monitor: registered and returns the fleet report from deps", async () => {
  const s = fakeServer();
  let called = false;
  registerTools(s as any, cfg, {
    monitor: async () => {
      called = true;
      return "2 sandbox(es) up — 1 session(s), 1 warm pool free.";
    },
  } as any);

  assert.ok(s.tools.monitor, "monitor tool is registered");
  const res = await s.tools.monitor.handler({});
  assert.equal(called, true);
  assert.match(textOf(res), /2 sandbox\(es\) up/);
});

test("watch: registered; forwards session + lines and returns the snapshot", async () => {
  const s = fakeServer();
  let seen: any = null;
  registerTools(s as any, cfg, {
    watch: async (_cfg: any, session: string, lines?: number) => {
      seen = { session, lines };
      return `┌─ ${session} (running)`;
    },
  } as any);

  assert.ok(s.tools.watch, "watch tool is registered");
  const res = await s.tools.watch.handler({ session: "delegate-9", lines: 60 });
  assert.deepEqual(seen, { session: "delegate-9", lines: 60 });
  assert.match(textOf(res), /delegate-9/);
});

test("ask: registered, and routes to the read-only co-pilot without touching the driver", async () => {
  const s = fakeServer();
  const calls: any[] = [];
  registerTools(s as any, cfg, {
    ask: async (_c: any, session: string, question: string, newThread?: boolean) => {
      calls.push({ session, question, newThread });
      return "CO_PILOT_ANSWER";
    },
    // Deliberately fatal: `ask` must never drive the driver lane.
    resume: async () => assert.fail("ask must not resume the driver"),
    status: async () => assert.fail("ask must not drive the driver's wait loop"),
  } as any);

  assert.ok(s.tools.ask, "missing tool: ask");
  const res = await s.tools.ask.handler({ session: "box-9", question: "what has it changed?" });
  assert.deepEqual(calls, [{ session: "box-9", question: "what has it changed?", newThread: undefined }]);
  assert.match(textOf(res), /CO_PILOT_ANSWER/);

  await s.tools.ask.handler({ session: "box-9", question: "and the other repo?", newThread: true });
  assert.equal(calls[1].newThread, true);
});

test("ask: an empty or missing question is rejected before reaching the box", async () => {
  // Booting/entering a box to ask nothing is pure waste, and the co-pilot would answer noise.
  const s = fakeServer();
  registerTools(s as any, cfg, { ask: async () => "SHOULD_NOT_RUN" } as any);
  const schema = s.tools.ask.schema as any;
  assert.ok(schema.session, "session must be in the schema");
  assert.ok(schema.question, "question must be in the schema");
  assert.equal(schema.question.isOptional?.() ?? false, false, "question must be required");
  assert.equal(schema.newThread.isOptional?.(), true, "newThread must be optional");
});

test("remote entry: source defaults to git, not local", async () => {
  // Over HTTP the caller is on another machine. Defaulting to "local" made the server rsync from
  // its OWN disk, which died with "spawn rsync ENOENT" — a failure the calling agent reported to
  // the user as "the sandbox MCP server is unreachable". It was up the whole time.
  const s = fakeServer();
  let seen: any = null;
  registerTools(
    s as any,
    cfg,
    {
      countBoxes: async () => 0,
      resolveGitAccess: okAccess,
      runDelegation: async (_cfg: any, plan: any) => {
        seen = plan;
        return { box: "b", warm: false, output: "ok" };
      },
    } as any,
    undefined,
    true
  );

  await s.tools.delegate.handler({ repo: "owner/name", task: "fix a bug" });
  assert.equal(seen.source, "git", "remote entry must not silently choose the rsync path");
});

test("remote entry: an explicit source:local is answered, not attempted", async () => {
  const s = fakeServer();
  let ran = false;
  registerTools(
    s as any,
    cfg,
    {
      countBoxes: async () => 0,
      resolveGitAccess: okAccess,
      runDelegation: async () => {
        ran = true;
        return { box: "b", warm: false, output: "ok" };
      },
    } as any,
    undefined,
    true
  );

  const out = textOf(
    await s.tools.delegate.handler({ source: "local", repo: "C:\Users\me\proj", task: "fix a bug" })
  );
  assert.equal(ran, false, "must not start a delegation it cannot possibly stage");
  // The message has to tell the agent BOTH what to do instead and that the server is fine —
  // otherwise it keeps reporting a connectivity outage and offering to work around it.
  assert.match(out, /source:"git"/);
  assert.match(out, /not a connectivity problem/i);
});

test("stdio entry keeps the local default (the IDE shares a filesystem with the controller)", async () => {
  const s = fakeServer();
  let seen: any = null;
  registerTools(s as any, cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: okAccess,
    runDelegation: async (_cfg: any, plan: any) => {
      seen = plan;
      return { box: "b", warm: false, output: "ok" };
    },
  } as any);

  await s.tools.delegate.handler({ repo: "/Users/me/proj", task: "fix a bug" });
  assert.equal(seen.source, "local");
});

test("remote entry: a patch travels into the plan, per repo", async () => {
  // The whole point of `patch`: uncommitted work from the caller's machine reaches the checkout.
  const s = fakeServer();
  let seen: any = null;
  registerTools(
    s as any,
    cfg,
    {
      countBoxes: async () => 0,
      resolveGitAccess: okAccess,
      runDelegation: async (_cfg: any, plan: any) => {
        seen = plan;
        return { box: "b", warm: false, output: "ok" };
      },
    } as any,
    undefined,
    true
  );

  await s.tools.delegate.handler({
    repo: "owner/name",
    ref: "Development",
    patch: "diff --git a/f b/f\n",
    task: "continue my feature",
  });
  assert.equal(seen.repos[0].patch, "diff --git a/f b/f\n");
  assert.equal(seen.repos[0].ref, "Development");
});

test("remote entry: the source:local refusal points at the patch path", async () => {
  // An agent holding uncommitted work needs the way FORWARD, not just "use git" (which would
  // silently drop that work — the exact failure mode the user described).
  const s = fakeServer();
  registerTools(s as any, cfg, { countBoxes: async () => 0, resolveGitAccess: okAccess } as any, undefined, true);
  const out = textOf(await s.tools.delegate.handler({ source: "local", repo: "/Users/me/proj", task: "t" }));
  assert.match(out, /patch/);
  assert.match(out, /git diff origin\/<ref> --binary/);
});
