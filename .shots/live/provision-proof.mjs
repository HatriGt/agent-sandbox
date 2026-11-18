// Live proof of the Freestyle provisioner on account B, run inside the agent-sandbox container
// as /app/wt-proof/proof.mjs next to a copy of dist/host-providers.js. Reads the account's key
// from the production hosts table (read-only), provisions one VM, proves SSH through the minted
// token, then deletes the VM and revokes the identity. Never prints the key or the token.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { makeFreestyleAdapter, FREESTYLE_API } from "./host-providers.js";

const require = createRequire("/app/package.json");
const Database = require("better-sqlite3");
const HOST = process.argv[2] || "freestyle-b";
const SLUG = process.argv[3] || "asb-provision-proof";

const db = new Database("/app/data/asb.sqlite", { readonly: true });
const row = db.prepare("select spec_json from hosts where id = ?").get(HOST);
db.close();
if (!row) throw new Error(`no host row ${HOST}`);
const spec = JSON.parse(row.spec_json);
const apiKey = (spec.cloud ?? spec.freestyle ?? {}).apiKey;
if (!apiKey) throw new Error(`host ${HOST} has no API key`);
const redact = (s) => String(s).replace(apiKey, "<key>").replace(/:[^@\s]+@/g, ":<token>@");

const listVms = async () => {
  const r = await fetch(`${FREESTYLE_API}/v5/vms`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
  const j = await r.json().catch(() => ({}));
  const arr = Array.isArray(j) ? j : j.vms ?? j.items ?? j.data ?? [];
  return { status: r.status, vms: arr.map((v) => ({ id: v.id, slug: v.slug, state: v.state ?? v.status })) };
};

const sshReady = async (target) => {
  const until = Date.now() + 120_000;
  let last = "";
  while (Date.now() < until) {
    const r = spawnSync("ssh", ["-i", "/root/.ssh/id_ed25519", "-o", "BatchMode=yes", "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20", target, "uname -n; id -un"], { encoding: "utf8", timeout: 40_000 });
    if (r.status === 0) { console.log("ssh answered:", r.stdout.trim().replace(/\n/g, " / ")); return; }
    last = (r.stderr || String(r.error ?? "")).trim().split("\n").pop() ?? "";
    console.log("ssh not yet:", redact(last));
    await new Promise((res) => setTimeout(res, 5000));
  }
  throw new Error(last || "timeout");
};

console.log("account:", HOST, "slug:", SLUG);
console.log("before:", JSON.stringify(await listVms()));
const adapter = makeFreestyleAdapter(fetch);
const t0 = Date.now();
const made = await adapter.provision({ apiKey, slug: SLUG, idleTimeoutSeconds: 300 }, { log: (l) => console.log("  ·", redact(l)), sshReady });
console.log(`provision: ok=${made.ok} in ${Math.round((Date.now() - t0) / 1000)}s`);
if (!made.ok) {
  console.log("error:", redact(made.error));
  console.log("after (failed):", JSON.stringify(await listVms()));
  process.exit(2);
}
console.log("ssh target:", redact(made.ssh));
console.log("cloud:", JSON.stringify({ ...made.cloud, apiKey: "<key>" }));
console.log("during:", JSON.stringify(await listVms()));
const gone = await adapter.destroy({ provider: "freestyle", cloud: made.cloud });
console.log("destroy:", JSON.stringify(gone));
await new Promise((res) => setTimeout(res, 3000));
console.log("after:", JSON.stringify(await listVms()));
const check = spawnSync("ssh", ["-i", "/root/.ssh/id_ed25519", "-o", "BatchMode=yes", "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20", made.ssh, "true"], { encoding: "utf8", timeout: 40_000 });
console.log("token after revoke:", check.status === 0 ? "STILL WORKS (unexpected)" : "refused: " + redact((check.stderr || "").trim().split("\n").pop()));
