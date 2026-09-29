/**
 * Bake the omp OCI image: claude + gh + bun + omp + debugpy + the MCP server packages, pruned, in
 * one layer that msb stores ONCE on the host. Boxes boot it with an empty sparse upper instead of
 * copying the ~3.4G agent-omp snapshot upper per box (see ompRootSource).
 *
 * Usage: node dist/bake-omp-image.js [tag]   (default: agent-omp:<yyyymmddhhmm>)
 * Extra MCP packages: OMP_BAKE_NPX=pkg,pkg. After baking, set MSB_OMP_IMAGE=<tag> in .env.
 */
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { bakeOmpImage } from "./msb.js";

async function main() {
  loadDotEnv();
  const cfg = loadConfig();
  const tag = process.argv[2] || `agent-omp:${new Date().toISOString().replace(/\D/g, "").slice(0, 12)}`;
  const extra = (process.env.OMP_BAKE_NPX ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  console.log(`[bake] building ${tag} FROM ${cfg.image} on the VPS (a few minutes) ...`);
  console.log(await bakeOmpImage(cfg, tag, extra));
  console.log(`[bake] done. Set MSB_OMP_IMAGE=${tag} in .env and restart the controller.`);
}

main().catch((e) => {
  console.error("[bake] FAILED:", e);
  process.exit(1);
});
