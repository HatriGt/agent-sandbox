import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Laptop, LogOut, MonitorSmartphone, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api, type SessionRow } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { ArmButton } from "@/components/ui/arm-button";
import { StaggerItem, Swap } from "@/components/ui/swap";
import { ListEmpty, ListSkeleton } from "@/components/ui/list-state";
import { Panel, SettingsSection } from "@/components/ui/settings";
import { cn } from "@/lib/utils";

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
      // Drop the row locally so it animates out; the reload behind confirms the server agrees.
      setRows((prev) => prev?.filter((x) => x.id !== s.id) ?? prev);
      toast.success("Device signed out");
      void load();
    } catch (e) {
      toast.error("Could not sign that device out", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const revokeOthers = async () => {
    try {
      const r = await api.revokeOtherSessions();
      setRows((prev) => prev?.filter((s) => s.current) ?? prev);
      toast.success(`Signed out ${r.revoked} ${r.revoked === 1 ? "device" : "devices"}`);
      void load();
    } catch (e) {
      toast.error("Could not sign the other devices out", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  // This device first, then most recently active.
  const sorted = React.useMemo(() => (rows ?? []).slice().sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.lastSeenAt ?? "") - Date.parse(a.lastSeenAt ?? "")), [rows]);
  const others = sorted.filter((s) => !s.current);
  const state = rows === null ? "loading" : rows.length === 0 ? "empty" : "list";
  return (
    <SettingsSection
      id="sess"
      title="Signed-in devices"
      meta={rows ? `${rows.length} · 30-day cap` : "30-day cap"}
      purpose="Browser sessions holding your account. Sign one out if you do not recognise it; your password stays."
      actions={
        <AnimatePresence initial={false}>
          {others.length > 0 && (
            <motion.div key="others" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <ArmButton size="sm" variant="ghost" icon={<LogOut />} label="Sign out everywhere else" armedLabel={`Sign out ${others.length} ${others.length === 1 ? "device" : "devices"}?`} onConfirm={revokeOthers} className="text-muted-foreground" />
            </motion.div>
          )}
        </AnimatePresence>
      }
    >
      <Panel>
        <Swap state={state}>
          {state === "loading" ? (
            <ListSkeleton rows={2} />
          ) : state === "empty" ? (
            <ListEmpty icon={MonitorSmartphone} title="No browser sessions" line="You are signed in with an access token, so there is nothing to sign out here." />
          ) : (
            <ul className="divide-y">
              <AnimatePresence initial={false}>
                {sorted.map((s, i) => {
                  const d = describe(s.userAgent);
                  const seen = s.lastSeenAt && Number.isFinite(Date.parse(s.lastSeenAt)) ? fmtAgo(Date.parse(s.lastSeenAt) / 1000) : null;
                  return (
                    <motion.li key={s.id} layout exit={{ opacity: 0, height: 0, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }} className="overflow-hidden">
                      <StaggerItem index={i} className={cn("group flex items-center gap-3 px-3.5 py-2.5", s.current && "bg-live/[0.04]")}>
                        <span className={cn("relative grid size-8 shrink-0 place-items-center rounded-full", s.current ? "bg-live/10 text-live" : "bg-muted text-muted-foreground")} aria-hidden>
                          {d.mobile ? <Smartphone className="size-3.5" /> : <Laptop className="size-3.5" />}
                          {s.current && <span className="bg-live ring-card absolute -right-px -bottom-px size-2 rounded-full ring-2" />}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-foreground flex min-w-0 items-center gap-1.5 text-meta font-medium">
                            <span className="truncate">{d.label}</span>
                            {s.current && <span className="bg-live/10 text-live rounded-full px-1.5 py-px text-micro font-medium">this device</span>}
                          </span>
                          <span className="text-faint truncate text-micro tabular-nums">
                            {[s.ip, seen ? `active ${seen}` : null].filter(Boolean).join(" · ") || "no activity yet"}
                          </span>
                        </span>
                        {!s.current && (
                          <ArmButton
                            size="sm"
                            variant="ghost"
                            icon={<LogOut className="size-3.5" />}
                            label="Sign out"
                            armedLabel="Sign out?"
                            onConfirm={() => revoke(s)}
                            className="text-muted-foreground hover:text-destructive sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 sm:data-[armed]:opacity-100"
                          />
                        )}
                      </StaggerItem>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </Swap>
      </Panel>
    </SettingsSection>
  );
}
