import * as React from "react";
import { Copy, Crown, Shield, Trash2, UserPlus, UserRound, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { api, type OrgMemberView, type OrgRole } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { getMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Segmented } from "@/components/ui/segmented";
import { Swap } from "@/components/ui/swap";
import { ListEmpty, ListSkeleton } from "@/components/ui/list-state";
import { Panel, PanelFooter, SettingsSection } from "@/components/ui/settings";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable, StatusDot, stopRow, type Column } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

const time = (s: string | null) => (s && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null);

const ROLES = [
  { value: "member" as const, label: "Member" },
  { value: "admin" as const, label: "Admin", icon: <Shield className="size-3" aria-hidden /> },
];

/** The note an admin pastes into Slack or an email: the one thing the invitee has to know. */
export function inviteNote(orgName: string, key: string): string {
  const how = key.startsWith("@") ? `sign in with GitHub as ${key}` : `sign up or sign in with ${key}`;
  return `You've been added to ${orgName} on Agent Sandbox. To be in, ${how} at ${location.origin}/dashboard — the organisation's MCP servers, skills and memory are there for you automatically.`;
}

/**
 * The people in an organisation: who has signed in, who is still an invite, and the one way in —
 * an email address. Nothing is sent from here: the admin pastes a note wherever the team talks,
 * and the invite links itself the moment that address signs in.
 */
export function OrgPeople({ org, role, members, onMembers }: { org: { id: string; name: string; ownerId: string }; role: OrgRole; members: OrgMemberView[] | null; onMembers: (m: OrgMemberView[]) => void }) {
  const manage = role !== "member";
  const me = getMe();
  const myId = me?.kind === "user" ? me.id : null;
  const [emails, setEmails] = React.useState("");
  const [inviting, setInviting] = React.useState(false);
  const [roleBusy, setRoleBusy] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const invite = async () => {
    const raw = emails.trim();
    if (!raw || inviting) return;
    setInviting(true);
    try {
      const r = await api.orgInvite(org.id, raw);
      onMembers(r.members);
      setEmails(r.invalid.join(", "));
      if (r.added.length) toast.success(r.added.length === 1 ? `${r.added[0]} is in` : `${r.added.length} people added`, { description: "They are in the moment they sign in with that address." });
      if (r.existing.length && !r.added.length) toast.message(r.existing.length === 1 ? `${r.existing[0]} is already here` : "Everyone there is already in");
      if (r.invalid.length) toast.error(r.invalid.length === 1 ? `Not an email address: ${r.invalid[0]}` : `${r.invalid.length} entries are not email addresses`, { description: "Left in the box so you can fix them." });
    } catch (e) {
      toast.error("Could not add", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setInviting(false);
    }
  };
  const setRole = async (m: OrgMemberView, next: "admin" | "member") => {
    if (m.role === next || roleBusy) return;
    setRoleBusy(m.email);
    onMembers((members ?? []).map((x) => (x.email === m.email ? { ...x, role: next } : x)));
    try {
      const r = await api.orgSetRole(org.id, m.email, next);
      onMembers(r.members);
      toast.success(next === "admin" ? `${m.login ?? m.email} can now manage the organisation` : `${m.login ?? m.email} is a member`);
    } catch (e) {
      toast.error("Could not change the role", { description: e instanceof Error ? e.message : String(e) });
      void api.orgMembers(org.id).then((r) => onMembers(r.members));
    } finally {
      setRoleBusy(null);
    }
  };
  const remove = async (m: OrgMemberView) => {
    try {
      const r = await api.orgRemoveMember(org.id, m.email);
      onMembers(r.members);
      toast.success(`Removed ${m.login ?? m.email}`);
    } catch (e) {
      toast.error("Could not remove", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const copyNote = async (m: OrgMemberView) => {
    try {
      await navigator.clipboard.writeText(inviteNote(org.name, m.email));
      toast.success("Invite note copied", { description: "Paste it wherever you talk to them." });
    } catch {
      toast.error("Could not copy");
    }
  };

  const state = members === null ? "loading" : members.length === 0 ? "empty" : "list";
  const joined = (members ?? []).filter((m) => m.status === "joined").length;
  const pending = (members ?? []).length - joined;
  const columns: Column<OrgMemberView>[] = [
    {
      id: "who",
      header: "Person",
      primary: true,
      sort: (m) => `${m.status === "joined" ? 0 : 1}${m.login ?? m.email}`,
      cell: (m) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <span className={cn("grid size-7 shrink-0 place-items-center overflow-hidden rounded-full", m.role === "owner" ? "bg-live/8 text-live" : m.role === "admin" ? "bg-foreground/6 text-foreground" : "bg-muted text-muted-foreground")} aria-hidden>
            {m.avatarUrl ? <img src={m.avatarUrl} alt="" className="size-full object-cover" /> : m.role === "owner" ? <Crown className="size-3.5" /> : m.role === "admin" ? <Shield className="size-3.5" /> : <UserRound className="size-3.5" />}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={cn("truncate", m.status === "invited" && "text-muted-foreground")}>{m.login ? `@${m.login}` : m.email}</span>
              {!!m.userId && m.userId === myId && <span className="text-faint text-micro font-normal">you</span>}
            </span>
            <span className="text-faint truncate text-micro font-normal">
              {m.login ? m.email || (m.name ?? "") : ""}
              <span className="sm:hidden">
                {m.login && m.email ? " · " : ""}
                {m.status === "joined" ? "joined" : "invited"}
              </span>
            </span>
          </span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      width: "w-36",
      hideBelow: "sm",
      sort: (m) => (m.status === "joined" ? 0 : 1),
      cell: (m) => (m.status === "joined" ? <StatusDot tone="ok">joined</StatusDot> : <StatusDot tone="muted">invited · not signed in yet</StatusDot>),
    },
    {
      id: "role",
      header: "Role",
      width: "w-44",
      hideBelow: "sm",
      sort: (m) => (m.role === "owner" ? 0 : m.role === "admin" ? 1 : 2),
      cell: (m) =>
        m.role === "owner" ? (
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-meta">
            <Crown className="size-3.5" aria-hidden />
            Owner
          </span>
        ) : role === "owner" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex" onClick={stopRow} onKeyDown={stopRow}>
                <Segmented ariaLabel={`Role for ${m.email}`} value={m.role === "admin" ? "admin" : "member"} onChange={(r) => void setRole(m, r)} options={ROLES} busy={roleBusy === m.email ? (m.role as "admin" | "member") : null} />
              </span>
            </TooltipTrigger>
            <TooltipContent>Admins add people and edit what is shared</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-meta">
            {m.role === "admin" && <Shield className="size-3.5" aria-hidden />}
            {m.role === "admin" ? "Admin" : "Member"}
          </span>
        ),
    },
    {
      id: "since",
      header: "Since",
      width: "w-24",
      hideBelow: "md",
      sort: (m) => time(m.joinedAt ?? m.invitedAt),
      cell: (m) => {
        const t = time(m.joinedAt ?? m.invitedAt);
        return <span className="text-muted-foreground text-micro tabular-nums">{t ? fmtAgo(t / 1000) : "—"}</span>;
      },
    },
  ];

  return (
    <SettingsSection
      id="org-people"
      title="People"
      meta={members ? `${joined} in${pending ? ` · ${pending} invited` : ""}` : undefined}
      purpose={manage ? "Add email addresses, or @handles for people who sign in with GitHub. Anyone who signs in with one is in — their sandboxes get the organisation's servers, skills and memory from the next run." : "Who shares this organisation's servers, skills and memory."}
    >
      <Panel>
        <Swap state={state}>
          {state === "loading" ? (
            <ListSkeleton rows={3} />
          ) : state === "empty" ? (
            <ListEmpty icon={UsersIcon} title="Nobody here yet" line="Add the team's email addresses below." />
          ) : (
            <DataTable
              aria-label="People"
              bordered={false}
              rows={members ?? []}
              columns={columns}
              rowKey={(m) => m.email || m.userId || "owner"}
              minWidth="min-w-[36rem]"
              search={(members ?? []).length > 8 ? { placeholder: "Search people", text: (m) => `${m.email} ${m.login ?? ""} ${m.name ?? ""} ${m.role} ${m.status}` } : undefined}
              actions={
                manage
                  ? (m) =>
                      m.role === "owner" ? null : (
                        <span className="inline-flex items-center gap-0.5">
                          {m.status === "invited" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="icon-sm" variant="ghost" onClick={() => void copyNote(m)} className="text-muted-foreground" aria-label={`Copy an invite note for ${m.email}`}>
                                  <Copy />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Copy a note to send them</TooltipContent>
                            </Tooltip>
                          )}
                          <ArmButton size="icon-sm" variant="ghost" icon={<Trash2 />} label={`Remove ${m.login ?? m.email}`} armedLabel="Confirm remove" onConfirm={() => remove(m)} disabled={m.role === "admin" && role !== "owner"} className="text-muted-foreground hover:text-destructive" />
                        </span>
                      )
                  : undefined
              }
            />
          )}
        </Swap>
        {manage && (
          <PanelFooter>
            <UserPlus className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <input
              ref={inputRef}
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void invite()}
              placeholder="Email addresses or @github-handles — paste a list, any separator"
              aria-label="Email addresses to add"
              className="placeholder:text-muted-foreground text-foreground h-8 min-w-0 flex-1 rounded-md bg-transparent px-1 text-meta outline-none"
            />
            <Button size="sm" variant="outline" onClick={() => void invite()} loading={inviting} disabled={!emails.trim()}>
              <UserPlus />
              Add
            </Button>
          </PanelFooter>
        )}
      </Panel>
    </SettingsSection>
  );
}
