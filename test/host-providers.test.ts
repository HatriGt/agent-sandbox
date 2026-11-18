import { test } from "node:test";
import assert from "node:assert/strict";
import { FREESTYLE_SSH_PROXY, cloudOf, knownProvider, listProviders, makeFreestyleAdapter, parseVmState, providerFor, type Fetcher } from "../src/host-providers.ts";
import type { HostSpec } from "../src/hosts.ts";

const spec: HostSpec = { id: "fs", name: "fs", provider: "freestyle", ssh: "a+root:t@beta-ssh.freestyle.sh", priority: 1, sleepAfterMs: 0, warm: false, enabled: true, cloud: { vmId: "vm-12", apiKey: "KEY" } };

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
  const noKey = await makeFreestyleAdapter(failing).state({ ...spec, cloud: { vmId: "vm-12", apiKey: "" } });
  assert.match(noKey.detail ?? "", /no API key/);
  const throwing: Fetcher = async () => {
    throw new Error("fetch failed");
  };
  assert.equal((await makeFreestyleAdapter(throwing).pause(spec)).detail, "fetch failed");
});

test("the credentials block is read under either name; canDrive needs the key and the VM id", async () => {
  const legacy = { ...spec, cloud: undefined, freestyle: { vmId: "vm-old", apiKey: "K" } } as HostSpec;
  assert.deepEqual(cloudOf(legacy), { vmId: "vm-old", apiKey: "K" });
  const seen: string[] = [];
  const fetcher: Fetcher = async (url) => {
    seen.push(url);
    return { ok: true, status: 200, text: async () => JSON.stringify({ state: "paused" }) };
  };
  assert.equal((await makeFreestyleAdapter(fetcher).state(legacy)).state, "paused");
  assert.deepEqual(seen, ["https://api.freestyle.sh/v5/vms/vm-old"]);
  const fs = providerFor(spec);
  assert.equal(fs.canDrive(spec), true);
  assert.equal(fs.canDrive({ ...spec, cloud: { vmId: "vm-12", apiKey: "" } }), false);
  assert.equal(fs.canDrive({ ...spec, cloud: undefined }), false);
  assert.equal(providerFor({ provider: "static" }).canDrive(spec), false, "a static host is never driven, whatever the row carries");
});

test("the registry: what the form is told, the proxy each provider sits behind, and an unknown id", () => {
  const list = listProviders();
  assert.deepEqual(
    list.map((p) => [p.id, p.label, p.needs, p.secrets, p.canProvision, p.canSnapshot, p.metered]),
    [
      ["static", "My own machine", [], [], false, false, false],
      ["freestyle", "Freestyle VM", ["vmId"], ["apiKey"], true, true, true],
    ]
  );
  assert.ok(list.every((p) => p.hint && p.sshHint && p.sshPlaceholder));
  assert.ok(!("state" in list[1]), "the list carries facts, not the adapter");
  assert.equal(providerFor({ provider: "freestyle" }).proxyHost, FREESTYLE_SSH_PROXY);
  assert.equal(providerFor({ provider: "static" }).proxyHost, undefined);
  assert.equal(providerFor({ provider: "freestyle" }).sshTarget!({ vm: "asb-host", token: "tok" }), "asb-host+root:tok@beta-ssh.freestyle.sh");
  assert.equal(providerFor({ provider: "freestyle" }).sshTarget!({ vm: "vm-1", user: "ubuntu", token: "tok" }), "vm-1+ubuntu:tok@beta-ssh.freestyle.sh");
  assert.equal(knownProvider("freestyle"), true);
  assert.equal(knownProvider("aws"), false);
  assert.equal(knownProvider("__proto__"), false);
  assert.equal(providerFor({ provider: "aws" }).id, "static", "an unknown provider behaves as static, never throws");
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
  assert.equal(p.provision, undefined);
  assert.equal(p.snapshot, undefined);
});

// --- provisioning ---------------------------------------------------------------------------------

type Call = { method: string; path: string; body?: Record<string, unknown> };

/** An API that answers each step; `failAt` makes one step answer 500. */
function fakeApi(o: { failAt?: string; createStatus?: number } = {}) {
  const calls: Call[] = [];
  const deleted: string[] = [];
  const fetcher: Fetcher = async (url, init) => {
    const path = url.replace("https://api.freestyle.sh", "");
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method: init.method, path, ...(body ? { body } : {}) });
    assert.equal(init.headers.Authorization, "Bearer ACCT-KEY");
    const reply = (status: number, j: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(j) });
    const step = `${init.method} ${path}`;
    if (o.failAt && step.startsWith(o.failAt)) return reply(500, { message: `boom at ${step}` });
    if (step === "POST /v5/vms") return o.createStatus === 202 ? reply(202, { requestId: "bg-1" }) : reply(201, { id: "vm-new", state: "running", slug: body?.slug });
    if (step === "GET /v5/background-requests/bg-1") return calls.filter((c) => c.path.includes("bg-1")).length < 2 ? reply(202, {}) : reply(200, { id: "vm-new", state: "running" });
    if (step === "POST /v5/identities") return reply(201, { id: "idn-new", managed: false });
    if (step === "POST /v5/identities/idn-new/permissions/vm") return reply(201, { id: "perm-1", identityId: "idn-new", vmId: body?.vmId, allowedLinuxUsers: body?.allowedLinuxUsers });
    if (step === "POST /v5/identities/idn-new/tokens") return reply(201, { id: "tok-new", token: "SECRET-TOKEN", expiresAt: null });
    if (step === "POST /v5/vms/vm-new/snapshot") return reply(201, { snapshotId: "snap-9", sourceVmId: "vm-new", snapshot: { id: "snap-9", slug: body?.slug } });
    if (init.method === "DELETE") {
      deleted.push(path);
      return reply(204, {});
    }
    return reply(404, { message: `no route ${step}` });
  };
  return { fetcher, calls, deleted };
}

test("provision: VM, identity, root grant, token, SSH target proved; the row's handles name what to undo", async () => {
  const api = fakeApi();
  const probed: string[] = [];
  const log: string[] = [];
  const r = await makeFreestyleAdapter(api.fetcher, 1_000, 1).provision!({ apiKey: " ACCT-KEY ", slug: "Freestyle-Account-C", snapshotId: "" }, { log: (m) => log.push(m), sshReady: async (ssh) => void probed.push(ssh) });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.ssh, "freestyle-account-c+root:SECRET-TOKEN@beta-ssh.freestyle.sh");
  assert.deepEqual(r.cloud, { vmId: "vm-new", apiKey: "ACCT-KEY", slug: "freestyle-account-c", identityId: "idn-new", tokenId: "tok-new" });
  assert.equal(r.snapshotId, "freestyle/ubuntu", "the stock image unless one is named");
  assert.deepEqual(probed, [r.ssh], "SSH was proved on the target the row will store");
  assert.deepEqual(
    api.calls.map((c) => `${c.method} ${c.path}`),
    ["POST /v5/vms", "POST /v5/identities", "POST /v5/identities/idn-new/permissions/vm", "POST /v5/identities/idn-new/tokens"]
  );
  const create = api.calls[0].body!;
  assert.equal(create.snapshotId, "freestyle/ubuntu");
  assert.equal(create.slug, "freestyle-account-c");
  assert.equal(create.idleTimeoutSeconds, 300);
  assert.deepEqual(create.firewall, { rules: [{ action: "allow", source: {}, destination: { public: true } }] }, "boxes need egress: the API grants nothing implicitly");
  assert.deepEqual(api.calls[2].body, { vmId: "vm-new", allowedLinuxUsers: ["root"] });
  assert.deepEqual(api.deleted, []);
  assert.ok(log.some((l) => /SSH answers/.test(l)));
  assert.ok(!r.log.join("\n").includes("SECRET-TOKEN") && !r.log.join("\n").includes("ACCT-KEY"), "neither secret is in the log");
});

test("provision: a named snapshot and a 202 that is polled until the VM record arrives", async () => {
  const api = fakeApi({ createStatus: 202 });
  const r = await makeFreestyleAdapter(api.fetcher, 1_000, 1).provision!({ apiKey: "ACCT-KEY", slug: "c", snapshotId: "snap-prepared", idleTimeoutSeconds: 600 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.snapshotId, "snap-prepared");
  assert.equal(api.calls[0].body!.snapshotId, "snap-prepared");
  assert.equal(api.calls[0].body!.idleTimeoutSeconds, 600);
  assert.deepEqual(api.calls.slice(0, 4).map((c) => `${c.method} ${c.path}`), ["POST /v5/vms", "GET /v5/background-requests/bg-1", "GET /v5/background-requests/bg-1", "POST /v5/identities"]);
  assert.equal(r.cloud.vmId, "vm-new");
});

test("provision: a bad slug or a blank key is refused before any call", async () => {
  const api = fakeApi();
  const a = makeFreestyleAdapter(api.fetcher, 1_000, 1);
  const bad = await a.provision!({ apiKey: "ACCT-KEY", slug: "-nope-" });
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.error : "", /not a Freestyle slug/);
  const dbl = await a.provision!({ apiKey: "ACCT-KEY", slug: "a--b" });
  assert.equal(dbl.ok, false);
  const none = await a.provision!({ apiKey: "  ", slug: "ok" });
  assert.equal(none.ok, false);
  assert.match(!none.ok ? none.error : "", /API key is required/);
  assert.deepEqual(api.calls, []);
});

test("provision: a failure at each step is a string, and what was made before it is deleted", async () => {
  const cases: { failAt: string; wantDeleted: string[]; error: RegExp }[] = [
    { failAt: "POST /v5/vms", wantDeleted: [], error: /create VM → 500: boom/ },
    { failAt: "POST /v5/identities", wantDeleted: ["/v5/vms/vm-new"], error: /create identity → 500/ },
    { failAt: "POST /v5/identities/idn-new/permissions/vm", wantDeleted: ["/v5/identities/idn-new", "/v5/vms/vm-new"], error: /grant root on the VM → 500/ },
    { failAt: "POST /v5/identities/idn-new/tokens", wantDeleted: ["/v5/identities/idn-new", "/v5/vms/vm-new"], error: /mint a token → 500/ },
  ];
  for (const c of cases) {
    const api = fakeApi({ failAt: c.failAt });
    const r = await makeFreestyleAdapter(api.fetcher, 1_000, 1).provision!({ apiKey: "ACCT-KEY", slug: "c" }, { sshReady: async () => {} });
    assert.equal(r.ok, false, c.failAt);
    if (r.ok) return;
    assert.match(r.error, c.error);
    assert.deepEqual(api.deleted, c.wantDeleted, c.failAt);
    assert.ok(r.log.some((l) => /undone/.test(l)) === c.wantDeleted.length > 0, `${c.failAt}: undo logged only when there was something to undo`);
  }
  // SSH never answering undoes everything too: a row nobody can reach is worse than none.
  const api = fakeApi();
  const r = await makeFreestyleAdapter(api.fetcher, 1_000, 1).provision!({ apiKey: "ACCT-KEY", slug: "c" }, {
    sshReady: async () => {
      throw new Error("ssh: Connection closed by remote host\nmore");
    },
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error, "SSH never answered: ssh: Connection closed by remote host");
  assert.deepEqual(api.deleted, ["/v5/identities/idn-new", "/v5/vms/vm-new"]);
  // A transport failure (no reply at all) reads the same way.
  const dead: Fetcher = async () => {
    throw new Error("fetch failed");
  };
  const d = await makeFreestyleAdapter(dead, 1_000, 1).provision!({ apiKey: "ACCT-KEY", slug: "c" });
  assert.equal(d.ok, false);
  assert.match(!d.ok ? d.error : "", /create VM → no reply: fetch failed/);
});

test("snapshot and destroy go through the host's own handles", async () => {
  const api = fakeApi();
  const a = makeFreestyleAdapter(api.fetcher, 1_000, 1);
  const host: HostSpec = { ...spec, cloud: { vmId: "vm-new", apiKey: "ACCT-KEY", identityId: "idn-new", tokenId: "tok-new", slug: "c" } };
  const s = await a.snapshot!(host, { slug: "asb-host-ready", displayName: "ready" });
  assert.deepEqual(s, { ok: true, snapshotId: "snap-9", slug: "asb-host-ready" });
  assert.deepEqual(api.calls.at(-1), { method: "POST", path: "/v5/vms/vm-new/snapshot", body: { slug: "asb-host-ready", displayName: "ready" } });
  const noKey = await a.snapshot!({ ...host, cloud: { vmId: "vm-new", apiKey: "" } });
  assert.equal(noKey.ok, false);
  const d = await a.destroy!(host);
  assert.equal(d.ok, true);
  assert.deepEqual(api.deleted, ["/v5/identities/idn-new", "/v5/vms/vm-new"]);
  assert.match(d.detail, /identity idn-new deleted; VM vm-new deleted/);
  // A host added by hand has no identity handle: only the VM goes.
  const api2 = fakeApi();
  const d2 = await makeFreestyleAdapter(api2.fetcher, 1_000, 1).destroy!({ ...spec, cloud: { vmId: "vm-12", apiKey: "ACCT-KEY" } });
  assert.equal(d2.ok, true);
  assert.deepEqual(api2.deleted, ["/v5/vms/vm-12"]);
  // A delete the API refuses is reported, not thrown.
  const api3 = fakeApi({ failAt: "DELETE /v5/vms/vm-new" });
  const d3 = await makeFreestyleAdapter(api3.fetcher, 1_000, 1).destroy!(host);
  assert.equal(d3.ok, false);
  assert.match(d3.detail, /VM vm-new: DELETE → 500/);
});
