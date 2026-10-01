import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveWatch, watchElapsedSec, watchMarks } from "../web/src/lib/watch.ts";
import type { TraceEvent } from "../src/trace.ts";

const say = (text: string, at?: number): TraceEvent => ({ kind: "say", text, at });
const block = "```stats id=calls\nCalls: 4\n```";

test("watchMarks parses target, interval and end", () => {
  assert.deepEqual(watchMarks("hi <!-- watch: backend logs | every 30s --> there"), [{ kind: "start", target: "backend logs", every: "30s" }]);
  assert.deepEqual(watchMarks("<!--watch:target=api errors-->"), [{ kind: "start", target: "api errors", every: null }]);
  assert.deepEqual(watchMarks("<!-- watch: queue | 2 min -->"), [{ kind: "start", target: "queue", every: "2min" }]);
  assert.deepEqual(watchMarks("<!-- watch: end -->"), [{ kind: "end" }]);
  assert.deepEqual(watchMarks("<!-- watch:  -->"), []);
  assert.deepEqual(watchMarks("watch: backend logs"), [], "only the comment form counts");
});

test("deriveWatch counts block updates and tracks time", () => {
  const w = deriveWatch([
    { kind: "you", text: "keep listening to the backend logs", at: 1000 },
    say("Watching.\n<!-- watch: backend logs | every 30s -->\n" + block, 2000),
    { kind: "tool", name: "Bash", arg: "timeout 30 tail -n 50 -f app.log", at: 3000 },
    say(block, 32_000),
    say("New 500 on /login.", 40_000),
    say(block, 62_000),
  ]);
  assert.ok(w);
  assert.equal(w.target, "backend logs");
  assert.equal(w.every, "30s");
  assert.equal(w.updates, 3);
  assert.equal(w.phase, "on");
  assert.equal(watchElapsedSec(w, false), 60);
  assert.equal(watchElapsedSec(w, true, 122_000), 120);
});

test("an operator message ends the watch; a re-emitted marker resumes it", () => {
  const ev: TraceEvent[] = [say("<!-- watch: logs -->" + block, 1), { kind: "you", text: "thanks" }];
  assert.equal(deriveWatch(ev), null);
  ev.push(say("<!-- watch: logs -->", 5));
  assert.equal(deriveWatch(ev)?.updates, 0);
});

test("end marker and paused line set the phase", () => {
  assert.equal(deriveWatch([say("<!-- watch: logs -->"), say("Done.<!-- watch: end -->")])?.phase, "ended");
  assert.equal(deriveWatch([say("<!-- watch: logs -->"), say("Watch paused — say continue to keep watching.")])?.phase, "paused");
  assert.equal(deriveWatch([say("no watch here " + block)]), null);
});
