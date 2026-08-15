/**
 * Print the warm pool status. Not part of the MCP server.
 * Usage: node dist/pool-status.js
 */
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { poolStatus } from "./pool.js";

async function main() {
  loadDotEnv();
  const cfg = loadConfig();
  const s = await poolStatus(cfg);
  if (!s.enabled) {
    console.log(
      `[pool] disabled — needs MSB_POOL_SIZE>0 (got ${s.size}), a snapshot, and EGRESS_ALLOW_ALL=1.`
    );
    return;
  }
  console.log(`[pool] ${s.available}/${s.size} ready${s.boxes.length ? `: ${s.boxes.join(", ")}` : ""}`);
}

main().catch((e) => {
  console.error("[pool] FAILED:", e);
  process.exit(1);
});
