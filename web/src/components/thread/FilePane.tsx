import * as React from "react";
import { Check, Download, FileCode2, FileDiff, FileQuestion, Loader2, Undo2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, ApiError, type ChangedFile } from "@/lib/api";
import { parseUnifiedDiff, diffForNewFile, hunkId, hunkToPatch, inlineChanges, pairChangedLines, type DiffHunk, type DiffLine, type ParsedDiff, type Span } from "@/lib/diff";
import { useReducedMotion } from "@/lib/motion-pref";
import { tokenizeLines, type CodeToken } from "@/components/CodeEditor";
import { FileMark, languageOf } from "@/lib/fileIcon";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
import { Markdown } from "@/components/ui/markdown";
import { Button } from "@/components/ui/button";
import { AnimatedTabs } from "@/components/ui/animated-tabs";
import { cn } from "@/lib/utils";
import "@/styles/review.css";

/**
 * The file pane — a VS Code-style side panel for one file from the sandbox: its diff against HEAD
 * (two gutters, coloured lines, per-hunk headers) or its full content with syntax highlighting.
 * Fetched lazily and cached per (session, path); download via the token-guarded artifact route.
 */
export function FilePane({ session, file, onClose }: { session: string; file: ChangedFile; onClose: () => void }) {
  const [tab, setTab] = React.useState<"diff" | "file">(file.status === "deleted" ? "diff" : "diff");
  const [diff, setDiff] = React.useState<ParsedDiff | null>(null);
  const [content, setContent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const untracked = file.status === "untracked" || file.status === "added";
  const review = useHunkReview(session, file.path, diff, {
    whole: untracked || file.status === "deleted",
    onDiscarded: (_files, scope) => {
      if (scope === "file") setDiff((d) => (d ? { ...d, hunks: [], additions: 0, deletions: 0 } : d));
    },
  });

  React.useEffect(() => {
    setDiff(null);
    setContent(null);
    setError(null);
    setTab(file.status === "modified" || file.status === "renamed" || file.status === "deleted" ? "diff" : "file");
  }, [session, file.path, file.status]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        if (tab === "diff") {
          if (diff) return;
          const d = await api.diff(session, file.path);
          if (cancelled) return;
          if (d.untracked) {
            const text = content ?? (await api.artifactText(session, file.path));
            if (cancelled) return;
            setContent(text);
            setDiff(diffForNewFile(text));
          } else setDiff(parseUnifiedDiff(d.diff));
        } else {
          if (content !== null) return;
          const text = await api.artifactText(session, file.path);
          if (!cancelled) setContent(text);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError && e.status === 404 ? "This file is no longer available in the sandbox." : e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, file.path, tab]);

  const download = async () => {
    try {
      const blob = await api.artifactBlob(session, file.path);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = file.path.slice(file.path.lastIndexOf("/") + 1);
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const base = file.path.slice(file.path.lastIndexOf("/") + 1);
  const dir = file.path.slice(0, Math.max(0, file.path.lastIndexOf("/")));
  const isMd = /\.(md|markdown)$/i.test(base);

  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="bg-card absolute inset-0 z-20 flex min-w-0 flex-col md:relative md:inset-auto md:h-full md:w-[46%] md:min-w-[26rem] md:border-l"
      aria-label={`File ${file.path}`}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <FileMark path={file.path} />
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate font-mono text-meta font-medium">{base}</p>
          {dir && <p className="stamp text-muted-foreground truncate">{dir}</p>}
        </div>
        <span className="stamp flex shrink-0 items-center gap-1.5">
          {file.additions > 0 && <span className="text-ok">+{file.additions}</span>}
          {file.deletions > 0 && <span className="text-destructive">−{file.deletions}</span>}
        </span>
        {review && tab === "diff" && <FileReviewBar review={review} />}
        <AnimatedTabs
          ariaLabel="File view"
          className="ml-2"
          value={tab}
          onChange={setTab}
          items={[
            { value: "diff", icon: <FileDiff className="size-3.5" />, label: "Diff" },
            { value: "file", icon: <FileCode2 className="size-3.5" />, label: "File", disabled: file.status === "deleted" },
          ]}
        />
        <Button variant="ghost" size="icon-sm" onClick={download} aria-label="Download" disabled={file.status === "deleted"}>
          <Download />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close file pane">
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="text-muted-foreground px-4 py-6 text-meta">{error}</p>
        ) : loading && ((tab === "diff" && !diff) || (tab === "file" && content === null)) ? (
          <p className="text-muted-foreground flex items-center gap-2 px-4 py-6 text-meta">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading {tab === "diff" ? "diff" : "file"}…
          </p>
        ) : tab === "diff" && diff ? (
          <DiffView diff={diff} path={file.path} review={review} />
        ) : tab === "file" && content !== null ? (
          isMd ? (
            <div className="prose-agent text-foreground px-5 py-4">
              <Markdown>{content}</Markdown>
            </div>
          ) : (
            <CodeBlock className="my-0 rounded-none border-0 shadow-none">
              <CodeBlockCode code={content} language={languageOf(file.path)} />
            </CodeBlock>
          )
        ) : null}
      </div>
    </motion.aside>
  );
}

/**
 * Two-gutter unified diff, the way a reviewer reads one: old and new line numbers in a gutter that
 * stays put while long lines scroll sideways, +/- rows tinted edge to edge, the edited WORDS marked
 * inside a changed pair, code coloured with the editor's own grammar, and hunks separated by a quiet
 * "N unchanged lines" rule. Shared by the file pane, the workspace, Review-all and the PR page.
 */
export function DiffView({ diff, path, review }: { diff: ParsedDiff; path: string; review?: HunkReview }) {
  const still = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  // Keyboard review while a hunk has focus: j/k walk the hunks, ⌘↵ accepts, ⌘⌫ rejects.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!review) return;
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
    const cur = t.closest<HTMLElement>("[data-hunk]");
    if (!cur) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod && (e.key === "j" || e.key === "k")) {
      const all = Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-hunk]") ?? []);
      const i = all.indexOf(cur);
      const next = all[i + (e.key === "j" ? 1 : -1)];
      if (next) {
        e.preventDefault();
        next.focus();
        next.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    const id = cur.dataset.hunk ?? "";
    if (mod && e.key === "Enter") {
      e.preventDefault();
      review.toggleAccept(id);
    } else if (mod && e.key === "Backspace") {
      e.preventDefault();
      const h = diff.hunks.find((x) => hunkId(x) === id);
      if (h) void review.rejectHunk(h);
    }
  };
  if (diff.binary) return <DiffNote>Binary file — no textual diff.</DiffNote>;
  if (!diff.hunks.length) return <DiffNote>No differences against HEAD for {path}.</DiffNote>;
  const live = diff.hunks.filter((h) => !review?.removed.has(hunkId(h)));
  if (!live.length) return <DiffNote>Every hunk was reverted — {path} is back to HEAD.</DiffNote>;
  return (
    <div ref={ref} onKeyDown={onKeyDown} className="enter min-w-max pb-4 font-mono text-code leading-[1.65]" role="table" aria-label={`Diff of ${path}`}>
      <AnimatePresence initial={false}>
        {live.map((h, i) => (
          <motion.div
            key={hunkId(h)}
            className="review-hunk-wrap"
            layout={!still}
            exit={still ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: still ? 0.12 : 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <Hunk hunk={h} prev={live[i - 1]} path={path} review={review} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Review state for one file's diff — which hunks the reader has accepted (kept, and marked as read;
 * remembered per session+path in sessionStorage so reopening the pane keeps the marks) and which
 * were rejected (reverted in the box through /discard.json, then collapsed out). `whole` says the
 * file has no per-hunk grain (new or deleted): any reject is the whole file. Returns undefined
 * without a session (the archived Review-all, the PR page) — a read-only diff.
 */
export interface HunkReview {
  session: string;
  path: string;
  accepted: ReadonlySet<string>;
  removed: ReadonlySet<string>;
  /** Hunk id mid-request, or "file" while the whole file is being discarded. */
  busy: string | null;
  counts: { hunks: number; reviewed: number };
  toggleAccept: (id: string) => void;
  acceptAll: () => void;
  rejectHunk: (hunk: DiffHunk) => Promise<boolean>;
  rejectFile: () => Promise<boolean>;
}

const reviewKey = (session: string, path: string) => `asb.review.${session}.${path}`;
function loadAccepted(session: string, path: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(reviewKey(session, path));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Fired after a discard so the ChangesDock (which owns the refresh) can roll its counts. */
export const CHANGES_DISCARDED_EVENT = "asb:changes-discarded";

export function useHunkReview(
  session: string | undefined,
  path: string,
  diff: ParsedDiff | null,
  opts: { whole?: boolean; onDiscarded?: (files: ChangedFile[], scope: "hunk" | "file") => void } = {}
): HunkReview | undefined {
  const [accepted, setAccepted] = React.useState<Set<string>>(() => (session ? loadAccepted(session, path) : new Set()));
  const [removed, setRemoved] = React.useState<Set<string>>(() => new Set());
  const [busy, setBusy] = React.useState<string | null>(null);
  const onDiscarded = React.useRef(opts.onDiscarded);
  onDiscarded.current = opts.onDiscarded;
  React.useEffect(() => {
    setAccepted(session ? loadAccepted(session, path) : new Set());
    setRemoved(new Set());
    setBusy(null);
  }, [session, path]);
  const persist = React.useCallback(
    (next: Set<string>) => {
      if (!session) return;
      try {
        if (next.size) sessionStorage.setItem(reviewKey(session, path), JSON.stringify([...next]));
        else sessionStorage.removeItem(reviewKey(session, path));
      } catch {
        /* storage full or disabled — the marks just do not persist */
      }
    },
    [session, path]
  );
  const ids = React.useMemo(() => (diff?.hunks ?? []).map(hunkId), [diff]);

  const toggleAccept = React.useCallback(
    (id: string) =>
      setAccepted((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        persist(next);
        return next;
      }),
    [persist]
  );
  const acceptAll = React.useCallback(() => {
    setAccepted((prev) => {
      const next = new Set(prev);
      for (const id of ids) if (!removed.has(id)) next.add(id);
      persist(next);
      return next;
    });
  }, [ids, removed, persist]);

  const whole = !!opts.whole;
  const discard = React.useCallback(
    async (hunk: DiffHunk | null): Promise<boolean> => {
      if (!session) return false;
      const id = hunk ? hunkId(hunk) : "file";
      setBusy(id);
      try {
        const r = await api.discardChange(session, path, hunk && !whole ? hunkToPatch(hunk) : undefined);
        setRemoved((prev) => {
          const next = new Set(prev);
          if (r.scope === "file") for (const x of ids) next.add(x);
          else next.add(id);
          return next;
        });
        toast(r.scope === "file" ? "File reverted" : "Hunk reverted", { duration: 2_000 });
        onDiscarded.current?.(r.files, r.scope);
        window.dispatchEvent(new CustomEvent(CHANGES_DISCARDED_EVENT, { detail: { session, path, files: r.files } }));
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) toast.error(e.message);
        else toast.error("Could not revert", { description: e instanceof Error ? e.message : String(e) });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [session, path, ids, whole]
  );
  const rejectHunk = React.useCallback((h: DiffHunk) => discard(h), [discard]);
  const rejectFile = React.useCallback(() => discard(null), [discard]);

  const liveIds = ids.filter((id) => !removed.has(id));
  const counts = { hunks: liveIds.length, reviewed: liveIds.filter((id) => accepted.has(id)).length };
  if (!session) return undefined;
  return { session, path, accepted, removed, busy, counts, toggleAccept, acceptAll, rejectHunk, rejectFile };
}

/**
 * The per-file review controls for a header: "3 hunks · 1 reviewed", Accept file, Reject file (an
 * inline arm-then-confirm — a whole file is more than a hunk, but not worth a dialog).
 */
export function FileReviewBar({ review, className }: { review: HunkReview; className?: string }) {
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4_000);
    return () => window.clearTimeout(t);
  }, [armed]);
  const { hunks, reviewed } = review.counts;
  const all = hunks > 0 && reviewed === hunks;
  const busy = review.busy === "file";
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", className)} data-review-bar>
      <span className="text-faint text-micro tabular-nums whitespace-nowrap" aria-live="polite">
        {hunks} {hunks === 1 ? "hunk" : "hunks"}
        {hunks > 0 && (
          <>
            {" · "}
            <span className={cn(reviewed > 0 && "text-ok")}>{reviewed} reviewed</span>
          </>
        )}
      </span>
      {hunks > 0 && !armed && (
        <button type="button" className="review-btn" data-tone={all ? "ok" : undefined} onClick={review.acceptAll} disabled={all || busy} aria-label="Accept every hunk in this file">
          <Check className="size-3" strokeWidth={2.5} aria-hidden />
          {all ? "Accepted" : "Accept file"}
        </button>
      )}
      {hunks > 0 && !armed && (
        <button type="button" className="review-btn" data-tone="danger" onClick={() => setArmed(true)} disabled={busy} aria-label="Reject every change in this file">
          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Undo2 className="size-3" aria-hidden />}
          Reject file
        </button>
      )}
      {armed && (
        <span className="flex items-center gap-1" role="group" aria-label="Confirm reject file">
          <span className="text-muted-foreground text-micro whitespace-nowrap">Discard all changes?</span>
          <button
            type="button"
            className="review-btn"
            data-tone="danger"
            data-armed
            autoFocus
            onClick={() => {
              setArmed(false);
              void review.rejectFile();
            }}
          >
            Discard
          </button>
          <button type="button" className="review-btn" onClick={() => setArmed(false)}>
            Cancel
          </button>
        </span>
      )}
    </span>
  );
}

function DiffNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="enter text-muted-foreground flex flex-col items-center gap-2 px-4 py-12 text-center text-meta">
      <FileQuestion className="text-faint size-5" aria-hidden />
      <p>{children}</p>
    </div>
  );
}

/** Lines the old side had (context + deletions) and the new side has (context + additions), in order. */
function sides(lines: DiffLine[]) {
  const old: string[] = [];
  const neu: string[] = [];
  const oldIdx: number[] = [];
  const newIdx: number[] = [];
  lines.forEach((l, i) => {
    if (l.kind === "context" || l.kind === "del") {
      oldIdx[i] = old.length;
      old.push(l.text);
    }
    if (l.kind === "context" || l.kind === "add") {
      newIdx[i] = neu.length;
      neu.push(l.text);
    }
  });
  return { old, neu, oldIdx, newIdx };
}

function Hunk({ hunk, prev, path, review }: { hunk: DiffHunk; prev?: DiffHunk; path: string; review?: HunkReview }) {
  const { lines } = hunk;
  const id = React.useMemo(() => hunkId(hunk), [hunk]);
  const accepted = !!review?.accepted.has(id);
  const busy = review?.busy === id;
  // Tokens come from parsing each side as one block, so a comment or template string that spans
  // lines colours correctly; deletions are read from the old side, additions from the new.
  const { oldToks, newToks, oldIdx, newIdx, marks } = React.useMemo(() => {
    const s = sides(lines);
    const marks = new Map<number, Span[]>();
    pairChangedLines(lines).forEach((partner, i) => {
      if (lines[i].kind !== "del") return;
      const ch = inlineChanges(lines[i].text, lines[partner].text);
      marks.set(i, ch.a);
      marks.set(partner, ch.b);
    });
    return { oldToks: tokenizeLines(s.old.join("\n"), path), newToks: tokenizeLines(s.neu.join("\n"), path), oldIdx: s.oldIdx, newIdx: s.newIdx, marks };
  }, [lines, path]);

  const oldNos = lines.map((l) => l.oldNo).filter((n): n is number => n != null);
  const newNos = lines.map((l) => l.newNo).filter((n): n is number => n != null);
  const range = `-${oldNos[0] ?? 0},${oldNos.length} +${newNos[0] ?? 0},${newNos.length}`;
  // The unchanged run this hunk skips over since the previous one — the reader's sense of distance.
  const prevLast = prev?.lines.map((l) => l.newNo).filter((n): n is number => n != null).pop();
  const gap = prevLast != null && newNos[0] != null ? newNos[0] - prevLast - 1 : 0;

  return (
    <section
      aria-label={hunk.header || range}
      className={cn(review && "review-hunk")}
      data-hunk={review ? id : undefined}
      data-accepted={accepted || undefined}
      data-busy={busy || undefined}
      tabIndex={review ? 0 : undefined}
    >
      <div className="review-head bg-muted/70 sticky top-0 z-20 border-b backdrop-blur-sm [&:not(:first-child)]:border-t" role="row">
        <div className="text-muted-foreground sticky left-0 flex w-max max-w-[calc(100vw-2rem)] items-center gap-2 px-3 py-1 text-micro">
          {gap > 0 ? (
            <span className="text-faint tabular-nums">⋯ {gap} unchanged {gap === 1 ? "line" : "lines"}</span>
          ) : (
            <span className="text-live font-semibold">@@</span>
          )}
          <span className="review-range tabular-nums">{range}</span>
          {/* Capped so the action row stays inside a narrow pane; the full header is the title. */}
          {hunk.header && <span className={cn("text-faint truncate", review && "max-w-[28ch]")} title={hunk.header}>{hunk.header}</span>}
          {review && (
            <span className="review-actions ml-3 flex items-center gap-0.5" role="group" aria-label="Review this hunk">
              <button
                type="button"
                className="review-btn"
                data-tone={accepted ? "ok" : undefined}
                onClick={() => review.toggleAccept(id)}
                disabled={busy}
                aria-pressed={accepted}
                title={accepted ? "Accepted — click to unmark (⌘↵ / Ctrl+Enter)" : "Keep this change and mark it reviewed (⌘↵ / Ctrl+Enter)"}
              >
                <Check className="size-3" strokeWidth={2.5} aria-hidden />
                {accepted ? "Accepted" : "Accept"}
              </button>
              <button
                type="button"
                className="review-btn"
                data-tone="danger"
                onClick={() => void review.rejectHunk(hunk)}
                disabled={busy}
                title="Revert this hunk in the sandbox (⌘⌫ / Ctrl+Backspace)"
              >
                {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Undo2 className="size-3" aria-hidden />}
                Reject
              </button>
            </span>
          )}
        </div>
      </div>
      {lines.map((l, i) => {
        if (l.kind === "meta") {
          return (
            <div key={i} className="text-faint flex items-center gap-2 pl-[8.25rem] text-micro italic" role="row">
              {l.text.replace(/^\\ /, "")}
            </div>
          );
        }
        const toks = l.kind === "add" ? newToks[newIdx[i]] : oldToks[oldIdx[i]];
        return (
          <div key={i} role="row" className={cn("flex", l.kind === "add" ? "diff-row-add" : l.kind === "del" ? "diff-row-del" : "diff-row-context")}>
            <span className="diff-gutter sticky left-0 z-10 flex shrink-0 select-none border-r" role="rowheader">
              <span className="text-faint w-[3.5rem] px-2 text-right tabular-nums">{l.oldNo ?? ""}</span>
              <span className="text-faint w-[3.5rem] px-2 text-right tabular-nums">{l.newNo ?? ""}</span>
              <span className={cn("w-5 text-center font-semibold", l.kind === "add" ? "text-ok" : l.kind === "del" ? "text-destructive" : "text-transparent")} aria-label={l.kind}>
                {l.kind === "add" ? "+" : l.kind === "del" ? "\u2212" : " "}
              </span>
            </span>
            <span className="text-foreground pr-6 pl-2 whitespace-pre" role="cell">
              <Line tokens={toks ?? []} marks={marks.get(i)} />
              {!l.text && " "}
            </span>
          </div>
        );
      })}
    </section>
  );
}

/** One line's coloured tokens, with the changed spans wrapped in a mark — tokens are split at span edges. */
function Line({ tokens, marks }: { tokens: CodeToken[]; marks?: Span[] }) {
  if (!marks?.length) return <>{tokens.map((t, i) => (t.cls ? <span key={i} className={t.cls}>{t.text}</span> : t.text))}</>;
  const out: React.ReactNode[] = [];
  let pos = 0;
  let k = 0;
  tokens.forEach((t, i) => {
    let from = pos;
    const end = pos + t.text.length;
    while (from < end) {
      while (k < marks.length && marks[k][1] <= from) k++;
      const m = marks[k];
      const inMark = !!m && m[0] <= from;
      const to = m ? (inMark ? Math.min(m[1], end) : Math.min(m[0], end)) : end;
      const piece = t.text.slice(from - pos, to - pos);
      const node = t.cls ? <span className={t.cls}>{piece}</span> : piece;
      out.push(
        inMark ? (
          <mark key={`${i}-${from}`} className="diff-mark">
            {node}
          </mark>
        ) : (
          <React.Fragment key={`${i}-${from}`}>{node}</React.Fragment>
        )
      );
      from = to;
    }
    pos = end;
  });
  return <>{out}</>;
}
