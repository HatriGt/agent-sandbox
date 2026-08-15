/**
 * End-to-end benchmark: times each phase of a delegation and captures box RAM/CPU.
 * Not part of the MCP server.
 *
 * Usage: node dist/bench.js <repoPath> "<task>"
 */
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { syncTreeToVps } from "./sync.js";
import { bootstrap, runAgentOnly, metrics, exec, teardown } from "./msb.js";
import { acquireBox, poolEligible } from "./pool.js";
import { newSessionId } from "./session.js";

function ms() {
  return Date.now();
}
function secs(from: number, to: number) {
  return ((to - from) / 1000).toFixed(1) + "s";
}

async function main() {
  loadDotEnv();
  const cfg = loadConfig();
  const repo = process.argv[2];
  const task = process.argv[3];
  if (!repo || !task) {
    console.error('Usage: node dist/bench.js <repoPath> "<task>"');
    process.exit(1);
  }

  const id = newSessionId();
  const t: Record<string, number> = {};
  console.log(`[bench] session=${id}`);
  console.log(
    `[bench] config: snapshot=${cfg.snapshot || "(none)"} mem=${cfg.memory} ` +
      `egress=${cfg.egressAllowAll ? "ALL" : cfg.egressDomains.length + " domains"} ` +
      `model=${cfg.anthropicModel}`
  );

  const eligible = poolEligible(cfg, false);
  t.start = ms();
  const staging = await syncTreeToVps(cfg, repo, id);
  t.synced = ms();

  const { box, warm } = await acquireBox(cfg, id, staging, eligible);
  t.booted = ms();
  console.log(`[bench] box=${box} ${warm ? "(WARM claim)" : "(cold boot)"}`);

  await bootstrap(cfg, box);
  t.bootstrapped = ms();

  // Capture footprint right before the agent runs (idle box w/ toolchain).
  const idleMetrics = await metrics(cfg, box);

  const res = await runAgentOnly(cfg, box, task);
  t.agentDone = ms();

  // Footprint during/right after agent work.
  const activeMetrics = await metrics(cfg, box);
  const du = await exec(cfg, box, "du -sh /workspace 2>/dev/null | cut -f1; df -h / | tail -1");

  await teardown(cfg, box, staging);
  t.torndown = ms();

  console.log("\n===== AGENT OUTPUT =====");
  console.log(res.stdout.trim() || res.stderr.trim());

  console.log("\n===== PHASE TIMINGS =====");
  console.log(`sync tree      : ${secs(t.start, t.synced)}`);
  console.log(`acquire (boot/claim+copy): ${secs(t.synced, t.booted)}`);
  console.log(`bootstrap      : ${secs(t.booted, t.bootstrapped)}`);
  console.log(`agent task     : ${secs(t.bootstrapped, t.agentDone)}`);
  console.log(`teardown       : ${secs(t.agentDone, t.torndown)}`);
  console.log(`TOTAL          : ${secs(t.start, t.torndown)}`);
  console.log(
    `(boot-to-ready : ${secs(t.start, t.bootstrapped)}  = sync+boot+bootstrap)`
  );

  console.log("\n===== FOOTPRINT (idle, toolchain loaded) =====");
  console.log(idleMetrics.trim());
  console.log("\n===== FOOTPRINT (after agent work) =====");
  console.log(activeMetrics.trim());
  console.log("\n===== DISK =====");
  console.log(du.stdout.trim());
}

main().catch((e) => {
  console.error("[bench] FAILED:", e);
  process.exit(1);
});
