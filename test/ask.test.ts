/**
 * The ASK lane's read-only gate + formatting.
 *
 * The gate is the whole safety story for "talk to a running agent without disturbing it": the ask
 * co-pilot shares a filesystem with a working driver, so anything it mutates is a bug in someone
 * else's run. These tests pin the two things that would be silently catastrophic — a forged
 * question sentinel (which would FREEZE the driver via its own ask-gate) and git state changes —
 * plus the ordinary write paths.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  askGateDecision,
  askGateNodeProgram,
  askSystemPrompt,
  askThreadProbe,
  formatAsk,
  MUTATING_BASH_RE,
} from "../src/ask.ts";

const bash = (command: string) => askGateDecision({ tool_name: "Bash", tool_input: { command } });

test("gate: edit-family tools are never available to the co-pilot", () => {
  for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
    const v = askGateDecision({ tool_name: tool, tool_input: { file_path: "/workspace/a/x.ts" } });
    assert.equal(v.deny, true, `${tool} should be denied`);
    assert.match(v.reason!, /READ-ONLY/);
  }
});

test("gate: read-only tools pass", () => {
  for (const tool of ["Read", "Glob", "Grep"]) {
    assert.equal(askGateDecision({ tool_name: tool, tool_input: { path: "/workspace" } }).deny, false);
  }
});

test("gate: read-only bash the co-pilot actually needs is allowed", () => {
  for (const cmd of [
    "cat /workspace/api/src/index.ts",
    "tail -n 50 /workspace/.agent.log",
    "ls -la /workspace",
    "git -C /workspace/api status",
    "git -C /workspace/api diff",
    "git -C /workspace/api log --oneline -20",
    "git -C /workspace/api show HEAD",
    "grep -rn 'TODO' /workspace/api/src",
    "ps aux",
  ]) {
    assert.equal(bash(cmd).deny, false, `should allow: ${cmd}`);
  }
});

test("gate: mutating bash is denied", () => {
  for (const cmd of [
    "rm -rf /workspace/api/node_modules",
    "echo hi > /workspace/api/notes.md",
    "cat x >> y",
    "npm install",
    "git -C /workspace/api commit -m x",
    "git -C /workspace/api checkout main",
    "git -C /workspace/api reset --hard",
    "git -C /workspace/api push origin HEAD",
    "sed -i s/a/b/ /workspace/api/x.ts",
    "ls && rm -f /tmp/x",
    "chmod +x /workspace/api/run.sh",
    "kill -9 123",
  ]) {
    assert.equal(bash(cmd).deny, true, `should deny: ${cmd}`);
  }
});

test("gate: gh is read-only — reads pass, anything that writes to GitHub is denied", () => {
  // The ask lane now gets a real GH_TOKEN (without it, it cannot answer "is the CI runner stuck?",
  // which is the question it exists for). That makes the gate the only thing standing between an
  // observer co-pilot and a merged PR, so gh is an allowlist of read verbs, not a blocklist.
  for (const cmd of [
    "gh pr checks 2319",
    "gh pr view 2319 --json statusCheckRollup",
    "gh pr list",
    "gh pr diff 2319",
    "gh run list --limit 5",
    "gh run view 123 --log",
    "gh issue view 12",
    "gh repo view",
    "gh workflow list",
    "gh auth status",
    // The runner query from the stuck-CI case: a bare `gh api` GET must survive the allowlist.
    "gh api repos/o/r/actions/runners",
    "gh api /repos/o/r/commits",
  ]) {
    assert.equal(bash(cmd).deny, false, `should allow: ${cmd}`);
  }

  for (const cmd of [
    "gh pr comment 2319 --body hi",
    "gh pr merge 2319",
    "gh pr review 2319 --approve",
    "gh pr close 2319",
    "gh pr create --title x",
    "gh pr edit 2319 --title z",
    "gh issue comment 5 --body y",
    "gh issue close 5",
    "gh release create v1",
    "gh run rerun 123",
    "gh run cancel 123",
    "gh workflow run ci.yml",
    "gh secret set A",
    "gh repo clone o/r",
    "gh api -X POST repos/o/r/issues",
    "gh api --method DELETE repos/o/r",
    "gh api --method=PATCH repos/o/r",
    "gh pr checks 2319 && gh pr merge 2319",
  ]) {
    assert.equal(bash(cmd).deny, true, `should deny: ${cmd}`);
  }
});

test("gate: writing the driver's question sentinel is denied with a sentinel-specific reason", () => {
  // The worst case: this would make the DRIVER's ask-gate deny all its tool calls — a freeze
  // caused by an observer that was supposed to be invisible.
  const v = bash("echo 'which approach?' > /workspace/.agent.question");
  assert.equal(v.deny, true);
  assert.match(v.reason!, /FREEZE/);

  assert.equal(
    askGateDecision({ tool_name: "Write", tool_input: { file_path: "/workspace/.agent.task" } }).deny,
    true
  );
});

test("gate: reading driver-lane state is still allowed", () => {
  // Protected paths are only protected from WRITES — reading them is the co-pilot's whole job.
  assert.equal(bash("cat /workspace/.agent.question").deny, false);
  assert.equal(bash("tail -f /workspace/.agent.log").deny, false);
  assert.equal(
    askGateDecision({ tool_name: "Read", tool_input: { file_path: "/workspace/.agent.log" } }).deny,
    false
  );
});

test("gate: hook settings must not be rewritten from the ask lane", () => {
  // Rewriting settings.json would disable the driver's ask-gate — the enforcement the whole
  // interactive Q&A loop depends on.
  assert.equal(bash("echo {} > $HOME/.claude/settings.json").deny, true);
});

test("gate: tolerates a malformed payload (allow, never crash)", () => {
  assert.equal(askGateDecision({}).deny, false);
  assert.equal(askGateDecision({ tool_name: "Bash" }).deny, false);
});

test("the in-box hook program embeds the same predicate source it is tested against", () => {
  // The shipped gate is generated from these regexes; if they drift, the tests above stop meaning
  // anything about what actually runs in the box.
  const prog = askGateNodeProgram();
  assert.ok(prog.includes(JSON.stringify(MUTATING_BASH_RE.source)));
  assert.match(prog, /permissionDecision":"deny"|permissionDecision/);
  assert.match(prog, /PreToolUse/);
});

test("system prompt tells the co-pilot it is an observer that cannot steer", () => {
  const p = askSystemPrompt("/workspace/api", "/workspace/.agent.log", "/workspace/.agent.question");
  assert.match(p, /READ-ONLY/);
  assert.match(p, /\/workspace\/api/);
  assert.match(p, /\/workspace\/\.agent\.log/);
  assert.match(p, /CANNOT talk to the driver/);
});

test("formatAsk: leads with driver state and always says the driver was untouched", () => {
  const out = formatAsk({
    session: "box-1",
    answer: "It has changed 3 files in src/api.",
    timedOut: false,
    driverState: "run:running",
    continued: true,
  });
  assert.match(out, /session=box-1/);
  assert.match(out, /driver: run:running/);
  assert.match(out, /changed 3 files/);
  assert.match(out, /NOT interrupted/);
  assert.match(out, /resume\(\)/);
});

test("formatAsk: a timed-out turn is flagged as partial", () => {
  const out = formatAsk({ session: "b", answer: "partial…", timedOut: true, continued: false });
  assert.match(out, /Time cap reached/);
  assert.match(out, /new thread/);
});

test("formatAsk: an empty answer never renders as a blank reply", () => {
  assert.match(formatAsk({ session: "b", answer: "", timedOut: false, continued: false }), /returned nothing/);
});

test("the generated hook, run as real node, matches askGateDecision case for case", async () => {
  // The gate that protects a live delegation is the file in the box, not the TS function. Run the
  // actual generated program through node and hold it to the same verdicts.
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ask-ro-")), "ask-ro.js");
  fs.writeFileSync(file, askGateNodeProgram());

  const cases: Array<[string, any]> = [
    ["deny", { tool_name: "Bash", tool_input: { command: "git -C /workspace/a commit -m x" } }],
    ["deny", { tool_name: "Bash", tool_input: { command: "echo q > /workspace/.agent.question" } }],
    ["deny", { tool_name: "Bash", tool_input: { command: "npm install" } }],
    ["deny", { tool_name: "Write", tool_input: { file_path: "/workspace/a/x.ts" } }],
    ["allow", { tool_name: "Bash", tool_input: { command: "git -C /workspace/a diff" } }],
    ["allow", { tool_name: "Bash", tool_input: { command: "tail -n 50 /workspace/.agent.log" } }],
    ["allow", { tool_name: "Read", tool_input: { file_path: "/workspace/.agent.log" } }],
    ["allow", {}],
  ];

  for (const [want, payload] of cases) {
    const out = execFileSync("node", [file], { input: JSON.stringify(payload) }).toString().trim();
    const denied = out.length > 0 && JSON.parse(out).hookSpecificOutput.permissionDecision === "deny";
    assert.equal(denied, want === "deny", `hook disagreed on ${JSON.stringify(payload)}`);
    // ...and agrees with the in-process predicate, so the tests above are load-bearing.
    assert.equal(denied, askGateDecision(payload).deny, `hook/predicate drift on ${JSON.stringify(payload)}`);
  }
});

test("thread probe: continues only when the driver's task fingerprint still matches", () => {
  // A warm-pool box that was asked about while idle gets CLAIMED for a real delegation later. If the
  // ask thread carried over, the co-pilot would re-assert what was true in the box's previous life
  // ("there is no /workspace here") instead of reading the box in front of it. Observed live.
  const probe = askThreadProbe("/workspace/.agent.task", false);
  assert.match(probe, /head -n 1 \/workspace\/\.agent\.task/, "must fingerprint the driver's task");
  assert.match(probe, /ASK_FP=/);
  assert.match(probe, /CONT="-c"/, "matching fingerprint continues the thread");
  assert.match(probe, /else CONT=""/, "mismatch starts a fresh thread");
  // First line only: `resume` APPENDS follow-ups to the task marker, and a follow-up must not throw
  // away a thread that is still about the same delegation.
  assert.doesNotMatch(probe, /cat \/workspace\/\.agent\.task/);
});

test("thread probe: newThread never continues, whatever the fingerprint says", () => {
  const probe = askThreadProbe("/workspace/.agent.task", true);
  assert.match(probe, /rm -f/);
  assert.match(probe, /CONT=""/);
  assert.doesNotMatch(probe, /CONT="-c"/);
});

test("parseAskOutput: continuity comes from the box's decision, not the caller's flag", async () => {
  const { parseAskOutput } = await import("../src/msb.ts");
  const fresh = parseAskOutput("b", "---ASKCONT---0\nthe answer\n---ASKEXIT---0", 0);
  assert.equal(fresh.continued, false);
  assert.equal(fresh.answer, "the answer");

  const same = parseAskOutput("b", "---ASKCONT---1\nthe answer\n---ASKEXIT---0", 0);
  assert.equal(same.continued, true);

  // The markers must not leak into what the operator reads.
  assert.doesNotMatch(same.answer, /ASKCONT|ASKEXIT/);
});

test("parseAskOutput: surfaces the time cap and survives missing markers", async () => {
  const { parseAskOutput } = await import("../src/msb.ts");
  assert.equal(parseAskOutput("b", "---ASKCONT---1\npartial\n---ASKEXIT---124", 0).timedOut, true);
  // No markers at all (an exec that died early): fall back to the raw output + process exit code.
  const raw = parseAskOutput("b", "boom", 1);
  assert.equal(raw.answer, "boom");
  assert.equal(raw.timedOut, false);
});
