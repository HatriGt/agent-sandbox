import * as React from "react";
import { Check, Plug, UserRound, Zap, Brain } from "lucide-react";
import { toast } from "sonner";
import { api, type OrgRef } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ListSkeleton } from "@/components/ui/list-state";
import { KIND_LABEL } from "@/components/memory/kinds";
import { cn } from "@/lib/utils";

export type MineKind = "servers" | "skills" | "notes";

type Row = { key: string; name: string; detail?: string; tag?: string; on?: boolean };

const WORD: Record<MineKind, [string, string]> = { servers: ["server", "servers"], skills: ["skill", "skills"], notes: ["note", "notes"] };
const ICON: Record<MineKind, typeof Plug> = { servers: Plug, skills: Zap, notes: Brain };

/**
 * An admin's own servers, skills or memory notes, picked into the organisation. The copy happens on
 * the controller (`POST /orgs/copy.json`) because the browser only ever sees masked secrets: a
 * server copied here arrives with its real env and headers. Items the organisation already has by
 * the same name are listed but marked, and picking one replaces the org's copy.
 */
export function PickFromMine({ org, kind, open, onClose, existing, onDone }: { org: OrgRef; kind: MineKind; open: boolean; onClose: () => void; existing: Set<string>; onDone: () => Promise<void> | void }) {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<Record<string, true>>({});
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setRows(null);
    setPicked({});
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
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Your ${WORD[kind][1]}, into ${org.name}`}
        description={kind === "servers" ? "Copied with their secrets. The organisation's copy is separate from yours: later edits on one side do not touch the other." : kind === "skills" ? "Copied as they are now. The organisation's copy is separate from yours." : "Copied as shared notes. Your own stay yours."}
        className="sm:max-w-lg"
      >
        {error && (
          <p role="alert" className="text-destructive text-meta">
            {error}
          </p>
        )}
        <div className="surface max-h-[50dvh] overflow-y-auto">
          {rows === null && !error ? (
            <ListSkeleton rows={3} />
          ) : all.length === 0 ? (
            <div className="flex items-center gap-3 px-3.5 py-4">
              <span className="tile grid size-8 shrink-0 place-items-center rounded-full shadow-e1" aria-hidden>
                <Icon className="text-muted-foreground size-4" strokeWidth={1.75} />
              </span>
              <span className="text-muted-foreground text-meta">You have no {WORD[kind][1]} of your own yet.</span>
            </div>
          ) : (
            <ul className="divide-y" role="group" aria-label={`Your ${WORD[kind][1]}`}>
              {all.map((r) => {
                const on = !!picked[r.key];
                const has = existing.has(r.key);
                return (
                  <li key={r.key}>
                    <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(r.key)} className={cn("hover:bg-muted/50 flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-left transition-colors duration-100", on && "bg-live/5")}>
                      <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-[4px] border transition-[background-color,border-color] duration-120", on ? "bg-live border-live text-white" : "bg-background")}>{on && <Check className="size-3" aria-hidden />}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("text-foreground block text-meta font-medium", kind !== "notes" && "stamp truncate", kind === "notes" && "line-clamp-2")}>{r.name}</span>
                        {r.detail && <span className={cn("text-faint block truncate text-micro", kind === "servers" && "stamp")}>{r.detail}</span>}
                      </span>
                      {r.tag && <span className="bg-foreground/6 text-muted-foreground hidden shrink-0 rounded-full px-2 py-0.5 text-micro sm:inline">{r.tag}</span>}
                      {r.on === false && <span className="text-faint shrink-0 text-micro">off for you</span>}
                      {has && <span className="text-attention-text shrink-0 text-micro">replaces the org's</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-2">
          {all.length > 1 && (
            <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setPicked(keys.length === all.length ? {} : Object.fromEntries(all.map((r) => [r.key, true as const])))}>
              {keys.length === all.length ? "None" : "All"}
            </Button>
          )}
          <span className="text-muted-foreground text-micro tabular-nums">{keys.length ? `${keys.length} of ${all.length} picked` : ""}</span>
          <span className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void add()} loading={busy} disabled={!keys.length}>
              <UserRound />
              Add to {org.name}
            </Button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
