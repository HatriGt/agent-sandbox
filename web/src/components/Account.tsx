import * as React from "react";
import { ArrowLeft, Check, Loader2, PlugZap, Shield } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getMe, setMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ApiKeys } from "@/components/ApiKeys";
import { Sessions } from "@/components/Sessions";
import { cn } from "@/lib/utils";

const inputCls = "border-line-strong focus:ring-ring text-foreground placeholder:text-muted-foreground h-9 w-full rounded-md border bg-transparent px-3 text-meta outline-none focus:ring-2";

export function Account({ onBack, onConnect, onAdmin }: { onBack: () => void; onConnect: () => void; onAdmin: () => void }) {
  const me = getMe();
  const user = me?.kind === "user" ? me : null;
  const [name, setName] = React.useState(user?.name ?? "");
  const [email, setEmail] = React.useState(user?.email ?? "");
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [pw, setPw] = React.useState({ current: "", next: "", again: "" });
  const [pwBusy, setPwBusy] = React.useState(false);

  const saveProfile = async () => {
    setSaving(true);
    try {
      await api.updateAccount({ name, email: email || null });
      setMe(await api.me());
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };
  const changePw = async () => {
    if (pw.next !== pw.again) {
      toast.error("The two new passwords differ.");
      return;
    }
    setPwBusy(true);
    try {
      await api.updateAccount({ currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: "", next: "", again: "" });
      toast.success(user?.hasPassword ? "Password changed" : "Password set — you can now sign in with it");
      setMe(await api.me());
    } catch (e) {
      toast.error("Could not change the password", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-6 md:px-8 md:py-8">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden">
          <ArrowLeft className="size-4" />
          Machines
        </Button>
        <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em]">Account</h1>
            <p className="text-muted-foreground mt-0.5 text-meta">{user ? `@${user.login}` : "Operator"} · {user?.role === "admin" || me?.kind === "operator" ? "admin" : "member"} · up to {user?.maxBoxes ?? "∞"} machines at once</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(me?.kind === "operator" || user?.role === "admin") && me?.mode === "saas" && (
              <Button variant="ghost" onClick={onAdmin} className="text-muted-foreground">
                <Shield />
                Manage users
              </Button>
            )}
            <Button variant="outline" onClick={onConnect}>
              <PlugZap />
              Connect an IDE
            </Button>
          </div>
        </header>

        <div className="flex flex-col gap-10">
          {user && user.mode === "saas" && (user.plan === "trial" || user.plan === "pro") && (
            <section aria-labelledby="plan-h" className={cn("rounded-xl p-4", user.expired ? "bg-destructive/10" : "bg-card raised")}>
              <h2 id="plan-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
                {user.plan === "pro" ? "Pro" : user.expired ? "Trial ended" : "Free trial"}
              </h2>
              <p className="text-muted-foreground mt-1 text-meta">
                {user.plan === "pro"
                  ? "Unlimited time. Thank you."
                  : user.expired
                    ? "Your history and settings are kept; starting or resuming machines needs an upgrade — or self-host for free."
                    : `${user.daysLeft === 0 ? "Ends today" : `${user.daysLeft} day${user.daysLeft === 1 ? "" : "s"} left`} · ends ${new Date(user.trialEndsAt ?? 0).toLocaleDateString()} · no card on file`}
              </p>
              {user.plan !== "pro" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" asChild>
                    <a href={user.billingUrl ?? "mailto:hello@agent-sandbox.dev?subject=Agent%20Sandbox%20upgrade"}>Upgrade</a>
                  </Button>
                  <Button size="sm" variant="ghost" asChild className="text-muted-foreground">
                    <a href="https://github.com/HatriGt/agent-sandbox/blob/main/docs/self-hosting.md" target="_blank" rel="noreferrer">
                      Self-host for free
                    </a>
                  </Button>
                </div>
              )}
            </section>
          )}
          {user && (
            <section aria-labelledby="profile-h">
              <h2 id="profile-h" className="text-foreground mb-3 text-h3 font-semibold tracking-[-0.01em]">
                Profile
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="label text-muted-foreground">Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="label text-muted-foreground">Email</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="optional" />
                </label>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Button size="sm" onClick={saveProfile} disabled={saving}>
                  {saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : null}
                  {saved ? "Saved" : "Save"}
                </Button>
                {user.github && <span className="text-muted-foreground text-meta">GitHub sign-in linked</span>}
              </div>
            </section>
          )}

          {user && (
            <section aria-labelledby="pw-h">
              <h2 id="pw-h" className="text-foreground mb-1 text-h3 font-semibold tracking-[-0.01em]">
                {user.hasPassword ? "Change password" : "Set a password"}
              </h2>
              <p className="text-muted-foreground mb-3 text-meta">{user.hasPassword ? "Sessions on other devices stay signed in." : "You signed in with a token or GitHub; a password lets you sign in with your username too."}</p>
              <div className={cn("grid gap-4", user.hasPassword ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
                {user.hasPassword && (
                  <label className="flex flex-col gap-1.5">
                    <span className="label text-muted-foreground">Current</span>
                    <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} className={inputCls} />
                  </label>
                )}
                <label className="flex flex-col gap-1.5">
                  <span className="label text-muted-foreground">New</span>
                  <input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="label text-muted-foreground">Again</span>
                  <input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} className={inputCls} />
                </label>
              </div>
              <Button size="sm" variant="outline" className="mt-3" onClick={changePw} disabled={pwBusy || pw.next.length < 10 || (user.hasPassword && !pw.current)}>
                {pwBusy ? <Loader2 className="animate-spin" /> : null}
                {user.hasPassword ? "Change password" : "Set password"}
              </Button>
            </section>
          )}

          {user && <ApiKeys />}
          {user && <Sessions />}
          {!user && (
            <p className="text-muted-foreground text-meta">
              You are signed in with the operator token — the deployment's root identity. For day-to-day work, sign up for a personal account and, if you need to manage people, use <button type="button" onClick={onAdmin} className="text-foreground cursor-pointer underline underline-offset-4">Manage users</button>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
