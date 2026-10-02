import * as React from "react";
import { Brain, Check, X } from "lucide-react";
import { toast } from "sonner";
import { api, type MemoryKind, type MemoryNew } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * The operator moment for memory (plan §5). A running box proposes a lesson or playbook → one quiet
 * toast with the text, Keep / Edit / Forget, and an 8 s hairline that drains to auto-keep. Closing it
 * (X, Esc, swipe) is Keep too: the toast is a chance to veto, never a gate — the note is already in
 * the next run's MEMORY.md. A preference or rule the box saved on its own gets a 4 s "Remembered"
 * toast with Undo. Facts and decisions stay silent (the outcome card counts them).
 *
 * No amber anywhere: nothing here needs the operator. Ids are remembered in localStorage so a second
 * tab, a reload or a reconnect never shows the same proposal twice.
 */

const SEEN_KEY = "asb-memory-seen";
const SEEN_CAP = 300;
export const AUTO_KEEP_MS = 8_000;

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function markSeen(ids: string[]) {
  try {
    const next = [...readSeen(), ...ids].slice(-SEEN_CAP);
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    /* private mode: the in-memory set below still dedupes within this tab */
  }
}

const KIND_LABEL: Record<MemoryKind, string> = {
  preference: "Preference",
  rule: "Rule",
  domain: "Domain knowledge",
  fact: "Fact",
  decision: "Decision",
  lesson: "Lesson",
  playbook: "Playbook",
};

/** Watch a snapshot's `memoryNew` and raise the right toast once per note. */
export function useMemoryToasts(memoryNew: MemoryNew[] | undefined) {
  // Per-tab memory of what was already raised, seeded from localStorage so other tabs count too.
  const seen = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    if (!memoryNew?.length) return;
    if (!seen.current) seen.current = new Set(readSeen());
    const fresh = memoryNew.filter((n) => !seen.current!.has(n.id));
    if (!fresh.length) return;
    for (const n of fresh) seen.current.add(n.id);
    markSeen(fresh.map((n) => n.id));
    for (const n of fresh) {
      if (n.status === "pending") showProposal(n);
      else if (n.kind === "preference" || n.kind === "rule") showRemembered(n);
    }
  }, [memoryNew]);
}

/**
 * Raise (or refresh) the proposal toast. Sonner only re-measures a custom toast's height when its
 * jsx changes, so the edit textarea re-issues this with a `mode` prop to let the card grow.
 */
function showProposal(note: MemoryNew, mode: "view" | "edit" = "view") {
  toast.custom((tid) => <ProposalToast note={note} toastId={tid} mode={mode} />, {
    id: `memory-${note.id}`,
    duration: Infinity,
    className: "!w-[var(--width)] !overflow-hidden",
    // Swiped away or closed by the Toaster: same as Keep. (Our own buttons dismiss after they POST.)
    onDismiss: () => void keepQuietly(note.id),
  });
}

function showRemembered(note: MemoryNew) {
  toast(`Remembered: ${note.text}`, {
    id: `memory-${note.id}`,
    icon: <Brain className="text-muted-foreground size-4" />,
    duration: 4_000,
    action: {
      label: "Undo",
      onClick: () => {
        api.memoryNoteDelete(note.id).then(
          () => toast("Forgotten", { duration: 2_000 }),
          (e: Error) => toast.error("Could not forget it", { description: e.message })
        );
      },
    },
  });
}

/** Keep without a confirmation toast — the operator did nothing, nothing to announce. */
const settled = new Set<string>();
async function keepQuietly(id: string) {
  if (settled.has(id)) return;
  settled.add(id);
  try {
    await api.memoryNoteUpdate({ id, status: "kept" });
  } catch {
    /* the controller auto-keeps unattended proposals anyway */
  }
}

function ProposalToast({ note, toastId }: { note: MemoryNew; toastId: string | number; mode: "view" | "edit" }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(note.text);
  const [busy, setBusy] = React.useState<"keep" | "forget" | "save" | null>(null);
  const [paused, setPaused] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const textRef = React.useRef<HTMLTextAreaElement>(null);

  // The auto-keep clock: a timeout that survives pauses by tracking what is left. Editing pauses it
  // for good — the operator is clearly deciding.
  const left = React.useRef(AUTO_KEEP_MS);
  const started = React.useRef<number | null>(null);
  const timer = React.useRef<number | null>(null);
  const halted = paused || editing || busy !== null;

  const finish = React.useCallback(
    async (how: "keep" | "forget" | "save") => {
      if (settled.has(note.id)) return toast.dismiss(toastId);
      setBusy(how);
      try {
        if (how === "forget") await api.memoryNoteDelete(note.id);
        else if (how === "save") await api.memoryNoteUpdate({ id: note.id, text: draft.trim(), status: "kept" });
        else await api.memoryNoteUpdate({ id: note.id, status: "kept" });
        settled.add(note.id);
        toast.dismiss(toastId);
        if (how === "forget") toast("Forgotten", { duration: 2_000 });
      } catch (e) {
        setBusy(null);
        toast.error(how === "forget" ? "Could not forget it" : "Could not keep it", { description: (e as Error).message });
      }
    },
    [note.id, toastId, draft]
  );

  React.useEffect(() => {
    if (halted) {
      if (started.current != null) {
        left.current = Math.max(0, left.current - (Date.now() - started.current));
        started.current = null;
      }
      if (timer.current != null) (window.clearTimeout(timer.current), (timer.current = null));
      return;
    }
    started.current = Date.now();
    timer.current = window.setTimeout(() => void finish("keep"), left.current);
    return () => {
      if (timer.current != null) (window.clearTimeout(timer.current), (timer.current = null));
    };
  }, [halted, finish]);

  React.useEffect(() => {
    if (editing) textRef.current?.focus();
  }, [editing]);
  // Let sonner re-measure when the textarea opens/closes (see showProposal). Skip the first render.
  const firstMode = React.useRef(true);
  React.useLayoutEffect(() => {
    if (firstMode.current) return void (firstMode.current = false);
    if (!settled.has(note.id)) showProposal(note, editing ? "edit" : "view");
  }, [editing, note]);

  const label = note.revises !== undefined
    ? `Updated${note.area ? ` · ${note.area}` : ""}`
    : note.kind === "playbook"
      ? "Playbook to remember"
      : note.kind === "lesson"
        ? "Lesson to remember"
        : note.kind === "domain"
          ? `Domain knowledge${note.area ? ` · ${note.area}` : ""}`
          : `${KIND_LABEL[note.kind]} to remember`;
  const canSave = draft.trim().length > 0;

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={`${label} — kept automatically in 8 seconds unless you choose`}
      data-memory-toast={note.id}
      data-paused={halted}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          if (editing) (setDraft(note.text), setEditing(false));
          else void finish("keep");
        }
      }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      // The Toaster already draws the card (classNames.toast); this is only its contents. The countdown
      // bar anchors to the toast itself (sonner positions it), so it hugs the card edge.
      className="text-card-foreground w-full min-w-0 text-meta"
    >
      <div className="flex items-start gap-2.5">
        <Brain className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-card-foreground font-medium">{label}</p>
          {editing ? (
            <textarea
              ref={textRef}
              value={draft}
              maxLength={note.kind === "playbook" ? 1200 : 400}
              rows={note.kind === "playbook" ? 5 : 3}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && note.kind !== "playbook") (e.preventDefault(), canSave && void finish("save"));
              }}
              className="border-line-strong bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/40 mt-1.5 w-full resize-none rounded-md border px-2 py-1.5 text-meta outline-none focus-visible:ring-2"
              aria-label={`${KIND_LABEL[note.kind]} text`}
            />
          ) : (
            <>
              {note.revises && (
                <p className="text-faint mt-0.5 break-words line-clamp-2 line-through decoration-faint" aria-label={`Was: ${note.revises}`}>
                  {note.revises}
                </p>
              )}
              <p className="text-foreground mt-0.5 whitespace-pre-line break-words">{note.text}</p>
              {note.why && !(note.revises && note.why.startsWith("Revises: ")) && <p className="text-muted-foreground mt-0.5 text-micro">{note.why}</p>}
            </>
          )}
          <div className="mt-2 flex items-center gap-1">
            {editing ? (
              <>
                <Button size="xs" onClick={() => void finish("save")} disabled={!canSave} loading={busy === "save"}>
                  <Check className="size-3.5" />
                  Save
                </Button>
                <Button size="xs" variant="ghost" onClick={() => (setDraft(note.text), setEditing(false))} disabled={busy !== null}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button size="xs" onClick={() => void finish("keep")} loading={busy === "keep"} disabled={busy !== null && busy !== "keep"}>
                  Keep
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setEditing(true)} disabled={busy !== null}>
                  Edit
                </Button>
                <Button size="xs" variant="ghost" className="hover:text-destructive" onClick={() => void finish("forget")} loading={busy === "forget"} disabled={busy !== null && busy !== "forget"}>
                  Forget
                </Button>
                <span className="text-faint ml-auto text-micro tabular-nums motion-safe:hidden" aria-hidden>
                  {halted ? "paused" : "keeps in 8 s"}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void finish("keep")}
          aria-label="Close (keeps the note)"
          title="Close — keeps it"
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring -mt-1 -mr-1.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {!editing && (
        <div className="bg-border absolute inset-x-0 bottom-0 h-px" aria-hidden>
          <div className={cn("memory-countdown bg-foreground/50 h-full w-full")} style={{ "--memory-countdown": `${AUTO_KEEP_MS}ms` } as React.CSSProperties} />
        </div>
      )}
    </div>
  );
}
