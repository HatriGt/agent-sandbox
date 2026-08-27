import * as React from "react";
import { ArrowLeft, Check, Copy, ExternalLink, Github, KeyRound, Loader2, ShieldCheck, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type AccountView } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/**
 * GitHub accounts — the credentials the sandboxes borrow.
 *
 * Model: a login-keyed store on the VPS (never in the browser). A run on a repo uses whichever
 * account can access that repo; a task-only run gets the DEFAULT account so `gh` works. Two ways in:
 * "Sign in with GitHub" (OAuth device flow — a one-time code, no secret pasted anywhere) when the
 * controller has an OAuth client id, and pasting a personal access token otherwise. Tokens are shown
 * only as a masked hint; removal is deliberate (armed confirm).
 */
export function Accounts({ onBack, embedded = false }: { onBack?: () => void; embedded?: boolean }) {
  const [accounts, setAccounts] = React.useState<AccountView[] | null>(null);
  const [oauth, setOauth] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api
      .accounts()
      .then((r) => {
        setAccounts(r.accounts);
        setOauth(r.oauth);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  React.useEffect(load, [load]);

  const body = (
    <>
        <header className="mb-7">
          {!embedded && (
            <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
              <ArrowLeft className="size-4" />
              Machines
            </Button>
          )}
          {embedded ? (
            <h2 className="text-foreground text-h2 font-semibold tracking-[-0.015em]">GitHub accounts</h2>
          ) : (
            <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em]">GitHub accounts</h1>
          )}
          <p className="text-muted-foreground mt-2 max-w-[68ch] text-body">
            Sandboxes borrow these credentials to clone, read pull requests and push. Tokens are stored on your
            server with owner-only permissions and are never sent to this browser. A run on a repository uses the
            account that can access it; a task-only run uses the <span className="text-foreground font-medium">default</span>{" "}
            account so <code className="bg-muted rounded px-1 font-mono text-[0.9em]">gh</code> works out of the box.
          </p>
        </header>

        {error && (
          <p role="alert" className="text-destructive mb-4 text-meta">
            {error}
          </p>
        )}

        <section aria-labelledby="connected" className="mb-8">
          <h2 id="connected" className="text-foreground mb-2.5 text-meta font-semibold">
            Connected
          </h2>
          {accounts === null ? (
            <div className="flex flex-col gap-2">
              {[0, 1].map((i) => (
                <div key={i} className="flex items-center gap-4 rounded-xl border px-4 py-3.5">
                  <Bar className="size-9 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Bar className="h-3 w-32" />
                    <Bar className="h-2.5 w-56" />
                  </div>
                  <Bar className="h-8 w-24 rounded-md" />
                </div>
              ))}
            </div>
          ) : accounts.length === 0 ? (
            <div className="rounded-xl border border-dashed px-6 py-10 text-center">
              <Github className="text-muted-foreground mx-auto size-6" aria-hidden />
              <p className="text-foreground mt-3 text-lead font-medium">No GitHub account yet</p>
              <p className="text-muted-foreground mx-auto mt-1 max-w-[46ch] text-meta">
                Until one is added, sandboxes can only work on public repositories and will stop to ask for
                credentials when they need more.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {accounts.map((a) => (
                <AccountRow key={a.login} account={a} onChanged={setAccounts} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="add">
          <h2 id="add" className="text-foreground mb-2.5 text-meta font-semibold">
            Add an account
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {oauth && <DeviceFlowCard onDone={(list) => setAccounts(list)} />}
            <PatCard onDone={(list) => setAccounts(list)} wide={!oauth} />
          </div>
          {!oauth && (
            <p className="text-muted-foreground mt-3 text-micro">
              Want one-click <span className="font-medium">Sign in with GitHub</span> instead of pasting tokens? Create a
              GitHub OAuth App (device flow enabled) and set <code className="font-mono">GITHUB_OAUTH_CLIENT_ID</code> on the
              controller — no client secret is needed.
            </p>
          )}
        </section>
    </>
  );
  if (embedded) return <div>{body}</div>;
  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-7 md:px-8 md:py-9">{body}</div>
    </div>
  );
}

function AccountRow({ account: a, onChanged }: { account: AccountView; onChanged: (list: AccountView[]) => void }) {
  const [armed, setArmed] = React.useState(false);
  const [busy, setBusy] = React.useState<"default" | "remove" | null>(null);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const makeDefault = () => {
    setBusy("default");
    api
      .setDefaultAccount(a.login)
      .then((r) => onChanged(r.accounts))
      .catch((e: unknown) => toast.error("Could not set default", { description: e instanceof Error ? e.message : String(e) }))
      .finally(() => setBusy(null));
  };
  const remove = () => {
    if (!armed) return setArmed(true);
    setBusy("remove");
    api
      .removeAccount(a.login)
      .then((r) => {
        onChanged(r.accounts);
        toast.success(`Removed ${a.login}`);
      })
      .catch((e: unknown) => toast.error("Could not remove", { description: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        setBusy(null);
        setArmed(false);
      });
  };

  return (
    <li className={cn("bg-card flex flex-wrap items-center gap-4 rounded-xl border px-4 py-3.5", a.isDefault && "border-live/40")}>
      <img
        src={`https://github.com/${encodeURIComponent(a.login)}.png?size=72`}
        alt=""
        width={36}
        height={36}
        loading="lazy"
        className="bg-muted size-9 shrink-0 rounded-full"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-foreground text-body font-medium">{a.login}</p>
          {a.isDefault && (
            <span className="bg-live/12 text-live inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold">
              <Star className="size-3" strokeWidth={2.5} aria-hidden />
              default
            </span>
          )}
          <span className="stamp text-muted-foreground">{a.tokenHint}</span>
          <span className="label text-muted-foreground">{a.type === "fine-grained" ? "fine-grained token" : a.type === "classic" ? "classic token" : "token"}</span>
        </div>
        <p className="text-muted-foreground mt-1 truncate text-micro">
          {a.orgs.length ? (
            <>
              Orgs: <span className="text-foreground/80">{a.orgs.join(", ")}</span>
            </>
          ) : (
            "No organisation memberships visible"
          )}
          {a.verifiedRepos.length > 0 && (
            <>
              <span className="mx-1.5 opacity-40">·</span>
              {a.verifiedRepos.length} verified {a.verifiedRepos.length === 1 ? "repo" : "repos"}
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {!a.isDefault && (
          <Button size="sm" variant="outline" onClick={makeDefault} disabled={busy !== null}>
            {busy === "default" ? <Loader2 className="animate-spin" /> : <Star />}
            Make default
          </Button>
        )}
        {armed ? (
          <>
            <Button size="sm" variant="destructive" onClick={remove} disabled={busy !== null}>
              <Trash2 />
              {busy === "remove" ? "Removing…" : "Confirm"}
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setArmed(false)} aria-label="Cancel">
              <X />
            </Button>
          </>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={remove} aria-label={`Remove ${a.login}`}>
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove — sandboxes lose this account's access</TooltipContent>
          </Tooltip>
        )}
      </div>
    </li>
  );
}

function PatCard({ onDone, wide }: { onDone: (list: AccountView[]) => void; wide: boolean }) {
  const [token, setToken] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const add = async () => {
    const t = token.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.addAccount(t);
      onDone(r.accounts);
      setToken("");
      toast.success(`Connected ${r.added}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cn("bg-card rounded-xl border p-4", wide && "md:col-span-2")}>
      <div className="flex items-center gap-2">
        <KeyRound className="text-muted-foreground size-4" aria-hidden />
        <h3 className="text-foreground text-body font-medium">Paste a personal access token</h3>
      </div>
      <p className="text-muted-foreground mt-1 text-meta">
        Verified against GitHub, then stored under its login. Needs <code className="font-mono">repo</code> and{" "}
        <code className="font-mono">read:org</code> (add <code className="font-mono">workflow</code> to trigger Actions).
      </p>
      <div className="mt-3 flex gap-2">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="ghp_… or github_pat_…"
          aria-label="Personal access token"
          className="text-foreground placeholder:text-muted-foreground bg-muted focus:ring-ring h-9 min-w-0 flex-1 rounded-md px-3 font-mono text-meta outline-none focus:ring-2"
        />
        <Button onClick={() => void add()} disabled={busy || !token.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          {busy ? "Verifying…" : "Add"}
        </Button>
      </div>
      {err && (
        <p className="text-destructive mt-2 text-micro" role="alert">
          {err}
        </p>
      )}
      <a
        href="https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=agent-sandbox"
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground hover:text-foreground mt-3 inline-flex items-center gap-1 text-micro underline-offset-2 hover:underline"
      >
        Create a token on GitHub with these scopes
        <ExternalLink className="size-3" aria-hidden />
      </a>
    </div>
  );
}

type Device =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "waiting"; code: string; uri: string; device: string; interval: number; expiresAt: number }
  | { phase: "done"; login: string }
  | { phase: "failed"; message: string };

function DeviceFlowCard({ onDone }: { onDone: (list: AccountView[]) => void }) {
  const [state, setState] = React.useState<Device>({ phase: "idle" });
  const [copied, setCopied] = React.useState(false);

  const start = async () => {
    setState({ phase: "starting" });
    try {
      const r = await api.deviceStart();
      setState({
        phase: "waiting",
        code: r.user_code,
        uri: r.verification_uri,
        device: r.device_code,
        interval: Math.max(5, r.interval),
        expiresAt: Date.now() + r.expires_in * 1000,
      });
    } catch (e) {
      setState({ phase: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  };

  React.useEffect(() => {
    if (state.phase !== "waiting") return;
    let cancelled = false;
    let interval = state.interval;
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() > state.expiresAt) return setState({ phase: "failed", message: "The code expired. Start again." });
      try {
        const r = await api.devicePoll(state.device);
        if (cancelled) return;
        if (r.status === "done") {
          onDone(r.accounts);
          setState({ phase: "done", login: r.login });
          toast.success(`Connected ${r.login}`);
          return;
        }
        if (r.status === "expired") return setState({ phase: "failed", message: "The code expired. Start again." });
        if (r.status === "denied") return setState({ phase: "failed", message: "You declined the authorisation on GitHub." });
        if (r.status === "error") return setState({ phase: "failed", message: r.message });
        if (r.interval) interval = r.interval;
      } catch {
        /* transient; keep polling */
      }
      timer = window.setTimeout(tick, interval * 1000);
    };
    let timer = window.setTimeout(tick, interval * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [state, onDone]);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="flex items-center gap-2">
        <Github className="text-muted-foreground size-4" aria-hidden />
        <h3 className="text-foreground text-body font-medium">Sign in with GitHub</h3>
      </div>
      <p className="text-muted-foreground mt-1 text-meta">
        A one-time code — nothing to paste, nothing to copy out of GitHub. The resulting token is stored on the server
        like any other account.
      </p>

      {state.phase === "idle" || state.phase === "failed" ? (
        <>
          <Button className="mt-3" onClick={() => void start()}>
            <Github />
            Sign in with GitHub
          </Button>
          {state.phase === "failed" && (
            <p className="text-destructive mt-2 text-micro" role="alert">
              {state.message}
            </p>
          )}
        </>
      ) : state.phase === "starting" ? (
        <p className="text-muted-foreground mt-3 flex items-center gap-2 text-meta">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Asking GitHub for a code…
        </p>
      ) : state.phase === "waiting" ? (
        <div className="enter mt-3">
          <p className="text-muted-foreground text-meta">
            Enter this code at{" "}
            <a href={state.uri} target="_blank" rel="noreferrer" className="text-live font-medium underline-offset-2 hover:underline">
              {state.uri.replace(/^https?:\/\//, "")}
              <ExternalLink className="ml-0.5 inline size-3" aria-hidden />
            </a>
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="bg-muted text-foreground rounded-lg px-3 py-2 font-mono text-h2 tracking-[0.12em]">{state.code}</code>
            <Button variant="outline" size="icon" onClick={() => void copy(state.code)} aria-label="Copy code">
              {copied ? <Check className="text-ok" /> : <Copy />}
            </Button>
          </div>
          <p className="text-muted-foreground mt-2 flex items-center gap-2 text-micro">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Waiting for you to approve on GitHub…
          </p>
        </div>
      ) : (
        <p className="text-ok mt-3 flex items-center gap-2 text-meta font-medium">
          <Check className="size-4" strokeWidth={2.5} aria-hidden />
          Connected {state.login}
        </p>
      )}
    </div>
  );
}
