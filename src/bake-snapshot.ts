/**
 * Bake a warm-start snapshot: boot a bare box, install Claude Code + gh, stop it, and snapshot.
 * Future delegations boot from this snapshot (MSB_SNAPSHOT) and skip the ~10s toolchain install.
 *
 * Usage: node dist/bake-snapshot.js [snapshotName]   (default: agent-base)
 * After baking, set MSB_SNAPSHOT=<name> in .env so createBox uses --from-snapshot.
 */
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { createBareBox, installTools, installOmpTools, installMcpConfig, preinstallNpmPackages, exec, stopBox, snapshotCreate, teardown, OMP_MIN_DISK, OMP_MIN_MEMORY } from "./msb.js";

async function main() {
  loadDotEnv();
  let cfg = loadConfig();
  const name = process.argv[2] || "agent-base";
  // `node dist/bake-snapshot.js agent-omp omp` bakes the omp variant: bun + omp pre-installed on
  // the bigger rootfs omp needs (a snapshot pins the rootfs size of every box booted from it).
  const omp = process.argv[3] === "omp";
  if (omp) cfg = { ...cfg, rootDisk: OMP_MIN_DISK, memory: OMP_MIN_MEMORY };
  const box = `bake-${Date.now()}`;

  console.log(`[bake] booting bare box ${box} from image ${cfg.image} (disk ${cfg.rootDisk}) ...`);
  await createBareBox(cfg, box);

  console.log(`[bake] installing claude + gh${omp ? " + bun + omp" : ""} ...`);
  const r = await (omp ? installOmpTools(cfg, box) : installTools(cfg, box));
  console.log(r.stdout.trim() || r.stderr.trim());

  // Pre-install MCP server packages so a booted box skips the npm round (~30s of every task
  // start, measured on the claude tier) and, on a 1G disk, the space it costs — the per-run
  // install of btp-mcp-server + @cap-js/mcp-server filled the claude boxes to the last byte and
  // killed every run for two weeks. The set: whatever the legacy-file store yields here (the
  // encrypted per-owner store is not reachable from this standalone process) plus an explicit
  // BAKE_NPX=pkg,pkg list for the deployment's known servers (OMP_BAKE_NPX, the older name, is
  // still read for the omp bake). Bake with MSB_ROOT_DISK=3G: the snapshot pins the disk of every
  // box booted from it, and the packages do not fit beside Claude Code on 1G.
  console.log("[bake] pre-installing MCP server packages ...");
  await installMcpConfig(cfg, box);
  const extra = [...new Set([process.env.BAKE_NPX ?? "", omp ? (process.env.OMP_BAKE_NPX ?? "") : ""].flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean))];
  if (extra.length) {
    console.log(`[bake] pre-installing: ${extra.join(", ")}`);
    await preinstallNpmPackages(cfg, box, extra);
  }
  // The tarballs are dead weight once the bins are on PATH, and a snapshot boot copies its whole
  // upper into every box — so the caches go, and the disk the boxes will inherit is printed.
  const df = await exec(cfg, box, "npm cache clean --force >/dev/null 2>&1; rm -rf /root/.npm/_cacache /root/.cache /tmp/* 2>/dev/null; ls /usr/local/lib/node_modules | tr '\\n' ' '; echo; df -h / | tail -1");
  console.log(`[bake] packages: ${df.stdout.trim()}`);

  console.log(`[bake] stopping box + creating snapshot '${name}' ...`);
  await stopBox(cfg, box);
  await snapshotCreate(cfg, box, name);

  console.log("[bake] removing scratch box ...");
  await teardown(cfg, box);

  console.log(`[bake] done. Set ${omp ? "MSB_OMP_SNAPSHOT" : "MSB_SNAPSHOT"}=${name} in .env to warm-start from it (boxes get a ${cfg.rootDisk} disk).`);
}

main().catch((e) => {
  console.error("[bake] FAILED:", e);
  process.exit(1);
});
