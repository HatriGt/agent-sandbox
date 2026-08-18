/**
 * Live over-the-shoulder view of one sandbox — redraws every couple seconds so you can watch the
 * agent work in real time. Not part of the MCP server.
 *
 * Usage: node dist/watch-cli.js <session> [--lines N] [--interval MS]
 *    or: npm run watch -- <session>
 *
 * Stops on its own when the box is gone; Ctrl-C to quit anytime.
 */
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { gatherWatch } from "./msb.js";
import { formatWatch } from "./monitor.js";

interface Args {
  session: string;
  lines: number;
  interval: number;
}

function parseArgs(argv: string[]): Args {
  const rest = argv.slice(2);
  let session = "";
  let lines = 40;
  let interval = 2000;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--lines") lines = Number(rest[++i]) || lines;
    else if (a === "--interval") interval = Number(rest[++i]) || interval;
    else if (!a.startsWith("--")) session = a;
  }
  return { session, lines, interval };
}

/** Clear the screen + move cursor home so each frame overwrites the last (in-place redraw). */
function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { session, lines, interval } = parseArgs(process.argv);
  if (!session) {
    console.error("Usage: npm run watch -- <session> [--lines N] [--interval MS]");
    process.exit(2);
  }
  loadDotEnv();
  const cfg = loadConfig();

  // Loop until the box is gone (missing) or the run is done AND not waiting on a question.
  for (;;) {
    const snap = await gatherWatch(cfg, session, lines);
    clearScreen();
    process.stdout.write(
      `watching ${session} — refresh ${interval}ms — Ctrl-C to quit\n\n${formatWatch(snap)}\n`
    );
    if (snap.boxStatus === "missing") break;
    if (snap.runState === "done") {
      process.stdout.write(`\n(run finished, exit=${snap.exitCode ?? "?"}) — stopping watch.\n`);
      break;
    }
    await sleep(interval);
  }
}

main().catch((e) => {
  console.error("[watch] FAILED:", e);
  process.exit(1);
});
