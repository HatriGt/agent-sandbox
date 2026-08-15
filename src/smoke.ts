/**
 * Live smoke test for the delegate loop. Not part of the MCP server.
 * Loads .env, syncs a repo, boots a box, runs the agent, prints status, then tears down.
 *
 * Usage: node dist/smoke.js <repoPath> "<task>"
 */
import fs from "node:fs";
import { loadConfig } from "./config.js";
import { syncTreeToVps } from "./sync.js";
import { createBox, runAgentTask, exec, status, teardown } from "./msb.js";
import { newSessionId } from "./session.js";

// Minimal .env loader (no dependency): KEY=VALUE lines into process.env.
function loadDotEnv(path = ".env") {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function main() {
  loadDotEnv();
  const repo = process.argv[2];
  const task = process.argv[3];
  if (!repo || !task) {
    console.error('Usage: node dist/smoke.js <repoPath> "<task>"');
    process.exit(1);
  }

  const cfg = loadConfig();
  const id = newSessionId();
  console.log(`[smoke] session=${id}`);

  console.log("[smoke] syncing tree -> VPS ...");
  const staging = await syncTreeToVps(cfg, repo, id);
  console.log(`[smoke] staged at ${staging}`);

  console.log("[smoke] booting box (repo baked in) ...");
  await createBox(cfg, { name: id, copyDir: staging });

  console.log("[smoke] confirming repo landed in box ...");
  const ls = await exec(cfg, id, "cd /workspace && ls -la && git status --short 2>/dev/null | head");
  console.log(ls.stdout);

  console.log("[smoke] running agent task ...");
  const res = await runAgentTask(cfg, id, task);
  console.log("--- agent output ---");
  console.log(res.stdout.trim() || res.stderr.trim());

  console.log("[smoke] status:");
  console.log(await status(cfg, id));

  console.log("[smoke] tearing down ...");
  await teardown(cfg, id, staging);
  console.log("[smoke] done.");
}

main().catch((e) => {
  console.error("[smoke] FAILED:", e);
  process.exit(1);
});
