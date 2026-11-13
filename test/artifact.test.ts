/**
 * The pure, box-independent half of the artifact reader: path confinement and content-type
 * classification. The on-box realpath/symlink/size checks run in a shell inside the microVM and are
 * covered by the live security curls at ship time (traversal + /etc/passwd must be rejected); here we
 * lock down the first line of defence — the pure validator that runs BEFORE anything touches a box.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeWorkspacePath, classifyContentType, contentDisposition } from "../src/artifact.ts";

test("safeWorkspacePath accepts a bare relative file", () => {
  const r = safeWorkspacePath("report.md");
  assert.deepEqual(r, { ok: true, relPath: "report.md" });
});

test("safeWorkspacePath accepts a nested relative file", () => {
  const r = safeWorkspacePath("out/nested/a.txt");
  assert.deepEqual(r, { ok: true, relPath: "out/nested/a.txt" });
});

test("safeWorkspacePath accepts an absolute path literally under /workspace", () => {
  const r = safeWorkspacePath("/workspace/report.md");
  assert.deepEqual(r, { ok: true, relPath: "report.md" });
});

test("safeWorkspacePath collapses ./ and // noise", () => {
  const r = safeWorkspacePath("./out//./a.txt");
  assert.deepEqual(r, { ok: true, relPath: "out/a.txt" });
});

test("safeWorkspacePath rejects an absolute path outside /workspace", () => {
  const r = safeWorkspacePath("/etc/passwd");
  assert.equal(r.ok, false);
});

test("safeWorkspacePath rejects relative .. traversal", () => {
  const r = safeWorkspacePath("../../etc/passwd");
  assert.equal(r.ok, false);
});

test("safeWorkspacePath rejects a .. that climbs out of a /workspace-absolute path", () => {
  const r = safeWorkspacePath("/workspace/../secret");
  assert.equal(r.ok, false);
});

test("safeWorkspacePath rejects a .. buried mid-path", () => {
  const r = safeWorkspacePath("out/../../etc/passwd");
  assert.equal(r.ok, false);
});

test("safeWorkspacePath rejects the workspace root itself (a directory)", () => {
  const r = safeWorkspacePath("/workspace");
  assert.equal(r.ok, false);
});

test("safeWorkspacePath rejects empty, null-byte, and over-long paths", () => {
  assert.equal(safeWorkspacePath("").ok, false);
  assert.equal(safeWorkspacePath("a\0b").ok, false);
  assert.equal(safeWorkspacePath("a/".repeat(600)).ok, false);
});

test("classifyContentType serves markdown/text inline, never as html", () => {
  assert.deepEqual(classifyContentType("report.md"), {
    contentType: "text/markdown; charset=utf-8",
    inlineSafe: true,
  });
  assert.deepEqual(classifyContentType("notes.txt"), {
    contentType: "text/plain; charset=utf-8",
    inlineSafe: true,
  });
  // An .html artifact must NOT be served as text/html (XSS against our origin) — download-only.
  const html = classifyContentType("evil.html");
  assert.notEqual(html.contentType, "text/html");
  assert.equal(html.inlineSafe, false);
});

test("classifyContentType forces download for unknown/binary types", () => {
  assert.deepEqual(classifyContentType("archive.zip"), {
    contentType: "application/octet-stream",
    inlineSafe: false,
  });
  assert.equal(classifyContentType("image.png").inlineSafe, false);
});

test("contentDisposition keeps an ASCII name as is and encodes any other name", () => {
  assert.equal(contentDisposition("attachment", "report.md"), 'attachment; filename="report.md"');
  assert.equal(contentDisposition("inline", 'a"b.txt'), "inline; filename=\"a_b.txt\"; filename*=UTF-8''a%22b.txt");
  const v = contentDisposition("attachment", "отчёт 📊.txt");
  assert.match(v, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  assert.equal(decodeURIComponent(v.split("UTF-8''")[1]), "отчёт 📊.txt");
  // Node refuses a header value outside Latin-1; the result must always be a legal header.
  assert.ok(/^[\t\x20-\x7e]*$/.test(v));
});
