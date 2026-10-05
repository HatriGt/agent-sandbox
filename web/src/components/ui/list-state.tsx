import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/** Shimmering rows shaped like the list they stand in for — never a spinner. */
export function ListSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <ul className={cn("divide-y", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-3.5 py-3">
          <Bar className="size-4 rounded" />
          <Bar className={cn("h-3", i % 2 ? "w-36" : "w-28")} />
          <Bar className="ml-auto hidden h-2.5 w-40 sm:block" />
        </li>
      ))}
    </ul>
  );
}

/** An empty list that teaches: icon · what would be here · why it is empty · the one way to fill it. */
export function ListEmpty({ icon: Icon, title, line, action, className }: { icon: LucideIcon; title: string; line?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("enter m-3 flex flex-col items-center rounded-lg border border-dashed px-6 py-8 text-center", className)}>
      <span className="bg-muted text-muted-foreground pop-in grid size-9 place-items-center rounded-full [animation-delay:80ms]">
        <Icon className="size-4" aria-hidden />
      </span>
      <p className="text-foreground mt-3 text-meta font-medium">{title}</p>
      {line && <p className="text-muted-foreground mt-0.5 max-w-sm text-meta">{line}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
