/**
 * Thread titles. A run's first message is often a paragraph ("review latest pr in this and give me
 * points. Also see how we can improve…"); the sidebar, fleet and header want a name. The side-chat
 * helper inside the sandbox (the same read-only Claude that answers "side questions") writes one —
 * three to six words — once per run. Titles live on the VPS host next to the run memory so they
 * survive controller restarts, and are cached here for a minute.
 */
import type { Config } from "./config.js";
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";
import { askInBox, knownStopped } from "./msb.js";
import { redactShapes } from "./redact.js";

const DIR = '"$HOME/.agent-sandbox/titles"';
const NAME_RE = /^[\w.-]+$/;

/** Normalise the helper's reply into a title: first line, no quotes/trailing period, ≤ 60 chars. */
export function cleanTitle(raw: string): string {
  // First real line: skip chatty preambles ("Sure!", "Here is a title:") but keep "Title: …".
  let t = raw.split("\n").map((l) => l.trim()).find((l) => l && !/^(here|sure|okay|ok|certainly)\b/i.test(l)) ?? "";
  t = t.replace(/^[#*_\-–>\s]+/, "").replace(/[*_]+$/, "").replace(/^["'“‘`]+|["'”’`]+$/g, "").replace(/[.:;]+$/, "").trim();
  t = t.replace(/^title\s*[:\-–]\s*/i, "");
  if (t.length > 60) t = `${t.slice(0, 59).replace(/\s+\S*$/, "")}…`;
  return t;
}

export function titlePrompt(task: string): string {
  return (
    `Write a short title (3 to 6 words, sentence case, no quotes, no trailing period) that names the goal of ` +
    `this task for a sidebar. Reply with the title only.\n\nTask:\n${task.slice(0, 1500)}`
  );
}

const cache = new Map<string, { titles: Record<string, string>; at: number }>();
const CACHE_KEY = "titles";
const TTL = 60_000;

export async function loadTitles(cfg: Config): Promise<Record<string, string>> {
  const c = cache.get(CACHE_KEY);
  if (c && Date.now() - c.at < TTL) return c.titles;
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `cd ${DIR} 2>/dev/null || exit 0; for f in *; do [ -f "$f" ] && printf '%s\\t%s\\n' "$f" "$(head -c 200 "$f" | tr '\\n' ' ')"; done`], { check: false });
  const titles: Record<string, string> = {};
  for (const line of (r.stdout ?? "").split("\n")) {
    const i = line.indexOf("\t");
    if (i > 0) titles[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  cache.set(CACHE_KEY, { titles, at: Date.now() });
  return titles;
}

export async function saveTitle(cfg: Config, box: string, title: string): Promise<void> {
  if (!NAME_RE.test(box)) throw new Error("invalid box name");
  await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `mkdir -p ${DIR} && chmod 700 ${DIR} && printf '%s' ${shellQuote(title)} > ${DIR}/${shellQuote(box)}`]);
  const c = cache.get(CACHE_KEY);
  if (c) c.titles[box] = title;
}

export async function forgetTitle(cfg: Config, box: string): Promise<void> {
  if (!NAME_RE.test(box)) return;
  await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `rm -f ${DIR}/${shellQuote(box)}`], { check: false });
  cache.get(CACHE_KEY)?.titles && delete cache.get(CACHE_KEY)!.titles[box];
}

const inflight = new Map<string, Promise<string | undefined>>();

/**
 * Ask the in-box helper for a title and store it. One attempt in flight per box; a sleeping box is
 * left alone (waking it just for a name is not worth a boot). Returns the title, or undefined.
 */
export function generateTitle(cfg: Config, box: string, task: string): Promise<string | undefined> {
  const running = inflight.get(box);
  if (running) return running;
  const p = (async () => {
    if (!task.trim() || knownStopped(box)) return undefined;
    const r = await askInBox(cfg, box, titlePrompt(task), { newThread: true });
    const title = cleanTitle(redactShapes(r.answer ?? ""));
    if (!title || title.length < 3) return undefined;
    await saveTitle(cfg, box, title);
    return title;
  })().finally(() => inflight.delete(box));
  inflight.set(box, p);
  return p;
}
