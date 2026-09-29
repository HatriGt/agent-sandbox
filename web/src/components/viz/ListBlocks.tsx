import * as React from "react";
import { AlertTriangle, Check, Clock, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { nodeText } from "@/lib/viz";
import type { Definition, StatusItem } from "@/lib/viz-auto-types";

/**
 * Upgrades for ORDINARY markdown lists — no fence, no cooperation from the agent. A list whose
 * every item is `Term — detail` becomes a definition grid; one whose every item opens with a
 * status glyph (✅ ❌ ⚠️ ⏳) becomes a status list with a tally. Mixed lists stay stock markdown.
 */

/** Plain text of every `<li>` react-markdown produced, or null if the list has anything odd (nested lists, checkboxes). */
export function listItemTexts(children: React.ReactNode): string[] | null {
  const out: string[] = [];
  for (const li of React.Children.toArray(children)) {
    if (!React.isValidElement<{ children?: React.ReactNode }>(li)) continue;
    const kids = React.Children.toArray(li.props.children);
    if (kids.some((k) => React.isValidElement<{ type?: string }>(k) && (k.type === "ul" || k.type === "ol" || (k.type === "input" && k.props.type === "checkbox")))) return null;
    // A `<strong>` term must survive as markers so the parser can see it: **Term** detail.
    const text = kids.map((k) => (React.isValidElement<{ children?: React.ReactNode }>(k) && k.type === "strong" ? `**${nodeText(k.props.children)}**` : nodeText(k))).join("").trim();
    if (!text) return null;
    out.push(text);
  }
  return out.length ? out : null;
}

export function DefinitionListBlock({ items }: { items: Definition[] }) {
  return (
    <dl className="not-prose my-3 grid grid-cols-[minmax(6rem,max-content)_1fr] gap-x-6 gap-y-2.5 rounded-xl border px-4 py-3">
      {items.map((d) => (
        <div key={d.term} className="contents">
          <dt className="text-foreground text-body font-medium">{d.term}</dt>
          <dd className="text-muted-foreground m-0 min-w-0 text-body leading-relaxed">{d.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

const STATE: Record<StatusItem["state"], { icon: React.ReactNode; tone: string; word: string }> = {
  ok: { icon: <Check className="size-3" strokeWidth={3} />, tone: "bg-ok/12 text-ok", word: "ok" },
  fail: { icon: <X className="size-3" strokeWidth={3} />, tone: "bg-destructive/12 text-destructive", word: "failed" },
  warn: { icon: <AlertTriangle className="size-3" strokeWidth={2.5} />, tone: "bg-attention/25 text-attention-text", word: "warning" },
  pending: { icon: <Clock className="size-3" strokeWidth={2.5} />, tone: "bg-muted text-muted-foreground", word: "pending" },
  info: { icon: <Info className="size-3" strokeWidth={2.5} />, tone: "bg-live/12 text-live", word: "info" },
};

export function StatusListBlock({ items }: { items: StatusItem[] }) {
  const tally = (["ok", "fail", "warn", "pending"] as const).map((s) => [s, items.filter((i) => i.state === s).length] as const).filter(([, n]) => n > 0);
  return (
    <div className="not-prose my-3 overflow-hidden rounded-xl border">
      <ul className="m-0 list-none p-0">
        {items.map((it, i) => {
          const s = STATE[it.state];
          return (
            <li key={i} className={cn("flex items-start gap-3 px-4 py-2 text-body", i > 0 && "border-t")}>
              <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", s.tone)} aria-label={s.word}>
                {s.icon}
              </span>
              <span className={cn("min-w-0 leading-relaxed", it.state === "pending" ? "text-muted-foreground" : "text-foreground")}>{it.text}</span>
            </li>
          );
        })}
      </ul>
      <div className="text-muted-foreground flex items-center gap-3 border-t px-4 py-1.5 text-micro">
        {tally.map(([s, n], i) => (
          <React.Fragment key={s}>
            {i > 0 && <span className="opacity-40">·</span>}
            <span className="tabular-nums">
              {n} {STATE[s].word}
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
