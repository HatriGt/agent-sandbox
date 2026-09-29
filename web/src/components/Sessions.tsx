import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Laptop, LogOut, MonitorSmartphone, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api, type SessionRow } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { StaggerItem, Swap } from "@/components/ui/swap";
import { ListEmpty, ListSkeleton } from "@/components/ApiKeys";

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
  const [leaving, setLeaving] = React.useState<string | null>(null);
  const load = React.useCallback(() => api.sessions().then((r) => setRows(r.sessions)).catch(() => setRows([])), []);
  React.useEffect(() => void load(), [load]);
  const revoke = async (s: SessionRow) => {
    setLeaving(s.id);
    try {
      await api.revokeSession(s.id);
      // Drop the row locally so it animates out; the reload behind confirms the server agrees.
      setRows((prev) => prev?.filter((x) => x.id !== s.id) ?? prev);
      void load();
    } catch (e) {
      toast.error("Could not sign that device out", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLeaving(null);
    }
  };
  const revokeOthers = async () => {
    try {
      await api.revokeOtherSessions();
      setRows((prev) => prev?.filter((x) => x.current) ?? prev);
      void load();
    } catch (e) {
      toast.error("Could not sign the other devices out", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const others = (rows ?? []).filter((s) => !s.current);
  const state = rows === null ? "loading" : rows.length === 0 ? "empty" : "list";
  return (
    <section aria-labelledby="sess-h">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="sess-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
            Signed-in devices
          </h2>
          <span className="text-muted-foreground text-meta">browser sessions · 30-day cap</span>
        </div>
        <AnimatePresence initial={false}>
          {others.length > 0 && (
            <motion.div key="others" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <ArmButton size="sm" variant="ghost" icon={<LogOut />} label="Sign out everywhere else" armedLabel={`Sign out ${others.length} ${others.length === 1 ? "device" : "devices"}?`} onConfirm={revokeOthers} className="text-muted-foreground" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="rounded-xl border">
        <Swap state={state}>
          {state === "loading" ? (
            <ListSkeleton rows={2} />
          ) : state === "empty" ? (
            <ListEmpty icon={MonitorSmartphone} title="No browser sessions" line="You are signed in with an access token, so there is nothing to sign out here." />
          ) : (
            <ul className="divide-y">
              <AnimatePresence initial={false}>
                {(rows ?? []).map((s, i) => {
                  const d = describe(s.userAgent);
                  return (
                    <motion.li key={s.id} layout exit={{ opacity: 0, height: 0, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }} className="overflow-hidden">
                      <StaggerItem index={i} className="flex items-center gap-3 px-3.5 py-2.5">
                        {d.mobile ? <Smartphone className="text-muted-foreground size-4 shrink-0" aria-hidden /> : <Laptop className="text-muted-foreground size-4 shrink-0" aria-hidden />}
                        <span className="text-foreground min-w-0 flex-1 truncate text-meta">
                          {d.label}
                          {s.current && <span className="text-live ml-1.5 text-micro font-medium">this device</span>}
                        </span>
                        <span className="text-faint hidden shrink-0 text-micro sm:inline">
                          {s.ip ?? ""}
                          {s.lastSeenAt && Number.isFinite(Date.parse(s.lastSeenAt)) ? ` · active ${fmtAgo(Date.parse(s.lastSeenAt) / 1000)}` : ""}
                        </span>
                        {!s.current && (
                          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" loading={leaving === s.id} onClick={() => void revoke(s)}>
                            <LogOut className="size-3.5" />
                            Sign out
                          </Button>
                        )}
                      </StaggerItem>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </Swap>
      </div>
    </section>
  );
}
