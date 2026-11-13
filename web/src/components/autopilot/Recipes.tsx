import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Recipe {
  id: string;
  icon: LucideIcon;
  title: string;
  /** One line: what it does, in plain words. */
  line: string;
  /** What starts it ("Weekdays 02:00", "Issue labelled agent"). */
  trigger: string;
  /** Quiet checks only speak up when something is wrong. */
  quiet?: boolean;
}

/**
 * Recipes: the common automations as cards. Picking one opens the editor already filled in (name,
 * trigger, task) — nothing is created until it is saved there, so the repo and wording stay the
 * person's call. A starting point that teaches what the kinds are for, not a wizard.
 */
export function RecipeGallery({ recipes, onPick, className, heading = "Start from a recipe" }: { recipes: readonly Recipe[]; onPick: (id: string) => void; className?: string; heading?: string }) {
  return (
    <section aria-labelledby="recipes-title" className={cn("enter", className)}>
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 id="recipes-title" className="text-foreground text-meta font-medium whitespace-nowrap">
          {heading}
        </h2>
        <p className="text-muted-foreground text-micro">Opens the editor filled in — nothing runs until you save</p>
      </div>
      <ul className="grid gap-2.5 @lg:grid-cols-2 @4xl:grid-cols-3">
        {recipes.map((r) => {
          const Icon = r.icon;
          return (
            <li key={r.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onPick(r.id)}
                className="group bg-card hover:border-foreground/25 focus-visible:ring-ring flex h-full w-full cursor-pointer flex-col rounded-xl border p-3.5 text-left outline-none transition-[border-color,transform] duration-150 focus-visible:ring-2 active:scale-[0.985]"
              >
                <span className="flex w-full items-center gap-2.5">
                  <span className="bg-muted text-foreground grid size-8 shrink-0 place-items-center rounded-lg" aria-hidden>
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="text-foreground min-w-0 flex-1 truncate text-meta font-medium">{r.title}</span>
                  <ArrowRight className="text-faint group-hover:text-foreground size-3.5 shrink-0 transition-[color,transform] duration-150 group-hover:translate-x-0.5" aria-hidden />
                </span>
                <span className="text-muted-foreground mt-2 line-clamp-2 text-micro leading-relaxed">{r.line}</span>
                <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                  <span className="text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 font-mono text-micro">{r.trigger}</span>
                  {r.quiet && <span className="text-faint rounded-full border px-2 py-0.5 text-micro">quiet</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
