/**
 * A delivered message carries machinery for the agent (skill token, file lines, image list). The
 * thread shows the words and the chips, never the machinery — for the echo and the log line alike.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYouMessage } from "../web/src/lib/you-message.ts";

test("plain words pass through", () => {
  assert.deepEqual(parseYouMessage("fix the flaky test"), { body: "fix the flaky test", skill: null, files: [] });
});

test("file chips come back as files and the path lines leave the body", () => {
  const sent = "tighten this\n\nFiles: @orders-api/src/a.ts @orders-api/test/a.test.ts\n\nReferenced files (under /workspace): /workspace/orders-api/src/a.ts, /workspace/orders-api/test/a.test.ts";
  assert.deepEqual(parseYouMessage(sent), { body: "tighten this", skill: null, files: ["orders-api/src/a.ts", "orders-api/test/a.test.ts"] });
});

test("an inline mention stays in the words; only its absolute-path line is dropped", () => {
  const sent = "why does @src/x.ts import redis?\n\nReferenced files (under /workspace): /workspace/src/x.ts";
  assert.deepEqual(parseYouMessage(sent), { body: "why does @src/x.ts import redis?", skill: null, files: [] });
});

test("a leading skill is split from the words, with or without words", () => {
  assert.deepEqual(parseYouMessage("/review-pr check 482"), { body: "check 482", skill: "review-pr", files: [] });
  assert.deepEqual(parseYouMessage("/review-pr"), { body: "", skill: "review-pr", files: [] });
});

test("a path that merely starts with a slash is prose", () => {
  assert.equal(parseYouMessage("/etc/hosts is wrong").skill, null);
});

test("skill, chips and images together", () => {
  const sent = "/deploy to staging\n\nFiles: @infra/app.yaml\n\nReferenced files (under /workspace): /workspace/infra/app.yaml\n\nAttached image (open with the Read tool):\n- /workspace/.attachments/20261111-1-shot.png";
  assert.deepEqual(parseYouMessage(sent), { body: "to staging", skill: "deploy", files: ["infra/app.yaml"] });
});

test("chips with no words at all", () => {
  const sent = "\n\nFiles: @a.ts\n\nReferenced files (under /workspace): /workspace/a.ts";
  assert.deepEqual(parseYouMessage(sent), { body: "", skill: null, files: ["a.ts"] });
  assert.deepEqual(parseYouMessage("/explain \n\nFiles: @a.ts\n\nReferenced files (under /workspace): /workspace/a.ts"), { body: "", skill: "explain", files: ["a.ts"] });
});
