import * as React from "react";
import { api } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { inlineTokens, insertToken, removeToken, tokenEndingAt, type InlineToken } from "@/lib/inline-tokens";

/**
 * Tags inside a composer's text. A skill or a file picked from a menu is written into the message
 * where the caret is (`/review-pr`, `@src/app.ts`) and drawn as a pill in the line, so a message can
 * carry several of each and each one sits in the sentence that talks about it.
 *
 * A tag that came from a menu behaves as one piece: Backspace right after it removes all of it, and
 * the menu that made it does not reopen when the caret touches its end. A tag typed by hand is still
 * drawn as a pill, but stays ordinary text to edit.
 */
export function useInlineTags(value: string, setValue: (v: string) => void, el: () => HTMLTextAreaElement | null) {
  const skills = useCached("skills", (signal) => api.skills(signal));
  const names = React.useMemo(() => new Set((skills.data?.skills ?? []).filter((s) => s.enabled).map((s) => s.name)), [skills.data]);
  const tokens = React.useMemo(() => inlineTokens(value, names), [value, names]);
  const picked = React.useRef(new Set<string>());

  const place = (r: { value: string; caret: number }) => {
    setValue(r.value);
    requestAnimationFrame(() => {
      const t = el();
      if (!t) return;
      t.focus();
      t.setSelectionRange(r.caret, r.caret);
    });
  };

  /** Write a tag over `value[start, end)` (the `/query` or `@query` being typed), or at the caret. */
  const insert = (token: string, start?: number, end?: number) => {
    const caret = el()?.selectionStart ?? value.length;
    picked.current.add(token);
    place(insertToken(value, start ?? caret, end ?? start ?? caret, token));
  };

  /** From the Skills button: add the skill at the caret, or take it out if the message has it. */
  const toggleSkill = (name: string) => {
    const has = tokens.find((t) => t.kind === "skill" && t.name === name);
    if (has) place(removeToken(value, has));
    else insert(`/${name}`);
  };

  /** Is the caret resting at the end of a tag that a menu wrote? Then no menu should open for it. */
  const atPicked = (text: string, caret: number) => {
    const t = tokenEndingAt(inlineTokens(text, names), caret);
    return !!t && picked.current.has(text.slice(t.start, t.end));
  };

  /** Backspace right after a picked tag removes the whole tag. Returns true when it did. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (e.key !== "Backspace" || e.ctrlKey || e.metaKey || e.altKey) return false;
    const t = e.currentTarget;
    if (t.selectionStart !== t.selectionEnd) return false;
    const hit = tokenEndingAt(tokens, t.selectionStart);
    if (!hit || !picked.current.has(value.slice(hit.start, hit.end))) return false;
    e.preventDefault();
    place(removeToken(value, hit));
    return true;
  };

  const skillNames = React.useMemo(() => [...new Set(tokens.filter((t) => t.kind === "skill").map((t) => t.name))], [tokens]);

  return { tokens: tokens as InlineToken[], skillNames, insert, toggleSkill, atPicked, onKeyDown, reset: () => picked.current.clear() };
}
