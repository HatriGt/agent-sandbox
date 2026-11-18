import * as React from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { SkillView } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { editedSinceImport, type Mutate, repoLabel } from "./model";

/**
 * "Get latest" for an imported skill: one round trip that compares the skill against the
 * repository it came from and, when the repository moved on, replaces the stored version. Edits
 * made here since the import are never replaced silently — the dialog asks once. Shared by the
 * library row and the editor's inspector so both behave the same.
 */
export function useGetLatest(onMutate: Mutate, onApplied?: (s: SkillView) => void) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<{ skill: SkillView; why: string } | null>(null);

  const run = React.useCallback(
    async (s: SkillView, opts: { force?: boolean; unsavedEdits?: boolean } = {}) => {
      if (!s.source) return;
      if (!opts.force) {
        if (opts.unsavedEdits) return setConfirm({ skill: s, why: "The editor has changes that are not saved. Getting the latest version discards them." });
        if (editedSinceImport(s)) return setConfirm({ skill: s, why: `/${s.name} was edited here after it was imported. Getting the latest version replaces those edits.` });
      }
      setBusy(s.name);
      try {
        const r = await onMutate({ action: "update", name: s.name, force: !!opts.force });
        const u = r.updated;
        if (u?.changed) {
          toast.success(`/${s.name} is now the latest from ${repoLabel(s.source)}`, {
            description: u.skipped.length ? `${u.skipped.length} file${u.skipped.length === 1 ? "" : "s"} skipped: ${u.skipped.slice(0, 4).join(", ")}` : "Every sandbox gets it on its next turn.",
          });
        } else {
          toast.info(`/${s.name} is already the latest`, { description: `${repoLabel(s.source)} on ${s.source.branch} has not changed since it was imported.` });
        }
        const saved = r.skills.find((x) => x.name === s.name);
        if (saved) onApplied?.(saved);
      } catch (e) {
        toast.error(`Could not get the latest /${s.name}`, { description: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(null);
        setConfirm(null);
      }
    },
    [onMutate, onApplied]
  );

  const dialog = (
    <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
      <DialogContent title="Replace your edits?" description={confirm?.why} className="w-[min(26rem,calc(100vw-2rem))]">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirm(null)} autoFocus>
            Keep mine
          </Button>
          <Button size="sm" loading={!!busy} onClick={() => confirm && void run(confirm.skill, { force: true })}>
            <RefreshCw />
            Get latest
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { run, busy, dialog };
}

/** The row control: a quiet icon that reads as ink, named for where the skill came from. */
export function GetLatestButton({ skill, available, busy, onClick }: { skill: SkillView; available?: boolean; busy?: boolean; onClick: () => void }) {
  if (!skill.source) return null;
  const label = available ? `Get the newer version from ${repoLabel(skill.source)}` : `Get latest from ${repoLabel(skill.source)}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-xs" variant="ghost" onClick={onClick} loading={busy} aria-label={label} className={available ? "text-foreground" : undefined}>
          <RefreshCw />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{editedSinceImport(skill) ? `${label} — replaces your edits` : label}</TooltipContent>
    </Tooltip>
  );
}
