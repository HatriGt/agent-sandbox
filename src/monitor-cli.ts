/**
 * Print the sandbox fleet report from the VPS. Not part of the MCP server.
 * Usage: node dist/monitor-cli.js   (or: npm run monitor)
 */
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { gatherMonitor } from "./msb.js";
import { formatMonitor } from "./monitor.js";

async function main() {
  loadDotEnv();
  const cfg = loadConfig();
  console.log(formatMonitor(await gatherMonitor(cfg)));
}

main().catch((e) => {
  console.error("[monitor] FAILED:", e);
  process.exit(1);
});
