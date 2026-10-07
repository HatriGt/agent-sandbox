import * as React from "react";
import { motion } from "motion/react";
import { setMotionPref, useMotionPref, useReducedMotion, type MotionPref } from "@/lib/motion-pref";
import { Segmented } from "@/components/ui/segmented";
import { PlugZap, Shield } from "lucide-react";
import { toast } from "sonner";
import { api, type BoxView } from "@/lib/api";
import { getMe, setMe } from "@/lib/auth";
import { isVisible } from "@/lib/format";
import { Capacity } from "@/components/Capacity";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { Field, Input } from "@/components/ui/field";
import { SaveButton } from "@/components/ui/save-button";
import { SettingsPage, SettingsSection } from "@/components/ui/settings";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Swap } from "@/components/ui/swap";
import { ApiKeys } from "@/components/ApiKeys";
import { NotifySettings } from "@/components/NotifySettings";
import { AgentSettings } from "@/components/AgentSettings";
import { Sessions } from "@/components/Sessions";
import { AuditLog } from "@/components/AuditLog";
import { cn } from "@/lib/utils";

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

/** Device-local appearance: how much the console animates. Stored in this browser only. */
function AppearanceSettings() {
  const pref = useMotionPref();
  const reduced = useReducedMotion();
  return (
    <SettingsSection id="appearance" title="Appearance" meta={pref === "system" ? (reduced ? "Reduced (from OS)" : "Full (from OS)") : undefined} purpose="Saved in this browser.">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-foreground text-meta font-medium">Motion</span>
        <Segmented<MotionPref>
          ariaLabel="Motion"
          value={pref}
          onChange={setMotionPref}
          options={[
            { value: "full", label: "Full" },
            { value: "system", label: "System" },
            { value: "reduced", label: "Reduced" },
          ]}
        />
        <p className="text-muted-foreground w-full text-micro">System follows your OS &lsquo;animation effects&rsquo; setting.</p>
      </div>
    </SettingsSection>
  );
}

const STRENGTH = ["", "weak", "fair", "good", "strong"] as const;

/** Four segments that fill left to right; the filled ones tint from destructive → attention → ok. */
function StrengthMeter({ value, visible }: { value: number; visible: boolean }) {
  const still = useReducedMotion();
  const tone = value <= 1 ? "bg-destructive" : value === 2 ? "bg-warn" : value === 3 ? "bg-live" : "bg-ok";
  return (
    <div className="flex items-center gap-2 pt-1" aria-hidden={!visible}>
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
  const isAdmin = user?.role === "admin" || me?.kind === "operator";
  const showPlan = !!user && user.mode === "saas" && (user.plan === "trial" || user.plan === "pro");

  // Save is live only when something actually changed and the email (if any) parses.
  const emailOk = email.trim() === "" || EMAIL.test(email.trim());
  const dirty = name.trim() !== (user?.name ?? "").trim() || email.trim() !== (user?.email ?? "").trim();
  const pwMatch = pw.again === "" || pw.next === pw.again;
  const pwStrong = pwStrength(pw.next);
  const pwShort = pw.next.length > 0 && pw.next.length < 10;

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
    if (pw.next !== pw.again) return;
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
    <SettingsPage
      title="Account"
      purpose={
        <>
          {user ? `@${user.login}` : "Operator"} · {isAdmin ? "admin" : "member"}
          {!showPlan && <> · {inUse !== null && maxBoxes ? `${inUse} of ${maxBoxes} machines in use` : `up to ${maxBoxes ?? "∞"} machines at once`}</>}
        </>
      }
      back={{ label: "Machines", onClick: onBack, mobileOnly: true }}
      actions={
        <>
          {isAdmin && me?.mode === "saas" && (
            <Button variant="ghost" onClick={onAdmin} className="text-muted-foreground">
              <Shield />
              Manage users
            </Button>
          )}
          <Button variant="outline" onClick={onConnect}>
            <PlugZap />
            Connect an IDE
          </Button>
        </>
      }
    >
      {user && showPlan && (
        <SettingsSection id="plan" title={user.plan === "pro" ? "Pro" : user.expired ? "Trial ended" : "Free trial"} className={cn("rounded-xl p-4", user.expired ? "bg-destructive/10" : "bg-card raised")}>
          <p className="text-muted-foreground -mt-2 text-meta">
            {user.plan === "pro"
              ? "Unlimited time. Thank you."
              : user.expired
                ? "Your history and settings are kept; starting or resuming machines needs an upgrade — or self-host for free."
                : `${user.daysLeft === 0 ? "Ends today" : `${user.daysLeft} day${user.daysLeft === 1 ? "" : "s"} left`} · ends ${new Date(user.trialEndsAt ?? 0).toLocaleDateString()} · no card on file`}
          </p>
          <Swap state={inUse !== null && maxBoxes ? "usage" : maxBoxes ? "cap" : "none"}>
            {inUse !== null && maxBoxes ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Capacity boxes={fleetBoxes ?? []} capacity={maxBoxes} size="sm" />
                <span className="text-muted-foreground text-meta tabular-nums">
                  <NumberTicker value={inUse} from={inUse} /> of {maxBoxes} machines in use
                </span>
                {user.plan === "trial" && !user.expired && <span className="stamp text-muted-foreground">{user.daysLeft === 0 ? "ends today" : `${user.daysLeft}d left`}</span>}
              </div>
            ) : maxBoxes ? (
              <p className="text-muted-foreground mt-3 text-meta">up to {maxBoxes} machines at once</p>
            ) : null}
          </Swap>
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
        </SettingsSection>
      )}

      {user && (
        <SettingsSection id="profile" title="Profile" purpose="How you appear in the console and in notifications." meta={user.github ? "GitHub sign-in linked" : undefined}>
          <form
            className="grid max-w-xl gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveProfile();
            }}
          >
            <Field label="Name">{(w) => <Input {...w} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
            <Field label="Email" optional error={!emailOk ? "That does not look like an email address." : undefined} help="Only used to address notifications.">
              {(w) => <Input {...w} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />}
            </Field>
            <div className="flex items-center gap-3 sm:col-span-2">
              <SaveButton onClick={() => void saveProfile()} saving={saving} saved={saved} disabled={!dirty || !emailOk} />
              <Swap state={dirty && !saving && !saved} className="inline-flex">
                {dirty && !saving && !saved ? <span className="text-muted-foreground text-meta">Unsaved changes</span> : null}
              </Swap>
            </div>
          </form>
        </SettingsSection>
      )}

      {user && (
        <SettingsSection
          id="pw"
          title={user.hasPassword ? "Change password" : "Set a password"}
          purpose={user.hasPassword ? "Sessions on other devices stay signed in." : "You signed in with a token or GitHub; a password lets you sign in with your username too."}
        >
          <form
            className={cn("grid max-w-2xl gap-4", user.hasPassword ? "sm:grid-cols-3" : "sm:grid-cols-2")}
            onSubmit={(e) => {
              e.preventDefault();
              void changePw();
            }}
          >
            {user.hasPassword && (
              <Field label="Current">{(w) => <Input {...w} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}</Field>
            )}
            <Field label="New" error={pwShort ? `10+ characters · ${10 - pw.next.length} to go` : undefined} help="10 or more characters.">
              {(w) => (
                <>
                  <Input {...w} type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
                  <Collapse open={pw.next.length > 0}>
                    <StrengthMeter value={pwStrong} visible={pw.next.length > 0} />
                  </Collapse>
                </>
              )}
            </Field>
            <Field label="Again" error={!pwMatch ? "Doesn't match" : undefined} ok={pw.again.length > 0 && pwMatch ? "Matches" : undefined}>
              {(w) => <Input {...w} type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />}
            </Field>
            <div className="sm:col-span-full">
              <Button type="submit" size="sm" variant="outline" loading={pwBusy} disabled={pw.next.length < 10 || !pwMatch || pw.again === "" || (user.hasPassword && !pw.current)}>
                {user.hasPassword ? "Change password" : "Set password"}
              </Button>
            </div>
          </form>
        </SettingsSection>
      )}

      <AppearanceSettings />
      <AgentSettings />
      <NotifySettings />
      {user && <ApiKeys />}
      {user && <Sessions />}
      <AuditLog />
      {!user && (
        <p className="text-muted-foreground max-w-[64ch] text-meta">
          You are signed in with the operator token — the deployment's root identity. For day-to-day work, sign up for a personal account and, if you need to manage people, use{" "}
          <button type="button" onClick={onAdmin} className="text-foreground cursor-pointer underline underline-offset-4">
            Manage users
          </button>
          .
        </p>
      )}
    </SettingsPage>
  );
}
