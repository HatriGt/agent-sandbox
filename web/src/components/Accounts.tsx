import * as React from "react";
import { Check, Copy, ExternalLink, Github, KeyRound, Loader2, Lock, Plus, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type AccountView } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/**
 * GitHub accounts as a compact list: avatar · login · default star · masked token · orgs, with the
 * actions on the row. "Add account" opens a dialog with the two ways in (Sign in with GitHub when the
 * controller has an OAuth client id; paste a token). Field-level hints live in the dialog.
 */
export function Accounts({ embedded = false }: { embedded?: boolean }) {
  const [accounts, setAccounts] = React.useState<AccountView[] | null>(null);
  const [oauth, setOauth] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);

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

  return (
    <div className={cn(!embedded && "mx-auto max-w-3xl px-5 py-7")}>
      <div className="bg-card overflow-hidden rounded-xl border">
        {error && (
          <p role="alert" className="text-destructive border-b px-4 py-3 text-meta">
            {error}
          </p>
        )}
        {accounts === null ? (
          <div className="divide-y">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Bar className="size-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Bar className="h-3 w-32" />
                  <Bar className="h-2.5 w-52" />
                </div>
              </div>
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <Github className="text-muted-foreground size-6" aria-hidden />
            <p className="text-foreground mt-3 text-body font-medium">No account connected</p>
            <p className="text-muted-foreground mt-1 text-meta">Sandboxes can only reach public repositories until you add one.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {accounts.map((a) => (
              <AccountRow key={a.login} account={a} onChanged={setAccounts} />
            ))}
          </ul>
        )}
        <div className="bg-muted/40 flex items-center justify-between gap-3 border-t px-4 py-2.5">
          <span className="text-muted-foreground text-micro">
            {accounts?.length ? `${accounts.length} connected` : oauth ? "Sign in or paste a token" : "Paste a personal access token"}
          </span>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Add account
          </Button>
        </div>
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent title="Add a GitHub account" description="The token is verified with GitHub, stored on your server under its login, and never shown again.">
          <AddAccount oauth={oauth} onDone={(list) => { setAccounts(list); setAdding(false); }} />
        </DialogContent>
      </Dialog>
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
  const run = (p: Promise<{ accounts: AccountView[] }>, kind: "default" | "remove", ok?: string) => {
    setBusy(kind);
    p.then((r) => {
      onChanged(r.accounts);
      if (ok) toast.success(ok);
    })
      .catch((e: unknown) => toast.error("Could not update", { description: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        setBusy(null);
        setArmed(false);
      });
  };
  return (
    <li className="group flex items-center gap-3 px-4 py-3">
      <img src={`https://github.com/${encodeURIComponent(a.login)}.png?size=64`} alt="" width={32} height={32} loading="lazy" className="bg-muted size-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-body font-medium">{a.login}</span>
          {a.isDefault && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="bg-live/12 text-live inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-semibold">
                  <Star className="size-3 fill-current" aria-hidden /> default
                </span>
              </TooltipTrigger>
              <TooltipContent>Used for task-only runs (no repository attached)</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="stamp text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2">
          <span className="inline-flex items-center gap-1">
            <Lock className="size-3" aria-hidden /> {a.tokenHint}
          </span>
          <span className="opacity-40">·</span>
          <span>{a.type === "fine-grained" ? "fine-grained" : a.type === "classic" ? "classic" : "token"}</span>
          {a.orgs.length > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span className="truncate">{a.orgs.join(", ")}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!a.isDefault && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={() => run(api.setDefaultAccount(a.login), "default")} disabled={busy !== null} aria-label="Make default">
                {busy === "default" ? <Loader2 className="animate-spin" /> : <Star />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Make default</TooltipContent>
          </Tooltip>
        )}
        {armed ? (
          <>
            <Button size="sm" variant="destructive" onClick={() => run(api.removeAccount(a.login), "remove", `Removed ${a.login}`)} disabled={busy !== null}>
              <Trash2 /> Remove
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setArmed(false)} aria-label="Cancel">
              <X />
            </Button>
          </>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={() => setArmed(true)} aria-label={`Remove ${a.login}`}>
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

function AddAccount({ oauth, onDone }: { oauth: boolean; onDone: (list: AccountView[]) => void }) {
  const [mode, setMode] = React.useState<"oauth" | "pat">(oauth ? "oauth" : "pat");
  return (
    <div>
      {oauth && (
        <div role="tablist" className="bg-muted mb-5 inline-flex h-9 items-center gap-0.5 rounded-lg p-0.5">
          <Tab active={mode === "oauth"} onClick={() => setMode("oauth")} icon={<Github className="size-3.5" />} label="Sign in with GitHub" />
          <Tab active={mode === "pat"} onClick={() => setMode("pat")} icon={<KeyRound className="size-3.5" />} label="Paste a token" />
        </div>
      )}
      {mode === "oauth" ? <DeviceFlow onDone={onDone} /> : <PatForm onDone={onDone} />}
      {!oauth && (
        <p className="text-muted-foreground mt-5 text-micro">
          Prefer one-click sign-in? Set <code className="font-mono">GITHUB_OAUTH_CLIENT_ID</code> on the controller (a GitHub OAuth App with device flow; no secret needed).
        </p>
      )}
    </div>
  );
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={cn("flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-meta font-medium", active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
      {icon}
      {label}
    </button>
  );
}

function PatForm({ onDone }: { onDone: (list: AccountView[]) => void }) {
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
      toast.success(`Connected ${r.added}`);
      onDone(r.accounts);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="label text-muted-foreground">Personal access token</span>
        <input type="password" autoFocus autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… or github_pat_…" className="text-foreground placeholder:text-muted-foreground bg-muted focus:ring-ring h-10 rounded-md px-3 font-mono text-meta outline-none focus:ring-2" />
        <span className="text-muted-foreground text-micro">
          Scopes: <code className="font-mono">repo</code>, <code className="font-mono">read:org</code>; add <code className="font-mono">workflow</code> to trigger Actions.{" "}
          <a href="https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=agent-sandbox" target="_blank" rel="noreferrer" className="text-live inline-flex items-center gap-0.5 underline-offset-2 hover:underline">
            Create one <ExternalLink className="size-3" />
          </a>
        </span>
      </label>
      {err && (
        <p className="text-destructive text-meta" role="alert">
          {err}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || !token.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          {busy ? "Verifying…" : "Add account"}
        </Button>
      </div>
    </form>
  );
}

type Device =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "waiting"; code: string; uri: string; device: string; interval: number; expiresAt: number }
  | { phase: "failed"; message: string };

function DeviceFlow({ onDone }: { onDone: (list: AccountView[]) => void }) {
  const [state, setState] = React.useState<Device>({ phase: "idle" });
  const [copied, setCopied] = React.useState(false);
  const start = async () => {
    setState({ phase: "starting" });
    try {
      const r = await api.deviceStart();
      setState({ phase: "waiting", code: r.user_code, uri: r.verification_uri, device: r.device_code, interval: Math.max(5, r.interval), expiresAt: Date.now() + r.expires_in * 1000 });
    } catch (e) {
      setState({ phase: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  };
  React.useEffect(() => {
    if (state.phase !== "waiting") return;
    let cancelled = false;
    let interval = state.interval;
    let timer = 0;
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() > state.expiresAt) return setState({ phase: "failed", message: "The code expired. Start again." });
      try {
        const r = await api.devicePoll(state.device);
        if (cancelled) return;
        if (r.status === "done") {
          toast.success(`Connected ${r.login}`);
          onDone(r.accounts);
          return;
        }
        if (r.status === "expired") return setState({ phase: "failed", message: "The code expired. Start again." });
        if (r.status === "denied") return setState({ phase: "failed", message: "You declined the authorisation on GitHub." });
        if (r.status === "error") return setState({ phase: "failed", message: r.message });
        if (r.interval) interval = r.interval;
      } catch {
        /* transient */
      }
      timer = window.setTimeout(tick, interval * 1000);
    };
    timer = window.setTimeout(tick, interval * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [state, onDone]);

  if (state.phase === "waiting") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-meta">
          Enter this code at{" "}
          <a href={state.uri} target="_blank" rel="noreferrer" className="text-live font-medium underline-offset-2 hover:underline">
            {state.uri.replace(/^https?:\/\//, "")} <ExternalLink className="inline size-3" />
          </a>
        </p>
        <div className="flex items-center gap-2">
          <code className="bg-muted text-foreground rounded-lg px-4 py-2.5 font-mono text-h2 tracking-[0.14em]">{state.code}</code>
          <Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(state.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {})} aria-label="Copy code">
            {copied ? <Check className="text-ok" /> : <Copy />}
          </Button>
        </div>
        <p className="text-muted-foreground flex items-center gap-2 text-micro">
          <Loader2 className="size-3 animate-spin" aria-hidden /> Waiting for approval on GitHub…
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-meta">A one-time code on github.com — nothing to paste.</p>
      <div>
        <Button onClick={() => void start()} disabled={state.phase === "starting"}>
          {state.phase === "starting" ? <Loader2 className="animate-spin" /> : <Github />}
          Sign in with GitHub
        </Button>
      </div>
      {state.phase === "failed" && (
        <p className="text-destructive text-meta" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
