/**
 * Partial parsing for fences that are still streaming in (docs/output-visualizers.md → "Live").
 *
 * The rule is the same as for finished fences — never invent data — with one more: never show a
 * value that is still being typed. A number cut at "12" of "123" would draw a wrong bar for a frame,
 * so both helpers cut back to the last value that is certainly complete.
 */

/** Line fences: every line but the last, which may still be growing (unless it already ended). */
export function completeLines(src: string): string {
  if (src.endsWith("\n")) return src.replace(/\n$/, "");
  const cut = src.lastIndexOf("\n");
  return cut < 0 ? "" : src.slice(0, cut);
}

/**
 * Close a JSON prefix into a parseable document holding only its finished values:
 * `{"x":["a","b` → `{"x":["a"]}`. Cuts back to the last completed value (after `,` `]` `}` or right
 * after an opening bracket), then closes every bracket still open. Returns null when nothing usable
 * has arrived yet.
 */
export function repairPartialJson(src: string): string | null {
  let inStr = false;
  let esc = false;
  let cut = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === ",") cut = i;
    else if (c === "]" || c === "}" || c === "[" || c === "{") cut = i + 1;
  }
  if (cut < 0) return null;
  const prefix = src.slice(0, cut).replace(/[\s,]+$/, "");
  // Re-walk the prefix to learn which brackets are still open.
  const stack: string[] = [];
  inStr = false;
  esc = false;
  for (const c of prefix) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") stack.pop();
  }
  // Cut points sit only after a finished value or an opening bracket, so the prefix can never end
  // in a dangling `"key":` — closing the open brackets is all that is left.
  if (inStr) return null;
  return prefix + stack.reverse().join("");
}
