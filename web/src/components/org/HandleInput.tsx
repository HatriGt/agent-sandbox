import * as React from "react";
import { AtSign, Loader2 } from "lucide-react";
import { api, type PersonHit } from "@/lib/api";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The invite field with a "@" typeahead: while the token under the caret starts with "@", a
 * popover offers people whose GitHub login starts with what was typed — those already on Agent
 * Sandbox first (an invite by handle links them at once), then GitHub's user search. ↑↓ choose,
 * ↵ or ⇥ insert "@login, " in place of the token, Esc closes; Enter with nothing open submits.
 * Email addresses pasted around it are left alone: only the "@word" the caret is in is looked up.
 */
const TOKEN_RE = /(?:^|[\s,;])@([A-Za-z0-9-]*)$/;
const DEBOUNCE_MS = 220;

/** The "@token" the caret is in (its text without the "@", and where the "@" sits), or null. */
function tokenAt(value: string, caret: number): { q: string; start: number } | null {
  const m = TOKEN_RE.exec(value.slice(0, caret));
  if (!m) return null;
  return { q: m[1], start: caret - m[1].length - 1 };
}

const STANDING: Record<NonNullable<PersonHit["status"]>, string> = { owner: "owner", admin: "already in", member: "already in", invited: "invited" };

export function HandleInput({
  org,
  inputRef,
  value,
  onChange,
  onSubmit,
  className,
  ...rest
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "onSubmit" | "ref"> & {
  org: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  /** Enter with no suggestion open. */
  onSubmit: () => void;
}) {
  const [token, setToken] = React.useState<{ q: string; start: number } | null>(null);
  const [hits, setHits] = React.useState<PersonHit[]>([]);
  const [github, setGithub] = React.useState<"ok" | "limited" | "error" | "skipped">("skipped");
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listId = React.useId();

  /** Re-read the token under the caret (after typing, a click, or a caret move). */
  const sync = React.useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    setToken(tokenAt(el.value, el.selectionStart ?? el.value.length));
  }, [inputRef]);

  const q = token?.q ?? null;
  React.useEffect(() => {
    if (q === null || q === "") {
      setHits([]);
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      api
        .orgPeopleSearch(org, q, ctl.signal)
        .then((r) => {
          setHits(r.people);
          setGithub(r.github);
          setActive(0);
        })
        .catch(() => {})
        .finally(() => {
          if (!ctl.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [org, q]);

  const open = token !== null && token.q.length > 0;

  const pick = (h: PersonHit) => {
    const el = inputRef.current;
    if (!el || !token) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, token.start);
    const after = value.slice(caret);
    const insert = `@${h.login}${after.trim() ? "" : ", "}`;
    const next = before + insert + (after.trim() ? after : "");
    onChange(next);
    setToken(null);
    const at = before.length + insert.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at, at);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && hits.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(hits[active]);
        return;
      }
    }
    if (e.key === "Escape" && open) {
      setToken(null);
      return;
    }
    if (e.key === "Enter") onSubmit();
  };

  return (
    <Popover open={open} onOpenChange={(o) => !o && setToken(null)}>
      <PopoverAnchor asChild>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setToken(tokenAt(e.target.value, e.target.selectionStart ?? e.target.value.length));
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") && sync()}
          onClick={sync}
          onBlur={() => setToken(null)}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && hits[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className={className}
          {...rest}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={10}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.target === inputRef.current && e.preventDefault()}
        className="w-[min(22rem,calc(100vw-2rem))] p-1.5"
      >
        <div className="text-faint flex items-center gap-2 px-2 pt-1 pb-1.5 text-micro">
          <AtSign className="size-3" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            GitHub logins starting with <span className="text-muted-foreground">{token?.q}</span>
          </span>
          {loading && <Loader2 className="size-3 animate-spin" aria-hidden />}
        </div>
        {hits.length ? (
          <ul id={listId} role="listbox" aria-label="People" className="flex flex-col gap-px">
            {hits.map((h, i) => (
              <li
                key={h.login}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => active !== i && setActive(i)}
                onClick={() => pick(h)}
                className={cn("flex cursor-default items-center gap-2.5 rounded-lg px-2 py-1.5", i === active && "bg-foreground/6")}
              >
                <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full">
                  {h.avatarUrl ? <img src={h.avatarUrl} alt="" className="size-full object-cover" /> : <AtSign className="size-3" aria-hidden />}
                </span>
                <span className="text-foreground min-w-0 flex-1 truncate text-meta">
                  {h.login}
                  {h.name && <span className="text-muted-foreground"> · {h.name}</span>}
                </span>
                {h.status ? (
                  <span className="bg-foreground/6 text-muted-foreground shrink-0 rounded-full px-1.5 py-px text-micro">{STANDING[h.status]}</span>
                ) : h.onSite ? (
                  <span className="text-faint shrink-0 text-micro">on Agent Sandbox</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground px-2 pb-1 text-meta">{loading ? "Looking…" : github === "limited" ? "GitHub search is resting for a minute; people already here still show." : github === "error" ? "GitHub did not answer; people already here still show." : token && token.q.length < 2 ? "Keep typing." : "No one by that login. Enter keeps what you typed."}</p>
        )}
        {hits.length > 0 && (
          <p className="text-faint px-2 pt-1.5 pb-0.5 text-micro">
            <kbd className="font-sans">↑↓</kbd> choose · <kbd className="font-sans">↵</kbd> add to the list
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
