import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRepoLists, matchRepos, inferRepos, type RepoInfo } from "../src/repos.ts";
import { parseTrace } from "../src/trace.ts";

const gh = (full_name: string, extra: Record<string, unknown> = {}) => ({
  full_name,
  private: true,
  default_branch: "main",
  pushed_at: "2026-08-20T00:00:00Z",
  ...extra,
});

test("mergeRepoLists unions logins, drops archived, orders by last push", () => {
  const merged = mergeRepoLists([
    { login: "alice", repos: [gh("acme/deal-service", { pushed_at: "2026-08-25T00:00:00Z" }), gh("acme/old", { archived: true })] },
    { login: "bob", repos: [gh("acme/deal-service"), gh("bob/tools", { pushed_at: "2026-08-26T00:00:00Z", private: false })] },
  ]);
  assert.deepEqual(
    merged.map((r) => [r.fullName, r.logins]),
    [
      ["bob/tools", ["bob"]],
      ["acme/deal-service", ["alice", "bob"]],
    ]
  );
});

const known: RepoInfo[] = [
  { fullName: "atom-insurance/elseco-deal-service", private: true, defaultBranch: "main", logins: ["a"] },
  { fullName: "atom-insurance/elseco-web", private: true, defaultBranch: "main", logins: ["a"] },
  { fullName: "hatrigt/agent-sandbox", private: false, defaultBranch: "main", logins: ["a"] },
  { fullName: "hatrigt/api", private: false, defaultBranch: "main", logins: ["a"] },
  { fullName: "other/api", private: false, defaultBranch: "main", logins: ["a"] },
];

test("matchRepos ranks name prefix, then name substring, then owner/description", () => {
  assert.deepEqual(matchRepos(known, "elseco").map((r) => r.fullName), ["atom-insurance/elseco-deal-service", "atom-insurance/elseco-web"]);
  assert.equal(matchRepos(known, "sandbox")[0].fullName, "hatrigt/agent-sandbox");
  assert.equal(matchRepos(known, "hatrigt").length, 2);
  assert.equal(matchRepos(known, "").length, 5);
});

test("inferRepos: names in prose (spaces ≈ hyphens), owner/name tokens, never ambiguous or generic", () => {
  assert.deepEqual(
    inferRepos("Review the last 2 PRs in elseco deal service and list the flags", known).map((r) => r.fullName),
    ["atom-insurance/elseco-deal-service"]
  );
  assert.deepEqual(inferRepos("fix the bug in hatrigt/agent-sandbox please", known).map((r) => r.fullName), ["hatrigt/agent-sandbox"]);
  assert.deepEqual(inferRepos("look at the api and tell me", known), [], "ambiguous 'api' across owners is not inferred");
  assert.deepEqual(inferRepos("write a report about deal services in insurance", known), [], "no exact repo name → nothing");
  assert.deepEqual(inferRepos("compare elseco-web with Elseco Deal Service", known).map((r) => r.fullName), [
    "atom-insurance/elseco-deal-service",
    "atom-insurance/elseco-web",
  ]);
});

test("trace: a nested copy of the log inside a tool result never flips the parser", () => {
  const log = [
    "● session started (model m)",
    "Let me look at the log.",
    "→ Bash: cat /workspace/.agent.log ⟦#aaaaaaaa⟧",
    "  ⟦#aaaaaaaa⟧ ● session started (model m)",
    "  ⟦think⟧",
    "  nested thinking",
    "  ⟦/think⟧",
    "  → Bash: ls ⟦#bbbbbbbb⟧",
    "    ⟦#bbbbbbbb⟧ a b c",
    "Now the real next step.",
    "→ Bash: gh pr list ⟦#cccccccc⟧",
    "  ⟦#cccccccc⟧ #1 fix",
  ].join("\n");
  const ev = parseTrace(log);
  const tools = ev.filter((e) => e.kind === "tool");
  assert.equal(tools.length, 2, "only the two real tool calls are tool events");
  assert.equal(ev.filter((e) => e.kind === "think").length, 0, "the indented nested sentinel is content, not a think block");
  assert.ok(tools[0].kind === "tool" && /nested thinking/.test(tools[0].result ?? ""), "nested lines stay inside the first tool's result");
  assert.ok(ev.some((e) => e.kind === "say" && e.text === "Now the real next step."));
});
