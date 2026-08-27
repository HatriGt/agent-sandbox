import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `cn` = clsx + tailwind-merge, taught this project's custom type scale.
 *
 * Why the extension matters: tailwind-merge cannot read `@theme`, so it does not know that
 * `text-meta`, `text-body`, `text-micro` … are FONT SIZES. Unknown `text-*` values fall into its
 * text-COLOR group, which means `cn("text-primary-foreground", "text-meta")` used to keep only the
 * later class and silently drop the colour. That single misclassification made the primary "New task"
 * button render ink-on-ink, turned `destroy` grey, and stripped the amber off "needs you" anywhere a
 * colour and a size met inside cva/cn. Registering the sizes here fixes every call site at once.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "meta", "body", "lead", "prose", "code", "h3", "h2", "h1", "display"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
