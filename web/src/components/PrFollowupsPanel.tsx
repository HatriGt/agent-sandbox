import * as React from "react";
import { Copy, GitPullRequest, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, type PrFollowupInstall, type PrFollowupPrefs } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

/**
 * "Keep my PRs green / Address review comments / Answer /agent on any PR": the per-user defaults for
 * PR follow-ups (all ON), plus the one GitHub webhook that feeds the first two. The third needs no
 * webhook (the controller polls GitHub every couple of seconds as the connected account), but the
 * webhook makes it instant — and "Install on GitHub" puts it on an org or a repo in one click.
 * Automations can override the first two per automation.
 */
export function PrFollowupsPanel() {
  const [prefs, setPrefs] = React.useState<PrFollowupPrefs | null>(null);
  const [hook, setHook] = React.useState<{ id: string; events: string[] } | null>(null);
  const [fresh, setFresh] = React.useState<{ hookUrl: string; secret: string } | null>(null);
  const [installs, setInstalls] = React.useState<PrFollowupInstall[]>([]);
  const [target, setTarget] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .prFollowups(ctrl.signal)
      .then((r) => {
        setPrefs(r.prefs);
        setHook(r.hook);
        setInstalls(r.installs ?? []);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const install = async () => {
    const t = target.trim();
    if (!t) return;
    setBusy(t);
    try {
      const r = await api.installPrFollowupHook(t);
      setInstalls(r.installs);
      setTarget("");
      if (!hook) setHook({ id: "", events: [] });
      toast.success(r.updated ? `Webhook on ${r.install.target} updated` : `Webhook installed on ${r.install.target}`, {
        description: r.install.kind === "org" ? "Every repo in the organisation now reaches the agent instantly." : "This repo now reaches the agent instantly.",
      });
    } catch (e) {
      toast.error("Could not install the webhook", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const uninstall = async (t: string) => {
    setBusy(t);
    try {
      setInstalls((await api.uninstallPrFollowupHook(t)).installs);
    } catch (e) {
      toast.error("Could not remove the webhook", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const change = async (patch: Partial<PrFollowupPrefs>) => {
    const prev = prefs;
    if (prev) setPrefs({ ...prev, ...patch });
    try {
      setPrefs((await api.setPrFollowups(patch)).prefs);
    } catch (e) {
      setPrefs(prev);
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const rotate = async () => {
    try {
      const r = await api.rotatePrFollowupHook();
      setHook({ id: r.id, events: r.events });
      setFresh({ hookUrl: r.hookUrl, secret: r.secret });
    } catch (e) {
      toast.error("Could not create the webhook", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const copy = (s: string) => void navigator.clipboard.writeText(s).then(() => toast.success("Copied"));

  if (!prefs) return null;
  return (
    <section aria-label="PR follow-ups" className="mt-8 rounded-xl border px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <GitPullRequest className="text-muted-foreground size-4" aria-hidden />
        <h2 className="text-foreground text-meta font-medium">After a PR is opened</h2>
      </div>
      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-3">
          <span className="text-meta">
            Keep my PRs green
            <span className="text-faint block text-micro">When CI fails on a PR an agent opened, it fixes it on the same branch. At most 3 tries.</span>
          </span>
          <Switch size="sm" checked={prefs.keepGreen} onCheckedChange={(v) => void change({ keepGreen: v })} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-meta">
            Address review comments
            <span className="text-faint block text-micro">Changes requested, review comments, or “/agent …” on the PR: it pushes fixes, replies and resolves the threads.</span>
          </span>
          <Switch size="sm" checked={prefs.addressReviews} onCheckedChange={(v) => void change({ addressReviews: v })} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-meta">
            Answer “/agent …” on any PR
            <span className="text-faint block text-micro">
              Comment <code>/agent &lt;ask&gt;</code> on any pull request in any repo your GitHub account can push to — no webhook needed. It reacts 👀 within a
              couple of seconds, works on the PR’s branch and replies on the PR; comment again to continue. Instant with the webhook below.
            </span>
          </span>
          <Switch size="sm" checked={prefs.commandAnywhere} onCheckedChange={(v) => void change({ commandAnywhere: v })} />
        </label>
        <div className="border-t pt-3 text-micro">
          <p className="text-muted-foreground">
            <Zap className="mr-1 inline size-3 align-[-2px]" aria-hidden />
            Install the webhook on an organisation (every repo in it) or one repo and GitHub delivers “/agent” comments, CI results and reviews the instant they
            happen. Your connected account must administer it.
          </p>
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void install();
            }}
          >
            <Input mono value={target} onChange={(e) => setTarget(e.target.value)} placeholder="org  or  org/repo" aria-label="Organisation or repository" className="h-8 flex-1" />
            <Button size="sm" type="submit" disabled={!target.trim() || busy !== null}>
              {busy === target.trim() && busy ? "Installing…" : "Install on GitHub"}
            </Button>
          </form>
          {installs.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1" aria-label="Installed webhooks">
              {installs.map((i) => (
                <li key={i.target} className="flex items-center justify-between gap-2">
                  <span>
                    <code>{i.target}</code> <span className="text-faint">{i.kind === "org" ? "· organisation" : "· repository"}</span>
                  </span>
                  <Button size="sm" variant="ghost" aria-label={`Remove the webhook from ${i.target}`} disabled={busy !== null} onClick={() => void uninstall(i.target)}>
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground mt-3">
            Or add it by hand: a webhook (content type JSON) sending{" "}
            {(hook?.events ?? ["check_run", "check_suite", "workflow_run", "pull_request_review", "pull_request_review_comment", "issue_comment"]).join(", ")}, with the payload URL and
            secret below.
          </p>
          {fresh ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <Button size="sm" variant="outline" className="justify-start" onClick={() => copy(fresh.hookUrl)}>
                <Copy />
                Copy payload URL
              </Button>
              <Button size="sm" variant="outline" className="justify-start" onClick={() => copy(fresh.secret)}>
                <Copy />
                Copy secret (shown once)
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void rotate()}>
              {hook ? "Rotate webhook secret" : "Create webhook"}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
