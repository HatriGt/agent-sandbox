import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A page-level empty state that teaches: a glyph, what this surface will hold, how it gets filled,
 * and the one action that fills it. Optional `facts` — short "what happens next" rows — turn a
 * blank into an explanation (a "how it works" card, not a sad face). Dashed hairline so it reads
 * as a placeholder for content, never as content. `ListEmpty` is the inline-list sibling.
 */
export function EmptyState({
  icon: Icon,
  title,
  line,
  action,
  facts,
  tone = "default",
  className,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  line?: React.ReactNode;
  action?: React.ReactNode;
  facts?: { icon: LucideIcon; text: React.ReactNode }[];
  tone?: "default" | "destructive";
  className?: string;
}) {
  return (
    <div
      role={tone === "destructive" ? "alert" : undefined}
      className={cn("enter flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center", tone === "destructive" && "border-destructive/30 bg-destructive/5", className)}
    >
      <span className={cn("grid size-11 place-items-center rounded-full", tone === "destructive" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")} aria-hidden>
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <p className={cn("mt-4 text-lead font-medium", tone === "destructive" ? "text-destructive" : "text-foreground")}>{title}</p>
      {line && <p className="text-muted-foreground mt-1 max-w-[34em] text-meta">{line}</p>}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>}
      {facts && facts.length > 0 && (
        <ul className="mt-7 grid w-full max-w-md gap-2 text-left sm:grid-cols-1">
          {facts.map((f, i) => {
            const FIcon = f.icon;
            return (
              <li key={i} className="bg-card flex items-start gap-3 rounded-lg border px-3 py-2.5 text-meta">
                <span className="text-muted-foreground mt-0.5 shrink-0">
                  <FIcon className="size-3.5" aria-hidden />
                </span>
                <span className="text-muted-foreground min-w-0">{f.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
