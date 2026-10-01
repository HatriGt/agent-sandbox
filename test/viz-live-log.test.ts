import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_ROW_CAP,
  createLiveLog,
  feedLiveLog,
  formatMs,
  liveKind,
  looksLikeLiveLog,
  p95,
  parseAccessLine,
  parseLevel,
} from "../web/src/lib/viz-live-log";
import { foldBackgroundShells, parseTrace } from "../src/trace";

test("parseAccessLine: common / combined log format", () => {
  const clf = '127.0.0.1 - frank [10/Oct/2000:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326';
  assert.deepEqual(parseAccessLine(clf), { method: "GET", path: "/apache_pb.gif", status: 200 });
  const combined = '10.0.0.2 - - [01/Oct/2026:10:00:00 +0000] "POST /api/orders HTTP/1.1" 502 0 "-" "curl/8.0" rt=0.250';
  assert.deepEqual(parseAccessLine(combined), { method: "POST", path: "/api/orders", status: 502, ms: 250 });
});

test("parseAccessLine: METHOD /path STATUS 12ms and morgan dev", () => {
  assert.deepEqual(parseAccessLine("GET /health 200 3ms"), { method: "GET", path: "/health", status: 200, ms: 3 });
  assert.deepEqual(parseAccessLine("POST /api/login 401 12.5 ms - 22"), { method: "POST", path: "/api/login", status: 401, ms: 12.5 });
  assert.deepEqual(parseAccessLine("[web] 12:00:01 INFO DELETE /users/4 -> 204 (1.2s)"), { method: "DELETE", path: "/users/4", status: 204, ms: 1200 });
  // No unit → no latency invented.
  assert.deepEqual(parseAccessLine("GET /a 200 17"), { method: "GET", path: "/a", status: 200 });
});

test("parseAccessLine: JSON lines and logfmt", () => {
  assert.deepEqual(parseAccessLine('{"level":"info","method":"get","path":"/x","status":500,"duration_ms":41}'), { method: "GET", path: "/x", status: 500, ms: 41 });
  assert.deepEqual(parseAccessLine('{"req":{"method":"PUT","url":"/y"},"res":{"statusCode":201},"responseTime":9}'), { method: "PUT", path: "/y", status: 201, ms: 9 });
  assert.deepEqual(parseAccessLine('{"method":"GET","path":"/z","status":200,"duration":"15ms"}'), { method: "GET", path: "/z", status: 200, ms: 15 });
  // Unit-less generic duration is ambiguous → omitted.
  assert.deepEqual(parseAccessLine('{"method":"GET","path":"/z","status":200,"duration":15}'), { method: "GET", path: "/z", status: 200 });
  assert.deepEqual(parseAccessLine('time=1 method=GET path=/q status=304 duration=2ms'), { method: "GET", path: "/q", status: 304, ms: 2 });
  assert.equal(parseAccessLine('{"msg":"hello"}'), null);
  assert.equal(parseAccessLine("compiling 12 modules"), null);
  assert.equal(parseAccessLine("GET is a verb, 200 times"), null);
});

test("parseAccessLine: partial lines never misparse", () => {
  assert.equal(parseAccessLine("GET /api/users 20"), null);
  assert.equal(parseAccessLine('{"method":"GET","path":"/a","sta'), null);
  assert.equal(parseAccessLine('127.0.0.1 - - [10/Oct/2000:13:55:36 -0700] "GET /a HTTP/1.1" 20'), null);
});

test("parseLevel: words and JSON levels", () => {
  assert.equal(parseLevel("2026-10-01T10:00:00Z ERROR db timeout"), "error");
  assert.equal(parseLevel("[WARN] slow query"), "warn");
  assert.equal(parseLevel("I am an errorless line"), null);
  assert.equal(parseLevel('{"level":50,"msg":"boom"}'), "error");
  assert.equal(parseLevel('{"severity":"INFO","msg":"ok"}'), "info");
});

test("feedLiveLog: only complete lines, incremental, counters only grow", () => {
  const full = [
    "GET /a 200 10ms",
    "GET /b 404 20ms",
    "POST /c 500 30ms",
    "GET /d 301 40ms",
    "ERROR something broke",
  ].join("\n") + "\n";
  let s = createLiveLog();
  let prevTotal = 0;
  // Feed every prefix, character by character — a mid-line cut must never be counted.
  for (let i = 1; i <= full.length; i++) {
    s = feedLiveLog(s, full.slice(0, i));
    assert.ok(s.total >= prevTotal);
    prevTotal = s.total;
    if (full.slice(0, i) === "GET /api 20") assert.equal(s.total, 0);
  }
  const whole = feedLiveLog(createLiveLog(), full);
  assert.equal(s.total, 4);
  assert.deepEqual(s.byClass, whole.byClass);
  assert.deepEqual(s.byClass, { "2xx": 1, "3xx": 1, "4xx": 1, "5xx": 1 });
  assert.equal(s.errors, 1);
  assert.equal(p95(s.latencies), 40);
  assert.equal(liveKind(s), "access");
  // Unterminated last line waits until final.
  const t = "GET /a 200 1ms\nGET /b 200 2ms";
  assert.equal(feedLiveLog(createLiveLog(), t).total, 1);
  assert.equal(feedLiveLog(createLiveLog(), t, { final: true }).total, 2);
});

test("feedLiveLog: same state when nothing new completed; reset on rewrite; row cap", () => {
  const a = feedLiveLog(createLiveLog(), "GET /a 200 1ms\n");
  assert.equal(feedLiveLog(a, "GET /a 200 1ms\nGET /b"), a);
  const r = feedLiveLog(a, "totally different\n");
  assert.equal(r.total, 0);
  let big = "";
  for (let i = 0; i < LIVE_ROW_CAP + 50; i++) big += `GET /x${i} 200 1ms\n`;
  const b = feedLiveLog(createLiveLog(), big);
  assert.equal(b.rows.length, LIVE_ROW_CAP);
  assert.equal(b.total, LIVE_ROW_CAP + 50);
  assert.equal(b.rows[b.rows.length - 1].seq, LIVE_ROW_CAP + 49);
});

test("liveKind / looksLikeLiveLog / formatMs / p95", () => {
  assert.equal(looksLikeLiveLog("INFO a\nWARN b\nINFO c\n"), true);
  assert.equal(looksLikeLiveLog("a,b\n1,2\n"), false);
  assert.equal(looksLikeLiveLog("GET /a 200 1ms\n"), false);
  assert.equal(p95([]), null);
  assert.equal(formatMs(null), "—");
  assert.equal(formatMs(1500), "1.50s");
  assert.equal(formatMs(42.4), "42ms");
});

const BG_LOG = [
  "→ Bash: tail -f /var/log/app.log ⟦#abc12345⟧",
  "  ⟦#abc12345⟧ Command running in background with ID: bash_1",
  "→ BashOutput: bash_1 ⟦#poll0001⟧",
  "  ⟦#poll0001⟧ <status>running</status>",
  "  ",
  "  <stdout>",
  "  GET /a 200 3ms",
  "  GET /b 500 9ms",
  "  </stdout>",
  "I see two calls so far.",
  "→ BashOutput: bash_1 ⟦#poll0002⟧",
  "  ⟦#poll0002⟧ <status>running</status>",
  "  ",
  "  <stdout>",
  "  POST /c 201 4ms",
  "  </stdout>",
].join("\n");

test("trace: background shell polls fold into the shell call, streaming until killed", () => {
  const ev = parseTrace(BG_LOG).filter((e) => e.kind === "tool");
  assert.equal(ev.length, 1);
  const sh = ev[0];
  assert.ok(sh.kind === "tool");
  if (sh.kind !== "tool") return;
  assert.equal(sh.name, "Bash");
  assert.equal(sh.streaming, true);
  assert.equal(sh.result, "GET /a 200 3ms\nGET /b 500 9ms\nPOST /c 201 4ms");
  const killed = parseTrace(BG_LOG + "\n→ KillShell: bash_1\n  Shell bash_1 killed").filter((e) => e.kind === "tool");
  assert.equal(killed.length, 1);
  const k = killed[0];
  assert.ok(k.kind === "tool" && k.streaming === undefined && k.result?.includes("POST /c"));
  const done = parseTrace(BG_LOG + "\n→ BashOutput: bash_1\n  <status>completed</status>\n  <exit_code>0</exit_code>");
  const d = done.find((e) => e.kind === "tool");
  assert.ok(d?.kind === "tool" && d.streaming === undefined);
});

test("foldBackgroundShells: leaves ordinary tool calls alone", () => {
  const ev = parseTrace("→ Bash: ls\n  a\n  b");
  assert.deepEqual(foldBackgroundShells(ev), ev);
  assert.equal(ev[0].kind === "tool" && ev[0].result, "a\nb");
});

test("liveToolOutputSource: complete lines only, JSON documents wait", async () => {
  const { liveToolOutputSource } = await import("../web/src/lib/viz-tool-output");
  assert.equal(liveToolOutputSource("a,b\n1,2\n3,"), "a,b\n1,2");
  assert.equal(liveToolOutputSource("one line"), null);
  assert.equal(liveToolOutputSource('{\n  "a": 1,\n'), null);
  assert.equal(liveToolOutputSource('{"a":1}\n{"a":2}\n{"a"'), '{"a":1}\n{"a":2}');
  assert.equal(liveToolOutputSource("x\n".repeat(500))?.split("\n").length, 200);
});
