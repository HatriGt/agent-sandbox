import * as React from "react";
import { api, type HealthResponse } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { MetaLine, StatusDot } from "@/components/ui/data-table";

/**
 * The service watching itself, one line under the Fleet heading: the canary (one real task an hour
 * through the live pool), the host disk under the sandboxes, and where claude boxes boot from.
 * Facts the operator otherwise learns from the next failed run. Re-read every minute.
 */
export function ServiceHealth() {
  const { data, refresh } = useCached<HealthResponse>("health", (signal) => api.health(signal));
  React.useEffect(() => {
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);
  if (!data) return null;
  const c = data.canary.last;
  const d = data.hostDisk.reading;
  const canaryTone = !data.canary.enabled ? "muted" : !c ? "muted" : c.ok ? "ok" : "destructive";
  const canaryText = !data.canary.enabled ? "canary off" : !c ? "canary not run yet" : c.ok ? `canary ok · ${c.detail}` : `canary failing · ${c.detail}`;
  const diskTone = !d ? "muted" : d.usedPct >= data.hostDisk.alertPct ? "attention" : "ok";
  const diskText = !d ? "host disk unknown" : `host disk ${d.usedPct}% · ${(d.availMib / 1024).toFixed(0)} GiB free`;
  const source = data.claudeSource.kind === "image" ? `boots from image ${data.claudeSource.name}` : data.claudeSource.kind === "snapshot" ? `boots from snapshot ${data.claudeSource.name}` : "cold boots (no image or snapshot)";
  const streak = data.startFailures.streak;
  return (
    <MetaLine
      className="mt-2"
      parts={[
        <StatusDot tone={canaryTone} className="font-normal">
          <span title={c ? new Date(c.at).toLocaleString() : undefined}>{canaryText}</span>
        </StatusDot>,
        <StatusDot tone={diskTone} className="font-normal">
          {diskText}
        </StatusDot>,
        source,
        streak > 0 && (
          <span className="text-attention-text">
            {streak} {streak === 1 ? "run" : "runs"} died before the first turn
          </span>
        ),
        data.rebakeDue.length > 0 && <span className="text-attention-text">rebake due: {data.rebakeDue.map((o) => o.name).join(", ")}</span>,
      ]}
    />
  );
}
