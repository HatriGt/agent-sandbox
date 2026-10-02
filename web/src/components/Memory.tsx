import * as React from "react";
import { ArrowLeft, Brain, Check, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type MemoryNote } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { fmtAgo, friendlyName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, SettingsSection } from "@/components/ui/settings";
import { Switch } from "@/components/ui/switch";
import { Bar } from "@/components/thread/Skeletons";

/**
 * Memory: what earlier runs left for future ones (src/memory-store.ts). One section per repo plus
 * "any repo", each a plain list of facts — pin to keep a note past the cap, edit it in place, or
 * delete it. Everything shown is a stored note; nothing here is derived or guessed. The switch at
 * the top turns the whole feature off (nothing written, nothing installed in boxes).
 */
export function MemoryPage({ onBack }: { onBack: () => void }) {
  const cached = useCached("memory-notes", (signal) => api.memoryNotes(signal));
  const data = cached.data ?? null;
  const notes = data?.notes ?? null;

  const apply = React.useCallback(
    async (p: Promise<{ enabled: boolean; notes: MemoryNote[] }>, ok?: string) => {
      try {
        cached.setData(await p);
        if (ok) toast.success(ok);
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [cached]
  );

  const groups = React.useMemo(() => {
    const by = new Map<string, MemoryNote[]>();
    for (const n of notes ?? []) {
      const k = n.repo ?? "";
      by.set(k, [...(by.get(k) ?? []), n]);
    }
    // Repos alphabetically, the global section last — repo notes are what a run reaches for first.
    return [...by.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [notes]);

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-6 md:px-8 md:py-8">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden">
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-foreground font-serif text-h1 font-normal tracking-[-0.01em]">Memory</h1>
            <p className="text-muted-foreground mt-1 text-meta">What your agents learned on earlier runs — conventions, decisions, quirks — handed to every new run as MEMORY.md.</p>
          </div>
          {data && (
            <label className="flex shrink-0 items-center gap-2 text-meta">
              <span className={cn(data.enabled ? "text-foreground" : "text-muted-foreground")}>Memory across runs</span>
              <Switch size="sm" checked={data.enabled} onCheckedChange={(on) => void apply(api.memoryNoteUpdate({ enabled: on }), on ? "Memory on" : "Memory off — runs start from scratch")} aria-label="Memory across runs" />
            </label>
          )}
        </header>

        {cached.error && !notes ? (
          <EmptyState icon={Brain} tone="destructive" title="Could not load memory" line={cached.error} />
        ) : !notes ? (
          <ul className="flex flex-col gap-2" aria-busy>
            {[0, 1, 2].map((i) => (
              <Bar key={i} className="h-10 rounded-lg" />
            ))}
          </ul>
        ) : notes.length === 0 ? (
          <EmptyState icon={Brain} title="Nothing remembered yet" line="Runs add notes as they finish — an agent that learns a convention or you answer a question leaves a line here for the next run." />
        ) : (
          <div className="flex flex-col gap-8">
            {groups.map(([repo, list]) => (
              <SettingsSection key={repo || "global"} id={`memory-${repo.replace(/[^\w-]/g, "-") || "global"}`} title={repo || "Any repo"} meta={`${list.length} note${list.length === 1 ? "" : "s"}`}>
                <Panel>
                  <ul className={cn("divide-y", !data?.enabled && "opacity-60")}>
                    {list.map((n) => (
                      <NoteRow
                        key={n.id}
                        note={n}
                        onPin={(pinned) => void apply(api.memoryNoteUpdate({ id: n.id, pinned }))}
                        onSave={(text) => apply(api.memoryNoteUpdate({ id: n.id, text }), "Note updated")}
                        onDelete={() => void apply(api.memoryNoteDelete(n.id), "Forgotten")}
                      />
                    ))}
                  </ul>
                </Panel>
              </SettingsSection>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NoteRow({ note, onPin, onSave, onDelete }: { note: MemoryNote; onPin: (pinned: boolean) => void; onSave: (text: string) => Promise<void>; onDelete: () => void }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(note.text);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const save = async () => {
    const t = draft.trim();
    if (!t || t === note.text) return setEditing(false);
    await onSave(t);
    setEditing(false);
  };
  const source = `from ${friendlyName(note.source)}`;

  return (
    <li className="group flex items-start gap-3 px-3.5 py-2.5">
      {editing ? (
        <form
          className="flex min-w-0 flex-1 flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <textarea
            ref={ref}
            value={draft}
            maxLength={400}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") (setDraft(note.text), setEditing(false));
              if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), void save());
            }}
            className="bg-background text-foreground focus-visible:ring-live/40 w-full resize-none rounded-md border px-2 py-1.5 text-body outline-none focus-visible:ring-2"
            aria-label="Note text"
          />
          <div className="flex items-center gap-1">
            <Button type="submit" size="sm">
              <Check className="size-4" />
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => (setDraft(note.text), setEditing(false))}>
              <X className="size-4" />
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-body leading-snug break-words">{note.text}</p>
          <p className="text-faint mt-0.5 text-micro tabular-nums">
            {source} · {fmtAgo(Math.floor(note.at / 1000))}
            {note.pinned && " · pinned"}
          </p>
        </div>
      )}
      {!editing && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
          <Button variant="ghost" size="icon-sm" aria-pressed={!!note.pinned} aria-label={note.pinned ? "Unpin note" : "Pin note (never evicted)"} title={note.pinned ? "Unpin" : "Pin — never evicted"} onClick={() => onPin(!note.pinned)}>
            {note.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Edit note" title="Edit" onClick={() => (setDraft(note.text), setEditing(true))}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Delete note" title="Forget" className="hover:text-destructive" onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </li>
  );
}
