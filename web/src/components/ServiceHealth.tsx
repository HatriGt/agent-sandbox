import * as React from "react";
import { api, type HealthResponse } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { fmtAgo } from "@/lib/format";
import { MetaLine, StatusDot } from "@/components/ui/data-table";

/**
 * The service watching itself, under the Fleet heading. Two registers: when everything is fine, one
 * quiet line (canary, host disk, where claude boxes boot from) that nobody has to read; when
 * something is wrong, a bordered notice that says the problem, its consequence and the next step in
 * plain words — the operator otherwise learns these facts from the next failed run. Re-read every
 * minute.
 */
export function ServiceHealth() {
  const { data, refresh } = useCached<HealthResponse>("health", (signal) => api.health(signal));
  React.useEffect(() => {
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);
  if (!data) return null;
  const problems = problemsOf(data);
  const c = data.canary.last;
  const d = data.hostDisk.reading;
  const source = data.claudeSource.kind === "image" ? `boots from image ${data.claudeSource.name}` : data.claudeSource.kind === "snapshot" ? `boots from snapshot ${data.claudeSource.name}` : "cold boots (no image or snapshot)";
  return (
    <>
      {problems.length > 0 && (
        <div role="status" className="border-attention/40 bg-card mt-3 rounded-xl border border-l-4 px-4 py-3">
          <ul className="flex flex-col gap-2">
            {problems.map((p) => (
              <li key={p.key} className="flex flex-col gap-0.5">
                <StatusDot tone={p.tone}>{p.title}</StatusDot>
                <span className="text-muted-foreground pl-3 text-meta">{p.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
          source,
        ]}
      />
    </>
  );
}

type Problem = { key: string; tone: "attention" | "destructive"; title: string; body: string };

/** Each thing that is wrong, with its consequence and the next step. Empty when the service is healthy. */
export function problemsOf(h: HealthResponse, nowMs = Date.now()): Problem[] {
  const out: Problem[] = [];
  const c = h.canary.last;
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
  if (h.rebakeDue.length) {
    out.push({
      key: "rebake",
      tone: "attention",
      title: "The sandbox image is behind",
      body: h.rebakeDue.map((o) => `${o.name} ${o.baked} → ${o.latest}`).join(", ") + ". Boxes still work; rebake the image to pick up the new version.",
    });
  }
  if (h.orphanSweep?.error) {
    out.push({ key: "sweep", tone: "attention", title: "The orphan sweep failed", body: h.orphanSweep.error });
  }
  return out;
}
