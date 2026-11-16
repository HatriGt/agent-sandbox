import * as React from "react";
import { Download, Plus, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, type OrgRef, type SkillView } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { Button } from "@/components/ui/button";
import { Panel, SettingsSection } from "@/components/ui/settings";
import { ListEmpty } from "@/components/ui/list-state";
import { Swap } from "@/components/ui/swap";
import { ImportDialog } from "@/components/skills/ImportDialog";
import { SkillTable } from "@/components/skills/SkillLibrary";
import type { Draft, Mutate } from "@/components/skills/model";

export type OrgSkillEditing = { key: number; initial?: SkillView; draft?: Draft };

/**
 * An organisation's skills: the same table and editor as the personal library, saved under the
 * org's key. The editor is the page's concern (it replaces the whole page while open, as on the
 * Skills page), so this section hands `onEdit` what to open and `useOrgSkills` the mutate to save with.
 */
export function useOrgSkills(org: OrgRef) {
  const cached = useCached(`skills:${org.id}`, (signal) => api.skills(signal, org.id));
  const mutate = React.useCallback<Mutate>(
    async (body, ok) => {
      const r = await api.skillMutate(body, org.id);
      cached.setData(r);
      if (ok) toast.success(ok);
      return r;
    },
    [cached, org.id]
  );
  return { skills: cached.data?.skills ?? null, error: cached.error, mutate, refresh: async () => cached.setData(await api.skills(undefined, org.id)) };
}

export function OrgSkills({ org, skills, error, mutate, refresh, onEdit }: { org: OrgRef; skills: SkillView[] | null; error: string | null; mutate: Mutate; refresh: () => Promise<void>; onEdit: (e: Omit<OrgSkillEditing, "key">) => void }) {
  const manage = org.role !== "member";
  const [importing, setImporting] = React.useState(false);
  const existing = React.useMemo(() => Object.fromEntries((skills ?? []).map((s) => [s.name, true as const])), [skills]);
  const on = (skills ?? []).filter((s) => s.enabled).length;
  return (
    <SettingsSection
      id="org-skills"
      title="Skills"
      meta={skills ? (skills.length === 0 ? "none yet" : `${on} of ${skills.length} on`) : undefined}
      purpose={manage ? "Playbooks every member's sandbox can use — synced in before each run, invoked with /name or picked up when they fit. A member's own skill of the same name wins." : "Playbooks the organisation gives your sandboxes. Only its admins change them."}
      actions={
        manage ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              <Download />
              Import
            </Button>
            <Button size="sm" onClick={() => onEdit({ draft: { name: "", description: "", content: "" } })}>
              <Plus />
              New skill
            </Button>
          </>
        ) : undefined
      }
    >
      {error && (
        <p role="alert" className="text-destructive mb-3 text-meta">
          {error}
        </p>
      )}
      <Swap state={skills === null ? "loading" : skills.length === 0 ? "empty" : "list"}>
        {skills !== null && skills.length === 0 ? (
          <Panel>
            <ListEmpty
              icon={Zap}
              title="No shared skills yet"
              line={manage ? "Write one here, or import from GitHub or a SKILL.md — every member gets it on their next run." : "Nothing shared yet."}
              action={
                manage ? (
                  <Button size="sm" variant="outline" onClick={() => onEdit({ draft: { name: "", description: "", content: "" } })}>
                    <Plus />
                    New skill
                  </Button>
                ) : undefined
              }
            />
          </Panel>
        ) : (
          <SkillTable skills={skills ?? []} loading={skills === null} readOnly={!manage} owner={org.name} onOpen={(s) => manage && onEdit({ initial: s })} onMutate={mutate} />
        )}
      </Swap>
      <ImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        existing={existing}
        mutate={(b) => api.skillMutate(b, org.id)}
        onImported={async (count) => {
          await refresh();
          toast.success(`Imported ${count} skill${count === 1 ? "" : "s"} — every member gets them on their next turn`);
        }}
        onEditOne={(d) => {
          setImporting(false);
          onEdit({ draft: d });
        }}
      />
    </SettingsSection>
  );
}
