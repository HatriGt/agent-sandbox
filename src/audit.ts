/**
 * Audit trail for every state-changing request: who (client address), what (method + path + the box
 * it named), outcome (status) and how long it took. One JSON line per event on stderr, prefixed
 * `[audit]`, so `docker logs` / journald already retain it and a log shipper can pick it up.
 * Never logs bodies, tokens or secrets — only the box name and a few whitelisted scalar fields.
 */
export interface AuditEvent {
  at: string;
  client: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  session?: string;
  action?: string;
  repo?: string;
}

const FIELDS = ["session", "action", "repo"] as const;

export function auditFields(body: unknown, query: unknown): Pick<AuditEvent, "session" | "action" | "repo"> {
  const out: Pick<AuditEvent, "session" | "action" | "repo"> = {};
  for (const src of [body, query]) {
    if (!src || typeof src !== "object") continue;
    for (const k of FIELDS) {
      const v = (src as Record<string, unknown>)[k];
      if (out[k] === undefined && typeof v === "string" && v.length <= 200) out[k] = v;
    }
  }
  return out;
}

export function formatAudit(e: AuditEvent): string {
  return `[audit] ${JSON.stringify(e)}`;
}

export const MUTATING = new Set(["POST", "PUT", "DELETE", "PATCH"]);
