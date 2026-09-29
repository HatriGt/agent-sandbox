import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { KeyRound, Plus, Shield, Trash2, UserRound, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { api, type UserRow } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { getMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { StaggerItem, Swap } from "@/components/ui/swap";
import { FreshTokenCard, ListEmpty, ListSkeleton } from "@/components/ApiKeys";
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

/**
 * Admin: the people on this controller. Create an account and hand over its first access token
 * (shown once); the person signs in with it, then mints their own keys. Everything they create —
 * machines, GitHub accounts, MCP servers — is theirs alone.
 */
export function Users() {
  const [users, setUsers] = React.useState<UserRow[] | null>(null);
  const [login, setLogin] = React.useState("");
  const [creating, setCreating] = React.useState(false);
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
      void load();
    } catch (e) {
      toast.error("Could not change the plan", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const toggleRole = async (u: UserRow) => {
    try {
      await api.setUserRole(u.id, u.role === "admin" ? "user" : "admin");
      await load();
    } catch (e) {
      toast.error("Could not change the role", { description: e instanceof Error ? e.message : String(e) });
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

  return (
    <section aria-labelledby="users-h">
      <div className="mb-4 flex items-center gap-2">
        <h2 id="users-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
          Users
        </h2>
        <span className="text-muted-foreground text-meta">each person gets their own machines, GitHub accounts and MCP servers</span>
      </div>

      <AnimatePresence initial={false}>
        {fresh && (
          <FreshTokenCard
            key={`${fresh.login}:${fresh.token}`}
            token={fresh.token}
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

      <div className="divide-y rounded-xl border">
        <Swap state={state}>
          {state === "loading" ? (
            <ListSkeleton rows={3} />
          ) : state === "empty" ? (
            <ListEmpty
              icon={UsersIcon}
              title="No users yet"
              line="Add one and hand them their token."
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
                  return (
                    <motion.li key={u.id} layout exit={{ opacity: 0, height: 0, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }} className="overflow-hidden">
                      <StaggerItem index={i} className="flex items-center gap-3 px-3.5 py-2.5">
                        {u.role === "admin" ? <Shield className="text-live size-4 shrink-0" aria-label="Admin" /> : <UserRound className="text-muted-foreground size-4 shrink-0" aria-hidden />}
                        <span className="text-foreground min-w-0 flex-1 truncate text-meta font-medium">
                          {u.login}
                          {isMe && <span className="text-faint ml-1.5 text-micro">you</span>}
                        </span>
                        <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-micro font-medium transition-colors duration-200", plan.cls)}>{plan.label}</span>
                        <span className="text-faint hidden shrink-0 text-micro sm:inline">
                          {u.boxes} {u.boxes === 1 ? "machine" : "machines"} · {u.keys} {u.keys === 1 ? "key" : "keys"}
                          {u.github ? " · GitHub linked" : ""}
                          {u.lastSeenAt && Number.isFinite(Date.parse(u.lastSeenAt)) ? ` · seen ${fmtAgo(Date.parse(u.lastSeenAt) / 1000)}` : ""}
                        </span>
                        {u.plan !== "pro" ? (
                          <Button size="sm" variant="ghost" onClick={() => setPlan(u, "pro")} className="text-muted-foreground" title="Unlimited time">
                            Make pro
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setPlan(u, "trial", 7)} className="text-muted-foreground" title="Back to a 7-day trial">
                            Trial
                          </Button>
                        )}
                        {u.plan === "trial" && (
                          <Button size="sm" variant="ghost" onClick={() => setPlan(u, "trial", 7)} className="text-muted-foreground" title="Give 7 more days">
                            +7d
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => issue(u)} className="text-muted-foreground" title="Issue a new access token">
                          <KeyRound />
                          Token
                        </Button>
                        <ArmButton
                          size="sm"
                          variant="ghost"
                          label={u.role === "admin" ? "Demote" : "Admin"}
                          armedLabel={u.role === "admin" ? "Demote to user?" : "Make admin?"}
                          onConfirm={() => toggleRole(u)}
                          disabled={isMe}
                          className="text-muted-foreground"
                        />
                        <ArmButton size="icon-sm" variant="ghost" icon={<Trash2 />} label={`Remove ${u.login}`} armedLabel="Confirm remove" onConfirm={() => remove(u)} disabled={isMe} className="text-muted-foreground hover:text-destructive" />
                      </StaggerItem>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </Swap>
        <div className="flex items-center gap-2 px-3.5 py-2.5">
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
        </div>
      </div>
    </section>
  );
}
