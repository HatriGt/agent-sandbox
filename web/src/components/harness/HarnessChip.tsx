import * as React from "react";
import { Layers } from "lucide-react";
import { api, type HarnessView } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Composer harness picker. A harness fills driver/model/skills/rules/egress/budget for the run;
 * anything picked explicitly in the composer still wins. Unreviewed imports are listed but disabled.
 */
export function HarnessChip({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [list, setList] = React.useState<HarnessView[] | null>(null);
  React.useEffect(() => {
    api.harnesses().then((r) => setList(r.harnesses)).catch(() => setList([]));
  }, []);
  if (!list?.length) return null;
  const cur = list.find((h) => h.id === value);
  return (
    <label
      title="Harness: a saved setup for this run. Explicit picks override it."
      className={cn(
        "relative h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-micro font-medium whitespace-nowrap transition-colors",
        cur ? "border-live/40 bg-live/8 text-live flex" : "text-muted-foreground hover:bg-muted hover:text-foreground hidden border-transparent sm:flex"
      )}
    >
      <Layers className="size-3.5 shrink-0" aria-hidden />
      <span className="max-w-32 truncate">{cur ? cur.name : "Harness"}</span>
      <select aria-label="Harness" className="absolute inset-0 cursor-pointer opacity-0" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">No harness</option>
        {(
          [
            ["Your harnesses", list.filter((h) => !h.builtin)],
            ["Built-in", list.filter((h) => h.builtin)],
          ] as const
        ).map(([label, group]) =>
          group.length ? (
            <optgroup key={label} label={label}>
              {group.map((h) => (
                <option key={h.id} value={h.id} disabled={!!h.needsReview} title={h.description}>
                  {h.name}
                  {h.needsReview ? " (needs review)" : ""}
                </option>
              ))}
            </optgroup>
          ) : null
        )}
      </select>
    </label>
  );
}
