import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Laptop, LogOut, MonitorSmartphone, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api, type SessionRow } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { ArmButton } from "@/components/ui/arm-button";
import { Swap } from "@/components/ui/swap";
import { ListEmpty, ListSkeleton } from "@/components/ui/list-state";
import { Panel, SettingsSection } from "@/components/ui/settings";
import { DataTable, StatusDot, type Column } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

const time = (s: string | null) => (s && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null);

const COLUMNS: Column<SessionRow>[] = [
  {
    id: "device",
    header: "Device",
    primary: true,
    sort: (s) => describe(s.userAgent).label,
    cell: (s) => {
      const d = describe(s.userAgent);
      return (
        <span className="flex min-w-0 items-center gap-2.5">
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", s.current ? "bg-live/10 text-live" : "bg-muted text-muted-foreground")} aria-hidden>
            {d.mobile ? <Smartphone className="size-3.5" /> : <Laptop className="size-3.5" />}
          </span>
          <span className="truncate">{d.label}</span>
        </span>
      );
    },
  },
  { id: "state", header: "Status", width: "w-32", sort: (s) => Number(s.current), cell: (s) => (s.current ? <StatusDot tone="live">This device</StatusDot> : <StatusDot tone="muted">Signed in</StatusDot>) },
  { id: "ip", header: "IP", width: "w-36", hideBelow: "md", sort: (s) => s.ip, cell: (s) => <span className="stamp text-muted-foreground truncate">{s.ip ?? "—"}</span> },
  {
    id: "seen",
    header: "Last active",
    width: "w-28",
    hideBelow: "sm",
    sort: (s) => time(s.lastSeenAt),
    cell: (s) => <span className="text-muted-foreground text-micro tabular-nums">{time(s.lastSeenAt) ? fmtAgo(time(s.lastSeenAt)! / 1000) : "no activity"}</span>,
  },
];

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
            <DataTable
              aria-label="Signed-in devices"
              bordered={false}
              rows={sorted}
              columns={COLUMNS}
              rowKey={(s) => s.id}
              rowProps={(s) => ({ className: s.current ? "bg-live/[0.04]" : undefined })}
              search={sorted.length > 8 ? { placeholder: "Search devices", text: (s) => `${describe(s.userAgent).label} ${s.ip ?? ""}` } : undefined}
              actions={(s) =>
                s.current ? null : <ArmButton size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} label="Sign out" armedLabel="Sign out?" onConfirm={() => revoke(s)} className="text-muted-foreground hover:text-destructive" />
              }
            />
          )}
        </Swap>
      </Panel>
    </SettingsSection>
  );
}
