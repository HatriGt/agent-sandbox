import * as React from "react";
import { Loader2, Pencil, Send, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { ArmButton } from "@/components/ui/arm-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface QueueTrayItem {
  id: string;
  text: string;
  /** queued: waiting for the turn to end · stopping: the turn is being stopped for it · delivering: on its way into the log. */
  status: "queued" | "stopping" | "delivering";
  /** Deliver it now: stops the running turn, so the button arms first. */
  onSendNow?: () => void;
  /** Take it back out of the queue. */
  onCancel?: () => void;
  /** Rewrite it before the agent has it. Rejects (with a toast already shown) when the server refuses. */
  onEdit?: (text: string) => Promise<void>;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Messages waiting behind a running turn, held at the top of the composer — the place they were
 * typed, next in line to go — rather than inside the transcript, where they used to sit above the
 * agent's streaming reply and read as if already delivered. One row per message in the order the
 * agent will read them: its number, the text (two lines, then clipped), and what you can still do:
 * edit it in place (the row becomes a small editor; Enter saves, Esc cancels), `Send now` (an
 * ArmButton: it stops the turn, so it asks once) and a × to take it back. A row whose turn is
 * being stopped, or that is on its way, shows that instead of the buttons. The tray folds away
 * when the last message leaves; the message then enters the transcript as a You bubble.
 */
export function QueueTray({ items }: { items: QueueTrayItem[] }) {
  const still = useReducedMotion();
  const fold = {
    initial: still ? { opacity: 0 } : { height: 0, opacity: 0 },
    animate: still ? { opacity: 1 } : { height: "auto", opacity: 1 },
    exit: still ? { opacity: 0 } : { height: 0, opacity: 0 },
    transition: { duration: still ? 0.12 : 0.24, ease: EASE },
  };
  return (
    <AnimatePresence initial={false}>
      {items.length > 0 && (
        <motion.div
          key="queue-tray"
          {...fold}
          // Spans the composer edge to edge (its p-2 undone), like the changes dock, and takes the
          // inner corner radius. Clicks stop here so a button does not also focus the textarea.
          className="-mx-2 -mt-2 mb-2 overflow-hidden rounded-t-[15px] border-b"
          onClick={(e) => e.stopPropagation()}
          data-queue-tray
          aria-label="Queued messages"
        >
          <div className="text-muted-foreground flex items-center gap-2 px-3 pt-2.5 pb-1 text-micro font-medium">
            <span className="bg-live breathe size-1.5 shrink-0 rounded-full motion-reduce:animate-none" aria-hidden />
            <span className="tabular">{items.length > 1 ? `Queued · ${items.length}` : "Queued"}</span>
          </div>
          <ul className="divide-y">
            <AnimatePresence initial={false}>
              {items.map((it, i) => (
                <motion.li key={it.id} layout={still ? false : "position"} {...fold} className="overflow-hidden">
                  <Row item={it} index={i} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Row({ item: it, index }: { item: QueueTrayItem; index: number }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(it.text);
  const [saving, setSaving] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  // The row's actions leave (the stop began, the message is on its way): so does the editor.
  React.useEffect(() => {
    if (it.status !== "queued" || !it.onEdit) setEditing(false);
  }, [it.status, it.onEdit]);
  const open = () => {
    setDraft(it.text);
    setEditing(true);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };
  const changed = draft.trim() !== "" && draft.trim() !== it.text.trim();
  const save = async () => {
    if (!changed || saving || !it.onEdit) return;
    setSaving(true);
    try {
      await it.onEdit(draft.trim());
      setEditing(false);
    } catch {
      /* the handler already said why; the words stay in the editor */
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex min-w-0 items-start gap-2.5 px-3 py-1.5">
        <span className="text-faint w-3 shrink-0 pt-1.5 text-center font-mono text-micro tabular" aria-hidden>
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <textarea
            ref={ref}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void save();
              }
            }}
            disabled={saving}
            rows={1}
            aria-label={`Edit queued message ${index + 1}`}
            className="field-sizing-content text-foreground focus-visible:border-ring w-full resize-none rounded-md border bg-transparent px-2 py-1 text-meta leading-snug outline-none disabled:opacity-60"
          />
          <div className="mt-1.5 flex items-center justify-end gap-1">
            <span className="text-faint mr-auto text-micro">Enter to save · Esc to keep the original</span>
            <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(false)} disabled={saving} className="rounded-full">
              Cancel
            </Button>
            <Button type="button" size="xs" onClick={() => void save()} disabled={!changed} loading={saving} className="rounded-full">
              <span hidden aria-hidden />
              Save
            </Button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-3 py-1.5">
      <span className="text-faint w-3 shrink-0 text-center font-mono text-micro tabular" aria-hidden>
        {index + 1}
      </span>
      <p className="text-foreground min-w-0 flex-1 text-meta leading-snug [overflow-wrap:anywhere] line-clamp-2">{it.text}</p>
      <div className="flex shrink-0 items-center gap-0.5">
        <AnimatePresence mode="popLayout" initial={false}>
          {it.status === "queued" ? (
            <motion.div key="actions" className="flex items-center gap-0.5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {it.onEdit && (
                <Button type="button" size="icon-xs" variant="ghost" onClick={open} aria-label="Edit" title="Edit the message" className="rounded-full">
                  <Pencil aria-hidden />
                </Button>
              )}
              {it.onSendNow && (
                <ArmButton size="xs" variant="ghost" icon={<Send className="size-3.5" aria-hidden />} label="Send now" armedLabel="Stop the turn & send" onConfirm={it.onSendNow} className="rounded-full" />
              )}
              {it.onCancel && (
                <Button type="button" size="icon-xs" variant="ghost" onClick={it.onCancel} aria-label="Remove from the queue" title="Remove from the queue" className="rounded-full">
                  <X aria-hidden />
                </Button>
              )}
            </motion.div>
          ) : (
            <motion.span
              key={it.status}
              role="status"
              className={cn("text-muted-foreground flex h-7 items-center gap-1.5 pr-1 text-micro")}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
              {it.status === "stopping" ? "Stopping the turn…" : "Delivering…"}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
