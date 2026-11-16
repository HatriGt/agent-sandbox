import * as React from "react";
import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import { ArrowRightLeft, Building2, Check, ChevronDown, Crown, LogOut, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type OrgMemberView, type OrgRef, type OrgView } from "@/lib/api";
import { getMe, setMe } from "@/lib/auth";
import { useGo } from "@/lib/route";
import { useReducedMotion } from "@/lib/motion-pref";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { SettingsPage } from "@/components/ui/settings";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, MenuHint } from "@/components/ui/dropdown-menu";
import { McpServers } from "@/components/McpServers";
import { SkillEditor } from "@/components/skills/SkillEditor";
import { OrgPeople } from "@/components/org/OrgPeople";
import { OrgSkills, useOrgSkills, type OrgSkillEditing } from "@/components/org/OrgSkills";
import { OrgMemory } from "@/components/org/OrgMemory";

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One organisation: its people, then what it shares — MCP servers, skills, memory — each the same
 * section the personal pages use, pointed at the org's store. The owner renames, hands over or
 * deletes it from the header; an admin adds people and edits what is shared; a member reads.
 */
export function Organisation({ id, onBack }: { id?: string; onBack: () => void }) {
  const go = useGo();
  const [orgs, setOrgs] = React.useState<OrgView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .orgs(ctrl.signal)
      .then((r) => setOrgs(r.orgs))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(err(e));
      });
    return () => ctrl.abort();
  }, []);
  const org = React.useMemo(() => (orgs ? (orgs.find((o) => o.id === id) ?? (id ? undefined : orgs[0])) : undefined), [orgs, id]);

  if (error) return <Shell onBack={onBack}><EmptyState icon={Building2} tone="destructive" title="Could not load organisations" line={error} /></Shell>;
  if (orgs && !org) {
    return (
      <Shell onBack={onBack}>
        {id ? (
          <EmptyState icon={Building2} title="Not one of yours" line="That organisation does not exist, or you are no longer in it." action={<Button variant="outline" size="sm" onClick={onBack}>Back to account</Button>} />
        ) : (
          <CreateFirst onCreated={(o) => { setOrgs((prev) => [...(prev ?? []), o]); go({ view: "org", id: o.id }, { replace: true }); }} />
        )}
      </Shell>
    );
  }
  if (!org) return <Shell onBack={onBack}><div className="text-muted-foreground text-meta">Loading…</div></Shell>;
  return <OrgPage key={org.id} org={org} orgs={orgs ?? []} onBack={onBack} onOrgs={setOrgs} />;
}

function Shell({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  return (
    <SettingsPage title="Organisation" back={{ label: "Account", onClick: onBack }}>
      {children}
    </SettingsPage>
  );
}

function CreateFirst({ onCreated }: { onCreated: (o: OrgView) => void }) {
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const create = async () => {
    if (name.trim().length < 2 || busy) return;
    setBusy(true);
    try {
      const r = await api.createOrg(name.trim());
      setMe(await api.me());
      toast.success(`${r.org.name} is yours`, { description: "Add the team's email addresses next." });
      onCreated(r.org);
    } catch (e) {
      toast.error("Could not create the organisation", { description: err(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <EmptyState
      icon={Building2}
      title="Start an organisation"
      line="Name it, add your team by email, and whatever you set up here — MCP servers, skills, memory — reaches every member's runs automatically."
      action={
        <form
          className="flex w-full max-w-sm items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Robotics" aria-label="Organisation name" maxLength={60} autoFocus />
          <Button type="submit" size="sm" loading={busy} disabled={name.trim().length < 2}>
            <Plus />
            Create
          </Button>
        </form>
      }
    />
  );
}

function OrgPage({ org, orgs, onBack, onOrgs }: { org: OrgView; orgs: OrgView[]; onBack: () => void; onOrgs: (o: OrgView[]) => void }) {
  const go = useGo();
  const still = useReducedMotion();
  const me = getMe();
  const myId = me?.kind === "user" ? me.id : null;
  const ref: OrgRef = { id: org.id, name: org.name, role: org.role };
  const owner = org.role === "owner";
  const manage = org.role !== "member";
  const [members, setMembers] = React.useState<OrgMemberView[] | null>(null);
  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .orgMembers(org.id, ctrl.signal)
      .then((r) => setMembers(r.members))
      .catch(() => setMembers([]));
    return () => ctrl.abort();
  }, [org.id]);
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(org.name);
  const [saving, setSaving] = React.useState(false);
  const [handing, setHanding] = React.useState<OrgMemberView | null>(null);
  const skills = useOrgSkills(ref);
  const [editing, setEditing] = React.useState<OrgSkillEditing | null>(null);
  const seq = React.useRef(0);

  const refreshMe = async () => setMe(await api.me());
  const rename = async () => {
    const n = name.trim();
    if (n.length < 2 || saving) return;
    setSaving(true);
    try {
      const r = await api.renameOrg(org.id, n);
      onOrgs(r.orgs);
      setRenaming(false);
      void refreshMe();
      toast.success("Renamed");
    } catch (e) {
      toast.error("Could not rename", { description: err(e) });
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    try {
      const r = await api.deleteOrg(org.id);
      onOrgs(r.orgs);
      void refreshMe();
      toast.success(`${org.name} deleted`, { description: "Its servers, skills and memory are gone from everyone's runs." });
      onBack();
    } catch (e) {
      toast.error("Could not delete", { description: err(e) });
    }
  };
  const leave = async () => {
    try {
      const r = await api.orgLeave(org.id);
      onOrgs(r.orgs);
      void refreshMe();
      toast.success(`You left ${org.name}`);
      onBack();
    } catch (e) {
      toast.error("Could not leave", { description: err(e) });
    }
  };
  const handOver = async () => {
    if (!handing?.userId) return;
    try {
      const r = await api.orgTransfer(org.id, handing.userId);
      onOrgs(r.orgs);
      setHanding(null);
      void refreshMe();
      toast.success(`${org.name} now belongs to @${handing.login ?? handing.email}`, { description: "You stay as an admin." });
    } catch (e) {
      toast.error("Could not hand over", { description: err(e) });
    }
  };

  const joinedOthers = (members ?? []).filter((m) => m.status === "joined" && m.role !== "owner" && m.userId && m.userId !== myId);
  const people = members ? members.filter((m) => m.status === "joined").length : org.members;

  const EASE = [0.22, 1, 0.36, 1] as const;
  const slide = (dir: 1 | -1): Pick<HTMLMotionProps<"div">, "initial" | "animate" | "exit" | "transition"> => ({
    initial: still ? { opacity: 0 } : { opacity: 0, x: 24 * dir },
    animate: { opacity: 1, x: 0 },
    exit: still ? { opacity: 0 } : { opacity: 0, x: -16 * dir, transition: { duration: 0.14, ease: EASE } },
    transition: { duration: 0.22, ease: EASE },
  });

  return (
    <div className="relative h-full min-h-0 min-w-0 overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        {editing ? (
          <motion.div key={`editor-${editing.key}`} {...slide(1)} className="absolute inset-0">
            <SkillEditor initial={editing.initial} draft={editing.draft} onMutate={skills.mutate} onSaved={(s) => setEditing((e) => (e ? { ...e, initial: s, draft: undefined } : e))} onClose={() => setEditing(null)} />
          </motion.div>
        ) : (
          <motion.div key="org" {...slide(-1)} className="absolute inset-0">
            <SettingsPage
              title={
                renaming ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rename();
                    }}
                  >
                    <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Organisation name" maxLength={60} autoFocus className="h-9 max-w-xs font-serif text-h3" onKeyDown={(e) => e.key === "Escape" && setRenaming(false)} />
                    <Button type="submit" size="icon-sm" variant="outline" aria-label="Save name" loading={saving} disabled={name.trim().length < 2}>
                      <Check />
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setRenaming(false)}>
                      <X />
                    </Button>
                  </form>
                ) : (
                  org.name
                )
              }
              purpose={
                <>
                  {people} {people === 1 ? "person" : "people"}
                  {org.pending ? ` · ${org.pending} invited` : ""} · {owner ? "you own it" : `owned by @${org.ownerLogin ?? "someone"}`}
                  {org.role === "admin" ? " · you are an admin" : org.role === "member" ? " · you are a member" : ""}
                </>
              }
              back={{ label: "Account", onClick: onBack }}
              actions={
                <>
                  {orgs.length > 1 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-muted-foreground">
                          <Building2 />
                          Switch
                          <ChevronDown className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Your organisations</DropdownMenuLabel>
                        {orgs.map((o) => (
                          <DropdownMenuItem key={o.id} onSelect={() => go({ view: "org", id: o.id })} disabled={o.id === org.id}>
                            {o.role === "owner" ? <Crown /> : <Building2 />}
                            {o.name}
                            <MenuHint>{o.members}</MenuHint>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {manage && !renaming && (
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setName(org.name); setRenaming(true); }}>
                      <Pencil />
                      Rename
                    </Button>
                  )}
                  {owner && joinedOthers.length > 0 && !handing && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-muted-foreground">
                          <ArrowRightLeft />
                          Hand over
                          <ChevronDown className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Hand over to</DropdownMenuLabel>
                        {joinedOthers.map((m) => (
                          <DropdownMenuItem key={m.email} onSelect={() => setHanding(m)}>
                            <Crown />@{m.login ?? m.email}
                            <MenuHint>you stay as admin</MenuHint>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {owner && handing && (
                    <span className="flex items-center gap-1.5 text-meta">
                      <span className="text-muted-foreground">Hand over to @{handing.login ?? handing.email}?</span>
                      <Button size="sm" variant="outline" onClick={() => void handOver()}>
                        <Check />
                        Confirm
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setHanding(null)}>
                        Cancel
                      </Button>
                    </span>
                  )}
                  {owner ? (
                    <ArmButton size="sm" variant="ghost" icon={<Trash2 />} label="Delete" armedLabel="Delete for everyone" onConfirm={remove} className="text-muted-foreground hover:text-destructive" />
                  ) : (
                    <ArmButton size="sm" variant="ghost" icon={<LogOut />} label="Leave" armedLabel="Confirm leave" onConfirm={leave} className="text-muted-foreground" />
                  )}
                </>
              }
            >
              <OrgPeople org={{ id: org.id, name: org.name, ownerId: org.ownerId }} role={org.role} members={members} onMembers={setMembers} />
              <McpServers scope={{ org: ref }} />
              <OrgSkills org={ref} skills={skills.skills} error={skills.error} mutate={skills.mutate} refresh={skills.refresh} onEdit={(e) => setEditing({ ...e, key: ++seq.current })} />
              <OrgMemory org={ref} />
            </SettingsPage>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
