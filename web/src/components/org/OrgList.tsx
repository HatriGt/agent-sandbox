import * as React from "react";
import { Building2, ChevronRight, Crown, Plus, Shield } from "lucide-react";
import { toast } from "sonner";
import { api, type OrgView } from "@/lib/api";
import { getMe, setMe } from "@/lib/auth";
import { useGo } from "@/lib/route";
import { Button } from "@/components/ui/button";
import { Swap } from "@/components/ui/swap";
import { ListSkeleton } from "@/components/ui/list-state";
import { Panel, PanelFooter, SettingsSection } from "@/components/ui/settings";
import { cn } from "@/lib/utils";

const MAX_OWNED = 5;

/**
 * The organisations a person is in, on the Account page: open one, or start one by naming it. An
 * org is where a team's MCP servers, skills and memory live; everyone added by email gets them in
 * every run without touching their own settings.
 */
export function OrgList() {
  const go = useGo();
  const me = getMe();
  const [orgs, setOrgs] = React.useState<OrgView[] | null>(null);
  const [name, setName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const load = React.useCallback(() => api.orgs().then((r) => setOrgs(r.orgs)).catch(() => setOrgs([])), []);
  React.useEffect(() => void load(), [load]);
  if (me?.kind !== "user") return null;

  const owned = (orgs ?? []).filter((o) => o.role === "owner").length;
  const create = async () => {
    const n = name.trim();
    if (!n || creating) return;
    setCreating(true);
    try {
      const r = await api.createOrg(n);
      setOrgs(r.orgs);
      setName("");
      setMe(await api.me());
      toast.success(`${r.org.name} is yours`, { description: "Add the team's email addresses next." });
      go({ view: "org", id: r.org.id });
    } catch (e) {
      toast.error("Could not create the organisation", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setCreating(false);
    }
  };
  const state = orgs === null ? "loading" : orgs.length === 0 ? "empty" : "list";
  return (
    <SettingsSection id="orgs" title="Organisations" meta={orgs?.length ? `${orgs.length}` : undefined} purpose="Share MCP servers, skills and memory with a team. Everyone you add by email gets them in every run, automatically.">
      <Panel>
        <Swap state={state}>
          {state === "loading" ? (
            <ListSkeleton rows={1} />
          ) : state === "empty" ? (
            <div className="flex items-center gap-3 px-3.5 py-3">
              <span className="tile grid size-8 shrink-0 place-items-center rounded-full shadow-e1" aria-hidden>
                <Building2 className="text-muted-foreground size-4" strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="text-foreground block text-meta font-medium">No organisation yet</span>
                <span className="text-muted-foreground block text-micro">Name one below — you own it and add people by email.</span>
              </span>
            </div>
          ) : (
            <ul className="divide-y">
              {(orgs ?? []).map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => go({ view: "org", id: o.id })} className="hover:bg-muted/40 focus-visible:bg-muted/40 flex w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none transition-colors duration-150">
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", o.role === "owner" ? "bg-live/8 text-live" : "tile text-muted-foreground shadow-e1")} aria-hidden>
                      {o.role === "owner" ? <Crown className="size-4" strokeWidth={1.75} /> : o.role === "admin" ? <Shield className="size-4" strokeWidth={1.75} /> : <Building2 className="size-4" strokeWidth={1.75} />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-foreground truncate text-meta font-medium">{o.name}</span>
                      <span className="text-muted-foreground truncate text-micro tabular-nums">
                        {o.role === "owner" ? "You own it" : o.role === "admin" ? "You are an admin" : `Owned by @${o.ownerLogin ?? "someone"}`} · {o.members} {o.members === 1 ? "person" : "people"}
                        {o.pending ? ` · ${o.pending} invited` : ""}
                      </span>
                    </span>
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Swap>
        {owned < MAX_OWNED && (
          <PanelFooter>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              placeholder="Name of a new organisation — e.g. Acme Robotics"
              aria-label="Name of the new organisation"
              maxLength={60}
              className="placeholder:text-muted-foreground text-foreground h-8 min-w-0 flex-1 rounded-md bg-transparent px-1 text-meta outline-none"
            />
            <Button size="sm" variant="outline" onClick={() => void create()} loading={creating} disabled={name.trim().length < 2}>
              <Plus />
              Create
            </Button>
          </PanelFooter>
        )}
      </Panel>
    </SettingsSection>
  );
}
