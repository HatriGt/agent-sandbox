import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ExternalLink, Github, KeyRound, Loader2, Lock, Plus, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type AccountView } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Collapse } from "@/components/ui/collapse";
import { StaggerItem, Swap } from "@/components/ui/swap";
import { CopyButton } from "@/components/ApiKeys";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AnimatedTabs, TabPanel } from "@/components/ui/animated-tabs";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";
import { useCached } from "@/lib/cache";

/**
 * GitHub accounts as a compact list: avatar · login · default star · masked token · orgs, with the
 * actions on the row. "Add account" opens a dialog with the two ways in (Sign in with GitHub when the
 * controller has an OAuth client id; paste a token). Field-level hints live in the dialog.
 */
export function Accounts({ embedded = false, query = "", onCount }: { embedded?: boolean; query?: string; onCount?: (n: number) => void }) {
  // Painted from the cache instantly, refreshed in the background (see lib/cache.ts).
  const cached = useCached("accounts", (signal) => api.accounts(signal));
  const accounts = cached.data?.accounts ?? null;
  const oauth = cached.data?.oauth ?? false;
  const error = cached.error;
  const setAccounts = React.useCallback((list: AccountView[]) => cached.setData((d) => ({ oauth: d?.oauth ?? false, accounts: list })), [cached]);
  const [adding, setAdding] = React.useState(false);
  // Dismissing hides that one message; a different error later shows again.
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (accounts) onCount?.(accounts.length);
  }, [accounts, onCount]);
  const q = query.trim().toLowerCase();
  const visible = (accounts ?? []).filter((a) => !q || [a.login, a.type, ...a.orgs].join(" ").toLowerCase().includes(q));
  const state = accounts === null ? "loading" : accounts.length === 0 ? "empty" : visible.length === 0 ? "nomatch" : "list";

  return (
    <div className={cn(!embedded && "mx-auto max-w-3xl px-5 py-7")}>
      <div className="bg-card overflow-hidden rounded-xl border">
        <Collapse open={!!error && error !== dismissed}>
          <div role="alert" className="bg-destructive/10 text-destructive flex items-start gap-2 border-b px-4 py-2.5 text-meta">
            <span className="min-w-0 flex-1">{error}</span>
            <button type="button" onClick={() => setDismissed(error ?? null)} aria-label="Dismiss" className="hover:bg-destructive/10 -mr-1 grid size-6 shrink-0 cursor-pointer place-items-center rounded-md">
              <X className="size-3.5" />
            </button>
          </div>
        </Collapse>
        <Swap state={state}>
          {state === "loading" ? (
            <div className="divide-y" aria-busy="true">
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
          ) : state === "empty" ? (
            <div className="m-3 flex flex-col items-center rounded-lg border border-dashed px-6 py-8 text-center">
              <Github className="text-muted-foreground size-5" aria-hidden />
              <p className="text-foreground mt-2.5 text-meta font-medium">No account connected</p>
              <p className="text-muted-foreground mt-0.5 text-meta">Sandboxes can only reach public repositories until you add one.</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setAdding(true)}>
                <Plus />
                Add account
              </Button>
            </div>
          ) : state === "nomatch" ? (
            <div className="flex flex-col items-center px-6 py-8 text-center">
              <p className="text-foreground text-body font-medium">Nothing matches</p>
              <p className="text-muted-foreground mt-1 text-meta">No account matches “{query.trim()}”.</p>
            </div>
          ) : (
            <ul className="divide-y">
              <AnimatePresence initial={false}>
                {visible.map((a, i) => (
                  <motion.li key={a.login} layout exit={{ opacity: 0, height: 0, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }} className="overflow-hidden">
                    <StaggerItem index={i}>
                      <AccountRow account={a} onChanged={setAccounts} />
                    </StaggerItem>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </Swap>
        {state !== "empty" && (
          <div className="bg-muted/40 flex items-center justify-between gap-3 border-t px-4 py-2.5">
            <span className="text-muted-foreground text-micro">
              {accounts?.length ? `${accounts.length} connected` : oauth ? "Sign in or paste a token" : "Paste a personal access token"}
            </span>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus />
              Add account
            </Button>
          </div>
        )}
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
  const still = useReducedMotion();
  const [busy, setBusy] = React.useState<"default" | "remove" | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = (p: Promise<{ accounts: AccountView[] }>, kind: "default" | "remove", ok?: string) => {
    setBusy(kind);
    return p
      .then((r) => {
        onChanged(r.accounts);
        if (ok) toast.success(ok);
      })
      .catch((e: unknown) => {
        toast.error("Could not update", { description: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => {
        if (alive.current) setBusy(null);
      });
  };
  return (
    <div className="group flex items-center gap-3 px-4 py-3">
      <img src={`https://github.com/${encodeURIComponent(a.login)}.png?size=64`} alt="" width={32} height={32} loading="lazy" className="bg-muted size-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-body font-medium">{a.login}</span>
          {a.isDefault && (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* One badge in the list; `layoutId` lets it glide to the new default instead of blinking. */}
                <motion.span layoutId={still ? undefined : "gh-default-badge"} transition={{ type: "spring", stiffness: 500, damping: 36 }} className="bg-live/10 text-live inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-semibold">
                  <Star className="size-3 fill-current" aria-hidden /> default
                </motion.span>
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
              <Button size="icon-sm" variant="ghost" onClick={() => void run(api.setDefaultAccount(a.login), "default")} loading={busy === "default"} disabled={busy !== null} aria-label="Make default">
                <Star />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Make default</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <ArmButton size="icon-sm" variant="ghost" icon={<Trash2 />} label={`Remove ${a.login}`} armedLabel="Remove" onConfirm={() => run(api.removeAccount(a.login), "remove", `Removed ${a.login}`)} disabled={busy === "default"} busy={busy === "remove"} />
            </span>
          </TooltipTrigger>
          <TooltipContent>Remove — sandboxes lose this account's access</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

type AddMode = "oauth" | "pat";
const ADD_MODES: readonly AddMode[] = ["oauth", "pat"];

function AddAccount({ oauth, onDone }: { oauth: boolean; onDone: (list: AccountView[]) => void }) {
  const [mode, setMode] = React.useState<AddMode>(oauth ? "oauth" : "pat");
  return (
    <div>
      {oauth && (
        <AnimatedTabs
          ariaLabel="How to add the account"
          idBase="add-account"
          size="md"
          className="mb-5"
          value={mode}
          onChange={setMode}
          items={[
            { value: "oauth", icon: <Github className="size-3.5" />, label: "Sign in with GitHub" },
            { value: "pat", icon: <KeyRound className="size-3.5" />, label: "Paste a token" },
          ]}
        />
      )}
      <TabPanel value={mode} order={ADD_MODES} idBase={oauth ? "add-account" : undefined}>
        {mode === "oauth" ? <DeviceFlow onDone={onDone} /> : <PatForm onDone={onDone} />}
      </TabPanel>
      {!oauth && (
        <p className="text-muted-foreground mt-5 text-micro">
          Prefer one-click sign-in? Set <code className="font-mono">GITHUB_OAUTH_CLIENT_ID</code> on the controller (a GitHub OAuth App with device flow; no secret needed).
        </p>
      )}
    </div>
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
      <Collapse open={!!err}>
        <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-meta" role="alert">
          {err}
        </p>
      </Collapse>
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={!token.trim()}>
          <Check />
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

  // Stepper: 0 = start · 1 = approve on GitHub · 2 = connected (the dialog closes on done).
  const step = state.phase === "waiting" ? 1 : 0;
  return (
    <div className="flex flex-col gap-4">
      <Stepper steps={["Start", "Approve on GitHub", "Connected"]} active={step} failed={state.phase === "failed"} />
      <Swap state={state.phase === "waiting" ? "waiting" : "idle"}>
        {state.phase === "waiting" ? (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-meta">
              Enter this code at{" "}
              <a href={state.uri} target="_blank" rel="noreferrer" className="text-live font-medium underline-offset-2 hover:underline">
                {state.uri.replace(/^https?:\/\//, "")} <ExternalLink className="inline size-3" />
              </a>
            </p>
            <div className="flex items-center gap-2">
              <code className="bg-muted text-foreground rounded-md px-4 py-2.5 font-mono text-h2 tracking-[0.14em]">{state.code}</code>
              <CopyButton
                size="icon"
                copied={copied}
                onClick={() =>
                  navigator.clipboard
                    .writeText(state.code)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1400);
                    })
                    .catch(() => {})
                }
              />
            </div>
            <p className="text-muted-foreground flex items-center gap-2 text-micro" role="status">
              <Loader2 className="size-3 animate-spin" aria-hidden /> Waiting for approval on GitHub…
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-meta">A one-time code on github.com — nothing to paste.</p>
            <div>
              <Button onClick={() => void start()} loading={state.phase === "starting"}>
                <Github />
                Sign in with GitHub
              </Button>
            </div>
            <Collapse open={state.phase === "failed"}>
              <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-meta" role="alert">
                {state.phase === "failed" ? state.message : ""}
              </p>
            </Collapse>
          </div>
        )}
      </Swap>
    </div>
  );
}

/** Three dots and labels; the active dot carries a --live ring that slides between steps. */
function Stepper({ steps, active, failed }: { steps: string[]; active: number; failed?: boolean }) {
  const still = useReducedMotion();
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((label, i) => {
        const state = i < active ? "done" : i === active ? "active" : "todo";
        return (
          <li key={label} className="flex min-w-0 items-center gap-2" aria-current={state === "active" ? "step" : undefined}>
            <span className="relative grid size-5 shrink-0 place-items-center">
              {state === "active" && <motion.span layoutId={still ? undefined : "device-step-ring"} transition={{ type: "spring", stiffness: 500, damping: 34 }} className={cn("absolute inset-0 rounded-full ring-2", failed ? "ring-destructive/50" : "ring-live/40")} aria-hidden />}
              <span className={cn("grid size-3 place-items-center rounded-full transition-colors duration-200", state === "done" ? "bg-ok" : state === "active" ? (failed ? "bg-destructive" : "bg-live") : "bg-muted-foreground/30")}>{state === "done" && <Check className="size-2 text-white" aria-hidden />}</span>
            </span>
            <span className={cn("truncate text-micro transition-colors duration-200", state === "active" ? "text-foreground font-medium" : "text-muted-foreground")}>{label}</span>
            {i < steps.length - 1 && <span className={cn("h-px w-6 shrink-0 transition-colors duration-200", i < active ? "bg-ok/60" : "bg-border")} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
