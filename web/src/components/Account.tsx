import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, PlugZap, Shield } from "lucide-react";
import { toast } from "sonner";
import { api, type BoxView } from "@/lib/api";
import { getMe, setMe } from "@/lib/auth";
import { isVisible } from "@/lib/format";
import { Capacity } from "@/components/Capacity";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { Swap } from "@/components/ui/swap";
import { ApiKeys } from "@/components/ApiKeys";
import { NotifySettings, SaveButton } from "@/components/NotifySettings";
import { AgentSettings } from "@/components/AgentSettings";
import { Sessions } from "@/components/Sessions";
import { AuditLog } from "@/components/AuditLog";
import { cn } from "@/lib/utils";

const inputCls = "border-line-strong focus:ring-ring text-foreground placeholder:text-muted-foreground h-9 w-full rounded-md border bg-transparent px-3 text-meta outline-none focus:ring-2 transition-[border-color,box-shadow] duration-150";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 0–4: length 10+, length 14+, mixed case or digits, a symbol. Coarse on purpose — a hint, not a gate. */
function pwStrength(p: string): number {
  if (!p) return 0;
  let n = 0;
  if (p.length >= 10) n++;
  if (p.length >= 14) n++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) n++;
  else if (/\d/.test(p) && /[a-zA-Z]/.test(p)) n++;
  if (/[^a-zA-Z0-9]/.test(p)) n++;
  return Math.min(4, n);
}
const STRENGTH = ["", "weak", "fair", "good", "strong"] as const;

/** Four segments that fill left to right; the filled ones tint from destructive → attention → ok. */
function StrengthMeter({ value, visible }: { value: number; visible: boolean }) {
  const still = useReducedMotion();
  const tone = value <= 1 ? "bg-destructive" : value === 2 ? "bg-attention" : value === 3 ? "bg-live" : "bg-ok";
  return (
    <div className="flex items-center gap-2" aria-hidden={!visible}>
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="bg-muted relative h-1 flex-1 overflow-hidden rounded-full">
            <motion.span
              className={cn("absolute inset-0 origin-left rounded-full", tone)}
              initial={false}
              animate={{ scaleX: visible && i < value ? 1 : 0 }}
              transition={still ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 36, delay: i < value ? i * 0.04 : 0 }}
            />
          </span>
        ))}
      </div>
      <span className="text-muted-foreground w-10 text-right text-micro" aria-live="polite">
        {visible ? STRENGTH[value] : ""}
      </span>
    </div>
  );
}

/** One helper line under a field; swaps colour and text without shifting the layout. */
function Hint({ show, tone = "muted", children }: { show: boolean; tone?: "muted" | "bad" | "ok"; children: React.ReactNode }) {
  return (
    <Collapse open={show}>
      <span className={cn("block pt-1 text-micro", tone === "bad" ? "text-destructive" : tone === "ok" ? "text-ok" : "text-muted-foreground")}>{children}</span>
    </Collapse>
  );
}

export function Account({ onBack, onConnect, onAdmin }: { onBack: () => void; onConnect: () => void; onAdmin: () => void }) {
  const me = getMe();
  const user = me?.kind === "user" ? me : null;
  const [name, setName] = React.useState(user?.name ?? "");
  const [email, setEmail] = React.useState(user?.email ?? "");
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [pw, setPw] = React.useState({ current: "", next: "", again: "" });
  const [pwBusy, setPwBusy] = React.useState(false);

  // Live usage: the machines running right now against the plan's cap. If the fleet fetch fails we
  // simply fall back to the static "up to N machines" line — never invented numbers.
  const [fleetBoxes, setFleetBoxes] = React.useState<BoxView[] | null>(null);
  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .fleet(ctrl.signal)
      .then((r) => setFleetBoxes(r.boxes.filter(isVisible)))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);
  const inUse = fleetBoxes ? fleetBoxes.filter((b) => /^running$/i.test(b.boxStatus)).length : null;
  const maxBoxes = user?.maxBoxes ?? null;

  // Save is live only when something actually changed and the email (if any) parses.
  const emailOk = email.trim() === "" || EMAIL.test(email.trim());
  const dirty = name.trim() !== (user?.name ?? "").trim() || email.trim() !== (user?.email ?? "").trim();
  const pwMatch = pw.again === "" || pw.next === pw.again;
  const pwStrong = pwStrength(pw.next);

  const saveProfile = async () => {
    if (!dirty || !emailOk) return;
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
            <p className="text-muted-foreground mt-0.5 text-meta">
              {user ? `@${user.login}` : "Operator"} · {user?.role === "admin" || me?.kind === "operator" ? "admin" : "member"} ·{" "}
              {inUse !== null && maxBoxes ? `${inUse} of ${maxBoxes} machines in use` : `up to ${maxBoxes ?? "∞"} machines at once`}
            </p>
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
              {inUse !== null && maxBoxes ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Capacity boxes={fleetBoxes ?? []} capacity={maxBoxes} size="sm" />
                  <span className="text-muted-foreground text-meta">
                    {inUse} of {maxBoxes} machines in use
                  </span>
                  {user.plan === "trial" && !user.expired && <span className="stamp text-muted-foreground">{user.daysLeft === 0 ? "ends today" : `${user.daysLeft}d left`}</span>}
                </div>
              ) : maxBoxes ? (
                <p className="text-muted-foreground mt-3 text-meta">up to {maxBoxes} machines at once</p>
              ) : null}
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
              <h2 id="profile-h" className="text-foreground mb-1 text-h3 font-semibold tracking-[-0.01em]">
                Profile
              </h2>
              <p className="text-muted-foreground mb-4 text-meta">How you appear in the console and in notifications.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="label text-muted-foreground">Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="label text-muted-foreground">Email</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={cn(inputCls, !emailOk && "border-destructive/60 focus:ring-destructive/40")} placeholder="optional" aria-invalid={!emailOk || undefined} />
                  <Hint show={!emailOk} tone="bad">
                    That does not look like an email address.
                  </Hint>
                </label>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <SaveButton onClick={() => void saveProfile()} saving={saving} saved={saved} disabled={!dirty || !emailOk} />
                <Swap state={dirty && !saving && !saved}>{dirty && !saving && !saved ? <span className="text-muted-foreground text-meta">Unsaved changes</span> : null}</Swap>
                {user.github && <span className="text-muted-foreground text-meta">GitHub sign-in linked</span>}
              </div>
            </section>
          )}

          {user && (
            <section aria-labelledby="pw-h">
              <h2 id="pw-h" className="text-foreground mb-1 text-h3 font-semibold tracking-[-0.01em]">
                {user.hasPassword ? "Change password" : "Set a password"}
              </h2>
              <p className="text-muted-foreground mb-4 text-meta">{user.hasPassword ? "Sessions on other devices stay signed in." : "You signed in with a token or GitHub; a password lets you sign in with your username too."}</p>
              <div className={cn("grid gap-4", user.hasPassword ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
                {user.hasPassword && (
                  <label className="flex flex-col gap-1.5">
                    <span className="label text-muted-foreground">Current</span>
                    <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} className={inputCls} />
                  </label>
                )}
                <label className="flex flex-col gap-1.5">
                  <span className="label text-muted-foreground">New</span>
                  <input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className={inputCls} aria-describedby="pw-help" />
                  <StrengthMeter value={pwStrong} visible={pw.next.length > 0} />
                  <Hint show={pw.next.length > 0 && pw.next.length < 10} tone="bad">
                    <span id="pw-help">10+ characters · {10 - pw.next.length} to go</span>
                  </Hint>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="label text-muted-foreground">Again</span>
                  <input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} className={cn(inputCls, !pwMatch && "border-destructive/60 focus:ring-destructive/40")} aria-invalid={!pwMatch || undefined} />
                  <Hint show={pw.again.length > 0} tone={pwMatch ? "ok" : "bad"}>
                    {pwMatch ? "Matches" : "Doesn't match"}
                  </Hint>
                </label>
              </div>
              <Button size="sm" variant="outline" className="mt-4" onClick={() => void changePw()} loading={pwBusy} disabled={pw.next.length < 10 || !pwMatch || pw.again === "" || (user.hasPassword && !pw.current)}>
                {user.hasPassword ? "Change password" : "Set password"}
              </Button>
            </section>
          )}

          <AgentSettings />

          <NotifySettings />

          {user && <ApiKeys />}
          {user && <Sessions />}
          <AuditLog />
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
