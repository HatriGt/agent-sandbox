/**
 * What the operator typed vs what was delivered.
 *
 * A message reaches the agent with machinery attached: a leading `/skill` token, a `Files: @a @b`
 * line for the file chips, a `Referenced files (under /workspace): …` line that spells every
 * mention as an absolute path, and an `Attached images (open with the Read tool): …` list. The agent
 * needs all of it; a person reading the thread needs none of it as prose. This splits a delivered
 * message back into the parts the composer showed, so the bubble in the thread has the same face the
 * message had before it was sent — and the optimistic echo and the durable log line render alike.
 */
export interface YouMessage {
  /** The words, without any of the machinery. */
  body: string;
  /** The `/skill` the message invokes, if it leads with one. */
  skill: string | null;
  /** Workspace paths attached as chips (not the `@path` mentions typed inline; those stay in the body). */
  files: string[];
}

const IMAGES_TAIL = /\n*Attached images? \(open with the Read tool\):[\s\S]*$/;
const REFERENCED_TAIL = /\n*Referenced files \(under \/workspace\): [^\n]*$/;
const FILES_TAIL = /(?:^|\n+)Files: ((?:@\S+ ?)+)$/;
const SKILL_HEAD = /^\/([a-z0-9][a-z0-9-]{0,49})(?:\s+([\s\S]*))?$/;

export function parseYouMessage(text: string): YouMessage {
  let rest = text.replace(IMAGES_TAIL, "").replace(REFERENCED_TAIL, "").trimEnd();
  let files: string[] = [];
  const f = rest.match(FILES_TAIL);
  if (f) {
    files = [...new Set(f[1].trim().split(/\s+/).map((p) => p.slice(1)).filter(Boolean))];
    rest = rest.slice(0, f.index).trimEnd();
  }
  rest = rest.trim();
  // A skill token alone, or followed by the words. `/etc/hosts is wrong` is prose, not a skill.
  const s = rest.match(SKILL_HEAD);
  if (s) return { body: (s[2] ?? "").trim(), skill: s[1], files };
  return { body: rest, skill: null, files };
}

/** A piece of the body: prose, or a passage quoted from the conversation ("Quote in reply"). */
export type BodyPart = { text: string } | { quote: string };

/**
 * The body split into prose and quoted passages. A quote travels as a paragraph of `> ` lines (the
 * composer expands each pill on send); the bubble folds every such paragraph back into a pill, so
 * the thread shows the message with the face it had in the composer. Prose keeps its own line
 * breaks; the blank lines that framed a quote are dropped, the pill brings its own spacing.
 */
export function splitQuotes(body: string): BodyPart[] {
  const out: BodyPart[] = [];
  let text: string[] = [];
  let quote: string[] | null = null;
  const flushText = () => {
    const t = text.join("\n").replace(/^\n+|\n+$/g, "");
    if (t) out.push({ text: t });
    text = [];
  };
  const flushQuote = () => {
    if (!quote) return;
    const q = quote.join("\n").trim();
    if (q) out.push({ quote: q });
    quote = null;
  };
  for (const line of body.split("\n")) {
    const m = line.match(/^>(?: ?(.*))?$/);
    if (m) {
      if (!quote) {
        flushText();
        quote = [];
      }
      quote.push(m[1] ?? "");
    } else {
      flushQuote();
      text.push(line);
    }
  }
  flushQuote();
  flushText();
  return out;
}
