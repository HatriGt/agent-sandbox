import { cn } from "@/lib/utils";

/**
 * A pill with a native select inside: "Status · any". Reads as a filter chip next to FilterChip
 * groups; the pill takes the ink ring while a value other than the first ("any") is chosen.
 */
export function FilterSelect({ label, value, onChange, options, className }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; className?: string }) {
  return (
    <label className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-meta", value ? "border-foreground/30 text-foreground" : "bg-card text-muted-foreground", className)}>
      <span className="text-faint whitespace-nowrap">{label}</span>
      <select aria-label={label} className="min-w-0 max-w-36 cursor-pointer truncate bg-transparent font-medium outline-none" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
