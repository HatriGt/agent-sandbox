import * as React from "react";
import { ArrowRight, Github, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { api, type AuthConfig } from "@/lib/api";
import { currentToken, getMe, migrateTokenFromUrl, onAuthChange, setMe, setToken } from "@/lib/auth";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router";

/**
 * The console's front door. Token mode: paste the controller token. Multi-user mode: sign in with a
 * username and password (or a personal access token, or GitHub when configured), or create an account.
 * A new account lands on "Connect your IDE" with a fresh API key.
 */
export function TokenGate({ children }: { children: React.ReactNode }) {
  const [, force] = React.useState(0);
  const [config, setConfig] = React.useState<AuthConfig | null>(null);
  const [checked, setChecked] = React.useState(false);
  React.useEffect(() => {
    migrateTokenFromUrl();
    force((n) => n + 1);
    api
      .authConfig()
      .then(setConfig)
      .catch(() => setConfig({ mode: "token", providers: [] }));
    return onAuthChange(() => force((n) => n + 1));
  }, []);
  React.useEffect(() => {
    if (config?.mode !== "saas") return;
    let cancelled = false;
    api
      .me()
      .then((m) => {
        if (!cancelled) setMe(m);
      })
      .catch(() => {})
      .finally(() => !cancelled && setChecked(true));
    return () => {
      cancelled = true;
    };
  }, [config?.mode]);
  if (config === null) return <div className="bg-background h-full" aria-busy="true" />;
  if (config.mode === "saas") {
    if (getMe() || currentToken()) return <>{children}</>;
    if (!checked) return <div className="bg-background h-full" aria-busy="true" />;
    return <Door config={config} />;
  }
  if (currentToken()) return <>{children}</>;
  return <OperatorEntry />;
}

function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="bg-background text-foreground flex min-h-full items-center justify-center px-6 py-10">
      <div className={cn("w-full", wide ? "max-w-md" : "max-w-sm")}>
        <div className="flex items-center gap-2.5">
          <span className="bg-primary text-primary-foreground grid size-9 place-items-center rounded-md">
            <Logo className="size-5" />
          </span>
          <span className="text-body font-semibold tracking-[-0.01em]">Agent Sandbox</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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
const inputCls = "border-line-strong focus:ring-ring text-foreground placeholder:text-muted-foreground h-10 w-full rounded-md border bg-transparent px-3 text-meta outline-none focus:ring-2";

/** Multi-user door: Sign in · Create account · (token) · (GitHub). */
function Door({ config }: { config: AuthConfig }) {
  const [tab, setTab] = React.useState<"in" | "up" | "token">("in");
  const github = config.providers.includes("github");
  const returnTo = `${location.pathname}${location.search}`;
  return (
    <Shell wide={tab === "up"}>
      <div className="mt-8 flex items-baseline justify-between">
        <h1 className="text-h1 font-semibold tracking-[-0.02em]">{tab === "up" ? "Create your account" : "Sign in"}</h1>
        {config.signup && (
          <button type="button" onClick={() => setTab(tab === "up" ? "in" : "up")} className="text-muted-foreground hover:text-foreground cursor-pointer text-meta underline-offset-4 hover:underline">
            {tab === "up" ? "I have an account" : "Create an account"}
          </button>
        )}
      </div>
      <p className="text-muted-foreground mt-2 text-body leading-relaxed">
        {tab === "up" ? "Your machines, GitHub accounts and MCP servers will be yours alone. Takes a minute; you leave with an API key for your IDE." : "Your machines, GitHub accounts and MCP servers are yours alone."}
      </p>

      {tab === "up" ? <SignUp min={config.passwordMin ?? 10} /> : tab === "token" ? <TokenEntry saas /> : <PasswordLogin />}

      {tab !== "up" && (
        <>
          <div className="text-faint my-5 flex items-center gap-3 text-micro">
            <span className="bg-border h-px flex-1" />
            or
            <span className="bg-border h-px flex-1" />
          </div>
          <div className="flex flex-col gap-2">
            {github && (
              <Button asChild variant="outline" size="lg" className="w-full justify-center">
                <a href={`/auth/github?to=${encodeURIComponent(returnTo)}`}>
                  <Github />
                  Continue with GitHub
                </a>
              </Button>
            )}
            <Button variant={tab === "token" ? "secondary" : "ghost"} size="lg" className="text-muted-foreground w-full justify-center" onClick={() => setTab(tab === "token" ? "in" : "token")}>
              <KeyRound />
              {tab === "token" ? "Use a password instead" : "Use an access token"}
            </Button>
          </div>
        </>
      )}
      <p className="text-faint mt-6 text-micro leading-relaxed">Session cookie only · HttpOnly · signs out after 30 days of inactivity.</p>
    </Shell>
  );
}

function PasswordLogin() {
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

function SignUp({ min }: { min: number }) {
  const navigate = useNavigate();
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
      // Land on "Connect your IDE": route first (through the router, so the app sees it), then let the gate open.
      navigate("/dashboard/connect?welcome=1", { replace: true });
      setMe(await api.me());
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
      <p className="text-faint text-micro leading-relaxed">By continuing you get a private workspace on this controller. Nothing is shared with other users.</p>
    </form>
  );
}

/** Paste-a-token entry: the operator token (token mode) or a personal access token (saas). */
function TokenEntry({ saas = false }: { saas?: boolean }) {
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

function OperatorEntry() {
  return (
    <Shell>
      <h1 className="mt-8 text-h1 font-semibold tracking-[-0.02em]">Enter your controller token</h1>
      <p className="text-muted-foreground mt-2 text-body leading-relaxed">
        The token from your controller's <code className="bg-muted rounded px-1 font-mono text-[0.9em]">MCP_HTTP_TOKEN</code>. It is kept in this browser only and sent as a header — never in a link.
      </p>
      <TokenEntry />
      <p className="text-muted-foreground mt-6 text-micro leading-relaxed">One token is one operator. For several people, turn on multi-user mode (docs/self-hosting.md).</p>
    </Shell>
  );
}
