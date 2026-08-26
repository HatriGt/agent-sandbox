import { cn } from "@/lib/utils";

/**
 * Placeholder for a thread whose first frame has not arrived. Shaped like the real thing — a task
 * bubble on the right, an agent label, prose lines, a step row, more prose — so the eye already
 * knows where everything will land. Shimmer sweeps once per 1.6s; static under reduced motion.
 */
export function ThreadSkeleton({ withTask = true }: { withTask?: boolean }) {
  return (
    <div className="flex flex-col gap-7" aria-busy="true" aria-label="Loading the conversation">
      {withTask ? null : (
        <div className="flex flex-col items-end gap-1.5">
          <Bar className="h-2.5 w-8" />
          <Bar className="h-11 w-[58%] rounded-2xl rounded-br-md" />
        </div>
      )}
      <div className="flex items-center gap-3">
        <Bar className="h-2.5 w-24" />
        <span className="bg-border h-px flex-1" />
      </div>
      <div className="flex flex-col gap-2.5">
        <Bar className="h-2.5 w-10" />
        <Bar className="h-3.5 w-[92%]" />
        <Bar className="h-3.5 w-[78%]" />
        <Bar className="h-3.5 w-[64%]" />
      </div>
      <Bar className="h-9 w-56 rounded-lg" />
      <div className="flex flex-col gap-2.5">
        <Bar className="h-2.5 w-10" />
        <Bar className="h-3.5 w-[84%]" />
        <Bar className="h-3.5 w-[46%]" />
      </div>
    </div>
  );
}

export function Bar({ className }: { className?: string }) {
  return <span className={cn("shimmer block rounded-md", className)} aria-hidden />;
}
