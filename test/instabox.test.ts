import { test } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "../src/config.ts";
import {
  DOCKER_HOST_PREPARE_SH,
  DOCKER_SHIM_PATH,
  INSTABOX_HOST_DEFAULTS,
  INSTABOX_SSH_GATEWAY,
  dockerShimSource,
  listProviders,
  makeInstaboxAdapter,
  parseInstaboxState,
  providerFor,
  type Fetcher,
} from "../src/host-providers.ts";
import { configForHost, normalizeHostSpec, publicHostSpec, redactSshTarget, type HostSpec } from "../src/hosts.ts";
import { routeFor } from "../src/ssh-tunnel.ts";
import { redactShapes } from "../src/redact.ts";
import { imagesWanted, prepareCuresCheck, prepareHost, prepareStatus, resetPrepareForTest, startPrepare } from "../src/host-prepare.ts";

// A fabricated token in the real shape (never a live credential in the repo).
const TOKEN = "ibssh_fakeFAKEfake0000000000000000";
const spec: HostSpec = { id: "ib", name: "Instabox", provider: "instabox", ssh: `${TOKEN}@${INSTABOX_SSH_GATEWAY}`, priority: 0, sleepAfterMs: 300_000, warm: false, enabled: true, cloud: { vmId: "m_abc", apiKey: "ibk_KEY" } };

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** A fake Instabox API: answers by path, records every call. */
function fakeApi(machine: () => Record<string, unknown>, extra: (s: Seen) => { status: number; body: unknown } | undefined = () => undefined) {
  const seen: Seen[] = [];
  const fetcher: Fetcher = async (url, init) => {
    const s: Seen = { url, method: init.method, headers: init.headers, ...(init.body ? { body: JSON.parse(init.body) } : {}) };
    seen.push(s);
    const r = extra(s) ?? (url.match(/\/v1\/machines\/[^/?]+$/) && init.method === "GET" ? { status: 200, body: machine() } : undefined) ?? { status: 404, body: { error: { code: "not_found", message: "no route" } } };
    return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(r.body) };
  };
  return { seen, fetcher };
}

test("instabox: state words map to the pool's four", () => {
  assert.equal(parseInstaboxState(JSON.stringify({ state: "running" })).state, "running");
  assert.equal(parseInstaboxState(JSON.stringify({ state: "suspended" })).state, "paused");
  assert.equal(parseInstaboxState(JSON.stringify({ state: "suspending" })).state, "paused");
  assert.equal(parseInstaboxState(JSON.stringify({ state: "stopped" })).state, "stopped");
  assert.equal(parseInstaboxState(JSON.stringify({ state: "resuming" })).state, "starting");
  assert.equal(parseInstaboxState(JSON.stringify({ state: "starting" })).state, "starting");
  assert.equal(parseInstaboxState(JSON.stringify({ machine: { state: "Running" } })).state, "running");
  assert.equal(parseInstaboxState(JSON.stringify({ state: "error" })).state, "unknown");
  assert.equal(parseInstaboxState("not json").state, "unknown");
});

test("instabox: the key rides as X-API-Key; read, suspend and start hit the right routes with an Idempotency-Key", async () => {
  let state = "running";
  const { seen, fetcher } = fakeApi(
    () => ({ id: "m_abc", state }),
    (s) => {
      if (s.url.endsWith("/suspend")) {
        state = "suspending";
        return { status: 202, body: { id: "op_1", type: "suspend", state: "queued" } };
      }
      if (s.url.endsWith("/start")) {
        state = "resuming";
        return { status: 202, body: { id: "op_2", type: "start", state: "queued" } };
      }
      return undefined;
    }
  );
  const a = makeInstaboxAdapter(fetcher);
  assert.equal(a.metered, true);
  assert.equal(a.proxyHost, INSTABOX_SSH_GATEWAY);
  assert.equal(a.sshLaneWidth, undefined, "the gateway takes parallel starts; no lane");
  assert.deepEqual(a.sshOpts, ["-p", "2222"]);
  assert.equal(a.directUser, "user");
  assert.equal((await a.state(spec)).state, "running");
  assert.equal((await a.pause(spec)).state, "paused");
  assert.equal((await a.start(spec)).state, "starting");
  assert.deepEqual(
    seen.map((s) => [s.method, s.url.replace("https://api.instabox.sh", "")]),
    [
      ["GET", "/v1/machines/m_abc"],
      ["GET", "/v1/machines/m_abc"],
      ["POST", "/v1/machines/m_abc/suspend"],
      ["GET", "/v1/machines/m_abc"],
      ["POST", "/v1/machines/m_abc/start"],
      ["GET", "/v1/machines/m_abc"],
    ]
  );
  assert.ok(seen.every((s) => s.headers["X-API-Key"] === "ibk_KEY"));
  assert.ok(seen.filter((s) => s.method === "POST").every((s) => /^asb-/.test(s.headers["Idempotency-Key"])));
  assert.notEqual(seen[2].headers["Idempotency-Key"], seen[4].headers["Idempotency-Key"]);
});

test("instabox: a pause of a machine that is not running is a no-op; a conflict on start reads the state instead; errors are details", async () => {
  let state = "suspended";
  const { seen, fetcher } = fakeApi(
    () => ({ state }),
    (s) => {
      if (s.url.endsWith("/start")) {
        state = "running";
        return { status: 409, body: { error: { code: "operation_conflict", message: "already running" } } };
      }
      return undefined;
    }
  );
  const a = makeInstaboxAdapter(fetcher);
  assert.equal((await a.pause(spec)).state, "paused");
  assert.ok(!seen.some((s) => s.url.endsWith("/suspend")), "nothing to suspend");
  assert.equal((await a.start(spec)).state, "running");
  const failing: Fetcher = async () => ({ ok: false, status: 402, text: async () => JSON.stringify({ error: { code: "plan_limit", message: "out of hours" } }) });
  const r = await makeInstaboxAdapter(failing).start(spec);
  assert.equal(r.state, "unknown");
  assert.match(r.detail ?? "", /402: out of hours/);
  assert.match((await makeInstaboxAdapter(failing).state({ ...spec, cloud: { vmId: "m_abc", apiKey: "" } })).detail ?? "", /no API key/);
  assert.equal(providerFor(spec).canDrive(spec), true);
  assert.equal(providerFor(spec).canDrive({ ...spec, cloud: undefined }), false);
});

test("instabox: mintSsh turns the key and the machine id into a token target; provision creates, waits, mints, and undoes on a failed SSH", async () => {
  let created = 0;
  let deleted: Seen | undefined;
  const { seen, fetcher } = fakeApi(
    () => ({ state: "running" }),
    (s) => {
      if (s.url.endsWith("/ssh-tokens")) return { status: 201, body: { id: "cn_1", token: TOKEN, host: INSTABOX_SSH_GATEWAY, port: 2222, command: `ssh -p 2222 ${TOKEN}@${INSTABOX_SSH_GATEWAY}` } };
      if (s.url.endsWith("/v1/machines") && s.method === "POST") {
        created++;
        return { status: 202, body: { id: "op_c", machineId: "m_new", type: "create", state: "queued" } };
      }
      if (s.url.includes("/v1/operations/op_c")) return { status: 200, body: { id: "op_c", machineId: "m_new", state: "succeeded" } };
      if (s.method === "DELETE") {
        deleted = s;
        return { status: 204, body: {} };
      }
      if (s.method === "PATCH") return { status: 400, body: { error: { code: "spec_not_allowed", message: "free plan: fixed" } } };
      return undefined;
    }
  );
  const a = makeInstaboxAdapter(fetcher, 5_000, 1);
  const m = await a.mintSsh!({ vmId: "m_abc", apiKey: "ibk_KEY" });
  assert.ok(m.ok);
  if (m.ok) {
    assert.equal(m.ssh, `${TOKEN}@${INSTABOX_SSH_GATEWAY}`);
    assert.equal(m.cloud.tokenId, "cn_1");
    assert.equal(m.cloud.sshPort, "2222");
  }
  assert.ok(seen.at(-1)?.body && (seen.at(-1)!.body as { noExpiry: boolean }).noExpiry === true);

  const log: string[] = [];
  const built = await a.provision({ apiKey: "ibk_KEY", slug: "asb-ib", idleTimeoutSeconds: 300 }, { log: (x) => log.push(x), sshReady: async () => undefined });
  assert.ok(built.ok, JSON.stringify(built));
  if (built.ok) {
    assert.equal(built.ssh, `${TOKEN}@${INSTABOX_SSH_GATEWAY}`);
    assert.deepEqual(built.cloud, { vmId: "m_new", apiKey: "ibk_KEY", name: "asb-ib", tokenId: "cn_1", sshPort: "2222" });
  }
  const create = seen.find((s) => s.url.endsWith("/v1/machines") && s.method === "POST")!;
  assert.deepEqual(create.body, { name: "asb-ib", templateId: "agent-browser", desiredState: "running", metadata: { "agent-sandbox": "box-host" } });
  assert.ok(log.some((l) => /idle pause left at the plan's default/.test(l)), "a refused idle time is logged, not fatal");
  assert.equal(created, 1);

  const failed = await a.provision({ apiKey: "ibk_KEY", slug: "asb-ib2" }, {
    sshReady: async () => {
      throw new Error("Permission denied");
    },
  });
  assert.ok(!failed.ok);
  assert.match(failed.ok ? "" : failed.error, /SSH never answered: Permission denied/);
  assert.ok(deleted, "the machine was deleted");
  assert.equal(deleted!.headers["X-Confirm-Delete"], "m_new");
  assert.match(deleted!.headers["Idempotency-Key"] ?? "", /^asb-/, "a delete is a lifecycle call: without the key the API answers 400 and the machine is left behind");
  assert.ok(!(await a.provision({ apiKey: "ibk_KEY", slug: "Bad Name" })).ok);
});

test("instabox: destroy confirms with the machine id; a snapshot is named for the account", async () => {
  const { seen, fetcher } = fakeApi(
    () => ({ state: "stopped" }),
    (s) => {
      if (s.method === "DELETE") return { status: 204, body: {} };
      if (s.url.endsWith("/snapshots")) return { status: 201, body: { id: "snap_9", name: (s.body as { name: string }).name, state: "ready" } };
      return undefined;
    }
  );
  const a = makeInstaboxAdapter(fetcher);
  const d = await a.destroy!(spec);
  assert.ok(d.ok);
  assert.equal(seen[0].headers["X-Confirm-Delete"], "m_abc");
  assert.match(seen[0].headers["Idempotency-Key"] ?? "", /^asb-/);
  const s = await a.snapshot!(spec, { slug: "asb-host-20261119" });
  assert.deepEqual(s, { ok: true, snapshotId: "snap_9", slug: "asb-host-20261119" });
});

test("instabox: prepare sends the shim on stdin to the install script, and reports what the host said", async () => {
  const calls: { script: string; input?: string }[] = [];
  const a = makeInstaboxAdapter(fakeApi(() => ({})).fetcher, 5_000, 1, () => "#!/usr/bin/env python3\nprint('shim')\n");
  const r = await a.prepare!(spec, {
    ssh: async (script, input) => {
      calls.push({ script, input });
      return { code: 0, stdout: "msb-docker shim 1\nrsync:ok\nuser:user home:/data/home\n", stderr: "" };
    },
  });
  assert.deepEqual(r, { ok: true, detail: "msb-docker shim 1 · rsync:ok · user:user home:/data/home" });
  assert.equal(calls[0].script, DOCKER_HOST_PREPARE_SH);
  assert.match(calls[0].input ?? "", /print\('shim'\)/);
  assert.match(DOCKER_HOST_PREPARE_SH, new RegExp(`install -m 755 "\\$T" ${DOCKER_SHIM_PATH}`));
  const bad = await a.prepare!(spec, { ssh: async () => ({ code: 3, stdout: "no docker on this machine\n", stderr: "" }) });
  assert.deepEqual(bad, { ok: false, detail: "no docker on this machine" });
  // The real shim is beside the module and is the Python the install script checks.
  const src = dockerShimSource();
  assert.match(src, /^#!\/usr\/bin\/env python3/);
  assert.ok(/def cmd_(run|exec|ls|metrics|snapshot|load)\(/.test(src));
});

test("the registry lists instabox with what the form needs: an optional SSH target, a docker box runtime", () => {
  const p = listProviders().find((x) => x.id === "instabox")!;
  assert.ok(p);
  assert.equal(p.label, "Instabox sandbox");
  assert.deepEqual([p.needs, p.secrets, p.canProvision, p.canSnapshot, p.metered, p.sshOptional, p.boxRuntime], [["vmId"], ["apiKey"], true, true, true, true, "docker"]);
  assert.ok(!("state" in p) && !("prepare" in p), "facts only");
});

const base = {
  vpsSsh: "root@vps",
  sshExtraOpts: ["-i", "/key", "-o", "StrictHostKeyChecking=accept-new"],
  msb: "/root/.local/bin/msb",
  msbHome: "/root/.microsandbox",
  vpsStagingDir: "/root/staging",
  maxBoxes: 5,
  hostSleepAfterMs: 0,
  poolSize: 1,
  ompPoolSize: 1,
  snapshot: "agent-claude",
  claudeImage: "agent-claude:1",
  ompImage: "agent-omp:1",
} as unknown as Config;

test("an instabox host row: the gateway port and the shim's paths come from the adapter, the user from it too; the row's own values win", () => {
  const n = normalizeHostSpec({ name: "Instabox A", provider: "instabox", ssh: `${TOKEN}@${INSTABOX_SSH_GATEWAY}`, cloud: { vmId: "m_abc", apiKey: "ibk_KEY" } });
  assert.equal(n.sleepAfterMs, 300_000, "metered: sleeps after five minutes unless told otherwise");
  assert.equal(n.warm, false);
  const c = configForHost(base, n);
  assert.equal(c.vpsSsh, `${TOKEN}@${INSTABOX_SSH_GATEWAY}`);
  assert.deepEqual(c.sshExtraOpts, ["-p", "2222", "-i", "/key", "-o", "StrictHostKeyChecking=accept-new"]);
  assert.equal(c.sshDirectUser, "user");
  assert.equal(c.msb, DOCKER_SHIM_PATH);
  assert.equal(c.msbHome, INSTABOX_HOST_DEFAULTS.msbHome);
  assert.equal(c.vpsStagingDir, INSTABOX_HOST_DEFAULTS.stagingDir);
  const own = configForHost(base, { ...n, msb: "/opt/msb", stagingDir: "/data/stage", sshExtraOpts: ["-o", "X=1"] });
  assert.equal(own.msb, "/opt/msb");
  assert.equal(own.vpsStagingDir, "/data/stage");
  assert.deepEqual(own.sshExtraOpts, ["-p", "2222", "-o", "X=1"]);
  // A Freestyle or static row is as before: no provider options, the primary's paths.
  const fs = configForHost(base, normalizeHostSpec({ name: "fs", provider: "freestyle", ssh: "a+root:t@beta-ssh.freestyle.sh", cloud: { vmId: "vm-1", apiKey: "k" } }));
  assert.deepEqual(fs.sshExtraOpts, base.sshExtraOpts);
  assert.equal(fs.sshDirectUser, undefined);
  assert.equal(fs.msb, base.msb);
  // The direct route logs in as the provider's user, not the token.
  assert.equal(routeFor(c.vpsSsh, c.sshDirectUser).user, "user");
  assert.equal(routeFor(c.vpsSsh).user, TOKEN, "without the override the token would be the user");
});

test("an instabox token is redacted everywhere it shows: the row, the log shapes; an edit that resends the redacted target keeps the stored one", () => {
  assert.equal(redactSshTarget(`${TOKEN}@${INSTABOX_SSH_GATEWAY}`), `ibssh_…@${INSTABOX_SSH_GATEWAY}`);
  assert.equal(redactSshTarget("a+root:tok@proxy"), "a+root:…@proxy");
  assert.equal(redactSshTarget("root@vps"), "root@vps");
  const pub = publicHostSpec(spec);
  assert.equal(pub.ssh, `ibssh_…@${INSTABOX_SSH_GATEWAY}`);
  assert.ok(!JSON.stringify(pub).includes(TOKEN));
  const line = `Command timed out: ssh -p 2222 ${TOKEN}@${INSTABOX_SSH_GATEWAY} true`;
  assert.ok(!redactShapes(line).includes(TOKEN));
  assert.match(redactShapes(line), /ibssh_…/);
  const kept = normalizeHostSpec({ ssh: `ibssh_…@${INSTABOX_SSH_GATEWAY}`, name: "Instabox" }, spec);
  assert.equal(kept.ssh, spec.ssh, "the dashboard only has the redacted form; sending it back changes nothing");
  const changed = normalizeHostSpec({ ssh: `ibssh_other0000000000@${INSTABOX_SSH_GATEWAY}` }, spec);
  assert.equal(changed.ssh, `ibssh_other0000000000@${INSTABOX_SSH_GATEWAY}`);
  const fsSpec: HostSpec = { ...spec, provider: "freestyle", ssh: "a+root:TOK@beta-ssh.freestyle.sh" };
  assert.equal(normalizeHostSpec({ ssh: "a+root:…@beta-ssh.freestyle.sh" }, fsSpec).ssh, fsSpec.ssh);
});

test("prepareCuresCheck: a fresh machine's missing msb starts the preparation; no SSH or a broken shim does not", () => {
  assert.ok(prepareCuresCheck(undefined));
  assert.ok(prepareCuresCheck({ ok: true, detail: "" }));
  assert.ok(prepareCuresCheck({ ok: false, detail: "msb ls failed (exit 127): sh: 1: /usr/local/bin/msb: not found\n" }));
  assert.ok(prepareCuresCheck({ ok: false, detail: "msb ls failed (exit 127): ControlSocket already exists, disabling multiplexing\r\nsh: 1: /usr/local/bin/msb: not found" }));
  assert.ok(!prepareCuresCheck({ ok: false, detail: "msb ls failed (exit 255): Permission denied (publickey)" }));
  assert.ok(!prepareCuresCheck({ ok: false, detail: "msb ls failed (exit 1): Traceback (most recent call last)" }));
  assert.ok(!prepareCuresCheck({ ok: false, detail: "ssh timed out after 20000ms" }));
});

test("prepareHost: the adapter's step, then each missing image streamed from the primary; a failure stops there and says so", async () => {
  resetPrepareForTest();
  const host = configForHost(base, spec);
  assert.deepEqual(imagesWanted(base, host), ["agent-claude:1", "agent-omp:1"]);
  assert.deepEqual(imagesWanted(base, { ...host, claudeImage: "agent-claude:2" }), ["agent-claude:2", "agent-omp:1"]);
  const streamed: string[] = [];
  const log: string[] = [];
  const fakeAdapter = makeInstaboxAdapter(fakeApi(() => ({})).fetcher, 5_000, 1, () => "print('shim')");
  const { setProviderForTest } = await import("../src/host-providers.ts");
  setProviderForTest("instabox", { ...fakeAdapter, prepare: async () => ({ ok: true, detail: "shim installed · rsync:ok" }) });
  try {
    let t = 1_000;
    const r = await prepareHost(base, host, spec, {
      hasImage: async (_c, ref) => ref === "agent-omp:1",
      streamImage: async (_p, _h, ref) => {
        streamed.push(ref);
        t += 170_000;
      },
      log: (m) => log.push(m),
      now: () => t,
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.steps, ["shim installed · rsync:ok", "agent-claude:1 streamed from the primary in 2m50s", "agent-omp:1 is on the host already"]);
    assert.deepEqual(streamed, ["agent-claude:1"]);
    assert.equal(r.running, false);
    assert.equal(prepareStatus("ib"), r);

    const failed = await prepareHost(base, host, spec, {
      hasImage: async () => false,
      streamImage: async () => {
        throw new Error("msb load on the host exited 1: no space left on device");
      },
      log: () => undefined,
    });
    assert.equal(failed.ok, false);
    assert.match(failed.error ?? "", /no space left/);
    assert.deepEqual(failed.steps, ["shim installed · rsync:ok"]);

    // Started in the background: the report is "running" at once and only one runs per host.
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const bg = startPrepare(base, host, spec, { hasImage: async () => true, streamImage: async () => undefined, log: () => undefined });
    assert.equal(bg.running, true);
    setProviderForTest("instabox", { ...fakeAdapter, prepare: async () => (await gate, { ok: true, detail: "late" }) });
    assert.equal(startPrepare(base, host, spec, { log: () => undefined }), bg, "the running report, not a second job");
    release();
    await new Promise((r) => setTimeout(r, 10));
  } finally {
    setProviderForTest("instabox", null);
    resetPrepareForTest();
  }
});
