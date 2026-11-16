// Live end-to-end for the box-host pool against the public controller, as the operator.
//   ASB_TOKEN=<operator bearer> node .shots/live-hosts-e2e.mjs [--base=https://...] [--no-run]
//   FS_SSH=<box+root:token@beta-ssh.freestyle.sh> FS_VM=<vm id> FS_KEY=<api key>   adds a Freestyle host too
// What it proves: the registry answers with the primary; a dead host added with a better order
// number is checked on the way in, marked unreachable and never picked; a real run still lands on
// the primary and its box carries the host tag; a Freestyle host round-trips with its token and
// API key never echoed; the primary cannot be removed; every test host is removed at the end.
const flags = process.argv.slice(2);
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const BASE = flag("base", "https://agent-sandbox.ajeethkumar.dev");
const NO_RUN = flags.includes("--no-run");
// With --run-on-fs the Freestyle host is put ahead of the primary and one real run has to land there.
const RUN_ON_FS = flags.includes("--run-on-fs");
const TOKEN = process.env.ASB_TOKEN;
if (!TOKEN) throw new Error("ASB_TOKEN is required");
const FS = process.env.FS_SSH ? { ssh: process.env.FS_SSH, vmId: process.env.FS_VM ?? "", apiKey: process.env.FS_KEY ?? "" } : null;
const ts = Date.now().toString(36);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fails = [];
const check = (ok, what, extra) => {
  log(ok ? "PASS" : "FAIL", what, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : "");
  if (!ok) fails.push(what);
};
const secrets = [TOKEN, FS?.apiKey, FS?.ssh?.match(/:([^@]+)@/)?.[1]].filter((s) => s && s.length > 8);

async function call(method, path, body) {
  const headers = { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "x-requested-with": "agent-sandbox", origin: BASE };
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  for (const s of secrets) if (text.includes(s)) check(false, `a secret was echoed by ${method} ${path}`);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}
const hosts = async () => (await call("GET", "/hosts.json")).json;
const hostAction = (body) => call("POST", "/hosts.json", body);
const added = [];
const cleanup = async () => {
  for (const id of added.splice(0)) {
    // A box torn down a moment ago is still in the host's last sweep for up to 15 s.
    let r;
    for (let i = 0; i < 8; i++) {
      r = await hostAction({ action: "remove", id });
      if (r.status === 200) break;
      await new Promise((res) => setTimeout(res, 10000));
    }
    check(r.status === 200, `removed test host ${id}`, r.json?.error);
  }
};
// One run, watched to the end through /fleet.json; answers the box's last fleet view.
async function runAndWatch(task, maxPolls = 40) {
  const t1 = Date.now();
  const r = await call("POST", "/delegate.json", { task });
  const box = r.json?.box;
  check(r.status === 200 && typeof box === "string", `delegate started a run (${Math.round((Date.now() - t1) / 1000)}s)`, { status: r.status, box, error: r.json?.error, output: r.json?.output });
  if (!box) return { box: null };
  let view;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((res) => setTimeout(res, 8000));
    const f = (await call("GET", "/fleet.json")).json;
    view = f?.boxes?.find((b) => b.name === box);
    if (view && /done|failed|waiting/.test(view.runState ?? "")) break;
  }
  return { box, view, seconds: Math.round((Date.now() - t1) / 1000) };
}
process.on("unhandledRejection", async (e) => {
  log("unhandled:", e);
  await cleanup();
  process.exit(2);
});

try {
  // ---- 1. the registry, as deployed
  let h = await hosts();
  const primary = h?.hosts?.find((x) => x.primary);
  check(!!primary && primary.id === "primary" && primary.enabled, "GET /hosts.json lists the primary host from .env", primary && { id: primary.id, ssh: primary.ssh, maxBoxes: primary.maxBoxes, running: primary.running, asleep: primary.asleep });
  check(typeof h.capacity === "number" && h.capacity >= primary.maxBoxes, "capacity is the sum of enabled hosts' slots", h.capacity);
  const health = (await call("GET", "/health.json")).json;
  check(Array.isArray(health?.hosts) && health.hosts.some((x) => x.id === "primary"), "/health.json carries hosts for an admin", health?.hosts?.map((x) => x.id));

  // ---- 2. the primary cannot be removed; a bad spec is refused
  let r = await hostAction({ action: "remove", id: "primary" });
  check(r.status === 400 && /primary/i.test(r.json?.error ?? ""), "removing the primary is refused", r.json?.error);
  r = await hostAction({ action: "upsert", spec: { name: "bad target", ssh: "-oProxyCommand=evil" } });
  check(r.status === 400, "an SSH target that starts with a dash is refused", r.json?.error);
  r = await hostAction({ action: "upsert", spec: { name: "no vm", provider: "freestyle", ssh: "a+root:t@beta-ssh.freestyle.sh" } });
  check(r.status === 400, "a Freestyle host without a VM id is refused", r.json?.error);

  // ---- 3. a dead host with a better order number than the primary
  const deadId = `e2e-dead-${ts}`;
  const t0 = Date.now();
  r = await hostAction({ action: "upsert", spec: { id: deadId, name: `E2E dead ${ts}`, ssh: "root@203.0.113.9", priority: -1, maxBoxes: 2, sleepAfterMs: 0, warm: false, enabled: true } });
  const dt = Math.round((Date.now() - t0) / 1000);
  if (r.status === 200) added.push(deadId);
  check(r.status === 200 && r.json?.check?.ok === false, `adding a dead host answers with a failed check (took ${dt}s)`, r.json?.check);
  check(dt < 70, "the add did not wait for TCP to give up on its own", dt);
  check(r.json?.host?.unreachable === true, "the dead host is unreachable from the start", { unreachable: r.json?.host?.unreachable, lastError: r.json?.host?.lastError });
  h = await hosts();
  check(h.hosts.some((x) => x.id === deadId && x.unreachable && x.priority === -1), "GET shows it unreachable with order -1", h.hosts.find((x) => x.id === deadId)?.lastError);
  // the fleet still answers quickly with the dead host in the pool
  const tf = Date.now();
  const fleet = (await call("GET", "/fleet.json")).json;
  const ft = Math.round((Date.now() - tf) / 1000);
  check(fleet && Array.isArray(fleet.boxes) && ft < 50, `/fleet.json still answers with a dead host enabled (${ft}s)`, { boxes: fleet?.boxes?.length, capacity: fleet?.lifecycle?.capacity });
  r = await hostAction({ action: "check", id: deadId });
  check(r.status === 200 && r.json?.ok === false, "check on the dead host says so", r.json?.check?.detail);
  r = await hostAction({ action: "check", id: "primary" });
  check(r.status === 200 && r.json?.ok === true, "check on the primary answers", r.json?.check);

  // ---- 4. a real run lands on the primary, not the dead host
  if (!NO_RUN) {
    const { box, view, seconds } = await runAndWatch(`Run \`uname -a\` and \`hostname\`, print both lines, then finish. (hosts e2e ${ts})`);
    if (box) {
      check(view?.host === "primary", `the box carries host=primary in the fleet (${seconds}s)`, view && { host: view.host, runState: view.runState, exitCode: view.exitCode });
      check(view?.runState === "done", "the run finished", view?.runState);
      const t = await call("POST", "/teardown.json", { box });
      check(t.status === 200, "teardown of the test box", t.json?.error ?? t.status);
    }
  }

  // ---- 5. a Freestyle host round-trips, secrets stay inside
  if (FS) {
    const fsId = `e2e-freestyle-${ts}`;
    r = await hostAction({ action: "upsert", spec: { id: fsId, name: `E2E Freestyle ${ts}`, provider: "freestyle", ssh: FS.ssh, freestyle: { vmId: FS.vmId, apiKey: FS.apiKey }, priority: 10, sleepAfterMs: 300000, maxBoxes: 4, warm: false, enabled: true, allowance: { vcpuHours: 200, vcpu: 4, resetDay: 1 } } });
    if (r.status === 200) added.push(fsId);
    check(r.status === 200, "a Freestyle host is accepted", { check: r.json?.check, error: r.json?.error });
    const v = r.json?.host;
    check(v && /…/.test(v.ssh) && v.freestyle?.hasApiKey === true && !("apiKey" in (v.freestyle ?? {})), "its SSH token is elided and the API key is only a flag", v && { ssh: v.ssh, freestyle: v.freestyle });
    check(v?.allowance?.vcpuHours === 200 && typeof v.allowance.leftHours === "number", "the allowance is reported with hours left", v?.allowance);
    r = await hostAction({ action: "check", id: fsId });
    check(r.status === 200, "check on the Freestyle host answers (ok or not)", { ok: r.json?.ok, detail: r.json?.check?.detail, providerState: r.json?.host?.providerState });
    // blank API key on an edit keeps the stored one
    r = await hostAction({ action: "upsert", id: fsId, spec: { name: `E2E Freestyle ${ts} renamed`, freestyle: { vmId: FS.vmId, apiKey: "" } } });
    check(r.status === 200 && r.json?.host?.freestyle?.hasApiKey === true && r.json.host.name.endsWith("renamed"), "an edit with a blank API key keeps the stored key", r.json?.host?.freestyle);
    const fsUp = r.json?.host?.providerState?.state === "running";
    if (RUN_ON_FS && fsUp && !NO_RUN) {
      // ---- 6. the Freestyle host ahead of the primary: a real run lands there and is reachable through the controller
      r = await hostAction({ action: "upsert", id: fsId, spec: { priority: -1 } });
      check(r.status === 200 && r.json?.host?.priority === -1, "the Freestyle host is put ahead of the primary", r.json?.host?.priority);
      const { box, view, seconds } = await runAndWatch(`Run \`hostname\` and \`nproc\`, print both lines, then finish. (hosts e2e on freestyle ${ts})`, 60);
      if (box) {
        check(view?.host === fsId, `the box carries host=${fsId} in the fleet (${seconds}s)`, view && { host: view.host, runState: view.runState, exitCode: view.exitCode, boxStatus: view.boxStatus });
        check(view?.runState === "done", "the run on the Freestyle host finished", view?.runState);
        const hv = (await hosts()).hosts.find((x) => x.id === fsId);
        check(hv && hv.lastSweepAt > 0 && !hv.unreachable, "the Freestyle host was swept while the run was on it", hv && { running: hv.running, lastSweepAt: hv.lastSweepAt, asleep: hv.asleep });
        const t = await call("POST", "/teardown.json", { box });
        check(t.status === 200, "teardown of the Freestyle test box (routed to the right host)", t.json?.error ?? t.status);
      }
      r = await hostAction({ action: "upsert", id: fsId, spec: { priority: 10 } });
      check(r.status === 200, "the Freestyle host is back behind the primary");
    } else if (RUN_ON_FS) {
      log("skip: the Freestyle VM is not running, no run was placed there", r.json?.host?.providerState);
    }
  } else {
    log("skip: no FS_SSH, the Freestyle host round-trip was not run");
  }
} finally {
  await cleanup();
  const h = await hosts();
  check(!h.hosts.some((x) => x.id.startsWith("e2e-")), "no e2e host is left behind", h.hosts.map((x) => x.id));
}
log(fails.length ? `FAILED: ${fails.length}\n - ${fails.join("\n - ")}` : "ALL PASS");
process.exit(fails.length ? 1 : 0);
