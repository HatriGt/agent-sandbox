import * as React from "react";
import { toast } from "sonner";
import { api, type HealthResponse } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { MetaLine, StatusDot } from "@/components/ui/data-table";

/**
 * The service watching itself, under the Fleet heading. Two registers: when everything is fine, one
 * quiet line (canary, host disk, where claude boxes boot from) that nobody has to read; when
 * something is wrong, a bordered notice that says the problem, its consequence and the next step in
 * plain words — the operator otherwise learns these facts from the next failed run.
 *
 * Every notice has to pass one test: can the person reading it do the thing it asks? A notice that
 * ends in "rebake the image" was shown to people with no way to rebake anything. So a notice
 * either carries its own action (the image update is a button) or it is not shown to someone who
 * cannot act on it: a signed-in user who is not an admin sees only whether new tasks currently
 * finish, and the server sends them nothing else. Re-read every minute, every five seconds while
 * an image update runs.
 */
export function ServiceHealth() {
  const { data, refresh } = useCached<HealthResponse>("health", (signal) => api.health(signal));
  const updating = data?.imageUpdate?.phase === "building" || data?.imageUpdate?.phase === "verifying";
  React.useEffect(() => {
    const t = setInterval(() => void refresh(), updating ? 5_000 : 60_000);
    return () => clearInterval(t);
  }, [refresh, updating]);
  const [starting, setStarting] = React.useState(false);
  const updateImage = async () => {
    setStarting(true);
    try {
      await api.updateImage();
      await refresh();
    } catch (e) {
      toast.error("Could not start the image update", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setStarting(false);
    }
  };
  if (!data) return null;
  const problems = problemsOf(data);
  const c = data.canary.last;
  const d = data.hostDisk.reading;
  const src = data.claudeSource;
  const source = !src ? null : src.kind === "image" ? `boots from image ${src.name}` : src.kind === "snapshot" ? `boots from snapshot ${src.name}` : "cold boots (no baked image)";
  return (
    <>
      {problems.length > 0 && (
        <div role="status" className="border-attention/40 bg-card mt-3 rounded-xl border px-4 py-3">
          <ul className="flex flex-col gap-3">
            {problems.map((p) => (
              <li key={p.key} className="flex flex-col gap-0.5">
                <StatusDot tone={p.tone}>{p.title}</StatusDot>
                <span className="text-muted-foreground pl-3 text-meta">{p.body}</span>
                {p.action === "update-image" && (
                  <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-3">
                    <Button size="sm" variant="outline" onClick={() => void updateImage()} loading={starting}>
                      {p.retry ? "Try again" : "Update image"}
                    </Button>
                    <span className="text-faint text-micro">Takes a few minutes. Running sandboxes are not touched, and it switches back by itself if the test task fails.</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.admin !== false && (
        <MetaLine
          className="mt-2"
          parts={[
            <StatusDot tone={!data.canary.enabled || !c ? "muted" : c.ok ? "ok" : "destructive"} className="font-normal">
              <span title={c ? `Last canary run ${new Date(c.at).toLocaleString()}` : "A canary is one real task an hour through the live pool"}>
                {!data.canary.enabled ? "canary off" : !c ? "canary not run yet" : c.ok ? `canary ok · ${c.detail}` : "canary failing"}
              </span>
            </StatusDot>,
            <StatusDot tone={!d ? "muted" : d.usedPct >= data.hostDisk.alertPct ? "attention" : "ok"} className="font-normal">
              <span title={d ? `${data.hostDisk.home} · read ${fmtAgo(Math.floor(data.hostDisk.at / 1000))}` : data.hostDisk.error}>
                {!d ? "host disk unknown" : `host disk ${d.usedPct}% · ${(d.availMib / 1024).toFixed(0)} GiB free`}
              </span>
            </StatusDot>,
            ...(source ? [source] : []),
          ]}
        />
      )}
    </>
  );
}

type Problem = {
  key: string;
  tone: "attention" | "destructive" | "live" | "ok";
  title: string;
  body: string;
  /** The notice's own next step, when the reader can take it from here. */
  action?: "update-image";
  retry?: boolean;
};

const changesText = (list: { name: string; baked: string; latest: string }[]) => list.map((o) => `${o.name.replace(/^@[^/]+\//, "")} ${o.baked} → ${o.latest}`).join(", ");

/** Each thing that is wrong, with its consequence and the next step. Empty when the service is healthy. */
export function problemsOf(h: HealthResponse, nowMs = Date.now()): Problem[] {
  const out: Problem[] = [];
  const c = h.canary.last;
  // Not an admin: the one fact that concerns them, in their terms. The rest is the operator's.
  if (h.admin === false) {
    if (h.canary.enabled && c && !c.ok) {
      out.push({
        key: "canary",
        tone: "destructive",
        title: "New tasks may not finish right now",
        body: `The service's own test task is failing${c.lastOkAt ? ` (it last passed ${fmtAgo(Math.floor(c.lastOkAt / 1000), nowMs)})` : ""}. The operator has been alerted; running sandboxes are not affected.`,
      });
    }
    return out;
  }
  if (h.canary.enabled && c && !c.ok) {
    const lastOk = c.lastOkAt ? `Last good run ${fmtAgo(Math.floor(c.lastOkAt / 1000), nowMs)}.` : "It has never passed.";
    out.push({
      key: "canary",
      tone: "destructive",
      title: `The hourly test task is failing${c.failures > 1 ? ` (${c.failures} in a row)` : ""}`,
      body: `${c.detail}. New tasks will most likely fail the same way. ${lastOk}`,
    });
  }
  const d = h.hostDisk.reading;
  if (d && d.usedPct >= h.hostDisk.alertPct) {
    out.push({
      key: "disk",
      tone: d.usedPct >= 95 ? "destructive" : "attention",
      title: `The host disk is ${d.usedPct}% full`,
      body: `${(d.availMib / 1024).toFixed(1)} GiB left under ${h.hostDisk.home}. New sandboxes stop booting when it fills — destroy sleeping machines you no longer need or remove old snapshots.`,
    });
  }
  const s = h.startFailures;
  if (s.streak > 0) {
    const last = s.last ? ` Last: ${s.last.box}, ${fmtAgo(Math.floor(s.last.at / 1000), nowMs)} — ${s.last.tail.trim()}` : "";
    out.push({
      key: "starts",
      tone: s.streak >= 3 ? "destructive" : "attention",
      title: `${s.streak} ${s.streak === 1 ? "run" : "runs in a row"} died before the first turn`,
      body: `The sandbox booted but the agent never produced a turn.${last}`,
    });
  }
  const u = h.imageUpdate;
  const fromImage = h.claudeSource?.kind === "image";
  if (u?.phase === "building" || u?.phase === "verifying") {
    out.push({
      key: "image",
      tone: "live",
      title: u.phase === "building" ? "Updating the sandbox image" : "Testing the new sandbox image",
      body:
        u.phase === "building"
          ? `Building ${u.tag} with ${changesText(u.changes ?? [])}${u.startedAt ? `, started ${fmtAgo(Math.floor(u.startedAt / 1000), nowMs)}` : ""}. You can leave this page.`
          : `${u.tag} is built and new sandboxes boot from it. Running the test task on it now; if that fails the previous image comes back.`,
    });
  } else if (u?.phase === "failed" || u?.phase === "rolled-back") {
    out.push({
      key: "image",
      tone: "attention",
      title: u.phase === "failed" ? "The image update did not go through" : "The image update was undone",
      body: `${capital(u.detail ?? "it stopped without a reason")}. Sandboxes boot from the previous image, as before.`,
      action: fromImage && h.rebakeDue.length ? "update-image" : undefined,
      retry: true,
    });
  } else if (h.rebakeDue.length) {
    out.push({
      key: "image",
      tone: "attention",
      title: "Newer versions are available for the sandbox image",
      body:
        `${changesText(h.rebakeDue)}. Sandboxes keep working on the current versions until you update.` +
        (fromImage ? "" : " This server boots sandboxes without a baked image, so there is nothing to update from here: bake one first (runbook, \"Baking the claude image\")."),
      action: fromImage ? "update-image" : undefined,
    });
  } else if (u?.phase === "done" && u.finishedAt && nowMs - u.finishedAt < 15 * 60_000) {
    out.push({
      key: "image",
      tone: "ok",
      title: "The sandbox image is up to date",
      body: `New sandboxes boot from ${u.tag} (${changesText(u.changes ?? [])}). The test task passed on it.`,
    });
  }
  if (h.orphanSweep?.error) {
    out.push({ key: "sweep", tone: "attention", title: "The orphan sweep failed", body: h.orphanSweep.error });
  }
  return out;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
