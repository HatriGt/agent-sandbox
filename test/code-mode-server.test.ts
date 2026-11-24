// The code-mode server end to end: the real server.ts over stdio (under tsx), in front of a small
// upstream MCP server (test/fixtures/code-mode-upstream.mjs) and one that cannot start, driven by
// an SDK client the way Claude Code drives it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { briefError, parseConfig, QUESTION_FILE_DEFAULT } from "../src/code-mode/box/server.ts";
import { QUESTION_MARK } from "../src/drivers/sentinels.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const serverTs = join(root, "src", "code-mode", "box", "server.ts");
const upstream = join(root, "test", "fixtures", "code-mode-upstream.mjs");
const dir = mkdtempSync(join(tmpdir(), "code-mode-it-"));
const stateDir = join(dir, "state");
const outDir = join(dir, "out");
const questionFile = join(dir, "question");
const configPath = join(dir, "upstream.json");
writeFileSync(
  configPath,
  JSON.stringify({
    mcpServers: {
      tracker: { type: "stdio", command: process.execPath, args: [upstream], env: { TRACKER_TOKEN: "s3cret-token" } },
      broken: { type: "stdio", command: process.execPath, args: [join(dir, "does-not-exist.mjs")] },
    },
    codeMode: { deny: ["mcp__tracker__fail_*"] },
  })
);

async function connect(extraEnv: Record<string, string> = {}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", serverTs, configPath],
    cwd: root,
    env: { ...(process.env as Record<string, string>), CODE_MODE_STATE_DIR: stateDir, CODE_MODE_OUT_DIR: outDir, CODE_MODE_QUESTION_FILE: questionFile, ...extraEnv },
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(transport);
  return client;
}

const clients: Client[] = [];
after(async () => {
  for (const c of clients) await c.close().catch(() => {});
});

async function tool(c: Client, name: string, args: Record<string, unknown>) {
  const r = (await c.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { text: r.content.map((x) => x.text).join("\n"), isError: !!r.isError };
}

test("parseConfig: Claude's shapes, the deny list, and every problem reported", () => {
  const ok = parseConfig(JSON.stringify({ mcpServers: { a: { command: "node" }, b: { type: "http", url: "https://x/mcp", headers: { Authorization: "Bearer t" } } }, codeMode: { deny: ["mcp__a__*"] } }));
  assert.ok("config" in ok);
  assert.deepEqual(ok.config.deny, ["mcp__a__*"]);
  assert.equal(ok.config.servers.a.type, "stdio");
  const bad = parseConfig(JSON.stringify({ mcpServers: { "bad name": { command: "x" }, c: { type: "sse", url: "file:///etc/passwd" }, d: { type: "ws" } }, codeMode: { deny: "x" } }));
  assert.ok("error" in bad);
  assert.match(bad.error, /bad name: the name/);
  assert.match(bad.error, /c: sse needs an http\(s\) url/);
  assert.match(bad.error, /d: unknown type "ws"/);
  assert.match(bad.error, /codeMode.deny/);
  assert.ok("error" in parseConfig("{"));
  assert.ok("error" in parseConfig(JSON.stringify({ mcpServers: {} })));
});

test("--check: one line per server, exit 0; a bad config exits 1", () => {
  const out = execFileSync(process.execPath, ["--import", "tsx", serverTs, "--check", configPath], { cwd: root }).toString();
  assert.match(out, /^sdk: .*server[\\/]index\.js$/m);
  assert.match(out, /^server tracker: stdio$/m);
  assert.match(out, /^server broken: stdio$/m);
  assert.match(out, /^deny: mcp__tracker__fail_\*$/m);
  assert.match(out, /^sandbox: vm, empty env/m);
  assert.doesNotMatch(out, /s3cret/);
  const badPath = join(dir, "bad.json");
  writeFileSync(badPath, "{}");
  const r = spawnSync(process.execPath, ["--import", "tsx", serverTs, "--check", badPath], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /config: no mcpServers object/);
});

test("server: tools/list answers with search and run only", async () => {
  const c = await connect();
  clients.push(c);
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name), ["search", "run"]);
});

test("server: search shows signatures, hides denied tools and lists the server that failed", async () => {
  const c = clients[0];
  const r = await tool(c, "search", { query: "items" });
  assert.match(r.text, /mcp__code-mode__run/);
  assert.match(r.text, /### mcp__tracker__list_items\nList tracker items\.\nargs: \{ status\?: "open" \| "closed"; limit\?: number \}/);
  assert.match(r.text, /### mcp__tracker__get_item/);
  assert.match(r.text, /unavailable:\n- broken: /);
  // The upstream's own MCP instructions reach the model, once per session.
  assert.match(r.text, /^tracker says: Statuses are lower case: open or closed\.$/m);
  assert.doesNotMatch((await tool(c, "search", { query: "items" })).text, /tracker says/);
  const all = await tool(c, "search", { query: "" });
  assert.match(all.text, /mcp__tracker__secret_probe — /);
  assert.doesNotMatch(all.text, /fail_tool/);
});

test("server: run filters in the script and returns the value plus one line per call", async () => {
  const c = clients[0];
  const r = await tool(c, "run", {
    code: '```js\nconst all = await call("mcp__tracker__list_items", {})\nconst open = await call("mcp__tracker__list_items", { status: "open" })\nconsole.log("open", open.items.length)\n({ open: open.items.length, firstOpen: open.items[0].id, sawAll: all.items.length })\n```',
  });
  assert.equal(r.isError, false, r.text);
  const lines = r.text.split("\n");
  const value = JSON.parse(lines[0]);
  assert.deepEqual([value.open, value.firstOpen], [134, "IT-1000"]);
  // The 400-item list (over 24k chars) reaches the script whole: only the returned value is capped.
  assert.equal(value.sawAll, 400);
  assert.equal(lines[1], "--- console ---");
  assert.equal(lines[2], "open 134");
  assert.match(lines[3], /^--- 2 MCP calls: \d+k chars in, \d+ out ---$/);
  assert.match(lines[4], /^#1 mcp__tracker__list_items \d+k \{items: \[400 × \{id, title, status, owner: \{email\}\}\], next_cursor\} e\.g\. \{items: \[400 × \{id, title, status, …\}\], next_cursor: null\}$/);
  assert.match(lines[5], /^#2 mcp__tracker__list_items \d+k \{items: \[134 × /);
  assert.equal(lines[6], "await recall(n) returns result #n again, with no new call.");
});

test("server: recall(n) returns the full result again without a new call", async () => {
  const r = await tool(clients[0], "run", { code: "const a = await recall(1); return a.items.length" });
  assert.equal(r.text, "400");
});

test("server: wrong names, wrong arguments and denied tools are refused before running", async () => {
  const c = clients[0];
  const typo = await tool(c, "run", { code: 'await saveFile("x.txt", "written?")\nawait call("mcp__tracker__get_itme", { id: "IT-1000" })' });
  assert.equal(typo.isError, true);
  assert.match(typo.text, /refused before running: mcp__tracker__get_itme does not exist\. Nearest: mcp__tracker__get_item\. Find the name with mcp__code-mode__search\. line 2:/);
  assert.throws(() => readdirSync(outDir), "nothing ran, so nothing was saved");
  assert.match((await tool(c, "run", { code: 'return call("mcp__tracker__get_item", { key: "x" })' })).text, /no argument "key"/);
  assert.match((await tool(c, "run", { code: 'return call("mcp__tracker__fail_tool", {})' })).text, /denied by the rule "mcp__tracker__fail_\*"/);
  // A name built at run time is checked when it is called.
  const dyn = await tool(c, "run", { code: 'const t = "fail_tool"; try { await call("mcp__tracker__" + t, {}) } catch (e) { return e.message }' });
  assert.match(dyn.text, /refused: mcp__tracker__fail_tool is denied/);
});

test("server: upstream errors and an unavailable server are error values in the script", async () => {
  const c = clients[0];
  const r = await tool(c, "run", {
    code: 'const out = []\nfor (const [n, a] of [["mcp__tracker__get_item", { id: "nope" }], ["mcp__broken__x", {}]]) { try { await call(n, a) } catch (e) { out.push(e.message) } }\nreturn out',
  });
  const [notFound, broken] = JSON.parse(r.text.split("\n")[0]);
  assert.equal(notFound, "mcp__tracker__get_item: no item nope");
  assert.match(broken, /^broken is unavailable: /);
  assert.match(r.text, /#\d+ mcp__tracker__get_item failed: mcp__tracker__get_item: no item nope/);
});

test("server: the script cannot see the tokens the upstream holds, and a ReferenceError lists the globals", async () => {
  const c = clients[0];
  const r = await tool(c, "run", { code: 'return [await call("mcp__tracker__secret_probe", {}), typeof process]' });
  assert.equal(r.text.split("\n")[0], '["token present","undefined"]');
  const ref = await tool(c, "run", { code: "return process.env" });
  assert.equal(ref.isError, true);
  assert.match(ref.text, /ReferenceError: process is not defined \(line 1\)\nA script has only: call\(name, args\)/);
});

test("server: saveFile writes under the out dir only, by base name", async () => {
  const r = await tool(clients[0], "run", { code: 'return await saveFile("../../evil.csv", [{ id: 1, t: "a,b" }])' });
  const path = JSON.parse(r.text.split("\n")[0]);
  assert.equal(path, join(outDir, "evil.csv"));
  assert.equal(readFileSync(path, "utf8"), 'id,t\n1,"a,b"\n');
});

test("server: remembered shapes and tool counts persist for the next server process (claude -c)", async () => {
  const knowledge = JSON.parse(readFileSync(join(stateDir, "knowledge.json"), "utf8"));
  assert.match(knowledge.shapes["mcp__tracker__list_items"], /^\{items: \[134 × /);
  assert.equal(typeof knowledge.toolCounts.tracker, "number");
  assert.ok(knowledge.toolCounts.tracker >= 3, "the upstream's tool count is kept for the controller's auto decision");
  const c2 = await connect();
  clients.push(c2);
  const r = await tool(c2, "search", { query: "list items" });
  assert.match(r.text, /returns \(earlier call\): \{items: \[134 × \{id, title, status, owner: \{email\}\}\], next_cursor\}/);
  // Call numbers continue from the last process, so a #n from an earlier turn never names a new result.
  const before = JSON.parse(readFileSync(join(stateDir, "calls.json"), "utf8")).n;
  assert.ok(before > 1);
  const next = await tool(c2, "run", { code: 'return (await call("mcp__tracker__get_item", { id: "IT-1000" })).id' });
  assert.match(next.text, new RegExp(`^#${before + 1} mcp__tracker__get_item `, "m"));
  const old = await tool(c2, "run", { code: "return recall(1)" });
  assert.ok(old.isError);
  assert.match(old.text, /results of earlier sessions are not kept/);
});

test("server: CODE_MODE_CATALOG puts the tool list and the upstream notes into the run description", async () => {
  const c = await connect({ CODE_MODE_CATALOG: "1" });
  clients.push(c);
  let run = (await c.listTools()).tools.find((t) => t.name === "run")!;
  assert.match(run.description ?? "", /Tools you can call/);
  assert.match(run.description ?? "", /the list below has them; search gives parameter docs/);
  assert.doesNotMatch(run.description ?? "", /look them up with search first/);
  // A loaded test machine can take longer than the 2.5 s wait for the upstream; Claude Code would
  // then see "still connecting" and search. Ask again once it is up.
  if (/servers still connecting/.test(run.description ?? "")) {
    await new Promise((r) => setTimeout(r, 3000));
    run = (await c.listTools()).tools.find((t) => t.name === "run")!;
  }
  assert.match(run.description ?? "", /^tracker says: Statuses are lower case/m);
  assert.match(run.description ?? "", /^mcp__tracker__get_item\(\{ id: string \}\) — /m);
  assert.doesNotMatch(run.description ?? "", /fail_tool/, "denied tools stay hidden");
  assert.match(run.description ?? "", /^not connected yet: broken/m);
  // Off by default: the plain description, nothing listed.
  const plain = (await clients[0].listTools()).tools.find((t) => t.name === "run")!;
  assert.doesNotMatch(plain.description ?? "", /Tools you can call/);
});

test("server: the run description names every tool per server, readers first, and says who is not up", async () => {
  const run = (await clients[0].listTools()).tools.find((t) => t.name === "run")!;
  assert.match(run.description ?? "", /\nTools \(argument types: search\):\nmcp__tracker__: get_item, list_items, secret_probe, stats, run_sql, update_item\n/);
  assert.doesNotMatch(run.description ?? "", /fail_tool/, "denied tools stay out of the index");
  assert.match(run.description ?? "", /^not connected yet: broken/m);
  assert.match(run.description ?? "", /pauses the run and puts an Approve\/Decline question to the operator itself/);
});

test("server: select:<name> returns exactly those tools, a write tool is marked, and a miss names the nearest", async () => {
  const r = await tool(clients[0], "search", { query: "select:mcp__tracker__update_item,mcp__tracker__get_itme" });
  assert.match(r.text, /### mcp__tracker__update_item \[approval\]\nChange an item's title\.\nargs: \{ id: string; title: string \}/);
  assert.doesNotMatch(r.text, /### mcp__tracker__list_items/);
  assert.match(r.text, /no tool "mcp__tracker__get_itme"; nearest: mcp__tracker__get_item/);
  const names = await tool(clients[0], "search", { query: "items" });
  assert.doesNotMatch(names.text, /list_items \[approval\]/, "a reader is not marked");
});

test("server: a write tool pauses the run, asks the operator through the box's question file, and resumes only once it is answered; the resume replays the calls made and lets the write through", async () => {
  assert.equal(QUESTION_FILE_DEFAULT, QUESTION_MARK, "the pause writes the driver's question file");
  const c = clients[0];
  const before = JSON.parse((await tool(c, "run", { code: 'return call("mcp__tracker__stats", {})' })).text.split("\n")[0]);
  const r = await tool(c, "run", {
    code: 'const one = await call("mcp__tracker__get_item", { id: "IT-1001" })\nconst u = await call("mcp__tracker__update_item", { id: one.id, title: "renamed by the script" })\nreturn { was: one.title, now: u.title }',
  });
  assert.equal(r.isError, false, r.text);
  const id = r.text.match(/\{"resume": "([a-z0-9]+)"\}/)?.[1];
  assert.ok(id, r.text);
  assert.match(r.text, /^Paused: call #\d+ mcp__tracker__update_item \{"id":"IT-1001","title":"renamed by the script"\} changes something/);
  assert.match(r.text, /\nThe operator has been asked \(a card with Approve and Decline; mcp__tracker__update_item creates, changes or removes something by its name\)\. End your turn now, with a short note of what waits: every further tool call is denied until they answer, and a resume before their answer is refused\. /);
  assert.match(r.text, /the 1 call already made is answered from its recorded result/);
  assert.doesNotMatch(r.text, /Ask the operator/, "the server asked; the model is not asked to");
  // The question file in the card's shape: one sentence, context, an Options block.
  const q = readFileSync(questionFile, "utf8");
  assert.match(q, /^Approve call #\d+ mcp__tracker__update_item\? It changes something, so the script paused before sending it\.\n\nArguments: \{"id":"IT-1001","title":"renamed by the script"\}\nWhy it waits: mcp__tracker__update_item creates, changes or removes something by its name\.\n1 call already made replays from its record; nothing was sent for this one \(run [a-z0-9]+\)\.\n\nOptions:\n- Approve \| send the call and finish the script\n- Decline \| send nothing and report what was not done\n$/);
  // Unanswered (the file still there): no resume.
  const early = await tool(c, "run", { resume: id });
  assert.equal(early.isError, true);
  assert.match(early.text, /the operator has not answered yet/);
  rmSync(questionFile);
  assert.equal(existsSync(questionFile), false);
  assert.match(r.text, /--- 2 MCP calls before the pause ---\n#\d+ mcp__tracker__get_item \d+ \{id, title, status, owner: \{email\}\} e\.g\. \{id: "IT-1001", title: "Item number 1 with a reasonably long t…, status: "closed", owner: \{email\}\}\n#\d+ mcp__tracker__update_item paused: waits for the operator's approval$/);
  const mid = JSON.parse((await tool(c, "run", { code: 'return call("mcp__tracker__stats", {})' })).text.split("\n")[0]);
  assert.equal(mid.update_item, undefined, "nothing was sent for the paused call");
  const done = await tool(c, "run", { resume: id });
  assert.equal(done.isError, false, done.text);
  const lines = done.text.split("\n");
  assert.deepEqual(JSON.parse(lines[0]), { was: "Item number 1 with a reasonably long title to make the list large", now: "renamed by the script" });
  assert.match(done.text, /^#\d+ mcp__tracker__get_item \d+ \(replayed\) /m);
  assert.match(done.text, /^#\d+ mcp__tracker__update_item \d+ = \{"ok":true,"id":"IT-1001","title":"renamed by the script"\}$/m);
  const after = JSON.parse((await tool(c, "run", { code: 'return call("mcp__tracker__stats", {})' })).text.split("\n")[0]);
  assert.equal(after.get_item, mid.get_item, "the replayed call was not made again");
  assert.equal(after.update_item, (before.update_item ?? 0) + 1);
  const gone = await tool(c, "run", { resume: id });
  assert.equal(gone.isError, true);
  assert.match(gone.text, /no paused run/);
});


test("box modules import only each other, node built-ins and (type-only) the SDK", () => {
  // They are shipped as four loose files into ~/.claude/code-mode; anything else would not resolve there.
  const boxDir = join(root, "src", "code-mode", "box");
  for (const f of readdirSync(boxDir).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(boxDir, f), "utf8");
    for (const m of src.matchAll(/^import\s+(type\s+)?[^"']*?from\s+["']([^"']+)["']/gm)) {
      const [, typeOnly, spec] = m;
      const ok = spec.startsWith("node:") || /^\.\/(server|runner|tools|result)\.js$/.test(spec) || (typeOnly && spec.startsWith("@modelcontextprotocol/sdk/"));
      assert.ok(ok, `${f} imports ${spec}`);
    }
  }
});

test("briefError keeps the status and title of a JSON error body and drops the rest", () => {
  const cf = 'Streamable HTTP error: Error POSTing to endpoint: {"type":"https://developers.cloudflare.com/x","title":"Error 1033: Cloudflare Tunnel error","status":530,"detail":"The host is configured as a Cloudflare Tunnel, but Cloudflare is currently unable to reach it.","instance":"a5","ray_id":"a5adca73ddedf89e","timestamp":"2026-11-15T11:07:11Z","zone":"s4-qa.example","retryable":true}';
  assert.equal(briefError(cf), "HTTP: 530 Error 1033: Cloudflare Tunnel error");
  const rpc = 'Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Compact JWS"}}';
  assert.equal(briefError(rpc), "HTTP: -32600 Invalid Compact JWS");
  assert.equal(briefError("spawn npx ENOENT\n  at x"), "spawn npx ENOENT at x");
  assert.equal(briefError("x".repeat(300)).length, 160);
});

test("server: a SQL tool the server marks destructive runs a SELECT without a pause and still pauses on an UPDATE", async () => {
  const c = clients[0];
  const read = await tool(c, "run", { code: 'return call("mcp__tracker__run_sql", { query: "SELECT id FROM items WHERE status = \'open\'" })' });
  assert.equal(read.isError, false, read.text);
  assert.deepEqual(JSON.parse(read.text.split("\n")[0]), { ran: "SELECT id FROM items WHERE status = 'open'", rows: 400 });
  const write = await tool(c, "run", { code: 'return call("mcp__tracker__run_sql", { query: "UPDATE items SET status = \'closed\'" })' });
  assert.match(write.text, /^Paused: call #\d+ mcp__tracker__run_sql \{"query":"UPDATE items SET status = 'closed'"\} changes something/);
  assert.match(write.text, /mcp__tracker__run_sql is marked destructive by its server/);
  rmSync(questionFile, { force: true });
  const marked = await tool(c, "search", { query: "select:mcp__tracker__run_sql" });
  assert.match(marked.text, /### mcp__tracker__run_sql \[approval\]/, "the tool can write, so search still marks it");
  assert.match(marked.text, /a read-only statement \(a plain SELECT\) given to a SQL tool passes without a pause/);
});
