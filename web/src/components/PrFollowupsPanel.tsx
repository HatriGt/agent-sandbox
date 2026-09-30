import * as React from "react";
import { Copy, GitPullRequest } from "lucide-react";
import { toast } from "sonner";
import { api, type PrFollowupPrefs } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

/**
 * "Keep my PRs green / Address review comments": the per-user defaults for PR follow-ups (both ON),
 * plus the one GitHub webhook that feeds them. Automations can override either toggle per automation.
 */
export function PrFollowupsPanel() {
  const [prefs, setPrefs] = React.useState<PrFollowupPrefs | null>(null);
  const [hook, setHook] = React.useState<{ id: string; events: string[] } | null>(null);
  const [fresh, setFresh] = React.useState<{ hookUrl: string; secret: string } | null>(null);

  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .prFollowups(ctrl.signal)
      .then((r) => {
        setPrefs(r.prefs);
        setHook(r.hook);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

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
        <div className="border-t pt-3 text-micro">
          <p className="text-muted-foreground">
            GitHub automations already feed this. For other repos, add a webhook (content type JSON) sending: {(hook?.events ?? ["check_run", "check_suite", "workflow_run", "pull_request_review", "pull_request_review_comment", "issue_comment"]).join(", ")}.
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
