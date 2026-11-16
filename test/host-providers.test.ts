import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFreestyleAdapter, parseVmState, providerFor, type Fetcher } from "../src/host-providers.ts";
import type { HostSpec } from "../src/hosts.ts";

const spec: HostSpec = { id: "fs", name: "fs", provider: "freestyle", ssh: "a+root:t@beta-ssh.freestyle.sh", priority: 1, sleepAfterMs: 0, warm: false, enabled: true, freestyle: { vmId: "vm-12", apiKey: "KEY" } };

test("freestyle adapter: bearer key, the three endpoints, state words parsed", async () => {
  const seen: { url: string; method: string; auth: string }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    seen.push({ url, method: init.method, auth: init.headers.Authorization });
    const body = url.endsWith("/pause") ? { vm: { state: "paused" } } : url.endsWith("/start") ? { state: { kind: "running" } } : { id: "vm-12", status: "Running" };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const a = makeFreestyleAdapter(fetcher);
  assert.equal(a.metered, true);
  assert.equal((await a.state(spec)).state, "running");
  assert.equal((await a.pause(spec)).state, "paused");
  assert.equal((await a.start(spec)).state, "running");
  assert.deepEqual(
    seen.map((s) => [s.method, s.url, s.auth]),
    [
      ["GET", "https://api.freestyle.sh/v5/vms/vm-12", "Bearer KEY"],
      ["POST", "https://api.freestyle.sh/v5/vms/vm-12/pause", "Bearer KEY"],
      ["POST", "https://api.freestyle.sh/v5/vms/vm-12/start", "Bearer KEY"],
    ]
  );
});

test("freestyle adapter: an API error or a missing key is a detail, never a throw", async () => {
  const failing: Fetcher = async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ message: "TOO_MANY_REQUESTS: server at capacity" }) });
  const r = await makeFreestyleAdapter(failing).start(spec);
  assert.equal(r.state, "unknown");
  assert.match(r.detail ?? "", /429: TOO_MANY_REQUESTS/);
  const noKey = await makeFreestyleAdapter(failing).state({ ...spec, freestyle: { vmId: "vm-12", apiKey: "" } });
  assert.match(noKey.detail ?? "", /no API key/);
  const throwing: Fetcher = async () => {
    throw new Error("fetch failed");
  };
  assert.equal((await makeFreestyleAdapter(throwing).pause(spec)).detail, "fetch failed");
});

test("parseVmState reads the shapes the API uses", () => {
  assert.equal(parseVmState(JSON.stringify({ state: "Paused" })).state, "paused");
  assert.equal(parseVmState(JSON.stringify({ vm: { lifecycle: { state: "booting" } } })).state, "starting");
  assert.equal(parseVmState(JSON.stringify({ status: "stopped" })).state, "stopped");
  assert.equal(parseVmState("<html>").state, "unknown");
  assert.equal(parseVmState("{}").detail, "no state in the reply");
});

test("a static host has no provider calls", async () => {
  const p = providerFor({ ...spec, provider: "static" });
  assert.equal(p.metered, false);
  assert.equal((await p.pause(spec)).state, "n/a");
});
