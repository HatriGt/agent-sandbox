import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Brain, Download, Plus, Trash2, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api, type MemoryNote, type OrgRef } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { useReducedMotion } from "@/lib/motion-pref";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Collapse } from "@/components/ui/collapse";
import { Switch } from "@/components/ui/switch";
import { Swap } from "@/components/ui/swap";
import { ListEmpty, ListSkeleton } from "@/components/ui/list-state";
import { Panel, SettingsSection } from "@/components/ui/settings";
import { Composer, KindGlyph } from "@/components/Memory";
import { PickFromMine } from "@/components/org/PickFromMine";
import { NoteStatement } from "@/components/memory/noteText";
import { plural } from "@/components/memory/kinds";
import { cn } from "@/lib/utils";

/**
 * An organisation's memory: preferences, rules and domain notes every member's run is handed in
 * MEMORY.md next to their own. Curated by hand here (or imported from a Markdown export) — runs
 * write what they learn into the person's memory, never into the org's, so nothing a member's
 * agent picks up leaks to the team unreviewed.
 */
export function OrgMemory({ org }: { org: OrgRef }) {
  const manage = org.role !== "member";
  const still = useReducedMotion();
  const cached = useCached(`memory-notes:${org.id}`, (signal) => api.memoryNotes(signal, org.id));
  const data = cached.data ?? null;
  const notes = React.useMemo(() => (data?.notes ?? []).filter((n) => n.until === undefined && n.status !== "pending").sort((a, b) => b.at - a.at), [data]);
  const [composing, setComposing] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const apply = async (p: Promise<Parameters<typeof cached.setData>[0]>, ok?: string): Promise<boolean> => {
    try {
      cached.setData(await p);
      if (ok) toast.success(ok);
      return true;
    } catch (e) {
      toast.error("Could not update memory", { description: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };
  const exportMd = async () => {
    try {
      const blob = await api.memoryExport(org.id);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${org.name.replace(/[^\w-]+/g, "-").toLowerCase()}-memory.md`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error("Could not export", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const importMd = async (file: File | undefined) => {
    if (!file) return;
    const before = notes.length;
    const r = await api.memoryImport(await file.text(), org.id).catch((e: unknown) => {
      toast.error("Could not import", { description: e instanceof Error ? e.message : String(e) });
      return null;
    });
    if (fileRef.current) fileRef.current.value = "";
    if (!r) return;
    cached.setData(r);
    const added = r.notes.filter((n) => n.until === undefined).length - before;
    toast.success(added > 0 ? `Imported ${plural(added, "note")}` : "Nothing new in that file");
  };

  return (
    <SettingsSection
      id="org-memory"
      title="Memory"
      meta={data ? (notes.length ? plural(notes.length, "note") : "none yet") : undefined}
      purpose={manage ? "Preferences, rules and domain notes every member's run is handed in MEMORY.md, beside their own. Written here by hand, never by a run." : "What the organisation tells your runs, in MEMORY.md beside your own notes."}
      actions={
        data && manage ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
              <UserRound className="size-4" />
              From yours
            </Button>
            <Button variant="outline" size="sm" onClick={() => setComposing((v) => !v)} aria-expanded={composing} aria-controls="org-memory-composer">
              <Plus className="size-4" />
              Add
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void exportMd()} disabled={!notes.length} title="Download every note as one Markdown file">
              <Download className="size-4" />
              Export
            </Button>
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} title="Add notes from a Markdown export">
              <Upload className="size-4" />
              Import
            </Button>
            <input ref={fileRef} type="file" accept=".md,text/markdown,text/plain" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void importMd(e.target.files?.[0])} />
            <label className="ml-1 flex items-center gap-2 text-meta">
              <span className={cn(data.enabled ? "text-foreground" : "text-muted-foreground")}>Shared</span>
              <Switch size="sm" checked={data.enabled} onCheckedChange={(on) => void apply(api.memoryNoteUpdate({ enabled: on }, org.id), on ? "Shared with every member" : "Kept, not shared")} aria-label="Share the organisation's memory" />
            </label>
          </>
        ) : undefined
      }
    >
      {cached.error && (
        <p role="alert" className="text-destructive mb-3 text-meta">
          {cached.error}
        </p>
      )}
      <PickFromMine org={org} kind="notes" open={picking} onClose={() => setPicking(false)} existing={new Set(notes.map((n) => n.id))} onDone={() => cached.refresh()} />
      <Collapse open={composing}>
        <Composer
          id="org-memory-composer"
          onCancel={() => setComposing(false)}
          onAdd={async (add) => {
            const ok = await apply(api.memoryNoteAdd(add, org.id), "Added");
            if (ok) setComposing(false);
            return ok;
          }}
        />
      </Collapse>
      <Swap state={data === null ? "loading" : notes.length === 0 ? "empty" : "list"}>
        <Panel scroll={notes.length > 0}>
          {data === null ? (
            <ListSkeleton rows={3} />
          ) : notes.length === 0 ? (
            <ListEmpty
              icon={Brain}
              title="No shared notes yet"
              line={manage ? "A preference the whole team shares, a rule every run should follow, how the product works." : "Nothing shared yet."}
              action={
                manage ? (
                  <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
                    <UserRound />
                    From your notes
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className={cn("divide-y", data.enabled ? "" : "opacity-60")}>
              <AnimatePresence initial={false}>
                {notes.map((n: MemoryNote) => (
                  <motion.li
                    key={n.id}
                    layout={!still}
                    initial={still ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={still ? { opacity: 0 } : { opacity: 0, transition: { duration: 0.12 } }}
                    className="group flex min-w-0 items-start gap-3 px-3.5 py-2.5"
                  >
                    <KindGlyph kind={n.kind} />
                    <span className="min-w-0 flex-1">
                      <NoteStatement text={n.text} />
                      {n.why && <span className="text-muted-foreground mt-0.5 block text-micro">{n.why}</span>}
                      {(n.repo || n.area) && (
                        <span className="text-faint stamp mt-0.5 block truncate">
                          {n.repo}
                          {n.area ? ` · ${n.area}` : ""}
                        </span>
                      )}
                    </span>
                    {manage && <ArmButton size="icon-xs" variant="ghost" icon={<Trash2 />} label="Forget this note" armedLabel="Forget" onConfirm={() => apply(api.memoryNoteDelete(n.id, org.id), "Forgotten").then(() => {})} className="text-muted-foreground hover:text-destructive opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" />}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </Panel>
      </Swap>
    </SettingsSection>
  );
}
