/**
 * Code-mode bench, host side: boots one throwaway microVM from the production claude image on the
 * VPS (over `ssh hostbrr`, like the controller), ships the bench and the compiled code-mode server
 * into it, runs box-run.mjs detached, pulls the raw stream-json back and tears the box down.
 * report.ts turns the pulled runs into the §7 table.
 *
 *   npm run build                                     # dist/code-mode/box/*.js is what gets shipped
 *   npx tsx bench/code-mode/bench.ts up               # boot + install; prints the box name
 *   npx tsx bench/code-mode/bench.ts run [box-run args, e.g. --tasks T3 --modes B --runs 5]
 *   npx tsx bench/code-mode/bench.ts status           # tail of the in-box log
 *   npx tsx bench/code-mode/bench.ts pull             # -> bench/code-mode/out/<box>/
 *   npx tsx bench/code-mode/bench.ts down             # msb rm, only a box this script created
 *
 * The box name is kept in bench/code-mode/out/box.txt. `down` refuses any name that does not start
 * with "bench-cm-" or that has a pin under ~/.agent-sandbox/keep/ on the host.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeDriver, claudeLaunchSh, CLAUDE_MCP_WAIT_MS } from "../../src/drivers/claude.js";
import { MOLI_PROMPT_HINT } from "../../src/browser.js";
import { CODE_MODE_DIR, CODE_MODE_MODULES } from "../../src/code-mode/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "out");
const BOX_FILE = join(OUT, "box.txt");
const HOST = process.env.BENCH_HOST || "hostbrr";
/** The image the pool boxes run (msb ls); MSB_CLAUDE_IMAGE=agent-claude:1 on the controller. */
const IMAGE = process.env.BENCH_IMAGE || "agent-claude:202611120630";
/** A warm pool box to copy the deployed hooks from, read-only. Any running pool-* box works. */
const SHIPPED = ["data.mjs", "state.mjs", "sdk.mjs", "tracker-server.mjs", "ops-server.mjs", "tasks.mjs", "box-run.mjs", "code-mode-prompt.txt", "code-mode-prompt-v2.txt"];
const MSB = "export PATH=/root/.microsandbox/bin:$PATH;";

const sh = (cmd: string, input?: string) => execFileSync("ssh", [HOST, `${MSB} ${cmd}`], { encoding: "utf8", input, maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "inherit"] });
const box = () => {
  if (!existsSync(BOX_FILE)) throw new Error("no box: run `up` first");
  return readFileSync(BOX_FILE, "utf8").trim();
};
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const inBox = (name: string, cmd: string) => sh(`msb exec ${name} -- sh -c ${q(cmd)}`);

/** What must match production, derived from src/ so a later change to the launcher reaches the bench. */
function prodConfig() {
  const allowed = /--allowedTools (.+?) \$\(/.exec(claudeLaunchSh(false))?.[1];
  if (!allowed) throw new Error("could not read --allowedTools from claudeLaunchSh");
  return {
    allowedTools: allowed.split(" "),
    sysPrompt: `${claudeDriver.systemPrompt} ${MOLI_PROMPT_HINT}`,
    mcpWaitMs: CLAUDE_MCP_WAIT_MS,
    timeoutMs: 15 * 60_000,
    env: {} as Record<string, string>,
  };
}

/** Copy a local directory into the box: tar locally, scp to the host, msb copy, untar. */
function ship(name: string, localDir: string, boxDir: string) {
  // Relative paths only: Git's tar and scp read "C:\..." as host:path.
  const tgz = `bench-cm-${process.pid}.tgz`;
  execFileSync("tar", ["czf", `../${tgz}`, "."], { cwd: localDir });
  const remote = `/tmp/${name}.tgz`;
  execFileSync("scp", ["-q", tgz, `${HOST}:${remote}`], { cwd: dirname(localDir) });
  sh(`msb copy -q ${remote} ${name}:/tmp/ship.tgz && rm -f ${remote}`);
  inBox(name, `mkdir -p ${boxDir} && tar xzf /tmp/ship.tgz -C ${boxDir} && rm /tmp/ship.tgz`);
  rmSync(join(dirname(localDir), tgz), { force: true });
}

function up() {
  mkdirSync(OUT, { recursive: true });
  // A recorded box is provisioned again (every step below is idempotent) rather than booted twice.
  const name = existsSync(BOX_FILE) ? box() : `bench-cm-${Date.now()}`;
  writeFileSync(BOX_FILE, name + "\n");
  // The production box shape (src/msb.ts createBox): 1G, 2 vCPU, public egress. Long timers: a full
  // bench is 60 sequential runs.
  const state = sh(`msb ls | awk '$1 == "${name}" {print $3}'`).trim();
  if (state !== "running") sh(`msb run -d --name ${name} -m 1G --max-memory 1G -c 2 --root-disk 4G --net public --idle-timeout 6h --max-duration 8h --pull never ${IMAGE} -- sleep infinity`);
  console.log(`box ${name} from ${IMAGE}`);
  console.log(inBox(name, "claude --version; node --version; npm i -g @modelcontextprotocol/sdk >/dev/null 2>&1 && npm ls -g @modelcontextprotocol/sdk | grep sdk").trim());

  // The deployed hooks and settings, copied read-only from a running pool box.
  const pool = sh(`msb ls | awk '$1 ~ /^pool-/ && $3 == "running" {print $1; exit}'`).trim();
  if (!pool) throw new Error("no running pool box to copy hooks from");
  const hooks = sh(`msb exec ${pool} -- sh -c 'tar czf - -C /root/.claude settings.json hooks | base64 -w0'`).trim();
  const stage = mkdtempSync(join(tmpdir(), "bench-cm-"));
  writeFileSync(join(stage, "hooks.tgz"), Buffer.from(hooks, "base64"));
  ship(name, stage, "/tmp/hooks");
  inBox(name, "mkdir -p /root/.claude && tar xzf /tmp/hooks/hooks.tgz -C /root/.claude && rm -rf /tmp/hooks && ls /root/.claude/hooks | tr '\\n' ' '");
  console.log(`hooks from ${pool}`);
  rmSync(stage, { recursive: true, force: true });

  // The compiled code-mode server (what codeModeFiles() ships), from dist.
  const cm = mkdtempSync(join(tmpdir(), "bench-cm-"));
  writeFileSync(join(cm, "package.json"), JSON.stringify({ type: "module" }) + "\n");
  for (const m of CODE_MODE_MODULES) copyFileSync(join(ROOT, "dist", "code-mode", "box", m), join(cm, m));
  ship(name, cm, CODE_MODE_DIR);
  rmSync(cm, { recursive: true, force: true });
  console.log(inBox(name, `node ${CODE_MODE_DIR}/server.js --check /dev/null 2>&1 | head -1`).trim());

  shipBench(name);
  // The model key, straight from the controller container into the box (600), never on this disk.
  sh(`K=$(docker exec agent-sandbox printenv ANTHROPIC_API_KEY) && msb exec ${name} -- sh -c "umask 077; printf %s \\"$K\\" > /root/bench/key"`);
  console.log("ready");
}

/** The bench files + config.json; re-run by `run` so edits to the tasks reach the box. */
function shipBench(name: string) {
  const stage = mkdtempSync(join(tmpdir(), "bench-cm-"));
  for (const f of SHIPPED) copyFileSync(join(HERE, f), join(stage, f));
  const cfg = prodConfig();
  const env = sh(`docker exec agent-sandbox sh -c 'printf "%s\\n%s" "$ANTHROPIC_BASE_URL" "$ANTHROPIC_MODEL"'`).trim().split("\n");
  cfg.env = { ANTHROPIC_BASE_URL: env[0], ANTHROPIC_MODEL: env[1], TMPDIR: "/root/.tmp" };
  writeFileSync(join(stage, "config.json"), JSON.stringify(cfg, null, 1));
  ship(name, stage, "/root/bench");
  inBox(name, "mkdir -p /root/.tmp");
  rmSync(stage, { recursive: true, force: true });
  console.log(`model ${env[1]} via ${env[0]}`);
}

function run(args: string[]) {
  const name = box();
  shipBench(name);
  const a = args.map(q).join(" ");
  inBox(name, `cd /root/bench && (setsid nohup node box-run.mjs ${a} >> /root/bench/run.log 2>&1 < /dev/null &) ; sleep 1; tail -2 /root/bench/run.log`);
  console.log(`started in ${name}; follow with: npx tsx bench/code-mode/bench.ts status`);
}

function pull() {
  const name = box();
  const dest = join(OUT, name);
  mkdirSync(dest, { recursive: true });
  inBox(name, `cd /root/bench && tar czf /tmp/out.tgz ${process.env.BENCH_OUT || "out"} run.log config.json`);
  const remote = `/tmp/${name}-out.tgz`;
  sh(`msb copy -q ${name}:/tmp/out.tgz ${remote}`);
  execFileSync("scp", ["-q", `${HOST}:${remote}`, "out.tgz"], { cwd: dest });
  sh(`rm -f ${remote}`);
  execFileSync("tar", ["xzf", "out.tgz"], { cwd: dest });
  rmSync(join(dest, "out.tgz"));
  console.log(`pulled into ${dest}`);
}

function down() {
  const name = box();
  if (!/^bench-cm-\d+$/.test(name)) throw new Error(`refusing to remove ${name}: not a bench box`);
  const pinned = sh(`test -e ~/.agent-sandbox/keep/${name} && echo pinned || true`).trim();
  if (pinned) throw new Error(`refusing to remove ${name}: pinned in ~/.agent-sandbox/keep`);
  sh(`msb stop ${name} >/dev/null 2>&1; msb rm ${name}`);
  rmSync(BOX_FILE);
  console.log(`removed ${name}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "up") up();
else if (cmd === "run") run(rest);
else if (cmd === "status") console.log(inBox(box(), "tail -n 15 /root/bench/run.log; echo; ls /root/bench/out | grep -c jsonl"));
else if (cmd === "pull") pull();
else if (cmd === "down") down();
else if (cmd === "exec") console.log(inBox(box(), rest.join(" ")));
else {
  console.error("usage: bench.ts up | run [--tasks T1,T2] [--modes A,B] [--runs 5] | status | pull | down | exec <cmd>");
  process.exit(2);
}
