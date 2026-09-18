/**
 * makeRepoLister stale-while-revalidate. Observed live: /delegate.json took 5.2s on a warm claim
 * because repo inference awaited a COLD repo fetch (up to 3 GitHub pages per account) inline in the
 * request. The list changes rarely; an expired cache must answer instantly and refresh in the
 * background, so only the first-ever request per owner pays the fetch. TDD: written before the fix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepoLister } from "../src/repos.ts";
import type { Config } from "../src/config.ts";

const cfg = {} as unknown as Config;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("an expired cache answers immediately with the stale list and refreshes in the background", async () => {
  let t = 0;
  let fetches = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const lister = makeRepoLister(cfg, async () => {
    fetches++;
    if (fetches > 1) await gate; // background refresh hangs until released
    return [];
  }, {
    ttlMs: 1000,
    now: () => t,
    // one fake account so fetchRepos runs at all
    accountsOf: async () => [{ login: "a", token: "tok" }],
  });

  await lister(); // cold: populates the cache
  assert.equal(fetches, 1);

  t = 5000; // TTL long past
  const start = Date.now();
  const stale = await lister(); // must NOT wait on the hung background fetch
  assert.ok(Date.now() - start < 200, "stale answer must be immediate");
  assert.deepEqual(stale, []);
  assert.equal(fetches, 2, "a background refresh was kicked");

  release();
  await sleep(10);
  // The refreshed cache is now fresh: no third fetch.
  await lister();
  assert.equal(fetches, 2);
});

test("force=true still blocks for a fresh fetch (the picker's refresh button)", async () => {
  let fetches = 0;
  const lister = makeRepoLister(cfg, async () => {
    fetches++;
    return [];
  }, { ttlMs: 1000, now: () => 0, accountsOf: async () => [{ login: "a", token: "tok" }] });
  await lister();
  await lister(true);
  assert.equal(fetches, 2);
});

test("a changed account set invalidates the cache (no stale answer for the wrong accounts)", async () => {
  let fetches = 0;
  let logins = [{ login: "a", token: "t1" }];
  const lister = makeRepoLister(cfg, async () => {
    fetches++;
    return [];
  }, { ttlMs: 60_000, now: () => 0, accountsOf: async () => logins });
  await lister();
  logins = [{ login: "a", token: "t1" }, { login: "b", token: "t2" }];
  await lister(); // different account set -> a blocking refetch, not the old cache
  assert.equal(fetches, 3, "one fetch per account on the second call (2 accounts) + the first");
});
