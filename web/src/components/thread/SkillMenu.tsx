import * as React from "react";
import { X } from "lucide-react";
import { motion } from "motion/react";
import { api, type SkillView } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { SkillMark } from "@/lib/skillGlyph";
import { cn } from "@/lib/utils";

/**
 * `/` skill invocation, the slash-command way: a message that STARTS with `/` opens the list of the
 * user's enabled skills (from Integrations → Skills), narrowing as you type; ↑/↓ moves, Enter/Tab
 * inserts `/name `, Esc dismisses. The token is sent as-is — the in-box agent is instructed to invoke
 * the matching skill. The menu only exists while something matches, so typing a path like
 * `/workspace/...` just types.
 */
export interface SlashState {
  /** The skill-name query: the first token, without the leading slash. */
  query: string;
}

/** Active `/query` at the START of the message with the caret still inside the first token, or null. */
export function slashAt(value: string, caret: number): SlashState | null {
  if (!value.startsWith("/")) return null;
  const ws = value.search(/\s/);
  const end = ws === -1 ? value.length : ws;
  if (caret > end) return null;
  return { query: value.slice(1, end) };
}

export function SkillMenu({
  state,
  onPick,
  onClose,
  onMatches,
}: {
  state: SlashState;
  onPick: (name: string) => void;
  onClose: () => void;
  /** Tells the composer whether anything matches, so Enter falls through to "send" when nothing does. */
  onMatches: (n: number) => void;
}) {
  const cached = useCached("skills", (signal) => api.skills(signal));
  const [cursor, setCursor] = React.useState(0);
  const q = state.query.toLowerCase();
  const matches = React.useMemo(
    () => (cached.data?.skills ?? []).filter((s) => s.enabled && s.name.includes(q)),
    [cached.data, q]
  );

  React.useEffect(() => {
    setCursor(0);
    onMatches(matches.length);
  }, [matches.length, onMatches]);

  // Keyboard is owned by the textarea; it forwards navigation here via a custom event.
  React.useEffect(() => {
    const onNav = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (key === "ArrowDown") setCursor((c) => Math.min(matches.length - 1, c + 1));
      else if (key === "ArrowUp") setCursor((c) => Math.max(0, c - 1));
      else if (key === "Enter" || key === "Tab") {
        if (matches[cursor]) onPick(matches[cursor].name);
      } else if (key === "Escape") onClose();
    };
    document.addEventListener("asb:skill-nav", onNav);
    return () => document.removeEventListener("asb:skill-nav", onNav);
  }, [matches, cursor, onPick, onClose]);

  if (!matches.length) return null;
  return (
    <motion.div
      role="listbox"
      aria-label="Skills"
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className="bg-popover text-popover-foreground absolute inset-x-2 bottom-full z-20 mb-2 max-h-72 overflow-y-auto rounded-xl border p-1 shadow-e3"
    >
      <div className="text-muted-foreground flex items-center gap-2 px-2.5 py-1.5 text-micro">
        <span className="flex-1">Run a skill with the rest of your message</span>
        <kbd className="rounded border px-1 py-px">↑↓</kbd>
        <kbd className="rounded border px-1 py-px">↵</kbd>
      </div>
      {matches.map((s, i) => (
        <button
          key={s.name}
          type="button"
          role="option"
          aria-selected={i === cursor}
          onMouseEnter={() => setCursor(i)}
          onMouseDown={(e) => {
            e.preventDefault(); // keep the textarea focused
            onPick(s.name);
          }}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-meta transition-colors duration-100",
            i === cursor ? "bg-accent text-foreground" : "text-foreground"
          )}
        >
          <SkillMark name={s.name} size={15} className="text-muted-foreground" />
          <span className="stamp shrink-0 font-medium">/{s.name}</span>
          <span className="text-muted-foreground min-w-0 truncate">{s.description}</span>
        </button>
      ))}
    </motion.div>
  );
}

/**
 * The chosen skill as a tag on the message — not raw `/name` text in the prose. Hovering (or
 * focusing) it floats a card with the full playbook: what it is for and the instructions the agent
 * will follow this turn. The X removes it without touching what was typed.
 */
export function SkillChip({ skill, onRemove }: { skill: SkillView; onRemove: () => void }) {
  return (
    <span className="group/chip relative inline-flex">
      <motion.span
        initial={{ opacity: 0, scale: 0.9, y: 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className="border-live/30 bg-live/8 inline-flex h-7 max-w-full cursor-default items-center gap-1.5 rounded-lg border pr-1 pl-1.5 text-micro"
        tabIndex={0}
      >
        <SkillMark name={skill.name} size={13} />
        <span className="stamp text-live font-semibold">/{skill.name}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove skill ${skill.name}`}
          className="text-muted-foreground hover:text-foreground grid size-5 cursor-pointer place-items-center rounded transition-colors"
        >
          <X className="size-3" />
        </button>
      </motion.span>

      {/* Hover card: pure CSS reveal so it never fights the textarea focus. */}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute bottom-full left-0 z-30 mb-2 w-80 max-w-[80vw] translate-y-1 opacity-0",
          "transition-[opacity,transform] duration-150 ease-out",
          "group-hover/chip:pointer-events-auto group-hover/chip:translate-y-0 group-hover/chip:opacity-100",
          "group-focus-within/chip:pointer-events-auto group-focus-within/chip:translate-y-0 group-focus-within/chip:opacity-100"
        )}
      >
        <span className="bg-popover text-popover-foreground block overflow-hidden rounded-xl border shadow-e3">
          <span className="flex items-center gap-2.5 border-b px-3 py-2.5">
            <SkillMark name={skill.name} size={16} className="text-muted-foreground" />
            <span className="min-w-0">
              <span className="stamp text-foreground block truncate text-meta font-semibold">/{skill.name}</span>
              <span className="text-muted-foreground block truncate text-micro">runs as a playbook this turn</span>
            </span>
          </span>
          <span className="block px-3 py-2.5">
            <span className="text-foreground block text-micro leading-relaxed">{skill.description}</span>
            <span className="text-muted-foreground mt-2 line-clamp-6 block font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {skill.content}
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}
