import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Crown, Ellipsis, KeyRound, Plus, RotateCcw, Shield, Trash2, UserRound, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { api, type UserRow } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { getMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Segmented } from "@/components/ui/segmented";
import { StaggerItem, Swap } from "@/components/ui/swap";
import { ListEmpty, ListSkeleton } from "@/components/ui/list-state";
import { SecretReveal } from "@/components/ui/secret";
import { Panel, PanelFooter, SettingsSection } from "@/components/ui/settings";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, MenuHint } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The plan pill's tones mirror TrialBadge: quiet while there is time, attention colour in the last
 * two days, red once over. Trial gets the --live hue so it never reads as "free".
 */
function planTone(u: UserRow): { cls: string; label: string } {
  if (u.plan === "pro") return { cls: "bg-ok/10 text-ok", label: "pro" };
  if (u.plan === "free") return { cls: "bg-muted text-muted-foreground", label: "free" };
  if (u.expired) return { cls: "bg-destructive/10 text-destructive", label: "trial ended" };
  const days = u.daysLeft ?? 0;
  return { cls: days <= 2 ? "bg-attention/20 text-attention-text" : "bg-live/10 text-live", label: `trial · ${days}d` };
}

const ROLES = [
  { value: "user" as const, label: "Member" },
  { value: "admin" as const, label: "Admin", icon: <Shield className="size-3" aria-hidden /> },
];

/**
 * Admin: the people on this controller. Create an account and hand over its first access token
 * (shown once); the person signs in with it, then mints their own keys. Everything they create —
 * machines, GitHub accounts, MCP servers — is theirs alone.
 */
export function Users() {
  const [users, setUsers] = React.useState<UserRow[] | null>(null);
  const [login, setLogin] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [roleBusy, setRoleBusy] = React.useState<string | null>(null);
  const [fresh, setFresh] = React.useState<{ login: string; token: string } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const me = getMe();
  const myId = me?.kind === "user" ? me.id : null;
  const load = React.useCallback(() => api.users().then((r) => setUsers(r.users)).catch(() => setUsers([])), []);
  React.useEffect(() => void load(), [load]);

  const create = async () => {
    const l = login.trim();
    if (!l || creating) return;
    setCreating(true);
    try {
      const u = await api.createUser(l, "user");
      setFresh({ login: u.login, token: u.token });
      setLogin("");
      void load();
    } catch (e) {
      toast.error("Could not create the user", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setCreating(false);
    }
  };
  const issue = async (u: UserRow) => {
    try {
      const k = await api.issueUserKey(u.id);
      setFresh({ login: u.login, token: k.token });
    } catch (e) {
      toast.error("Could not issue a token", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const setPlan = async (u: UserRow, plan: "trial" | "pro" | "free", days?: number) => {
    try {
      await api.setUserPlan(u.id, plan, days);
      toast.success(`${u.login} is now ${plan === "pro" ? "pro" : `on a ${days ?? 7}-day trial`}`);
      void load();
    } catch (e) {
      toast.error("Could not change the plan", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const setRole = async (u: UserRow, role: "user" | "admin") => {
    if (u.role === role || roleBusy) return;
    setRoleBusy(u.id);
    // Optimistic: the pill glides now; a failure snaps it back with the reload.
    setUsers((prev) => prev?.map((x) => (x.id === u.id ? { ...x, role } : x)) ?? prev);
    try {
      await api.setUserRole(u.id, role);
      toast.success(role === "admin" ? `${u.login} is now an admin` : `${u.login} is now a member`);
    } catch (e) {
      toast.error("Could not change the role", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRoleBusy(null);
      void load();
    }
  };
  const remove = async (u: UserRow) => {
    try {
      await api.deleteUser(u.id);
      setUsers((prev) => prev?.filter((x) => x.id !== u.id) ?? prev);
      toast.success(`Removed ${u.login}`);
      void load();
    } catch (e) {
      toast.error("Could not remove", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const state = users === null ? "loading" : users.length === 0 ? "empty" : "list";
  const admins = (users ?? []).filter((u) => u.role === "admin").length;

  return (
    <SettingsSection id="users" title="Users" meta={users ? `${users.length} · ${admins} admin${admins === 1 ? "" : "s"}` : undefined} purpose="Each person gets their own machines, GitHub accounts and MCP servers. Admins see and can act on everything.">
      <AnimatePresence initial={false}>
        {fresh && (
          <SecretReveal
            key={`${fresh.login}:${fresh.token}`}
            className="mb-3"
            value={fresh.token}
            onDone={() => setFresh(null)}
            title={
              <>
                Access token for <span className="font-mono">{fresh.login}</span> — hand it over now; it will not be shown again.
              </>
            }
            footer={<>They paste it at {location.origin}/dashboard — the same token also works as their MCP API key.</>}
          />
        )}
      </AnimatePresence>

      <Panel>
        <Swap state={state}>
          {state === "loading" ? (
            <ListSkeleton rows={3} />
          ) : state === "empty" ? (
            <ListEmpty
              icon={UsersIcon}
              title="No users yet"
              line="Add a login below; you get a one-time token to hand them."
              action={
                <Button size="sm" variant="outline" onClick={() => inputRef.current?.focus()}>
                  <Plus />
                  Add the first user
                </Button>
              }
            />
          ) : (
            <ul className="divide-y">
              <AnimatePresence initial={false}>
                {(users ?? []).map((u, i) => {
                  const plan = planTone(u);
                  const isMe = u.id === myId;
                  const seen = u.lastSeenAt && Number.isFinite(Date.parse(u.lastSeenAt)) ? fmtAgo(Date.parse(u.lastSeenAt) / 1000) : null;
                  return (
                    <motion.li key={u.id} layout exit={{ opacity: 0, height: 0, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }} className="overflow-hidden">
                      <StaggerItem index={i} className="group flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5 sm:flex-nowrap">
                        <span
                          className={cn("grid size-8 shrink-0 place-items-center rounded-full border transition-colors duration-200", u.role === "admin" ? "bg-live/8 border-live/15 text-live" : "bg-muted text-muted-foreground border-transparent")}
                          aria-hidden
                        >
                          {u.role === "admin" ? <Shield className="size-3.5" /> : <UserRound className="size-3.5" />}
                        </span>
                        <span className="flex min-w-0 flex-1 basis-40 flex-col">
                          <span className="text-foreground flex min-w-0 items-center gap-1.5 text-meta font-medium">
                            <span className="truncate">{u.login}</span>
                            {isMe && <span className="text-faint text-micro font-normal">you</span>}
                          </span>
                          <span className="text-faint truncate text-micro tabular-nums">
                            {u.boxes} {u.boxes === 1 ? "machine" : "machines"} · {u.keys} {u.keys === 1 ? "key" : "keys"}
                            {u.github ? " · GitHub linked" : ""}
                            {seen ? ` · seen ${seen}` : " · never signed in"}
                          </span>
                        </span>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-micro font-medium tabular-nums transition-colors duration-200", plan.cls)}>{plan.label}</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex shrink-0">
                              <Segmented ariaLabel={`Role for ${u.login}`} value={u.role} onChange={(r) => void setRole(u, r)} options={ROLES} disabled={isMe} busy={roleBusy === u.id ? u.role : null} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{isMe ? "You cannot change your own role" : "Admins see and can act on every machine"}</TooltipContent>
                        </Tooltip>
                        {/* Secondary actions: revealed on hover/focus at ≥sm, always visible on touch. */}
                        <span className="ml-auto flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:duration-150 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 sm:has-[[data-armed]]:opacity-100 sm:has-[[data-state=open]]:opacity-100">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="icon-sm" variant="ghost" onClick={() => issue(u)} className="text-muted-foreground" aria-label={`Issue a token for ${u.login}`}>
                                <KeyRound />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Issue a fresh access token — shown once</TooltipContent>
                          </Tooltip>
                          <DropdownMenu>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <DropdownMenuTrigger asChild>
                                  <Button size="icon-sm" variant="ghost" aria-label={`Plan for ${u.login}`} className="text-muted-foreground">
                                    <Ellipsis />
                                  </Button>
                                </DropdownMenuTrigger>
                              </TooltipTrigger>
                              <TooltipContent>Plan</TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Plan</DropdownMenuLabel>
                              {u.plan !== "pro" && (
                                <DropdownMenuItem onSelect={() => void setPlan(u, "pro")}>
                                  <Crown />
                                  Make pro
                                  <MenuHint>unlimited time</MenuHint>
                                </DropdownMenuItem>
                              )}
                              {u.plan === "trial" && (
                                <DropdownMenuItem onSelect={() => void setPlan(u, "trial", 7)}>
                                  <RotateCcw />
                                  Extend trial
                                  <MenuHint>+7 days</MenuHint>
                                </DropdownMenuItem>
                              )}
                              {u.plan === "pro" && (
                                <DropdownMenuItem onSelect={() => void setPlan(u, "trial", 7)}>
                                  <RotateCcw />
                                  Back to trial
                                  <MenuHint>7 days</MenuHint>
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <ArmButton size="icon-sm" variant="ghost" icon={<Trash2 />} label={`Remove ${u.login}`} armedLabel="Confirm remove" onConfirm={() => remove(u)} disabled={isMe} className="text-muted-foreground hover:text-destructive" />
                        </span>
                      </StaggerItem>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </Swap>
        <PanelFooter>
          <input
            ref={inputRef}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Login for the new user — e.g. neo"
            aria-label="New user login"
            className="placeholder:text-muted-foreground text-foreground h-8 min-w-0 flex-1 rounded-md bg-transparent px-1 text-meta outline-none"
          />
          <Button size="sm" variant="outline" onClick={() => void create()} loading={creating} disabled={!login.trim()}>
            <Plus />
            Add user
          </Button>
        </PanelFooter>
      </Panel>
    </SettingsSection>
  );
}
