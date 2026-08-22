/**
 * Put a question to a box's READ-ONLY co-pilot from the VPS shell — the CLI twin of the `ask` MCP
 * tool, so `monitor` / `watch` / `ask` all have one. Not part of the MCP server.
 *
 * Usage: node dist/ask-cli.js <session> "your question" [--new]
 *    or: npm run ask -- <session> "your question"
 *
 * With no question it reads one per line from stdin, so you can hold a running conversation with
 * the co-pilot while the driver agent keeps working. The driver is never interrupted either way.
 */
import { createInterface } from "node:readline";
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { askInBox, driverStateLine } from "./msb.js";
import { formatAsk } from "./ask.js";
import type { Config } from "./config.js";

interface Args {
  session: string;
  question: string;
  newThread: boolean;
}

function parseArgs(argv: string[]): Args {
  const rest = argv.slice(2);
  let session = "";
  const words: string[] = [];
  let newThread = false;
  for (const a of rest) {
    if (a === "--new") newThread = true;
    else if (!session && !a.startsWith("--")) session = a;
    else if (!a.startsWith("--")) words.push(a);
  }
  return { session, question: words.join(" "), newThread };
}

/** One turn: ask, then print it with the driver's state for context. */
async function turn(cfg: Config, session: string, question: string, newThread: boolean) {
  const [result, driverState] = await Promise.all([
    askInBox(cfg, session, question, { newThread }),
    driverStateLine(cfg, session),
  ]);
  console.log(`\n${formatAsk({ ...result, driverState })}\n`);
}

async function main() {
  const { session, question, newThread } = parseArgs(process.argv);
  if (!session) {
    console.error('Usage: npm run ask -- <session> "your question" [--new]');
    process.exit(2);
  }
  loadDotEnv();
  const cfg = loadConfig();

  if (question) {
    await turn(cfg, session, question, newThread);
    return;
  }

  // Interactive: each line is a follow-up on the same co-pilot thread (only the first honours --new).
  console.log(`asking ${session} — one question per line, Ctrl-C to quit`);
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
  let first = true;
  rl.prompt();
  for await (const line of rl) {
    const q = line.trim();
    if (!q) {
      rl.prompt();
      continue;
    }
    try {
      await turn(cfg, session, q, first && newThread);
    } catch (e) {
      console.error("[ask] FAILED:", (e as Error).message);
    }
    first = false;
    rl.prompt();
  }
}

main().catch((e) => {
  console.error("[ask] FAILED:", e);
  process.exit(1);
});
