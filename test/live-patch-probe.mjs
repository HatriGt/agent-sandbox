// Live probes for the `patch` feature against production. Read-only from the repo's perspective:
// every case either must NOT start a box, or starts a verification-only box the runner tears down.
// Usage: node test/live-patch-probe.mjs <token> [case...]
const URL_ = "https://agent-sandbox.ajeethkumar.dev/mcp";
const TOKEN = process.argv[2];
if (!TOKEN) { console.error("usage: node test/live-patch-probe.mjs <token>"); process.exit(2); }
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
let sid;
async function post(body) {
  const h = sid ? { ...H, "Mcp-Session-Id": sid } : H;
  const r = await fetch(URL_, { method: "POST", headers: h, body: JSON.stringify(body) });
  const t = await r.text();
  if (!sid) sid = r.headers.get("mcp-session-id");
  return { status: r.status, text: t };
}
let nextId = 100;
export async function call(args) {
  return post({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name: "delegate", arguments: args } });
}
export async function tool(name, args) {
  return post({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } });
}
export function textOf(r) {
  // Collect all text blocks from the SSE/json payload.
  const out = [];
  const re = /"text":"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(r.text))) out.push(JSON.parse('"' + m[1] + '"'));
  return out.join("\n---\n") || r.text.slice(0, 400);
}
export async function init() {
  await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bughunt", version: "0" } } });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });
}
const only = new Set(process.argv.slice(3));
const want = (n) => only.size === 0 || only.has(n);

await init();
console.log("session", sid);

if (want("1")) {
  const r = await call({ source: "local", repo: "/Users/me/x", patch: "diff\n", task: "t" });
  console.log("\n[1] local+patch on remote:\n" + textOf(r).slice(0, 300));
}
if (want("2")) {
  const r = await call({ patch: "diff --git a/x b/x\n", task: "write a report" });
  console.log("\n[2] patch with no repo:\n" + textOf(r).slice(0, 300));
}
if (want("3")) {
  const r = await call({ repo: "atom-insurance/atom-deal-service", ref: "Development", patch: "+x".repeat(4.5 * 1024 * 1024) + "\n", task: "t" });
  console.log("\n[3] 9MB patch (over MAX_PATCH_BYTES, under body limit):", r.status, "\n" + textOf(r).slice(0, 300));
}
if (want("4")) {
  const r = await call({ repo: "atom-insurance/atom-deal-service", ref: "Development", patch: "+x".repeat(9 * 1024 * 1024) + "\n", task: "t" });
  console.log("\n[4] 18MB body (over the 16MB tier):", r.status, "\n" + r.text.slice(0, 300));
}
if (want("5")) {
  const evil = "diff --git a/../../escape.txt b/../../escape.txt\nnew file mode 100644\n--- /dev/null\n+++ b/../../escape.txt\n@@ -0,0 +1,1 @@\n+pwned\n";
  const r = await call({ repo: "atom-insurance/atom-deal-service", ref: "Development", patch: evil, task: "should not start" });
  console.log("\n[5] path traversal:\n" + textOf(r).slice(0, 400));
}
if (want("6")) {
  const r = await call({ repo: "atom-insurance/atom-deal-service", ref: "Development", patch: "this is not a diff at all\n", task: "should not start" });
  console.log("\n[6] garbage patch:\n" + textOf(r).slice(0, 400));
}
if (want("7")) {
  // Symlink patch: git apply creates the link; the follow-up write through it would escape. git
  // refuses "beyond a symbolic link" on apply of the second file — verify that holds remotely.
  const link = "diff --git a/lnk b/lnk\nnew file mode 120000\n--- /dev/null\n+++ b/lnk\n@@ -0,0 +1,1 @@\n+/etc\n\\ No newline at end of file\ndiff --git a/lnk/pwn b/lnk/pwn\nnew file mode 100644\n--- /dev/null\n+++ b/lnk/pwn\n@@ -0,0 +1,1 @@\n+pwned\n";
  const r = await call({ repo: "atom-insurance/atom-deal-service", ref: "Development", patch: link, task: "should not start" });
  console.log("\n[7] symlink escape:\n" + textOf(r).slice(0, 400));
}
