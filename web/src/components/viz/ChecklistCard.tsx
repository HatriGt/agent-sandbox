import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { RollNumber, useRowEntrance } from "./motion";

/**
 * GFM task lists (`- [x] done / - [ ] todo`) auto-upgrade to this: a quiet card with a progress
 * line ("3 of 5 done") and drawn check/pending marks instead of dead disabled checkboxes. A done
 * item's check draws its stroke once on first paint (or when it flips to done while streaming);
 * nested content inside an item renders untouched.
 */
export function ChecklistCard({ items }: { items: { checked: boolean; content: React.ReactNode }[] }) {
  const done = items.filter((i) => i.checked).length;
  const entrance = useRowEntrance(items.map((_, i) => String(i)));
  return (
    <div className="viz-frame-in bg-card not-prose my-3 overflow-hidden rounded-xl border">
      <div className="flex h-8 items-center gap-3 border-b px-3">
        <span className="text-muted-foreground shrink-0 text-micro font-medium tabular-nums">
          <RollNumber text={String(done)} /> of {items.length} done
        </span>
        <span className="bg-muted h-1 min-w-0 flex-1 overflow-hidden rounded-full" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={items.length} aria-label="done">
          <span className="bg-ok block h-full rounded-full viz-tween-w" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((item, i) => {
          const e = entrance(String(i));
          return (
            <li key={i} className={cn("border-border/60 flex items-start gap-2.5 px-3 py-2 text-meta not-first:border-t", e.className)} style={e.style}>
              {/* Keyed by state: a flip to done mounts a fresh mark, so its check draws once. */}
              <span
                key={item.checked ? "done" : "todo"}
                className={cn(
                  "mt-px grid size-4 shrink-0 place-items-center rounded-full",
                  item.checked ? "viz-tone text-ok" : "border-line-strong border border-dashed"
                )}
                style={item.checked ? ({ "--tone": "var(--ok)", ...e.style } as React.CSSProperties) : undefined}
                aria-label={item.checked ? "done" : "pending"}
                role="img"
              >
                {item.checked && <Check className="viz-check size-2.5" strokeWidth={3} aria-hidden />}
              </span>
              <span className={cn("min-w-0 text-pretty", item.checked ? "text-muted-foreground" : "text-foreground")}>{item.content}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Extract task-list items from a markdown `ul`'s children; null when it isn't a task list. */
export function taskItems(children: React.ReactNode): { checked: boolean; content: React.ReactNode }[] | null {
  const items: { checked: boolean; content: React.ReactNode }[] = [];
  let checkboxes = 0;
  for (const li of React.Children.toArray(children)) {
    if (!React.isValidElement<{ children?: React.ReactNode; className?: string }>(li)) continue;
    const kids = React.Children.toArray(li.props.children);
    let checked: boolean | null = null;
    const content: React.ReactNode[] = [];
    for (const k of kids) {
      if (React.isValidElement<{ type?: string; checked?: boolean }>(k) && k.type === "input" && k.props.type === "checkbox") {
        checked = Boolean(k.props.checked);
        checkboxes++;
      } else content.push(k);
    }
    items.push({ checked: checked ?? false, content });
  }
  // Only upgrade when EVERY item is a task item — mixed lists stay stock markdown.
  if (items.length === 0 || checkboxes !== items.length) return null;
  return items;
}
