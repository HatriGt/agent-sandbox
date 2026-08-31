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
 * A quiet, flat glyph per skill, picked from the NAME — review → PR arrows, deploy → rocket,
 * test → flask… — else a bolt. No tint, no plate: it inherits the text colour of wherever it sits,
 * like every other icon in the console. Its only job is to make a list of skills scannable.
 */
const KEYED: [RegExp, React.ComponentType<IconProps>][] = [
  [/review|pr\b|pull/, GitPullRequest],
  [/deploy|release|ship|publish/, RocketLaunch],
  [/test|spec|qa\b/, Flask],
  [/fix|bug|debug|patch/, Bug],
  [/clean|lint|tidy|refactor/, Broom],
  [/secur|audit|guard/, ShieldCheck],
  [/db|sql|data|migrat/, Database],
  [/doc|note|write|readme/, Scroll],
  [/style|ui\b|design|css/, PaintBrush],
  [/build|infra|setup|env/, Stack],
  [/run|exec|cli|shell/, TerminalWindow],
];

export function skillIcon(name: string): React.ComponentType<IconProps> {
  const n = name.toLowerCase();
  for (const [re, icon] of KEYED) if (re.test(n)) return icon;
  return Lightning;
}

export function SkillMark({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Icon = skillIcon(name);
  return <Icon size={size} weight="duotone" aria-hidden className={cn("shrink-0", className)} />;
}
