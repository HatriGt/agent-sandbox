import * as React from "react";
import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * GFM task lists (`- [x] done / - [ ] todo`) auto-upgrade to this: a quiet card with a progress
 * line ("3 of 5") and drawn check/pending glyphs instead of dead disabled checkboxes. Nested
 * content inside an item renders untouched.
 */
export function ChecklistCard({ items }: { items: { checked: boolean; content: React.ReactNode }[] }) {
  const done = items.filter((i) => i.checked).length;
  return (
    <div className="bg-card not-prose my-3 rounded-xl border">
      <div className="flex h-8 items-center gap-2 border-b px-3">
        <span className="text-muted-foreground text-micro font-medium tabular-nums">
          {done} of {items.length} done
        </span>
        <span className="bg-muted h-1 min-w-0 flex-1 overflow-hidden rounded-full" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={items.length}>
          <span
            className="bg-ok block h-full rounded-full transition-[width] duration-300"
            style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
          />
        </span>
      </div>
      <ul className="flex list-none flex-col gap-1 px-3 py-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-meta">
            {item.checked ? (
              <Check className="text-ok mt-0.5 size-3.5 shrink-0" aria-label="done" />
            ) : (
              <Circle className="text-faint mt-0.5 size-3.5 shrink-0" aria-label="pending" />
            )}
            <span className={cn("min-w-0", item.checked && "text-muted-foreground")}>{item.content}</span>
          </li>
        ))}
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
