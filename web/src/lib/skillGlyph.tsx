import {
  Brush,
  Bug,
  Database,
  FlaskConical,
  GitPullRequest,
  Layers,
  type LucideProps,
  Paintbrush,
  Rocket,
  ScrollText,
  ShieldCheck,
  SquareTerminal,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A quiet, flat glyph per skill, picked from the NAME — review → PR arrows, deploy → rocket,
 * test → flask… — else a bolt. No tint, no plate: it inherits the text colour of wherever it sits,
 * like every other icon in the console. Its only job is to make a list of skills scannable.
 */
const KEYED: [RegExp, React.ComponentType<LucideProps>][] = [
  [/review|pr\b|pull/, GitPullRequest],
  [/deploy|release|ship|publish/, Rocket],
  [/test|spec|qa\b/, FlaskConical],
  [/fix|bug|debug|patch/, Bug],
  [/clean|lint|tidy|refactor/, Brush],
  [/secur|audit|guard/, ShieldCheck],
  [/db|sql|data|migrat/, Database],
  [/doc|note|write|readme/, ScrollText],
  [/style|ui\b|design|css/, Paintbrush],
  [/build|infra|setup|env/, Layers],
  [/run|exec|cli|shell/, SquareTerminal],
];

export function skillIcon(name: string): React.ComponentType<LucideProps> {
  const n = name.toLowerCase();
  for (const [re, icon] of KEYED) if (re.test(n)) return icon;
  return Zap;
}

export function SkillMark({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Icon = skillIcon(name);
  return <Icon size={size} strokeWidth={1.75} aria-hidden className={cn("shrink-0", className)} />;
}
