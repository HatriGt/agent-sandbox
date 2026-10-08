// How a delivery reads in the Automations list and on an automation's Runs list (mirrors the web's
// RunsTable wording).
import type { AutomationDelivery } from "@/lib/api";

const REASON: Record<NonNullable<AutomationDelivery["reason"]>, string> = {
  cooldown: "cooldown",
  disabled: "paused",
  limit: "limit reached",
  dedupe: "duplicate",
  ignored: "not a match",
  signature: "bad signature",
  payload: "bad payload",
  error: "error",
};

/** "fired → box-1" / "skipped · cooldown" / "rejected · bad signature". */
export function deliveryLine(d: AutomationDelivery): string {
  const head = d.outcome === "fired" ? `fired${d.box ? ` → ${d.box}` : ""}` : `${d.outcome === "failed" ? "could not start" : d.outcome}${d.reason ? ` · ${REASON[d.reason]}` : ""}`;
  return d.test ? `test · ${head}` : head;
}

export const deliveryTone = (d: AutomationDelivery): "ok" | "muted" | "destructive" => (d.outcome === "fired" ? "ok" : d.outcome === "skipped" ? "muted" : "destructive");

/** The same facts split for the Runs table: outcome word, and a one-line why (reason or detail). */
export function deliveryParts(d: AutomationDelivery): { outcome: string; why: string } {
  const outcome = d.outcome === "failed" ? "could not start" : d.outcome;
  const why = d.outcome === "fired" ? "" : [d.reason ? REASON[d.reason] : "", d.detail ?? ""].filter(Boolean).join(" — ");
  return { outcome: d.test ? `test · ${outcome}` : outcome, why };
}
