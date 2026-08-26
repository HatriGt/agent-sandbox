import { test } from "node:test";
import assert from "node:assert/strict";
import { maskToken, viewAccounts, deviceStart, devicePoll } from "../src/accounts.ts";
import { parseStore, serializeStore, upsertAccount, removeAccount, setDefaultAccount, pickDefaultAccount } from "../src/gh-token-store.ts";

const acc = (login: string, orgs: string[] = []) => ({ login, token: `ghp_${login}abcdefgh1234`, type: "classic" as const, orgs, verifiedRepos: [] });

test("maskToken keeps only the prefix and the last four characters", () => {
  assert.equal(maskToken("ghp_abcdefghijklmnop1234"), "ghp_…1234");
  assert.equal(maskToken("github_pat_11ABCDEFG_xyz9876"), "github_pat_…9876");
  assert.equal(maskToken("short"), "••••");
});

test("store: explicit default survives round-trip, wins over the heuristic, clears on removal", () => {
  let store = upsertAccount(upsertAccount({ accounts: {} }, acc("alice", ["org-a", "org-b"])), acc("bob"));
  assert.equal(pickDefaultAccount(store)?.login, "alice", "heuristic: most orgs");
  store = setDefaultAccount(store, "bob");
  assert.equal(pickDefaultAccount(store)?.login, "bob");
  const again = parseStore(serializeStore(store));
  assert.equal(again.defaultLogin, "bob");
  assert.equal(setDefaultAccount(store, "nobody").defaultLogin, "bob", "unknown login is ignored");
  store = removeAccount(store, "bob");
  assert.equal(store.defaultLogin, undefined);
  assert.equal(pickDefaultAccount(store)?.login, "alice");
  const views = viewAccounts(upsertAccount(store, acc("bob")), "alice");
  assert.deepEqual(views.map((v) => [v.login, v.isDefault]), [["alice", true], ["bob", false]]);
  assert.ok(!JSON.stringify(views).includes("abcdefgh"), "tokens never reach the view");
});

test("device flow: start parses GitHub's response; poll maps every documented state", async () => {
  const mk = (status: number, body: unknown) => async () => ({ ok: status < 400, status, json: async () => body });
  const start = await deviceStart("cid", mk(200, { device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 899, interval: 5 }));
  assert.equal(start.user_code, "ABCD-1234");
  await assert.rejects(deviceStart("cid", mk(400, { error: "unauthorized_client", error_description: "bad client" })), /bad client/);
  assert.deepEqual(await devicePoll("cid", "dc", mk(200, { error: "authorization_pending" })), { status: "pending" });
  assert.deepEqual(await devicePoll("cid", "dc", mk(200, { error: "slow_down", interval: 10 })), { status: "pending", interval: 10 });
  assert.deepEqual(await devicePoll("cid", "dc", mk(200, { error: "expired_token" })), { status: "expired" });
  assert.deepEqual(await devicePoll("cid", "dc", mk(200, { error: "access_denied" })), { status: "denied" });
  assert.deepEqual(await devicePoll("cid", "dc", mk(200, { access_token: "gho_x" })), { status: "token", token: "gho_x" });
});
