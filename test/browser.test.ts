import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { BROWSER_DAEMON_SRC } from "../src/browser-daemon.ts";
import { BROWSER_DAEMON_VERSION, MOLI_SHA256, MOLI_VERSION, browserStubScript, makeBoxQueue, moliInstallSh, normalizeUrl, parseBrowserAction, parseBrowserReply } from "../src/browser.ts";

test("normalizeUrl: a dev server is http, a domain is https, anything else is a search", () => {
  assert.equal(normalizeUrl("localhost:5173"), "http://localhost:5173/");
  assert.equal(normalizeUrl("localhost:3000/pricing?x=1"), "http://localhost:3000/pricing?x=1");
  assert.equal(normalizeUrl("127.0.0.1:8080"), "http://127.0.0.1:8080/");
  assert.equal(normalizeUrl("web:3000"), "http://web:3000/");
  assert.equal(normalizeUrl("react.dev/learn"), "https://react.dev/learn");
  assert.equal(normalizeUrl("  https://example.com/a b "), "https://example.com/a%20b");
  assert.equal(normalizeUrl("http://example.com"), "http://example.com/");
  assert.equal(normalizeUrl("how to center a div"), "https://duckduckgo.com/html/?q=how%20to%20center%20a%20div");
  assert.equal(normalizeUrl("about:blank"), "about:blank");
});

test("normalizeUrl refuses everything that is not a web page", () => {
  for (const bad of ["", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "ftp://host/x", "chrome://settings", "view-source:https://x.dev", "x".repeat(2001)]) {
    assert.equal(normalizeUrl(bad), null, bad.slice(0, 40));
  }
});

test("parseBrowserAction clamps the viewport and keeps only the fields its action uses", () => {
  const p = parseBrowserAction({ op: "click", x: 99999, y: -5, w: 10, h: 99999, dpr: 3, url: "file:///etc/passwd", text: "x", session: "box-1", evil: "$(rm -rf /)" });
  assert.ok(p.ok);
  assert.deepEqual(p.action, { op: "click", w: 320, h: 1600, dpr: 2, x: 1920, y: 0 });
  const g = parseBrowserAction({ op: "goto", url: "localhost:5173", map: true });
  assert.ok(g.ok);
  assert.deepEqual(g.action, { op: "goto", w: 1024, h: 720, dpr: 1, url: "http://localhost:5173/", map: true });
});

test("parseBrowserAction refuses unknown actions, bad addresses and odd keys", () => {
  assert.equal(parseBrowserAction({ op: "eval", text: "1" }).ok, false);
  assert.equal(parseBrowserAction({ op: "goto", url: "file:///etc/shadow" }).ok, false);
  assert.equal(parseBrowserAction({ op: "goto" }).ok, false);
  assert.equal(parseBrowserAction({ op: "key", key: "Enter; rm" }).ok, false);
  assert.equal(parseBrowserAction({ op: "type", text: "" }).ok, false);
  assert.equal(parseBrowserAction(null).ok, false);
  // `open` without an address shows whatever page the box's browser is already on.
  assert.deepEqual(parseBrowserAction({ op: "open" }), { ok: true, action: { op: "open", w: 1024, h: 720, dpr: 1 } });
});

test("the in-box scripts are valid JavaScript and carry the action as data", () => {
  const p = parseBrowserAction({ op: "type", text: "'; process.exit(1); //\n`${x}`" });
  assert.ok(p.ok);
  const stub = browserStubScript(p.action);
  new Script(stub); // throws on a syntax error
  new Script(BROWSER_DAEMON_SRC);
  assert.ok(stub.includes(JSON.stringify(p.action)), "the action is embedded as one JSON literal");
  assert.ok(stub.includes(BROWSER_DAEMON_VERSION));
  assert.ok(!stub.includes("@@V@@"), "the helper's version placeholder is filled in");
  assert.doesNotMatch(BROWSER_DAEMON_SRC, /`|\$\{/, "the helper must stay free of template syntax (it lives in one raw literal)");
  // The helper and Moli's protocol port answer on the box's loopback only.
  assert.match(BROWSER_DAEMON_SRC, /listen\(PORT, "127\.0\.0\.1"\)/);
  assert.match(BROWSER_DAEMON_SRC, /"--host", "127\.0\.0\.1"/);
});

test("parseBrowserReply reads the marked line and survives shell noise", () => {
  const out = 'motd line\n\n@@ASB-BROWSER@@{"ok":true,"url":"http://localhost:5173/","shot":"abc"}\n';
  assert.deepEqual(parseBrowserReply(out), { ok: true, url: "http://localhost:5173/", shot: "abc" });
  assert.equal(parseBrowserReply("node: not found").ok, false);
  assert.equal(parseBrowserReply("@@ASB-BROWSER@@{broken").ok, false);
  assert.equal(parseBrowserReply('@@ASB-BROWSER@@"text"').ok, false);
});

test("the install step pins the version and refuses a download that does not match", () => {
  const sh = moliInstallSh();
  assert.ok(sh.includes(`moli ${MOLI_VERSION}`));
  assert.ok(sh.includes(`/v${MOLI_VERSION}/moli-x86_64-unknown-linux-gnu.tar.gz`));
  assert.ok(sh.includes(`echo "${MOLI_SHA256}  $D/m.tgz" | sha256sum -c -`));
  assert.ok(sh.indexOf("sha256sum -c") < sh.indexOf("install -m 755"), "checked before it is installed");
  assert.match(sh, /\/var\/tmp\//, "the archive goes to disk, not to the box's in-memory /tmp");
});

test("the claude image carries the browser", async () => {
  const { agentImageDockerfile } = await import("../src/msb.js");
  const df = agentImageDockerfile({ claudeCodeVersion: "2.1.273", ompVersion: "latest" } as never, "node@sha256:abc", [], "claude");
  assert.ok(df.includes(moliInstallSh()));
  assert.match(df, /\/usr\/local\/bin\/moli --version/);
  assert.equal(df.match(/^RUN /gm)?.length, 1);
});

test("makeBoxQueue runs one box's actions in order and lets other boxes through", async () => {
  const enqueue = makeBoxQueue();
  const seen: string[] = [];
  const job = (name: string, ms: number) => () => new Promise<string>((r) => setTimeout(() => (seen.push(name), r(name)), ms));
  const all = Promise.all([enqueue("a", job("a1", 30)), enqueue("a", job("a2", 1)), enqueue("b", job("b1", 5))]);
  await enqueue("a", () => Promise.reject(new Error("boom"))).catch(() => seen.push("a3-failed"));
  await enqueue("a", job("a4", 1));
  assert.deepEqual(await all, ["a1", "a2", "b1"]);
  assert.deepEqual(seen, ["b1", "a1", "a2", "a3-failed", "a4"]);
});
