import * as React from "react";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useCached } from "@/lib/cache";
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
    <div
      role="listbox"
      aria-label="Skills"
      className="bg-popover text-popover-foreground absolute inset-x-2 bottom-full z-20 mb-2 max-h-72 overflow-y-auto rounded-xl border p-1 shadow-e3"
    >
      <div className="text-muted-foreground px-2.5 py-1.5 text-micro">
        Skills — Enter runs the highlighted one with the rest of your message
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
            "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-meta",
            i === cursor ? "bg-accent text-foreground" : "text-foreground"
          )}
        >
          <Sparkles className="text-live size-3.5 shrink-0" aria-hidden />
          <span className="stamp shrink-0 font-medium">/{s.name}</span>
          <span className="text-muted-foreground min-w-0 truncate">{s.description}</span>
        </button>
      ))}
    </div>
  );
}
