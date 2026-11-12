/**
 * The pure half of the browser pane: which element is under the pointer, what to call it, and the
 * words that carry a picked element to the agent.
 */

/** One visible element of the page, as the sandbox reports it: x, y, width, height (viewport px), tag, label (`a.button`), text. */
export type MappedElement = [number, number, number, number, string, string, string];

export type PickDetail = {
  /** The shortest selector that matches this element alone. */
  selector?: string;
  text?: string;
  html?: string;
  component?: string;
  style?: { color?: string; background?: string; font?: string; weight?: string };
  attrs?: Record<string, string>;
} | null;

/**
 * The element a person means when they point: the smallest box that holds the pointer. The page
 * lists a parent before its children, so on equal area the later (deeper) element wins.
 */
export function hitTest(map: readonly MappedElement[], x: number, y: number): number {
  let best = -1;
  let bestArea = Infinity;
  for (let i = 0; i < map.length; i++) {
    const [ex, ey, w, h] = map[i];
    if (x < ex || y < ey || x > ex + w || y > ey + h) continue;
    const area = w * h;
    if (area <= bestArea) {
      best = i;
      bestArea = area;
    }
  }
  return best;
}

/** A component name worth telling the agent: a production build's `f` or `t` is noise. */
const realComponent = (name: string | undefined): string => (name && /^[A-Z][A-Za-z0-9_]{2,}$/.test(name) ? name : "");

/**
 * What the agent is told about a picked element, in one line beside its picture: where it is, the
 * selector that finds it, its visible text, its opening tag, and the component when the page is a
 * development build. The person never reads this; in the composer the element is a picture chip.
 */
export function elementNote(n: number, url: string, el: MappedElement, detail: PickDetail): string {
  const parts = [`selector \`${detail?.selector || el[5]}\``];
  const text = detail?.text || el[6];
  if (text) parts.push(`text "${text}"`);
  if (detail?.html) parts.push(`html \`${detail.html.replace(/`/g, "'")}\``);
  const comp = realComponent(detail?.component);
  if (comp) parts.push(`component ${comp}`);
  parts.push(`${el[2]} x ${el[3]} px${detail?.style?.font ? ` in ${detail.style.font}` : ""}`);
  return `Element ${n}, picked in the browser on ${url}: ${parts.join("; ")}.`;
}
