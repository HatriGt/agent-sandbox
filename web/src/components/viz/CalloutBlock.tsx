import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, Lightbulb, OctagonAlert, ShieldAlert, XCircle } from "lucide-react";
import type { CalloutKind } from "@/lib/viz-extra";
import { Markdown } from "@/components/ui/markdown";

/**
 * Callouts: GitHub-style `> [!NOTE]` blockquote alerts auto-upgrade, and the ```note / ```warn /
 * ```error / ```success fences render the same aside.
 *
 * It reads as a marked paragraph, not a card: one tinted ground in the kind's hue (a few percent
 * over the page, with a hairline of the same hue instead of a border), a small round glyph that
 * carries the colour, and the kind named in words as the lead of the first sentence — "Note Two
 * claim references…" — so the text keeps the prose's size and rhythm and meaning never rides on
 * the hue alone. The old card-with-a-coloured-bar-and-a-shouted-label is the shape every docs
 * site ships; that is what read as boilerplate. Content stays rendered markdown.
 */
const KIND_META: Record<CalloutKind, { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; word: string; tint: string; ink: string }> = {
  note: { icon: Info, word: "Note", tint: "var(--live)", ink: "var(--live)" },
  tip: { icon: Lightbulb, word: "Tip", tint: "var(--ok)", ink: "var(--ok)" },
  important: { icon: ShieldAlert, word: "Important", tint: "var(--sleep)", ink: "var(--sleep)" },
  // The amber tint is light; its text token carries the glyph so it still reads on a light page.
  warning: { icon: AlertTriangle, word: "Warning", tint: "var(--warn)", ink: "var(--warn-text)" },
  caution: { icon: OctagonAlert, word: "Caution", tint: "var(--destructive)", ink: "var(--destructive)" },
  success: { icon: CheckCircle2, word: "Success", tint: "var(--ok)", ink: "var(--ok)" },
  error: { icon: XCircle, word: "Error", tint: "var(--destructive)", ink: "var(--destructive)" },
};

/**
 * `children`: already-rendered markdown (a `> [!NOTE]` blockquote's paragraphs). `source`: a fence's
 * raw markdown, rendered here with a `contents` wrapper so its paragraphs sit in the aside's own flow
 * and the first one can run on from the kind word.
 */
export function CalloutBlock({ kind, children, source }: { kind: CalloutKind; children?: React.ReactNode; source?: string }) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <aside
      // oklab, not oklch: the card is achromatic, and a hue interpolation towards its hue 0 turned
      // every tint pink. The hairline is a border in the same hue (one elevation cue, no shadow).
      className="not-prose enter my-3 flex gap-3 rounded-lg border border-[color-mix(in_oklab,var(--callout)_22%,transparent)] bg-[color-mix(in_oklab,var(--callout)_6%,var(--card))] px-3.5 py-3"
      style={{ "--callout": meta.tint, "--callout-ink": meta.ink } as React.CSSProperties}
      data-callout={kind}
      aria-label={meta.word}
    >
      <span
        className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--callout)_14%,transparent)] text-(--callout-ink)"
        aria-hidden
      >
        <Icon className="size-3" strokeWidth={2.25} />
      </span>
      {/* The kind word leads the first paragraph; later paragraphs, lists and tables stack under it. */}
      <div className="text-foreground/90 min-w-0 flex-1 text-body leading-[1.625] [&>div>p]:my-0 [&>div>p+p]:mt-1.5 [&>div>p:first-child+*]:mt-1.5 [&>p]:my-0 [&>p+p]:mt-1.5 [&>span+div>p:first-child]:inline [&>span+p]:inline [&>span+p+*]:mt-1.5">
        <span className="text-foreground mr-1.5 font-semibold">{meta.word}</span>
        {source !== undefined ? <Markdown className="contents">{source}</Markdown> : children}
      </div>
    </aside>
  );
}

/**
 * Detect a GitHub alert blockquote: first paragraph starts with `[!NOTE]` etc. Returns the kind
 * and the children with that marker stripped, or null for an ordinary blockquote.
 */
export function alertFromBlockquote(children: React.ReactNode, toKind: (name: string) => CalloutKind | null): { kind: CalloutKind; children: React.ReactNode } | null {
  const items = React.Children.toArray(children).filter((c) => c !== "\n");
  const first = items[0];
  if (!React.isValidElement<{ children?: React.ReactNode }>(first)) return null;
  const inner = React.Children.toArray(first.props.children);
  const lead = inner[0];
  if (typeof lead !== "string") return null;
  const m = lead.match(/^\s*\[!([A-Za-z]+)\]\s*\n?/);
  if (!m) return null;
  const kind = toKind(m[1]);
  if (!kind) return null;
  const stripped = lead.slice(m[0].length);
  const newFirst = React.cloneElement(first, undefined, ...(stripped ? [stripped] : []), ...inner.slice(1));
  return { kind, children: [newFirst, ...items.slice(1)] };
}
