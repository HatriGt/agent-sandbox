import * as React from "react";
import { Laptop, LogOut, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api, type SessionRow } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";

function describe(ua: string | null): { label: string; mobile: boolean } {
  const s = ua ?? "";
  const mobile = /Mobile|iPhone|Android/i.test(s);
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : /Firefox\//.test(s) ? "Firefox" : "Browser";
  const os = /iPhone|iPad/.test(s) ? "iOS" : /Android/.test(s) ? "Android" : /Mac OS X/.test(s) ? "macOS" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : "";
  return { label: [browser, os].filter(Boolean).join(" · "), mobile };
}

/** Where you are signed in. Revoke a stolen or forgotten session without changing your password. */
export function Sessions() {
  const [rows, setRows] = React.useState<SessionRow[] | null>(null);
  const load = React.useCallback(() => api.sessions().then((r) => setRows(r.sessions)).catch(() => setRows([])), []);
  React.useEffect(() => void load(), [load]);
  const revoke = async (s: SessionRow) => {
    try {
      await api.revokeSession(s.id);
      void load();
    } catch (e) {
      toast.error("Could not sign that device out", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const others = (rows ?? []).filter((s) => !s.current);
  return (
    <section aria-labelledby="sess-h">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="sess-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
            Signed-in devices
          </h2>
          <span className="text-muted-foreground text-meta">browser sessions · 30-day cap</span>
        </div>
        {others.length > 0 && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => api.revokeOtherSessions().then(() => load())}>
            <LogOut />
            Sign out everywhere else
          </Button>
        )}
      </div>
      <ul className="divide-y rounded-xl border">
        {rows === null && <li className="text-muted-foreground px-3.5 py-3 text-meta">Loading…</li>}
        {(rows ?? []).map((s) => {
          const d = describe(s.userAgent);
          return (
            <li key={s.id} className="flex items-center gap-3 px-3.5 py-2.5">
              {d.mobile ? <Smartphone className="text-muted-foreground size-4 shrink-0" aria-hidden /> : <Laptop className="text-muted-foreground size-4 shrink-0" aria-hidden />}
              <span className="text-foreground min-w-0 flex-1 truncate text-meta">
                {d.label}
                {s.current && <span className="text-live ml-1.5 text-micro font-medium">this device</span>}
              </span>
              <span className="text-faint hidden shrink-0 text-micro sm:inline">
                {s.ip ?? ""}
                {s.lastSeenAt ? ` · active ${fmtAgo(Date.parse(s.lastSeenAt) / 1000)}` : ""}
              </span>
              {!s.current && (
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => revoke(s)}>
                  Sign out
                </Button>
              )}
            </li>
          );
        })}
        {rows !== null && rows.length === 0 && <li className="text-muted-foreground px-3.5 py-3 text-meta">Signed in with an access token — no browser sessions.</li>}
      </ul>
    </section>
  );
}
