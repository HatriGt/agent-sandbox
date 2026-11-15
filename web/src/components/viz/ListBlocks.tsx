import * as React from "react";
import { AlertTriangle, Check, Clock, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { nodeText } from "@/lib/viz";
import type { Definition, StatusItem } from "@/lib/viz-auto-types";
import { RollNumber, useRowEntrance } from "./motion";
import { toneStyle, type Tone } from "./tone";
import { TallyItem, VIZ_FOOTER } from "./VizFrame";

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
  const entrance = useRowEntrance(items.map((d) => d.term));
  return (
    <dl className="viz-frame-in viz-card not-prose my-3 grid grid-cols-[minmax(6rem,max-content)_1fr] overflow-hidden @max-[26rem]:grid-cols-1">
      {items.map((d, i) => {
        const e = entrance(d.term);
        // Each pair is one row with a shared hairline above it; the term column stays aligned.
        const row = cn("px-4 py-2.5", i > 0 && "border-border/60 border-t", e.className);
        return (
          <div key={d.term} className="contents">
            <dt className={cn(row, "text-foreground text-body font-medium @max-[26rem]:pb-0")} style={e.style}>{d.term}</dt>
            <dd className={cn(row, "text-muted-foreground m-0 min-w-0 text-body leading-relaxed text-pretty @max-[26rem]:border-t-0 @max-[26rem]:pt-0.5 @min-[26rem]:pl-0")} style={e.style}>{d.detail}</dd>
          </div>
        );
      })}
    </dl>
  );
}

const STATE: Record<StatusItem["state"], { icon: React.ReactNode; tone: Tone; hue: string; word: string }> = {
  ok: { icon: <Check className="viz-check size-3" strokeWidth={2.75} />, tone: "ok", hue: "var(--ok)", word: "ok" },
  fail: { icon: <X className="viz-check size-3" strokeWidth={2.75} />, tone: "fail", hue: "var(--destructive)", word: "failed" },
  warn: { icon: <AlertTriangle className="viz-mark size-3" strokeWidth={2.25} />, tone: "warn", hue: "var(--warn)", word: "warning" },
  pending: { icon: <Clock className="viz-mark size-3" strokeWidth={2.25} />, tone: "neutral", hue: "var(--faint)", word: "pending" },
  info: { icon: <Info className="viz-mark size-3" strokeWidth={2.25} />, tone: "live", hue: "var(--live)", word: "info" },
};

export function StatusListBlock({ items }: { items: StatusItem[] }) {
  const tally = (["ok", "fail", "warn", "pending"] as const).map((s) => [s, items.filter((i) => i.state === s).length] as const).filter(([, n]) => n > 0);
  const entrance = useRowEntrance(items.map((_, i) => String(i)));
  return (
    <div className="viz-frame-in viz-card not-prose my-3 overflow-hidden">
      <ul className="m-0 list-none p-0">
        {items.map((it, i) => {
          const s = STATE[it.state];
          const e = entrance(String(i));
          return (
            <li key={i} className={cn("flex items-start gap-3 px-4 py-2 text-body", i > 0 && "border-border/60 border-t", e.className)} style={e.style}>
              {/* Keyed by state: a flip mounts a fresh glyph, so it draws / sharpens in once. */}
              <span key={it.state} className="viz-tone mt-0.5 grid size-5 shrink-0 place-items-center rounded-full" style={toneStyle(s.tone)} aria-label={s.word} role="img">
                {s.icon}
              </span>
              <span className={cn("min-w-0 leading-relaxed text-pretty", it.state === "pending" ? "text-muted-foreground" : "text-foreground")}>{it.text}</span>
            </li>
          );
        })}
      </ul>
      <div className={VIZ_FOOTER}>
        {tally.map(([s, n]) => (
          <TallyItem key={s} hue={STATE[s].hue} n={<RollNumber text={String(n)} />} word={STATE[s].word} />
        ))}
      </div>
    </div>
  );
}
