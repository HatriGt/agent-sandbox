import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, Lightbulb, OctagonAlert, ShieldAlert, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalloutKind } from "@/lib/viz-extra";

/**
 * Callouts: GitHub-style `> [!NOTE]` blockquote alerts auto-upgrade, and the ```note / ```warn /
 * ```error / ```success fences render the same card. Left accent border + icon + the kind named
 * in words — meaning never rides on the hue alone. Content stays rendered markdown.
 */
const KIND_META: Record<CalloutKind, { icon: React.ComponentType<{ className?: string }>; word: string; cls: string; bar: string }> = {
  note: { icon: Info, word: "Note", cls: "text-live", bar: "var(--live)" },
  tip: { icon: Lightbulb, word: "Tip", cls: "text-ok", bar: "var(--ok)" },
  important: { icon: ShieldAlert, word: "Important", cls: "text-sleep", bar: "var(--sleep)" },
  warning: { icon: AlertTriangle, word: "Warning", cls: "text-attention-text", bar: "var(--attention)" },
  caution: { icon: OctagonAlert, word: "Caution", cls: "text-destructive", bar: "var(--destructive)" },
  success: { icon: CheckCircle2, word: "Success", cls: "text-ok", bar: "var(--ok)" },
  error: { icon: XCircle, word: "Error", cls: "text-destructive", bar: "var(--destructive)" },
};

export function CalloutBlock({ kind, children }: { kind: CalloutKind; children: React.ReactNode }) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <aside
      className="bg-card not-prose my-3 rounded-xl border py-2.5 pr-4 pl-3.5"
      style={{ borderLeft: `3px solid ${meta.bar}` }}
      aria-label={meta.word}
    >
      <div className={cn("mb-1 flex items-center gap-1.5 text-micro font-semibold", meta.cls)}>
        <Icon className="size-3.5" aria-hidden />
        {meta.word}
      </div>
      <div className="text-foreground text-meta [&>p]:my-0 [&>p+p]:mt-1.5">{children}</div>
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
