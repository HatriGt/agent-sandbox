import * as React from "react";
import { api, type AuditEventRow } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { consolePath } from "@/lib/route";
import { useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PAGE = 25;

/**
 * The raw audit row (method + path) turned into a human verb. Kept as a small pure mapper so the
 * server stays honest — it serves facts, the console narrates. `session` slots into the sentence
 * where it reads naturally; unknown paths fall back to "METHOD /path" verbatim.
 */
export function describeEvent(e: Pick<AuditEventRow, "method" | "path" | "session" | "action">): { verb: string; session: string | null } {
  const p = e.path.replace(/\/+$/, "");
  const s = e.session;
  // [verb, whether it reads as "<verb> <session>"]
  const table: Record<string, [string, boolean]> = {
    "POST /delegate.json": ["Started a machine", false],
    "POST /teardown.json": ["Destroyed", true],
    "POST /resume.json": ["Sent a message to", true],
    "POST /ask.json": ["Asked the co-pilot about", true],
    "POST /wake.json": ["Woke", true],
    "POST /sleep.json": ["Put to sleep:", true],
    "POST /keep.json": ["Pinned or released", true],
    "POST /rename.json": ["Renamed", true],
    "POST /revert.json": ["Reverted", true],
    "POST /memory.json": ["Resized memory of", true],
    "POST /disk.json": ["Grew the disk of", true],
    "PUT /file.json": ["Wrote a file in", true],
    "POST /pr/merge.json": ["Merged a PR", false],
    "POST /pr/approve.json": ["Approved a PR", false],
    "POST /pr/comment.json": ["Commented on a PR", false],
    "POST /pr/review.json": ["Reviewed a PR", false],
    "POST /pr/state.json": ["Changed a PR's state", false],
    "POST /repos/attach.json": ["Attached a repository to", true],
    "POST /api-keys.json": ["Created an API key", false],
    "DELETE /api-keys.json": ["Revoked an API key", false],
    "DELETE /sessions.json": ["Signed out a device", false],
    "POST /account.json": ["Updated the profile", false],
    "POST /notify.json": ["Changed notification settings", false],
    "POST /accounts.json": ["Connected a GitHub account", false],
    "DELETE /accounts.json": ["Disconnected a GitHub account", false],
    "POST /skills.json": ["Changed a skill", false],
    "POST /mcp-servers.json": ["Changed MCP servers", false],
    "POST /auth/logout": ["Signed out", false],
    "POST /auth/login": ["Signed in", false],
  };
  const key = `${e.method} ${p}`;
  if (key === "POST /git.json") return { verb: e.action ? `Git ${e.action} on` : "Git action on", session: s };
  const hit = table[key];
  if (!hit) return { verb: `${e.method} ${p}`, session: null };
  return { verb: hit[0], session: hit[1] ? s : null };
}

/** Recent stored audit events for this account — quiet meta-density rows under Sessions. */
export function AuditLog() {
  const [rows, setRows] = React.useState<AuditEventRow[] | null>(null);
  const [done, setDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const { search } = useLocation();

  const load = React.useCallback(async (before?: string) => {
    setBusy(true);
    try {
      const r = await api.audit({ limit: PAGE, before });
      setRows((prev) => [...(before ? (prev ?? []) : []), ...r.events]);
      if (r.events.length < PAGE) setDone(true);
    } catch {
      setRows((prev) => prev ?? []);
      setDone(true);
    } finally {
      setBusy(false);
    }
  }, []);
  React.useEffect(() => void load(), [load]);

  return (
    <section aria-labelledby="audit-h">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="audit-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
          Recent activity
        </h2>
        <span className="text-muted-foreground text-meta">state-changing actions · kept 90 days</span>
      </div>
      <ul className="divide-y rounded-xl border">
        {rows === null && <li className="text-muted-foreground px-3.5 py-3 text-meta">Loading…</li>}
        {(rows ?? []).map((e, i) => {
          const d = describeEvent(e);
          const at = Date.parse(e.at);
          return (
            <li key={`${e.at}-${i}`} className="flex items-baseline gap-3 px-3.5 py-2">
              <span className="stamp text-faint shrink-0">{Number.isFinite(at) ? fmtAgo(at / 1000) : e.at}</span>
              <span className={cn("text-meta min-w-0 truncate", e.status >= 400 ? "text-muted-foreground" : "text-foreground")}>
                {d.verb}
                {d.session && (
                  <>
                    {" "}
                    <a href={`${consolePath({ view: "box", name: d.session })}${search}`} className="underline decoration-line-strong underline-offset-4 hover:decoration-current">
                      {d.session}
                    </a>
                  </>
                )}
                {e.status >= 400 && <span className="text-destructive"> · failed {e.status}</span>}
              </span>
            </li>
          );
        })}
        {rows !== null && rows.length === 0 && (
          <li className="text-muted-foreground px-3.5 py-3 text-meta">Nothing yet — actions you take (starting, answering, destroying) appear here.</li>
        )}
      </ul>
      {rows !== null && rows.length > 0 && !done && (
        <Button size="sm" variant="ghost" className="text-muted-foreground mt-2" disabled={busy} onClick={() => load(rows[rows.length - 1].at)}>
          Show more
        </Button>
      )}
    </section>
  );
}
