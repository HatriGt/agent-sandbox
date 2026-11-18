// What a paste becomes, and the tail that names attachments for the agent.
// Run from web/:  npx --yes tsx --tsconfig tsconfig.json --test src/lib/attachments.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentDisplayName, attachmentsTail, countLines, fmtBytes, isLongPaste, pastedExtension, pastedTextAttachment } from "./attachments";

test("a sentence is typed; a long passage or many lines is a document", () => {
  assert.equal(isLongPaste("fix the limiter"), false);
  assert.equal(isLongPaste("x".repeat(1499)), false);
  assert.equal(isLongPaste("x".repeat(1500)), true);
  assert.equal(isLongPaste(Array.from({ length: 29 }, (_, i) => `l${i}`).join("\n")), false);
  assert.equal(isLongPaste(Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n")), true);
});

test("line counts ignore a trailing newline", () => {
  assert.equal(countLines(""), 0);
  assert.equal(countLines("one"), 1);
  assert.equal(countLines("one\ntwo\n"), 2);
  assert.equal(countLines("one\ntwo"), 2);
});

test("a paste is JSON when it parses, markdown when shaped like it, text otherwise", () => {
  assert.equal(pastedExtension('{"a": [1, 2]}'), "json");
  assert.equal(pastedExtension("[1,\n2]"), "json");
  assert.equal(pastedExtension("{ not json"), "txt");
  assert.equal(pastedExtension("# Title\n\nbody"), "md");
  assert.equal(pastedExtension("some\n```js\ncode\n```"), "md");
  assert.equal(pastedExtension("Error: boom\n  at x (a.ts:1)"), "txt");
});

test("a pasted passage is named pasted-N with its kind, size and line count", () => {
  const a = pastedTextAttachment('{"k": "é"}\n', 3);
  assert.equal(a.name, "pasted-3.json");
  assert.equal(a.kind, "text");
  assert.equal(a.pasted, true);
  assert.equal(a.lines, 1);
  assert.equal(a.size, 12); // é is two bytes
  assert.match(a.dataUrl, /^data:application\/json;base64,/);
  assert.equal(Buffer.from(a.dataUrl.split(",")[1], "base64").toString("utf8"), '{"k": "é"}\n');
});

test("the tail says images when they all are, files otherwise, with a note under a path", () => {
  assert.equal(attachmentsTail([]), "");
  assert.equal(attachmentsTail([{ path: "/workspace/.attachments/1-a.png", kind: "image" }]), "Attached image (open with the Read tool):\n- /workspace/.attachments/1-a.png");
  assert.equal(
    attachmentsTail([
      { path: "/workspace/.attachments/1-a.png", kind: "image" },
      { path: "/workspace/.attachments/2-pasted-1.json", kind: "text", note: "text pasted into the message, 66 lines" },
    ]),
    "Attached files (open with the Read tool):\n- /workspace/.attachments/1-a.png\n- /workspace/.attachments/2-pasted-1.json\n  text pasted into the message, 66 lines"
  );
  assert.equal(attachmentsTail([{ path: "/workspace/.attachments/1-r.pdf", kind: "pdf" }]), "Attached file (open with the Read tool):\n- /workspace/.attachments/1-r.pdf");
});

test("the bubble shows the name without the send stamp", () => {
  assert.equal(attachmentDisplayName("/workspace/.attachments/20261118093000-2-pasted-1.json"), "pasted-1.json");
  assert.equal(attachmentDisplayName("/workspace/.attachments/report.pdf"), "report.pdf");
});

test("sizes read as a person says them", () => {
  assert.equal(fmtBytes(512), "512 B");
  assert.equal(fmtBytes(6 * 1024), "6 KB");
  assert.equal(fmtBytes(1.25 * 1024 * 1024), "1.3 MB");
  assert.equal(fmtBytes(12 * 1024 * 1024), "12 MB");
});
