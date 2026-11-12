import { test } from "node:test";
import assert from "node:assert/strict";
import { STORE_REFRESH_SEC, STORE_RETRY_SEC, isPinned, isStoreBox, makePkgStore, parseStoreListing, planStoreBuilds, specName, storable, storeKey, storedPathSh } from "../src/pkg-store.js";

test("a spec becomes one safe directory name, and names made of dots are refused", () => {
  assert.equal(specName("@cap-js/mcp-server@1.2.3"), "@cap-js/mcp-server");
  assert.equal(specName("chrome-devtools-mcp@latest"), "chrome-devtools-mcp");
  assert.equal(storeKey("@cap-js/mcp-server"), "p_@cap-js_mcp-server");
  assert.equal(storeKey("chrome-devtools-mcp@latest"), "p_chrome-devtools-mcp@latest");
  assert.ok(storable("btp-mcp-server") && storable("@cap-js/mcp-server@0.1.0"));
  // `..` passes the npx spec pattern; it must never become a path.
  for (const bad of ["..", ".", "@../x", "@a/..", "a/b/c", "a b", "https://x.y/z", "", "-rf"]) assert.equal(storable(bad), false, bad);
  assert.ok(!storeKey("..").includes("/") && storeKey("..") !== "..");
});

test("only an exact version is pinned", () => {
  assert.equal(isPinned("pkg@1.2.3"), true);
  assert.equal(isPinned("@s/pkg@1.2.3-beta.1"), true);
  for (const s of ["pkg", "pkg@latest", "pkg@^1.2.3", "pkg@1", "@s/pkg"]) assert.equal(isPinned(s), false, s);
});

test("a box looks for the newest stored copy", () => {
  const q = (s: string) => `'${s}'`;
  assert.equal(storedPathSh("@cap-js/mcp-server", q), "ls -d /opt/asb-store/'p_@cap-js_mcp-server'/v*/lib/node_modules/'@cap-js/mcp-server' 2>/dev/null | sort | tail -1");
});

test("the host listing gives the newest version of each key", () => {
  const have = parseStoreListing("/root/.agent-sandbox/npm-store/pkgs/p_a/v100\n/root/x/pkgs/p_a/v300\n/root/x/pkgs/p_a/v200\n/root/x/pkgs/p_@s_b@latest/v50\nnoise\n/root/x/pkgs/other/v9\n");
  assert.deepEqual([...have], [["p_a", 300], ["p_@s_b@latest", 50]]);
});

test("what gets built: missing, or unpinned and a week old; never a recent failure", () => {
  const now = 1_000_000;
  const have = new Map([["p_fresh", now - 10], ["p_old", now - STORE_REFRESH_SEC - 1], ["p_pinned@1.0.0", now - STORE_REFRESH_SEC * 9]]);
  assert.deepEqual(planStoreBuilds(["fresh", "old", "pinned@1.0.0", "missing", "missing", ".."], have, new Map(), now), ["old", "missing"]);
  assert.deepEqual(planStoreBuilds(["missing"], have, new Map([["missing", now - 60]]), now), []);
  assert.deepEqual(planStoreBuilds(["missing"], have, new Map([["missing", now - STORE_RETRY_SEC - 1]]), now), ["missing"]);
});

test("builder boxes are told apart by name", () => {
  assert.equal(isStoreBox("asbstore-abc"), true);
  assert.equal(isStoreBox("pool-1-abc"), false);
});

test("the queue builds each missing package once, one at a time, and leaves a failure alone", async () => {
  let now = 5000;
  const built: string[] = [];
  let active = 0, maxActive = 0, lists = 0;
  const logs: string[] = [];
  const store = makePkgStore({
    nowSec: () => now,
    list: async () => { lists++; return "/s/pkgs/p_have/v4000\n"; },
    build: async (spec, ver) => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (spec === "bad") throw new Error("npm did not install it");
      built.push(`${spec}:${ver}`);
    },
    log: (m) => logs.push(m),
  });
  store.want(["have", "a", "bad"]);
  store.want(["a", "b"]);
  await new Promise((r) => setTimeout(r, 1));
  await store.idle();
  assert.deepEqual(built.map((b) => b.split(":")[0]).sort(), ["a", "b"]);
  assert.ok(built.every((b) => /:v\d+$/.test(b)));
  assert.equal(maxActive, 1);
  assert.equal(lists, 1, "the host is listed once a minute at most");
  assert.deepEqual(store.state().failed, ["bad"]);
  // Asked again: what was built is known without another build, the failure is not retried yet.
  now += 30;
  store.want(["a", "b", "bad"]);
  await new Promise((r) => setTimeout(r, 1));
  await store.idle();
  assert.equal(built.length, 2);
  // Six hours on, the failure gets another try.
  now += STORE_RETRY_SEC + 1;
  store.want(["bad"]);
  await new Promise((r) => setTimeout(r, 1));
  await store.idle();
  assert.equal(logs.filter((l) => l.includes("bad could not be stored")).length, 2);
});
