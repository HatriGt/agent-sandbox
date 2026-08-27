import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClaims, shouldKeepStopped } from "../src/claims.ts";
import { parseMcpImport, normalizeServer, toClaudeMcpConfig, viewServers, parseMcpStore, serializeMcpStore } from "../src/mcp-store.ts";

test("claims: parse stat output into ages; keep a sleeping claimed box under the TTL", () => {
  const now = 1_000_000;
  const m = parseClaims("pool-1-a 999000\npool-1-b 900000\n* \n", now);
  assert.equal(m.get("pool-1-a"), 1000);
  assert.equal(m.get("pool-1-b"), 100_000);
  assert.equal(m.has("*"), false);
  assert.equal(shouldKeepStopped(1000, 86_400), true, "asleep 16m, TTL 24h → keep");
  assert.equal(shouldKeepStopped(100_000, 86_400), false, "asleep 27h → reap");
  assert.equal(shouldKeepStopped(undefined, 86_400), false, "never claimed → dead capacity");
});

test("mcp: import Claude/Cursor-shaped JSON, bare maps, single objects; defaults and errors", () => {
  const list = parseMcpImport(
    JSON.stringify({
      mcpServers: {
        atlassian: { command: "npx", args: ["-y", "mcp-remote", "https://mcp.atlassian.com/v1/sse"], env: { TOKEN: "abc123456" } },
        linear: { url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer xyz" } },
        off: { type: "stdio", command: "foo", disabled: true },
      },
    }),
    42
  );
  assert.deepEqual(
    list.map((s) => [s.name, s.type, s.enabled]),
    [
      ["atlassian", "stdio", true],
      ["linear", "http", true],
      ["off", "stdio", false],
    ]
  );
  assert.equal(parseMcpImport('{"github": {"command": "gh-mcp"}}')[0].name, "github");
  assert.equal(parseMcpImport('{"name": "one", "command": "x"}')[0].name, "one");
  assert.throws(() => parseMcpImport("nope"), /valid JSON/);
  assert.throws(() => parseMcpImport("{}"), /No servers/);
  assert.throws(() => normalizeServer({ name: "bad name!", command: "x" }), /must be/);
  assert.throws(() => normalizeServer({ name: "web", type: "http", url: "ftp://x" }), /http\(s\) url/);
  assert.throws(() => normalizeServer({ name: "s" }), /needs a command/);
});

test("mcp: Claude config carries enabled servers only; the view masks secrets; store round-trips", () => {
  const servers = parseMcpImport('{"mcpServers":{"a":{"command":"a","env":{"KEY":"supersecretvalue"}},"b":{"url":"https://b/mcp","disabled":true}}}', 1);
  const store = { servers: Object.fromEntries(servers.map((s) => [s.name, s])) };
  const cfg = toClaudeMcpConfig(store)!;
  assert.deepEqual(Object.keys(cfg.mcpServers), ["a"]);
  assert.deepEqual(cfg.mcpServers.a, { type: "stdio", command: "a", env: { KEY: "supersecretvalue" } });
  const view = viewServers(store);
  assert.equal(view[0].env!.KEY, "su…lue");
  assert.ok(!JSON.stringify(view).includes("supersecretvalue"));
  assert.deepEqual(parseMcpStore(serializeMcpStore(store)).servers.b.url, "https://b/mcp");
  assert.equal(toClaudeMcpConfig({ servers: {} }), null);
});
