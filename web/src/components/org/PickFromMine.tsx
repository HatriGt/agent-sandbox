import * as React from "react";
import { Check, Plug, Search, Zap, Brain } from "lucide-react";
import { toast } from "sonner";
import { api, type OrgRef } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { ListSkeleton } from "@/components/ui/list-state";
import { KIND_LABEL } from "@/components/memory/kinds";
import { cn } from "@/lib/utils";

export type MineKind = "servers" | "skills" | "notes";

type Row = { key: string; name: string; detail?: string; tag?: string; on?: boolean };

const WORD: Record<MineKind, [string, string]> = { servers: ["server", "servers"], skills: ["skill", "skills"], notes: ["note", "notes"] };
const ICON: Record<MineKind, typeof Plug> = { servers: Plug, skills: Zap, notes: Brain };
const SEARCH_FROM = 7;

/**
 * An admin's own servers, skills or memory notes, picked into the organisation. The copy happens on
 * the controller (`POST /orgs/copy.json`) because the browser only ever sees masked secrets: a
 * server copied here arrives with its real env and headers. Items the organisation already has by
 * the same name are listed but marked, and picking one replaces the org's copy.
 *
 * Shape: the list is a surface (header line: count and Select all; a tile of checkbox rows with
 * the name on the left and the type chip and any note on the right), a search field once the
 * list is long enough to need one, and the dialog footer carries the count and the two buttons.
 */
export function PickFromMine({ org, kind, open, onClose, existing, onDone }: { org: OrgRef; kind: MineKind; open: boolean; onClose: () => void; existing: Set<string>; onDone: () => Promise<void> | void }) {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<Record<string, true>>({});
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setRows(null);
    setPicked({});
    setQuery("");
    setError(null);
    const ctrl = new AbortController();
    const load = async (): Promise<Row[]> => {
      if (kind === "servers") {
        const r = await api.mcpServers(ctrl.signal);
        return r.servers.filter((s) => !s.excluded).map((s) => ({ key: s.name, name: s.name, detail: s.type === "stdio" ? [s.command, ...(s.args ?? [])].join(" ") : s.url, tag: s.type === "stdio" ? "command" : s.type, on: s.enabled }));
      }
      if (kind === "skills") {
        const r = await api.skills(ctrl.signal);
        return r.skills.map((s) => ({ key: s.name, name: `/${s.name}`, detail: s.description, on: s.enabled }));
      }
      const r = await api.memoryNotes(ctrl.signal);
      return r.notes.filter((n) => n.until === undefined && n.status !== "pending").sort((a, b) => b.at - a.at).map((n) => ({ key: n.id, name: n.text, detail: n.repo ? `${n.repo}${n.area ? ` · ${n.area}` : ""}` : n.why, tag: KIND_LABEL[n.kind] }));
    };
    load()
      .then(setRows)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, [open, kind]);

  const keys = Object.keys(picked);
  const all = rows ?? [];
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((r) => `${r.name} ${r.detail ?? ""} ${r.tag ?? ""}`.toLowerCase().includes(q)) : all;
  const allPicked = all.length > 0 && keys.length === all.length;
  const toggle = (k: string) =>
    setPicked((p) => {
      const n = { ...p };
      if (n[k]) delete n[k];
      else n[k] = true;
      return n;
    });
  const add = async () => {
    if (!keys.length || busy) return;
    setBusy(true);
    try {
      const r = await api.orgCopy(org.id, { [kind]: keys });
      const n = kind === "notes" ? r.copied.notes : r.copied[kind].length;
      toast.success(`${n} ${WORD[kind][n === 1 ? 0 : 1]} now shared by ${org.name}`, { description: "Every member gets them on their next run." });
      await onDone();
      onClose();
    } catch (e) {
      toast.error("Could not copy", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const Icon = ICON[kind];
  const word = WORD[kind];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Your ${word[1]}, into ${org.name}`}
        description={kind === "servers" ? "Copied with their secrets. The organisation's copy is separate from yours: later edits on one side do not touch the other." : kind === "skills" ? "Copied as they are now. The organisation's copy is separate from yours." : "Copied as shared notes. Your own stay yours."}
        className="w-[min(36rem,calc(100vw-2rem))]"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void add();
          }
        }}
      >
        {error && (
          <p role="alert" className="bg-destructive/10 text-destructive mb-3 rounded-lg px-3 py-2 text-meta">
            {error}
          </p>
        )}
        {all.length >= SEARCH_FROM && (
          <label className="bg-card focus-within:ring-ring/40 focus-within:border-ring mb-3 flex h-8 items-center gap-1.5 rounded-md border px-2 transition-[border-color,box-shadow] duration-150 focus-within:ring-2">
            <Search className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery("");
                }
              }}
              placeholder={`Search your ${word[1]}`}
              aria-label={`Search your ${word[1]}`}
              className="placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent text-meta outline-none"
            />
          </label>
        )}
        <div className="surface">
          {rows === null && !error ? (
            <div className="tile">
              <ListSkeleton rows={3} />
            </div>
          ) : all.length === 0 ? (
            <div className="flex items-center gap-3 px-3.5 py-5">
              <span className="tile grid size-8 shrink-0 place-items-center rounded-full shadow-e1" aria-hidden>
                <Icon className="text-muted-foreground size-4" strokeWidth={1.75} />
              </span>
              <span className="text-muted-foreground text-meta">You have no {word[1]} of your own yet.</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 px-3.5 pt-2.5 pb-2">
                <span className="text-muted-foreground text-micro tabular-nums">
                  {q ? `${shown.length} of ${all.length} ${word[1]}` : `${all.length} ${all.length === 1 ? word[0] : word[1]}`}
                </span>
                <button type="button" onClick={() => setPicked(allPicked ? {} : Object.fromEntries(all.map((r) => [r.key, true as const])))} className="text-live cursor-pointer text-micro font-medium hover:underline">
                  {allPicked ? "Clear" : "Select all"}
                </button>
              </div>
              <ul className="tile max-h-[44dvh] divide-y overflow-y-auto" role="group" aria-label={`Your ${word[1]}`}>
                {shown.length === 0 && <li className="text-muted-foreground px-3.5 py-4 text-meta">Nothing matches “{query.trim()}”.</li>}
                {shown.map((r) => {
                  const on = !!picked[r.key];
                  const has = existing.has(r.key);
                  return (
                    <li key={r.key}>
                      <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(r.key)} className={cn("hover:bg-foreground/4 flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-100", on && "bg-live/6")}>
                        <span className={cn("grid size-4 shrink-0 place-items-center rounded-[4px] border transition-[background-color,border-color] duration-120", on ? "bg-live border-live text-white" : "border-line-strong bg-background")}>{on && <Check className="size-3" aria-hidden />}</span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("text-foreground block text-meta font-medium", kind !== "notes" && "stamp truncate", kind === "notes" && "line-clamp-2")}>{r.name}</span>
                          {r.detail && <span className={cn("text-faint block truncate text-micro", kind === "servers" && "stamp")}>{r.detail}</span>}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {has && <span className="bg-attention/12 text-attention-text rounded-full px-2 py-0.5 text-micro">replaces the org's</span>}
                          {r.on === false && <span className="text-faint text-micro">off for you</span>}
                          {r.tag && <span className="bg-foreground/6 text-muted-foreground hidden rounded-full px-2 py-0.5 text-micro sm:inline">{r.tag}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        <DialogFooter>
          <span className="text-muted-foreground mr-auto text-micro tabular-nums" aria-live="polite">
            {keys.length ? `${keys.length} of ${all.length} picked` : all.length ? "Nothing picked yet" : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void add()} loading={busy} disabled={!keys.length}>
            {keys.length ? `Add ${keys.length} to ${org.name}` : `Add to ${org.name}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
