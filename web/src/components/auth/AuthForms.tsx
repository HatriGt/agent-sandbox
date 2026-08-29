import * as React from "react";
import { Link } from "react-router";
import { ArrowRight, Github, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { api, type AuthConfig } from "@/lib/api";
import { setMe, setToken } from "@/lib/auth";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";

export function AuthShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="bg-background text-foreground flex min-h-full items-center justify-center px-6 py-10">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className={cn("w-full", wide ? "max-w-md" : "max-w-sm")}>
        <Link to="/" className="inline-flex items-center gap-2.5 no-underline">
          <span className="bg-primary text-primary-foreground grid size-9 place-items-center rounded-md">
            <Logo className="size-5" />
          </span>
          <span className="text-foreground text-body font-semibold tracking-[-0.01em]">Agent Sandbox</span>
        </Link>
        {children}
      </motion.div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between">
        <span className="label text-muted-foreground">{label}</span>
        {hint && <span className="text-faint text-micro">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
export const inputCls = "border-line-strong focus:ring-ring text-foreground placeholder:text-muted-foreground h-10 w-full rounded-md border bg-transparent px-3 text-meta outline-none focus:ring-2";

export function OrDivider() {
  return (
    <div className="text-faint my-5 flex items-center gap-3 text-micro">
      <span className="bg-border h-px flex-1" />
      or
      <span className="bg-border h-px flex-1" />
    </div>
  );
}

export function GithubButton({ to }: { to: string }) {
  return (
    <Button asChild variant="outline" size="lg" className="w-full justify-center">
      <a href={`/auth/github?to=${encodeURIComponent(to)}`}>
        <Github />
        Continue with GitHub
      </a>
    </Button>
  );
}

/** Username/email + password. `onDone` fires once the session is established. */
export function PasswordLogin({ onDone }: { onDone: () => void }) {
  const [login, setLogin] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async () => {
    if (!login.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(login.trim(), password);
      setMe(await api.me());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="mt-6 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Username or email">
        <input autoFocus autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Password">
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
      </Field>
      {error && (
        <p className="text-destructive text-meta" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={busy || !login.trim() || !password} className="justify-center">
        {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
        {busy ? "Signing in…" : "Sign in"}
        {!busy && <ArrowRight className="size-4" />}
      </Button>
    </form>
  );
}

export function SignUpForm({ min, onDone }: { min: number; onDone: () => void }) {
  const [f, setF] = React.useState({ name: "", login: "", email: "", password: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const strength = f.password.length >= min + 6 ? 3 : f.password.length >= min ? 2 : f.password.length > 0 ? 1 : 0;
  const ready = f.name.trim() && /^[A-Za-z0-9][A-Za-z0-9_-]{1,38}$/.test(f.login) && f.password.length >= min;
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.signup({ login: f.login.trim(), name: f.name.trim(), email: f.email.trim(), password: f.password });
      setMe(await api.me());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="mt-6 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name">
          <input autoFocus autoComplete="name" value={f.name} onChange={set("name")} placeholder="Priya Nair" className={inputCls} />
        </Field>
        <Field label="Username" hint="letters, digits, - _">
          <input autoComplete="username" value={f.login} onChange={set("login")} placeholder="priya" spellCheck={false} className={cn(inputCls, "font-mono")} />
        </Field>
      </div>
      <Field label="Email" hint="optional · for sign-in and recovery">
        <input type="email" autoComplete="email" value={f.email} onChange={set("email")} placeholder="priya@example.com" className={inputCls} />
      </Field>
      <Field label="Password" hint={`at least ${min} characters`}>
        <input type="password" autoComplete="new-password" value={f.password} onChange={set("password")} className={inputCls} />
        <span className="mt-1 flex gap-1" aria-hidden>
          {[1, 2, 3].map((i) => (
            <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors", strength >= i ? (strength === 3 ? "bg-ok" : strength === 2 ? "bg-live" : "bg-attention") : "bg-muted")} />
          ))}
        </span>
      </Field>
      {error && (
        <p className="text-destructive text-meta" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={busy || !ready} className="justify-center">
        {busy ? <Loader2 className="animate-spin" /> : null}
        {busy ? "Creating…" : "Create account"}
        {!busy && <ArrowRight className="size-4" />}
      </Button>
      <p className="text-faint text-micro leading-relaxed">You get a private workspace on this controller: your machines, GitHub accounts and MCP servers are yours alone.</p>
    </form>
  );
}

/** Paste-a-token entry: the operator token (token mode) or a personal access token (saas). */
export function TokenEntry({ saas = false, onDone }: { saas?: boolean; onDone: () => void }) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async () => {
    const t = value.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await api.verifyToken(t);
      if (!ok) {
        setError("That token was not accepted by the controller.");
        return;
      }
      setToken(t);
      if (saas) setMe(await api.me());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="mt-6 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label={saas ? "Access token" : "Token"}>
        <div className="border-line-strong focus-within:ring-ring flex items-center gap-2 rounded-md border px-3 focus-within:ring-2">
          <KeyRound className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <input
            type="password"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={saas ? "asb_…" : "paste the token"}
            aria-label={saas ? "Access token" : "Controller token"}
            className="placeholder:text-muted-foreground h-11 min-w-0 flex-1 bg-transparent font-mono text-meta outline-none"
          />
        </div>
      </Field>
      {error && (
        <p className="text-destructive text-meta" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={busy || !value.trim()} className="justify-center">
        {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
        {busy ? "Checking…" : "Open the console"}
        {!busy && <ArrowRight className="size-4" />}
      </Button>
    </form>
  );
}

/** Token-mode door: the operator's controller token. */
export function OperatorEntry({ onDone }: { onDone: () => void }) {
  return (
    <AuthShell>
      <h1 className="mt-8 text-h1 font-semibold tracking-[-0.02em]">Enter your controller token</h1>
      <p className="text-muted-foreground mt-2 text-body leading-relaxed">
        The token from your controller's <code className="bg-muted rounded px-1 font-mono text-[0.9em]">MCP_HTTP_TOKEN</code>. It is kept in this browser only and sent as a header — never in a link.
      </p>
      <TokenEntry onDone={onDone} />
      <p className="text-muted-foreground mt-6 text-micro leading-relaxed">One token is one operator. For several people, turn on multi-user mode (docs/self-hosting.md).</p>
    </AuthShell>
  );
}

/** The multi-user sign-in page body. */
export function SignInCard({ config, to, onDone }: { config: AuthConfig; to: string; onDone: () => void }) {
  const [useToken, setUseToken] = React.useState(false);
  return (
    <AuthShell>
      <div className="mt-8 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <h1 className="text-h1 font-semibold tracking-[-0.02em]">Sign in</h1>
        {config.signup && (
          <Link to={`/signup${to !== "/dashboard" ? `?to=${encodeURIComponent(to)}` : ""}`} className="text-muted-foreground hover:text-foreground text-meta whitespace-nowrap underline-offset-4 hover:underline">
            Create an account
          </Link>
        )}
      </div>
      <p className="text-muted-foreground mt-2 text-body leading-relaxed">Welcome back. Your machines, GitHub accounts and MCP servers are where you left them.</p>
      {useToken ? <TokenEntry saas onDone={onDone} /> : <PasswordLogin onDone={onDone} />}
      <OrDivider />
      <div className="flex flex-col gap-2">
        {config.providers.includes("github") && <GithubButton to={to} />}
        <Button variant="ghost" size="lg" className="text-muted-foreground w-full justify-center" onClick={() => setUseToken((v) => !v)}>
          <KeyRound />
          {useToken ? "Use a password instead" : "Use an access token"}
        </Button>
      </div>
      <p className="text-faint mt-6 text-micro leading-relaxed">Session cookie only · HttpOnly · signs out after 30 days of inactivity.</p>
    </AuthShell>
  );
}

/** The multi-user sign-up page body. */
export function SignUpCard({ config, to, onDone }: { config: AuthConfig; to: string; onDone: () => void }) {
  return (
    <AuthShell wide>
      <div className="mt-8 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <h1 className="text-h1 font-semibold tracking-[-0.02em]">Create your account</h1>
        <Link to={`/signin${to !== "/dashboard" ? `?to=${encodeURIComponent(to)}` : ""}`} className="text-muted-foreground hover:text-foreground text-meta whitespace-nowrap underline-offset-4 hover:underline">
          I have an account
        </Link>
      </div>
      <p className="text-muted-foreground mt-2 text-body leading-relaxed">Free on this controller. Start tasks from the dashboard right away, or connect your IDE later from Account.</p>
      {config.signup ? (
        <>
          <SignUpForm min={config.passwordMin ?? 10} onDone={onDone} />
          {config.providers.includes("github") && (
            <>
              <OrDivider />
              <GithubButton to={to} />
            </>
          )}
        </>
      ) : (
        <div className="bg-card raised mt-6 rounded-xl p-4">
          <p className="text-foreground text-meta font-medium">Sign-up is by invitation here.</p>
          <p className="text-muted-foreground mt-1 text-meta">Ask an admin for an access token, then sign in with it.</p>
        </div>
      )}
    </AuthShell>
  );
}
