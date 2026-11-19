// Drive an Instabox machine at the provider directly, behind the controller's back, the way the
// free plan's own idle pause does. Runs inside the container, where the host row's key lives:
//   docker cp .shots/live/ibx-api.cjs agent-sandbox:/app/ibx-api.cjs
//   docker exec agent-sandbox node /app/ibx-api.cjs <host-id> state|suspend|start
// Prints one JSON line: { state, ms, status }. The key never leaves the host.
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");
const [hostId, verb = "state"] = process.argv.slice(2);
if (!hostId) throw new Error("host id required");
const db = new Database(path.join(process.env.DATA_DIR || "/app/data", "asb.sqlite"), { readonly: true });
const row = db.prepare("select spec_json from hosts where id = ?").get(hostId);
if (!row) throw new Error(`no host ${hostId}`);
const spec = JSON.parse(row.spec_json);
const cloud = spec.cloud || spec.instabox || {};
if (!cloud.apiKey || !cloud.vmId) throw new Error(`host ${hostId} has no cloud key/machine`);
const API = "https://api.instabox.sh";
const call = async (method, p, lifecycle) => {
  const r = await fetch(`${API}${p}`, {
    method,
    headers: { "X-API-Key": cloud.apiKey, Accept: "application/json", ...(lifecycle ? { "Content-Type": "application/json", "Idempotency-Key": `asb-live-${crypto.randomUUID()}` } : {}) },
    ...(lifecycle ? { body: "{}" } : {}),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: r.status, json };
};
const state = async () => {
  const r = await call("GET", `/v1/machines/${encodeURIComponent(cloud.vmId)}`);
  const m = r.json.machine || r.json;
  return { status: r.status, state: m.state, error: r.json.error };
};
(async () => {
  const t0 = Date.now();
  if (verb === "state") return console.log(JSON.stringify({ ...(await state()), ms: Date.now() - t0 }));
  if (verb !== "suspend" && verb !== "start") throw new Error(`unknown verb ${verb}`);
  const r = await call("POST", `/v1/machines/${encodeURIComponent(cloud.vmId)}/${verb}`, true);
  const want = verb === "suspend" ? /suspended|stopped/ : /running/;
  let s = await state();
  for (let i = 0; i < 40 && !want.test(s.state || ""); i++) {
    await new Promise((res) => setTimeout(res, 1500));
    s = await state();
  }
  console.log(JSON.stringify({ verb, status: r.status, error: r.json.error, state: s.state, ms: Date.now() - t0 }));
})().catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exit(1); });
