import * as React from "react";
import { Check, Copy, KeyRound, Plus, Shield, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api, type UserRow } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { getMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Admin: the people on this controller. Create an account and hand over its first access token
 * (shown once); the person signs in with it, then mints their own keys. Everything they create —
 * machines, GitHub accounts, MCP servers — is theirs alone.
 */
export function Users() {
  const [users, setUsers] = React.useState<UserRow[] | null>(null);
  const [login, setLogin] = React.useState("");
  const [fresh, setFresh] = React.useState<{ login: string; token: string } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const me = getMe();
  const myId = me?.kind === "user" ? me.id : null;
  const load = React.useCallback(() => api.users().then((r) => setUsers(r.users)).catch(() => setUsers([])), []);
  React.useEffect(() => void load(), [load]);

  const create = async () => {
    const l = login.trim();
    if (!l) return;
    try {
      const u = await api.createUser(l, "user");
      setFresh({ login: u.login, token: u.token });
      setLogin("");
      void load();
    } catch (e) {
      toast.error("Could not create the user", { description: e instanceof Error ? e.message : String(e) });
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
      void load();
    } catch (e) {
      toast.error("Could not change the role", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const remove = async (u: UserRow) => {
    if (!window.confirm(`Remove ${u.login}? Their sessions and keys stop working; their machines pass to the operator.`)) return;
    try {
      await api.deleteUser(u.id);
      toast.success(`Removed ${u.login}`);
      void load();
    } catch (e) {
      toast.error("Could not remove", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy — select the token and copy it manually");
    }
  };

  return (
    <section aria-labelledby="users-h">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="users-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
          Users
        </h2>
        <span className="text-muted-foreground text-meta">each person gets their own machines, GitHub accounts and MCP servers</span>
      </div>

      {fresh && (
        <div className="bg-card raised mb-3 rounded-xl p-4">
          <p className="text-foreground text-meta font-medium">
            Access token for <span className="font-mono">{fresh.login}</span> — hand it over now; it will not be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="bg-muted text-foreground min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 font-mono text-code select-all">{fresh.token}</code>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="text-ok" /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>
              Done
            </Button>
          </div>
          <p className="text-muted-foreground mt-2 text-micro">They paste it at {location.origin}/dashboard — the same token also works as their MCP API key.</p>
        </div>
      )}

      <ul className="divide-y rounded-xl border">
        {users === null && <li className="text-muted-foreground px-3.5 py-3 text-meta">Loading…</li>}
        {users !== null && users.length === 0 && <li className="text-muted-foreground px-3.5 py-4 text-meta">No users yet. Add one below and give them their token.</li>}
        {(users ?? []).map((u) => (
          <li key={u.id} className="flex items-center gap-3 px-3.5 py-2.5">
            {u.role === "admin" ? <Shield className="text-live size-4 shrink-0" aria-label="Admin" /> : <UserRound className="text-muted-foreground size-4 shrink-0" aria-hidden />}
            <span className="text-foreground min-w-0 flex-1 truncate text-meta font-medium">
              {u.login}
              {u.id === myId && <span className="text-faint ml-1.5 text-micro">you</span>}
            </span>
            <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-micro font-medium", u.plan === "pro" ? "bg-ok/10 text-ok" : u.expired ? "bg-destructive/10 text-destructive" : u.plan === "trial" ? "bg-muted text-muted-foreground" : "bg-muted text-muted-foreground")}>
              {u.plan === "pro" ? "pro" : u.plan === "free" ? "free" : u.expired ? "trial ended" : `trial · ${u.daysLeft}d`}
            </span>
            <span className="text-faint hidden shrink-0 text-micro sm:inline">
              {u.boxes} {u.boxes === 1 ? "machine" : "machines"} · {u.keys} {u.keys === 1 ? "key" : "keys"}
              {u.github ? " · GitHub linked" : ""}
              {u.lastSeenAt ? ` · seen ${fmtAgo(Date.parse(u.lastSeenAt) / 1000)}` : ""}
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
            <Button size="sm" variant="ghost" onClick={() => toggleRole(u)} className="text-muted-foreground" disabled={u.id === myId} title={u.role === "admin" ? "Make a regular user" : "Make an admin"}>
              {u.role === "admin" ? "Demote" : "Admin"}
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Remove ${u.login}`} onClick={() => remove(u)} disabled={u.id === myId} className="text-muted-foreground hover:text-destructive">
              <Trash2 />
            </Button>
          </li>
        ))}
        <li className="flex items-center gap-2 px-3.5 py-2.5">
          <input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Login for the new user — e.g. priya"
            aria-label="New user login"
            className="placeholder:text-muted-foreground text-foreground h-8 min-w-0 flex-1 rounded-md bg-transparent px-1 text-meta outline-none"
          />
          <Button size="sm" variant="outline" onClick={create}>
            <Plus />
            Add user
          </Button>
        </li>
      </ul>
    </section>
  );
}
