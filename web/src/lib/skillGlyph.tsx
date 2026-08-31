import {
  Broom,
  Bug,
  Database,
  Flask,
  GitPullRequest,
  Lightning,
  PaintBrush,
  RocketLaunch,
  Scroll,
  ShieldCheck,
  Stack,
  TerminalWindow,
  type IconProps,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * Every skill gets a face. The glyph is picked from the NAME — first by what the skill is obviously
 * about (review → PR arrows, deploy → rocket, test → flask …), else by a stable hash — and paired
 * with a tint, so a grid of skills reads like a hand of distinct cards rather than a list of
 * identical bullets. Phosphor duotone: the two-layer fill carries the tint without a heavy outline.
 */
type Glyph = { Icon: React.ComponentType<IconProps>; fg: string; bg: string };

const KEYED: [RegExp, Glyph][] = [
  [/review|pr\b|pull/, { Icon: GitPullRequest, fg: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/12" }],
  [/deploy|release|ship|publish/, { Icon: RocketLaunch, fg: "text-sky-600 dark:text-sky-400", bg: "bg-sky-500/12" }],
  [/test|spec|qa\b/, { Icon: Flask, fg: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/12" }],
  [/fix|bug|debug|patch/, { Icon: Bug, fg: "text-rose-600 dark:text-rose-400", bg: "bg-rose-500/12" }],
  [/clean|lint|tidy|refactor/, { Icon: Broom, fg: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/12" }],
  [/secur|audit|guard/, { Icon: ShieldCheck, fg: "text-teal-600 dark:text-teal-400", bg: "bg-teal-500/12" }],
  [/db|sql|data|migrat/, { Icon: Database, fg: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-500/12" }],
  [/doc|note|write|readme/, { Icon: Scroll, fg: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-500/12" }],
  [/style|ui\b|design|css/, { Icon: PaintBrush, fg: "text-fuchsia-600 dark:text-fuchsia-400", bg: "bg-fuchsia-500/12" }],
  [/build|infra|setup|env/, { Icon: Stack, fg: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/12" }],
  [/run|exec|cli|shell/, { Icon: TerminalWindow, fg: "text-slate-600 dark:text-slate-400", bg: "bg-slate-500/12" }],
];

const FALLBACK: Glyph[] = [
  { Icon: Lightning, fg: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/12" },
  { Icon: Lightning, fg: "text-sky-600 dark:text-sky-400", bg: "bg-sky-500/12" },
  { Icon: Lightning, fg: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/12" },
  { Icon: Lightning, fg: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/12" },
  { Icon: Lightning, fg: "text-rose-600 dark:text-rose-400", bg: "bg-rose-500/12" },
  { Icon: Lightning, fg: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-500/12" },
];

export function skillGlyph(name: string): Glyph {
  const n = name.toLowerCase();
  for (const [re, g] of KEYED) if (re.test(n)) return g;
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) | 0;
  return FALLBACK[Math.abs(h) % FALLBACK.length];
}

/** The tinted square that anchors a skill everywhere: cards, menu rows, the composer chip. */
export function SkillMark({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const g = skillGlyph(name);
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-lg",
        size === "sm" ? "size-6 rounded-md" : size === "lg" ? "size-11" : "size-8",
        g.bg,
        g.fg,
        className
      )}
      aria-hidden
    >
      <g.Icon size={size === "sm" ? 14 : size === "lg" ? 24 : 18} weight="duotone" />
    </span>
  );
}
