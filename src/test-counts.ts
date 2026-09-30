/**
 * Test pass/fail COUNTS from a test runner's summary output — the outcome card's trust line
 * (docs/plan-demo-parity.md bet 2). Count-only sibling of web/src/lib/testReport.ts (which also
 * shapes per-case rows for the thread); the server cannot import web code. Recognises node:test,
 * jest/vitest, pytest, go test -v and cargo test. Anything else returns null, and the caller falls
 * back to the exit code — a count is never guessed.
 */
export interface TestCounts {
  runner: "node" | "jest" | "vitest" | "pytest" | "go" | "cargo";
  passed: number;
  failed: number;
  skipped: number;
}

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

export function parseTestCounts(raw: string | undefined): TestCounts | null {
  if (!raw) return null;
  const t = strip(raw);
  return cargo(t) ?? nodeTest(t) ?? jestLike(t) ?? pytest(t) ?? goTest(t);
}

function cargo(t: string): TestCounts | null {
  const rs = [...t.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/g)];
  if (!rs.length) return null;
  const sum = (i: number) => rs.reduce((a, m) => a + Number(m[i]), 0);
  return { runner: "cargo", passed: sum(1), failed: sum(2), skipped: sum(3) };
}

function nodeTest(t: string): TestCounts | null {
  const pass = t.match(/^\s*(?:ℹ|#)\s*pass\s+(\d+)/m);
  const fail = t.match(/^\s*(?:ℹ|#)\s*fail\s+(\d+)/m);
  if (!pass || !fail) return null;
  const n = (k: string) => Number((t.match(new RegExp(`^\\s*(?:ℹ|#)\\s*${k}\\s+(\\d+)`, "m")) ?? [])[1] ?? 0);
  return { runner: "node", passed: Number(pass[1]), failed: Number(fail[1]), skipped: n("skipped") + n("todo") };
}

function jestLike(t: string): TestCounts | null {
  const sum = [...t.matchAll(/^\s*Tests:?\s+([^\n]*)/gm)].pop();
  if (!sum) return null;
  const line = sum[1];
  const num = (k: string) => Number((line.match(new RegExp(`(\\d+)\\s+${k}`)) ?? [])[1] ?? 0);
  const passed = num("passed");
  const failed = num("failed");
  const skipped = num("skipped") + num("todo") + num("pending");
  if (!passed && !failed && !skipped) return null;
  return { runner: /vitest|^\s*Duration\s/im.test(t) ? "vitest" : "jest", passed, failed, skipped };
}

function pytest(t: string): TestCounts | null {
  const sum = [...t.matchAll(/=+\s+([^=\n]*?)\s+in\s+[\d.]+s\s*(?:\([^)]*\)\s*)?=+/g)].pop();
  if (!sum) return null;
  const num = (k: string) => Number((sum[1].match(new RegExp(`(\\d+)\\s+${k}`)) ?? [])[1] ?? 0);
  const passed = num("passed");
  const failed = num("failed") + num("errors?");
  const skipped = num("skipped") + num("xfailed") + num("deselected");
  if (!passed && !failed && !skipped) return null;
  return { runner: "pytest", passed, failed, skipped };
}

function goTest(t: string): TestCounts | null {
  const rs = [...t.matchAll(/^\s*--- (PASS|FAIL|SKIP): \S+/gm)];
  if (!rs.length) return null;
  const c = (k: string) => rs.filter((m) => m[1] === k).length;
  return { runner: "go", passed: c("PASS"), failed: c("FAIL"), skipped: c("SKIP") };
}
