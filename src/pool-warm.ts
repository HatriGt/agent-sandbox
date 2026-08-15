/**
 * Pre-seed / top up the warm pool to MSB_POOL_SIZE. Run once after deploy (and the MCP also
 * refills automatically after each claim). Not part of the MCP server.
 *
 * Usage: node dist/pool-warm.js
 */
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { listPoolBoxes } from "./msb.js";
import { refillPool } from "./pool.js";

async function main() {
  loadDotEnv();
  const cfg = loadConfig();
  if (cfg.poolSize <= 0) {
    console.log("[pool] MSB_POOL_SIZE=0 — pooling disabled.");
    return;
  }
  if (!cfg.egressAllowAll) {
    console.log("[pool] EGRESS_ALLOW_ALL is not set — pool boxes are open-egress; enable it to use the pool.");
  }
  const before = await listPoolBoxes(cfg);
  console.log(`[pool] available before: ${before.length}/${cfg.poolSize}`);
  await refillPool(cfg);
  const after = await listPoolBoxes(cfg);
  console.log(`[pool] available after:  ${after.length}/${cfg.poolSize}`);
  console.log(after.length ? `[pool] ready: ${after.join(", ")}` : "[pool] none ready");
}

main().catch((e) => {
  console.error("[pool] FAILED:", e);
  process.exit(1);
});
