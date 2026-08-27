/**
 * Recognise a test runner's output inside a Bash result and shape it into a report the UI can render
 * as a card (summary chips + per-file results) instead of a wall of text. Heuristic by design — it
 * covers the runners the agent actually meets (vitest / jest, node:test, pytest, go test) and returns
 * null for anything else, so unrecognised output falls back to the terminal panel untouched.
 * Pure; the server test suite covers it.
 */
export type TestStatus = "pass" | "fail" | "skip";

export interface TestCase {
  name: string;
  status: TestStatus;
  ms?: number;
}
export interface TestFile {
  name: string;
  status: TestStatus;
  tests: TestCase[];
}
export interface TestReport {
  runner: "vitest" | "jest" | "node" | "pytest" | "go";
  passed: number;
  failed: number;
  skipped: number;
  durationMs?: number;
  files: TestFile[];
}

const strip = (s: string) => s.replace(/\[[0-9;]*m/g, "");

function toMs(n: string, unit: string): number {
  const v = Number(n);
  return unit.startsWith("ms") ? v : unit.startsWith("s") ? v * 1000 : unit.startsWith("m") ? v * 60_000 : v;
}

export function parseTestReport(raw: string | undefined): TestReport | null {
  if (!raw) return null;
  const text = strip(raw);
  return parseJestLike(text) ?? parseNodeTest(text) ?? parsePytest(text) ?? parseGo(text);
}

/* vitest / jest:
 *   ✓ src/a.test.ts (3 tests) 45ms        (vitest file line)
 *   ✓ should login (45 ms) / ✕ should fail (5001 ms) / ○ skipped
 *   Tests  8 passed | 1 failed | 1 skipped (10)   or   Tests: 1 failed, 8 passed, 9 total
 *   Duration  1.23s                                or   Time: 1.234 s
 */
function parseJestLike(t: string): TestReport | null {
  const sum = t.match(/Tests:?\s+([^\n]*)/);
  if (!sum) return null;
  const line = sum[1];
  const num = (k: string) => Number((line.match(new RegExp(`(\\d+)\\s+${k}`)) ?? [])[1] ?? 0);
  const passed = num("passed");
  const failed = num("failed");
  const skipped = num("skipped") + num("todo") + num("pending");
  if (!passed && !failed && !skipped) return null;
  const dur = t.match(/(?:Duration|Time:?)\s+([\d.]+)\s*(ms|s|m)/);
  const runner: TestReport["runner"] = /vitest|Duration\s/i.test(t) ? "vitest" : "jest";

  const files: TestFile[] = [];
  let cur: TestFile | null = null;
  for (const l of t.split("\n")) {
    const file = l.match(/^\s*(?:✓|✔|✗|✕|×|❯|PASS|FAIL)\s+([\w./@-]+\.(?:test|spec)\.[cm]?[jt]sx?)\b(?:\s*\((\d+) tests?\))?/);
    if (file) {
      cur = { name: file[1], status: /✗|✕|×|FAIL/.test(l) ? "fail" : "pass", tests: [] };
      files.push(cur);
      continue;
    }
    const tc = l.match(/^\s+(✓|✔|✕|✗|×|○|↓|-)\s+(.+?)(?:\s+\(?(\d+(?:\.\d+)?)\s*(ms|s)\)?)?\s*$/);
    if (tc && cur) {
      const status: TestStatus = /✓|✔/.test(tc[1]) ? "pass" : /○|↓|-/.test(tc[1]) ? "skip" : "fail";
      cur.tests.push({ name: tc[2].trim(), status, ms: tc[3] ? toMs(tc[3], tc[4]) : undefined });
      if (status === "fail") cur.status = "fail";
    }
  }
  return { runner, passed, failed, skipped, durationMs: dur ? toMs(dur[1], dur[2]) : undefined, files };
}

/* node:test (spec reporter):  ✔ name (1.2ms) / ✖ name (3ms) / ﹣ name (skipped)   ℹ pass 234 / ℹ fail 0 */
function parseNodeTest(t: string): TestReport | null {
  const pass = t.match(/ℹ\s+pass\s+(\d+)/);
  const fail = t.match(/ℹ\s+fail\s+(\d+)/);
  if (!pass && !fail) return null;
  const skipped = Number((t.match(/ℹ\s+skipped\s+(\d+)/) ?? [])[1] ?? 0) + Number((t.match(/ℹ\s+todo\s+(\d+)/) ?? [])[1] ?? 0);
  const dur = t.match(/ℹ\s+duration_ms\s+([\d.]+)/);
  const tests: TestCase[] = [];
  for (const l of t.split("\n")) {
    const m = l.match(/^\s*(✔|✖|﹣)\s+(.+?)(?:\s+\(([\d.]+)ms\))?\s*(?:#\s*SKIP)?\s*$/);
    if (m) tests.push({ name: m[2], status: m[1] === "✔" ? "pass" : m[1] === "✖" ? "fail" : "skip", ms: m[3] ? Number(m[3]) : undefined });
  }
  const failed = Number(fail?.[1] ?? 0);
  return {
    runner: "node",
    passed: Number(pass?.[1] ?? 0),
    failed,
    skipped,
    durationMs: dur ? Number(dur[1]) : undefined,
    files: tests.length ? [{ name: "node --test", status: failed ? "fail" : "pass", tests }] : [],
  };
}

/* pytest:  tests/test_auth.py::test_login PASSED [ 10%]   ====== 8 passed, 1 failed, 1 skipped in 1.23s ====== */
function parsePytest(t: string): TestReport | null {
  const sum = t.match(/=+\s+([^=\n]*?)\s+in\s+([\d.]+)s\s+=+/);
  if (!sum) return null;
  const num = (k: string) => Number((sum[1].match(new RegExp(`(\\d+)\\s+${k}`)) ?? [])[1] ?? 0);
  const passed = num("passed");
  const failed = num("failed") + num("error");
  const skipped = num("skipped") + num("xfailed") + num("deselected");
  if (!passed && !failed && !skipped) return null;
  const byFile = new Map<string, TestFile>();
  for (const l of t.split("\n")) {
    const m = l.match(/^([\w./-]+\.py)::([^\s]+)\s+(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)/);
    if (!m) continue;
    const f = byFile.get(m[1]) ?? { name: m[1], status: "pass" as TestStatus, tests: [] };
    const status: TestStatus = /PASSED|XPASS/.test(m[3]) ? "pass" : /SKIPPED|XFAIL/.test(m[3]) ? "skip" : "fail";
    f.tests.push({ name: m[2], status });
    if (status === "fail") f.status = "fail";
    byFile.set(m[1], f);
  }
  return { runner: "pytest", passed, failed, skipped, durationMs: Number(sum[2]) * 1000, files: [...byFile.values()] };
}

/* go test -v:  --- PASS: TestX (0.00s) / --- FAIL: TestY (0.10s) / --- SKIP   ok  pkg 1.23s / FAIL pkg 1.2s */
function parseGo(t: string): TestReport | null {
  const results = [...t.matchAll(/^--- (PASS|FAIL|SKIP): (\S+) \(([\d.]+)s\)/gm)];
  if (!results.length) return null;
  const pkgs = [...t.matchAll(/^(ok|FAIL)\s+(\S+)\s+([\d.]+)s/gm)];
  const tests: TestCase[] = results.map((m) => ({ name: m[2], status: m[1] === "PASS" ? "pass" : m[1] === "SKIP" ? "skip" : "fail", ms: Number(m[3]) * 1000 }));
  const passed = tests.filter((x) => x.status === "pass").length;
  const failed = tests.filter((x) => x.status === "fail").length;
  const skipped = tests.filter((x) => x.status === "skip").length;
  const dur = pkgs.reduce((a, m) => a + Number(m[3]) * 1000, 0);
  return {
    runner: "go",
    passed,
    failed,
    skipped,
    durationMs: dur || undefined,
    files: pkgs.length
      ? pkgs.map((m) => ({ name: m[2], status: m[1] === "ok" ? "pass" : "fail", tests: pkgs.length === 1 ? tests : [] }))
      : [{ name: "go test", status: failed ? "fail" : "pass", tests }],
  };
}

/** GitHub pull-request URLs in a blob of text (the agent's prose or a `gh pr create` result). */
export function findPullRequests(text: string | undefined): Array<{ url: string; repo: string; number: number }> {
  if (!text) return [];
  const out = new Map<string, { url: string; repo: string; number: number }>();
  for (const m of text.matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g)) {
    const url = m[0];
    if (!out.has(url)) out.set(url, { url, repo: m[1], number: Number(m[2]) });
  }
  return [...out.values()];
}
