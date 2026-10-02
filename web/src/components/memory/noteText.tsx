import * as React from "react";

/** Legacy answered-question notes: "asked <q> → operator chose <a>". */
const ASKED = /^asked\s+(.+?)\s*(?:→|->)\s*operator chose\s+(.+?)\s*$/is;

const sentence = (s: string) => {
  const t = s.trim().replace(/^["“”']+|["“”']+$/g, "");
  if (!t) return t;
  const c = t[0].toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(c) ? c : `${c}.`;
};

/** Split a note into a headline statement and an optional body; legacy Q→A notes lead with the answer. */
export function noteParts(text: string): { headline: string; body?: string; asked?: string } {
  const m = ASKED.exec(text.trim());
  if (m) return { headline: sentence(m[2]), asked: sentence(m[1].replace(/[?.]+$/, "")).replace(/\.$/, "?") };
  const t = text.trim();
  const nl = t.indexOf("\n");
  if (nl > 0) return { headline: t.slice(0, nl).trim(), body: t.slice(nl + 1).trim() || undefined };
  // One long line with several sentences: the first sentence is the headline.
  const s = /^(.{12,160}?[.!?])\s+(\S.*)$/s.exec(t);
  if (s && t.length > 90) return { headline: s[1], body: s[2] };
  return { headline: t };
}

/** Plain text with `code` spans rendered as code. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.length > 2 && p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="bg-muted text-foreground rounded px-1 py-px font-mono text-[0.88em]">
            {p.slice(1, -1)}
          </code>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </>
  );
}

/** A note as a clean statement: headline, then body; legacy answers show the question muted below. */
export function NoteStatement({ text }: { text: string }) {
  const { headline, body, asked } = noteParts(text);
  return (
    <>
      <p className="text-foreground text-body leading-snug font-medium break-words">
        <Inline text={headline} />
      </p>
      {body && (
        <p className="text-muted-foreground mt-0.5 text-meta leading-snug break-words whitespace-pre-line">
          <Inline text={body} />
        </p>
      )}
      {asked && (
        <p className="text-muted-foreground mt-0.5 text-meta leading-snug break-words">
          Asked: <Inline text={asked} />
        </p>
      )}
    </>
  );
}

/** One-line plain label for tooltips and aria. */
export const noteHeadline = (text: string) => noteParts(text).headline.replace(/`/g, "");
