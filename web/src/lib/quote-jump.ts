/**
 * A passage quoted from the conversation into the composer: its text, and the `data-turn` row it was
 * selected in so the jump back looks there first.
 */
export interface QuoteRef {
  readonly id: string;
  readonly text: string;
  readonly turn?: string;
}

/** The pill's label: the start of the quote on one line, cut at a word near `max` characters. */
export function quoteLabel(text: string, max = 36): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** The `data-turn` row a DOM node sits in, if any. */
export function turnOf(node: Node | null): string | undefined {
  const el = node instanceof Element ? node : node?.parentElement;
  return el?.closest<HTMLElement>("[data-turn]")?.dataset.turn ?? undefined;
}

const HIGHLIGHT = "quote-jump";

/**
 * Scrolls the conversation to the quoted passage and highlights it for a moment. Matches on the
 * quote's first line with whitespace collapsed (a selection across blocks reads with newlines the
 * DOM text does not have). Looks in the quote's own row first, then the whole conversation; false
 * when the passage is no longer there.
 */
export function jumpToQuote(root: HTMLElement | null, quote: QuoteRef): boolean {
  if (!root) return false;
  const needle = norm(quote.text.split("\n").find((l) => l.trim()) ?? "").slice(0, 160).trim();
  if (!needle) return false;
  const row = quote.turn ? root.querySelector<HTMLElement>(`[data-turn="${CSS.escape(quote.turn)}"]`) : null;
  const range = (row && findText(row, needle)) || findText(root, needle);
  if (!range) {
    if (!row) return false;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }
  const target = range.startContainer.parentElement;
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  flash(range, target);
  return true;
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ");
}

/** A Range over the first occurrence of `needle` in `root`'s text, whitespace runs compared as one space. */
function findText(root: HTMLElement, needle: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let flat = "";
  const map: [Text, number][] = [];
  let lastSpace = true;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const v = n.data;
    for (let i = 0; i < v.length; i++) {
      const ws = /\s/.test(v[i]);
      if (ws && lastSpace) continue;
      flat += ws ? " " : v[i];
      map.push([n, i]);
      lastSpace = ws;
    }
  }
  const at = flat.indexOf(needle);
  if (at === -1) return null;
  const [sn, so] = map[at];
  const [en, eo] = map[at + needle.length - 1];
  const r = document.createRange();
  r.setStart(sn, so);
  r.setEnd(en, eo + 1);
  return r;
}

let clear = 0;
function flash(range: Range, el: HTMLElement | null) {
  window.clearTimeout(clear);
  const reg = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const Hl = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (reg && Hl) {
    reg.set(HIGHLIGHT, new Hl(range));
    clear = window.setTimeout(() => reg.delete(HIGHLIGHT), 2200);
    return;
  }
  // No Custom Highlight API: flash the block the passage starts in.
  if (!el) return;
  el.classList.add("quote-jump-flash");
  clear = window.setTimeout(() => el.classList.remove("quote-jump-flash"), 2200);
}
