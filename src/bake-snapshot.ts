/**
 * Bake a warm-start snapshot: boot a bare box, install Claude Code + gh, stop it, and snapshot.
 * Future delegations boot from this snapshot (MSB_SNAPSHOT) and skip the ~10s toolchain install.
 *
 * Usage: node dist/bake-snapshot.js [snapshotName]   (default: agent-base)
 * After baking, set MSB_SNAPSHOT=<name> in .env so createBox uses --from-snapshot.
 */
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { createBareBox, installTools, stopBox, snapshotCreate, teardown } from "./msb.js";

async function main() {
  loadDotEnv();
  const cfg = loadConfig();
  const name = process.argv[2] || "agent-base";
  const box = `bake-${Date.now()}`;

  console.log(`[bake] booting bare box ${box} from image ${cfg.image} ...`);
  await createBareBox(cfg, box);

  console.log("[bake] installing claude + gh ...");
  const r = await installTools(cfg, box);
  console.log(r.stdout.trim() || r.stderr.trim());

  console.log(`[bake] stopping box + creating snapshot '${name}' ...`);
  await stopBox(cfg, box);
  await snapshotCreate(cfg, box, name);

  console.log("[bake] removing scratch box ...");
  await teardown(cfg, box);

  console.log(`[bake] done. Set MSB_SNAPSHOT=${name} in .env to warm-start from it.`);
}

main().catch((e) => {
  console.error("[bake] FAILED:", e);
  process.exit(1);
});
