import * as React from "react";
import { ArrowRight, Github, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { currentToken, getMe, migrateTokenFromUrl, onAuthChange, setMe, setToken } from "@/lib/auth";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";

/**
 * The console's front door until real sign-in exists: paste the controller token once. It is verified
 * against the controller before it is kept, stored locally, and sent as a header from then on. A 401
 * anywhere later clears it and brings this screen back with a reason.
 */
export function TokenGate({ children }: { children: React.ReactNode }) {
  const [, force] = React.useState(0);
  const [mode, setMode] = React.useState<"token" | "saas" | null>(null);
  const [checked, setChecked] = React.useState(false);
  React.useEffect(() => {
    migrateTokenFromUrl();
    force((n) => n + 1);
    api
      .authConfig()
      .then((c) => setMode(c.mode))
      .catch(() => setMode("token"));
    return onAuthChange(() => force((n) => n + 1));
  }, []);
  // Cookie mode: ask the server who we are once; a 401 later (signOut) brings the door back.
  React.useEffect(() => {
    if (mode !== "saas") return;
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
  }, [mode]);
  if (mode === null) return <div className="bg-background h-full" aria-busy="true" />;
  if (mode === "saas") {
    if (getMe() || currentToken()) return <>{children}</>;
    if (!checked) return <div className="bg-background h-full" aria-busy="true" />;
    return <SignIn />;
  }
  const token = currentToken();
  if (token) return <>{children}</>;
  return <Entry />;
}

function SignIn() {
  const to = `${location.pathname}${location.search}`;
  return (
    <div className="bg-background text-foreground flex min-h-full items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5">
          <span className="bg-primary text-primary-foreground grid size-9 place-items-center rounded-md">
            <Logo className="size-5" />
          </span>
          <span className="text-body font-semibold tracking-[-0.01em]">Agent Sandbox</span>
        </div>
        <h1 className="mt-8 text-h1 font-semibold tracking-[-0.02em]">Sign in</h1>
        <p className="text-muted-foreground mt-2 text-body leading-relaxed">Your machines, runs and API keys are yours alone. We only read your GitHub identity — repository access is granted separately, per account.</p>
        <Button asChild className="mt-6 h-10 w-full">
          <a href={`/auth/github?to=${encodeURIComponent(to)}`}>
            <Github />
            Continue with GitHub
          </a>
        </Button>
        <p className="text-faint mt-4 text-micro">Session cookie only · HttpOnly · signs out after 30 days of inactivity</p>
      </div>
    </div>
  );
}

function Entry() {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-background text-foreground flex min-h-full items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5">
          <span className="bg-primary text-primary-foreground grid size-9 place-items-center rounded-md">
            <Logo className="size-5" />
          </span>
          <span className="text-body font-semibold tracking-[-0.01em]">Agent Sandbox</span>
        </div>
        <h1 className="mt-8 text-h1 font-semibold tracking-[-0.02em]">Enter your controller token</h1>
        <p className="text-muted-foreground mt-2 text-body leading-relaxed">
          The token from your controller's <code className="bg-muted rounded px-1 font-mono text-[0.9em]">MCP_HTTP_TOKEN</code>.
          It is kept in this browser only and sent as a header — never in a link. Everything behind it — sandboxes,
          GitHub accounts, MCP servers — is yours alone.
        </p>
        <form
          className="mt-6 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="label text-muted-foreground">Token</span>
            <div className="border-line-strong focus-within:ring-ring flex items-center gap-2 rounded-md border px-3 focus-within:ring-2">
              <KeyRound className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <input
                type="password"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="paste the token"
                aria-label="Controller token"
                className="placeholder:text-muted-foreground h-11 min-w-0 flex-1 bg-transparent font-mono text-meta outline-none"
              />
            </div>
          </label>
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
        <p className="text-muted-foreground mt-6 text-micro leading-relaxed">
          Interim access model: one token is one operator. Proper sign-in (accounts, sessions, revocation) is on the
          roadmap; until then treat this token like a root password.
        </p>
      </div>
    </div>
  );
}
