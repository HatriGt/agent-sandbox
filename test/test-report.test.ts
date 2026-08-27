import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTestReport, findPullRequests } from "../web/src/lib/testReport.ts";

test("vitest output → report with files and cases", () => {
  const out = [
    " ✓ src/auth.test.ts (3 tests) 45ms",
    "   ✓ should login with valid credentials 45ms",
    "   ✓ should reject invalid password 32ms",
    "   × should handle timeout 5001ms",
    " Test Files  1 failed (1)",
    "      Tests  8 passed | 1 failed | 1 skipped (10)",
    "   Duration  1.23s",
  ].join("\n");
  const r = parseTestReport(out)!;
  assert.equal(r.runner, "vitest");
  assert.deepEqual([r.passed, r.failed, r.skipped, r.durationMs], [8, 1, 1, 1230]);
  assert.equal(r.files[0].name, "src/auth.test.ts");
  assert.equal(r.files[0].status, "fail");
  assert.deepEqual(r.files[0].tests.map((t) => [t.name, t.status, t.ms]), [
    ["should login with valid credentials", "pass", 45],
    ["should reject invalid password", "pass", 32],
    ["should handle timeout", "fail", 5001],
  ]);
});

test("jest summary line", () => {
  const r = parseTestReport("PASS src/a.test.ts\n  ✓ works (12 ms)\nTests:       1 failed, 8 passed, 9 total\nTime:        2.5 s")!;
  assert.equal(r.runner, "jest");
  assert.deepEqual([r.passed, r.failed, r.durationMs], [8, 1, 2500]);
});

test("node:test spec reporter", () => {
  const r = parseTestReport("✔ hub: first read (2.1ms)\n✖ hub: broken (3.0ms)\nℹ tests 2\nℹ pass 1\nℹ fail 1\nℹ duration_ms 55.2")!;
  assert.equal(r.runner, "node");
  assert.deepEqual([r.passed, r.failed], [1, 1]);
  assert.equal(r.files[0].tests[1].status, "fail");
});

test("pytest", () => {
  const r = parseTestReport("tests/test_auth.py::test_login PASSED [ 50%]\ntests/test_auth.py::test_timeout FAILED [100%]\n===== 1 failed, 1 passed in 0.42s =====")!;
  assert.equal(r.runner, "pytest");
  assert.deepEqual([r.passed, r.failed, r.durationMs], [1, 1, 420]);
  assert.equal(r.files[0].status, "fail");
});

test("go test -v", () => {
  const r = parseTestReport("=== RUN   TestA\n--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.10s)\nFAIL\nFAIL\tgithub.com/x/y\t0.123s")!;
  assert.equal(r.runner, "go");
  assert.deepEqual([r.passed, r.failed], [1, 1]);
});

test("unrelated output is not a report; PR links are found", () => {
  assert.equal(parseTestReport("total 288\n-rw-r--r-- handlers.ts"), null);
  assert.equal(parseTestReport(undefined), null);
  assert.deepEqual(findPullRequests("Opened https://github.com/acme/deal-service/pull/142 and https://github.com/acme/deal-service/pull/142 again"), [
    { url: "https://github.com/acme/deal-service/pull/142", repo: "acme/deal-service", number: 142 },
  ]);
});
