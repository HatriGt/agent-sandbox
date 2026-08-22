/**
 * A deliberately tiny inline-markdown tokenizer for agent prose.
 *
 * The agent writes markdown — `**Finished `/workspace/audit.md`**` — because it is a coding agent
 * and that is how it talks. Rendering that verbatim leaves asterisks and backticks on screen, which
 * reads like a broken template. Rendering it with a full markdown library would pull a parser (and
 * an HTML sanitiser) into a bundle that needs neither, and would invite raw HTML from model output
 * into the DOM.
 *
 * So: bold, inline code, and nothing else. Tokens out, React in the component — no HTML string ever
 * exists, so there is nothing to sanitise. Pure, so the server suite covers it.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "code"; value: string };

// Inline code first: a backtick span may contain asterisks that are not emphasis (`a * b`).
const TOKEN_RE = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g;

export function tokenizeInline(input: string): Inline[] {
  const src = String(input ?? "");
  const out: Inline[] = [];
  let last = 0;

  for (const m of src.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", value: src.slice(last, at) });
    if (m[1] !== undefined) out.push({ type: "code", value: m[1] });
    else out.push({ type: "strong", value: (m[2] ?? m[3])! });
    last = at + m[0].length;
  }
  if (last < src.length) out.push({ type: "text", value: src.slice(last) });

  // Never return an empty list for non-empty input.
  return out.length ? out : src ? [{ type: "text", value: src }] : [];
}

/** Strip markdown markers without rendering — for titles, `aria-label`s, and list previews. */
export function plainInline(input: string): string {
  return tokenizeInline(input)
    .map((t) => t.value)
    .join("");
}
