/**
 * Bake the claude OCI image: Claude Code + gh + the MCP server packages, pruned, with the baked
 * package manifest, in one layer that msb stores ONCE on the host. Boxes boot it with an empty
 * sparse upper instead of copying the ~931M claude snapshot upper per box (see claudeRootSource).
 *
 * Usage: node dist/bake-claude-image.js [tag]   (default: agent-claude:<yyyymmddhhmm>)
 * Extra MCP packages: BAKE_NPX=pkg@version,pkg@version (pin them: the box then never follows a
 * release the operator has not seen). After baking, set MSB_CLAUDE_IMAGE=<tag> in .env.
 */
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { bakeAgentImage } from "./msb.js";

async function main() {
  loadDotEnv();
  const cfg = loadConfig();
  const tag = process.argv[2] || `agent-claude:${new Date().toISOString().replace(/\D/g, "").slice(0, 12)}`;
  const extra = (process.env.BAKE_NPX ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  console.log(`[bake] building ${tag} FROM ${cfg.image} on the VPS (a few minutes) ...`);
  console.log(await bakeAgentImage(cfg, tag, extra, "claude"));
  console.log(`[bake] done. Set MSB_CLAUDE_IMAGE=${tag} in .env and restart the controller.`);
}

main().catch((e) => {
  console.error("[bake] FAILED:", e);
  process.exit(1);
});
