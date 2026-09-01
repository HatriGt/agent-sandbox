import test from "node:test";
import assert from "node:assert/strict";
import { makeRedactor, redactKnown, redactSecrets, redactShapes } from "../src/redact.ts";

// A fabricated token in the real shape (never a live credential in the repo).
const GHP = "ghp_FakeExampleToken0000000000000000ABCD";

test("url-embedded tokens are stripped but the remote stays readable", () => {
  const line = `origin https://x-access-token:${GHP}@github.com/atom-insurance/elseco-deal-service.git (fetch)`;
  const out = redactShapes(line);
  assert.ok(!out.includes(GHP));
  assert.match(out, /origin https:\/\/x-access-token:…ABCD@github\.com\/atom-insurance\/elseco-deal-service\.git \(fetch\)/);
});

test("credential shapes are caught wherever they appear; short tails identify which one", () => {
  const cases: [string, RegExp][] = [
    [`export GH_TOKEN=${GHP}`, /GH_TOKEN=ghp_…ABCD$/],
    ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789", /Bearer …6789/],
    ["key sk-ant-api03-abcdefghijklmnopqrstuvwxyz", /…wxyz/],
    ["aws AKIAIOSFODNN7EXAMPLE here", /…MPLE/],
    ['{"HANA_PASSWORD": "Ajeeth-super-567"}', /"HANA_PASSWORD": "…-567"/],
    ["github_pat_11AAAAAAA0abcdefghijklmnopqrstuvwxyz1234567890", /…7890/],
  ];
  for (const [input, expect] of cases) {
    const out = redactShapes(input);
    assert.match(out, expect, input);
  }
  // Ordinary text is left alone.
  const plain = "git status -s; echo '--- branch ---'; HANA_HOST=192.168.13.20 LOG_LEVEL=info";
  assert.equal(redactShapes(plain), plain);
});

test("known secrets are replaced verbatim even when they have no recognisable shape", () => {
  const secret = "correct horse battery staple 42";
  assert.equal(redactKnown(`pw is ${secret}!`, [secret]), "pw is …e 42!");
  // Too short to be safe to blanket-replace: left alone.
  assert.equal(redactKnown("abc abc", ["abc"]), "abc abc");
  // Combined: known first, then shapes.
  assert.equal(redactSecrets(`${secret} and ${GHP}`, [secret]).includes(GHP), false);
});

test("redactor refreshes its list lazily and never blocks or throws on a failing source", async () => {
  let t = 0;
  let calls = 0;
  const r = makeRedactor(
    async () => {
      calls++;
      if (calls === 2) throw new Error("ssh down");
      return ["secret-value-one"];
    },
    1000,
    () => t
  );
  await r.prime();
  assert.equal(r.redact("has secret-value-one inside"), "has …-one inside");
  t = 5000;
  // Stale → background refresh (which fails) → old list still applies.
  assert.equal(r.redact("secret-value-one"), "…-one");
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(r.known, ["secret-value-one"]);
  assert.equal(calls, 2);
});

test("run() failures redact token-embedded clone URLs before they reach a caller", async () => {
  // Live testing: `delegate` with a bad ref returned the raw failed command line, INCLUDING the
  // x-access-token clone URL — a live GitHub token handed to the calling agent. exec.run now
  // redacts by shape on the error path; this pins the shape that leaked.
  const { run } = await import("../src/exec.ts");
  await assert.rejects(
    () => run("node", ["-e", "console.error('fatal: could not read https://x-access-token:ghp_ABCDEFGHIJKLMNOPQRSTUVWX1234@github.com/o/r.git'); process.exit(1)"]),
    (e) => {
      assert.ok(!String(e.message).includes("ghp_ABCDEFGHIJKLMNOPQRSTUVWX1234"), "token must not survive into the error");
      assert.match(String(e.message), /x-access-token:…/);
      return true;
    }
  );
});
