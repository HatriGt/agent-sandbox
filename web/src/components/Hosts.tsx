import * as React from "react";
import { Activity, Moon, Pencil, Plus, Server, Sun, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type HostSpecInput, type HostView, type HealthResponse } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Collapse } from "@/components/ui/collapse";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable, StatusDot, stopRow, type Column } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

/**
 * The box hosts: every machine a run may land on. One line per host in the fleet's grammar — the
 * host's state as a dot and a word (awake, asleep, unreachable, paused, off), its machines against
 * its slots, how much of this month's allowance a metered account has left, and where it stands in
 * the order runs are handed out. Admins only; a host is the operator's infrastructure, so a member
 * never sees this section (the server answers 403 and the panel stays away).
 *
 * The primary host comes from .env: its connection is shown, not edited, and it cannot be removed.
 * Any other host is a form: an SSH target and, for a Freestyle VM, the VM id and an API key that
 * lets the controller pause it the moment it falls asleep and start it the moment a run needs it.
 */
export function HostsPanel({ onChanged }: { onChanged?: () => void }) {
  // Admin-only: the server answers /hosts.json with 403 for anyone else (and /health.json says
  // admin: false), so the gate is the response, not a client-side identity that token mode never sets.
  const health = useCached<HealthResponse>("health", (signal) => api.health(signal));
  const admin = health.data?.admin !== false;
  const { data, refresh } = useCached<{ hosts: HostView[]; capacity: number }>("hosts", (signal) => (admin ? api.hosts(signal) : Promise.reject(new Error("not an admin"))));
  React.useEffect(() => {
    if (!admin) return;
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [admin, refresh]);
  const [editing, setEditing] = React.useState<HostView | "new" | null>(null);
  const [busy, setBusy] = React.useState<Record<string, string>>({});
  if (!admin || !data) return null;
  const hosts = data.hosts;

  const act = async (host: HostView, action: "check" | "wake" | "pause" | "remove") => {
    setBusy((b) => ({ ...b, [host.id]: action }));
    try {
      const r = await api.hostAction({ action, id: host.id });
      if (action === "check") {
        if (r.check?.ok) toast.success(`${host.name} answers`, { description: `${r.check.detail} · ${(r.check.ms / 1000).toFixed(1)} s` });
        else toast.error(`${host.name} did not answer`, { description: r.check?.detail });
      } else if (action === "remove") toast.success(`${host.name} removed`);
      else toast.success(`${host.name}: ${r.providerState?.state ?? "done"}`, { description: r.providerState?.detail });
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(`Could not ${action} ${host.name}`, { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy((b) => {
        const { [host.id]: _, ...rest } = b;
        return rest;
      });
    }
  };

  const columns: Column<HostView>[] = [
    { id: "host", header: "Host", primary: true, cell: (h) => <HostCell host={h} /> },
    { id: "state", header: "State", width: "w-[9rem]", cell: (h) => stateDot(h) },
    { id: "machines", header: "Machines", width: "w-[7rem]", align: "end", sort: (h) => h.running, cell: (h) => <MachinesCell host={h} /> },
    { id: "allowance", header: "This month", width: "w-[11rem]", hideBelow: "md", cell: (h) => <AllowanceCell host={h} /> },
    { id: "order", header: "Order", width: "w-[5rem]", align: "end", hideBelow: "sm", sort: (h) => h.priority, cell: (h) => <span className="stamp text-muted-foreground">{h.priority}</span> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "w-[9.5rem]",
      align: "end",
      cell: (h) => <HostActions host={h} busy={busy[h.id]} onAct={(a) => void act(h, a)} onEdit={() => setEditing(h)} />,
    },
  ];
  return (
    <section className="mt-9" aria-labelledby="hosts">
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="hosts" className="text-foreground flex items-center gap-1.5 text-meta font-semibold">
            <Server className="size-3.5" aria-hidden />
            Box hosts
          </h2>
          <p className="text-muted-foreground mt-0.5 text-micro">
            Where machines boot. A run goes to the lowest order number with a free slot; equal hosts share by what is warm, awake and least used this month.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus />
          Add host
        </Button>
      </div>
      <DataTable aria-label="Box hosts" rows={hosts} columns={columns} rowKey={(h) => h.id} initialSort={{ id: "order", dir: "asc" }} minWidth="min-w-[40rem]" />
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null && (
          <HostDialog
            host={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              await refresh();
              onChanged?.();
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

const stateDot = (h: HostView) => {
  if (!h.enabled) return <StatusDot tone="muted">off</StatusDot>;
  if (h.unreachable)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <StatusDot tone="destructive">unreachable</StatusDot>
          </span>
        </TooltipTrigger>
        <TooltipContent>{h.lastError ?? "The last sweep failed"}</TooltipContent>
      </Tooltip>
    );
  if (h.asleep) return <StatusDot tone="sleep">asleep{h.sleepSince ? ` · ${fmtAgo(Math.floor(h.sleepSince / 1000))}` : ""}</StatusDot>;
  if (h.providerState?.state === "paused") return <StatusDot tone="sleep">paused</StatusDot>;
  if (h.providerState?.state === "starting") return <StatusDot tone="live" pulse>starting</StatusDot>;
  if (h.running > 0) return <StatusDot tone="live" pulse>working</StatusDot>;
  return <StatusDot tone="ok">awake</StatusDot>;
};

function HostCell({ host: h }: { host: HostView }) {
  return (
    <div className="min-w-0">
      <p className="text-foreground truncate text-meta">
        {h.name}
        {h.primary && <span className="text-faint ml-1.5 text-micro">· from .env</span>}
      </p>
      {/* Only the SSH target gives way when the column is narrow; the words around it stay whole. */}
      <span className="text-muted-foreground stamp mt-0.5 flex min-w-0 items-center gap-2 text-micro">
        <span className="shrink-0">{h.provider === "freestyle" ? "Freestyle VM" : "your machine"}</span>
        <span className="bg-border h-2.5 w-px shrink-0" aria-hidden />
        <span className="min-w-0 truncate" title={h.ssh}>
          {h.ssh}
        </span>
        <span className="bg-border h-2.5 w-px shrink-0" aria-hidden />
        <span className="shrink-0">{h.sleepAfterMs > 0 ? `sleeps after ${Math.round(h.sleepAfterMs / 60_000)}m` : "never sleeps"}</span>
        {h.warm && (
          <>
            <span className="bg-border h-2.5 w-px shrink-0" aria-hidden />
            <span className="shrink-0">keeps a warm box</span>
          </>
        )}
      </span>
      {h.check && !h.check.ok && <p className="text-destructive mt-0.5 truncate text-micro">{h.check.detail}</p>}
    </div>
  );
}

function MachinesCell({ host: h }: { host: HostView }) {
  const used = h.running + h.reserved;
  return (
    <span className="stamp text-muted-foreground inline-flex items-center gap-2" title={h.reserved ? `${h.running} running, ${h.reserved} starting` : undefined}>
      <span className={cn(used >= h.maxBoxes && "text-foreground")}>
        {used}/{h.maxBoxes}
      </span>
      <span className="bg-border block h-1 w-10 overflow-hidden rounded-full" aria-hidden>
        <span className={cn("block h-full origin-left rounded-full", used >= h.maxBoxes ? "bg-foreground/70" : "bg-live")} style={{ transform: `scaleX(${Math.min(1, used / Math.max(1, h.maxBoxes))})` }} />
      </span>
    </span>
  );
}

function AllowanceCell({ host: h }: { host: HostView }) {
  const a = h.allowance;
  if (!a) return <span className="stamp text-faint">unmetered</span>;
  const nearly = a.pct >= 85;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex flex-col gap-1">
          <span className={cn("stamp text-micro", nearly ? "text-warn-text" : "text-muted-foreground")}>
            {Math.round(a.leftHours)} of {a.vcpuHours} vCPU-h left
          </span>
          <span className="bg-border block h-1 w-24 max-w-full overflow-hidden rounded-full" aria-hidden>
            <span className={cn("block h-full origin-left rounded-full", nearly ? "bg-warn" : "bg-ok")} style={{ transform: `scaleX(${Math.min(1, a.pct / 100)})` }} />
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {a.usedHours.toFixed(1)} vCPU-hours used in {a.month} on {a.vcpu} vCPU · resets on day {a.resetDay}
      </TooltipContent>
    </Tooltip>
  );
}

function HostActions({ host: h, busy, onAct, onEdit }: { host: HostView; busy?: string; onAct: (a: "check" | "wake" | "pause" | "remove") => void; onEdit: () => void }) {
  const metered = h.provider !== "static" && h.freestyle?.hasApiKey;
  return (
    <div className="flex items-center justify-end gap-0.5" onClick={stopRow} onKeyDown={stopRow}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`Check ${h.name}`} loading={busy === "check"} onClick={() => onAct("check")} className="text-muted-foreground">
            <Activity />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Check: SSH in, count the machines, read the disk</TooltipContent>
      </Tooltip>
      {metered && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={h.asleep || h.providerState?.state === "paused" ? `Wake ${h.name}` : `Pause ${h.name}`}
              loading={busy === "wake" || busy === "pause"}
              onClick={() => onAct(h.asleep || h.providerState?.state === "paused" ? "wake" : "pause")}
              className="text-muted-foreground"
            >
              {h.asleep || h.providerState?.state === "paused" ? <Sun /> : <Moon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{h.asleep || h.providerState?.state === "paused" ? "Start the VM now" : "Pause the VM now (refused while an agent works)"}</TooltipContent>
        </Tooltip>
      )}
      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${h.name}`} onClick={onEdit} className="text-muted-foreground">
        <Pencil />
      </Button>
      {!h.primary && (
        <ArmButton size="icon-sm" variant="ghost" icon={<Trash2 />} label={`Remove ${h.name}`} armedLabel="Remove?" onConfirm={() => onAct("remove")} disabled={busy === "remove"} className="text-muted-foreground" />
      )}
    </div>
  );
}

type Form = {
  name: string;
  provider: "static" | "freestyle";
  ssh: string;
  sshExtraOpts: string;
  vmId: string;
  apiKey: string;
  priority: string;
  sleepMin: string;
  warm: boolean;
  enabled: boolean;
  maxBoxes: string;
  metered: boolean;
  vcpuHours: string;
  vcpu: string;
  resetDay: string;
  advanced: boolean;
  msb: string;
  msbHome: string;
  stagingDir: string;
  snapshot: string;
  claudeImage: string;
};

const formOf = (h: HostView | null): Form => ({
  name: h?.name ?? "",
  provider: (h?.provider as Form["provider"]) ?? "freestyle",
  ssh: h && !h.primary ? h.ssh : "",
  sshExtraOpts: "",
  vmId: h?.freestyle?.vmId ?? "",
  apiKey: "",
  priority: String(h?.priority ?? 10),
  sleepMin: String(Math.round((h?.sleepAfterMs ?? 5 * 60_000) / 60_000)),
  warm: h?.warm ?? false,
  enabled: h?.enabled ?? true,
  maxBoxes: h?.maxBoxes ? String(h.maxBoxes) : "",
  metered: !!h?.allowance,
  vcpuHours: String(h?.allowance?.vcpuHours ?? 200),
  vcpu: String(h?.allowance?.vcpu ?? 4),
  resetDay: String(h?.allowance?.resetDay ?? 1),
  advanced: false,
  msb: h?.msb ?? "",
  msbHome: h?.msbHome ?? "",
  stagingDir: h?.stagingDir ?? "",
  snapshot: h?.snapshot ?? "",
  claudeImage: h?.claudeImage ?? "",
});

function HostDialog({ host, onClose, onSaved }: { host: HostView | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = React.useState<Form>(() => formOf(host));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const primary = !!host?.primary;
  const freestyle = f.provider === "freestyle";
  const can = !!f.name.trim() && (primary || (!!f.ssh.trim() && (!freestyle || !!f.vmId.trim())));
  const submit = async () => {
    if (!can || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const spec: HostSpecInput = {
        name: f.name.trim(),
        priority: Number(f.priority) || 0,
        sleepAfterMs: Math.max(0, Number(f.sleepMin) || 0) * 60_000,
        warm: f.warm,
        enabled: f.enabled,
        allowance: f.metered ? { vcpuHours: Number(f.vcpuHours) || 0, vcpu: Number(f.vcpu) || 1, resetDay: Number(f.resetDay) || 1 } : null,
      };
      if (!primary) {
        spec.provider = f.provider;
        spec.ssh = f.ssh.trim();
        if (f.sshExtraOpts.trim()) spec.sshExtraOpts = f.sshExtraOpts.trim();
        spec.maxBoxes = f.maxBoxes.trim() ? Number(f.maxBoxes) : null;
        spec.freestyle = freestyle ? { vmId: f.vmId.trim(), apiKey: f.apiKey.trim() } : null;
        if (f.advanced || host) {
          spec.msb = f.msb.trim();
          spec.msbHome = f.msbHome.trim();
          spec.stagingDir = f.stagingDir.trim();
          spec.snapshot = f.snapshot.trim();
          spec.claudeImage = f.claudeImage.trim();
        } else if (freestyle) {
          // A fresh VM has no snapshot of the primary's: boot from the image, or cold.
          spec.snapshot = "";
        }
      }
      const r = await api.hostAction({ action: "upsert", ...(host ? { id: host.id } : {}), spec });
      if (r.check && !r.check.ok) toast.warning(`${spec.name} ${host ? "updated" : "added"}, but it does not answer: ${r.check.detail}`, { duration: 12_000 });
      else toast.success(`${spec.name} ${host ? "updated" : "added"}${r.check ? ` · ${r.check.detail}` : ""}`);
      await onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <DialogContent
      title={host ? `Edit ${host.name}` : "Add a box host"}
      description={primary ? "The primary host's connection comes from .env; the rest is yours to tune." : "A machine with microsandbox installed that the controller can reach over SSH. Runs are handed out by order number; equal hosts share."}
      className="w-[min(36rem,calc(100vw-2rem))]"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">{(w) => <Input {...w} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Freestyle account A" autoFocus />}</Field>
        {!primary && (
          <>
            <Field label="Provider" hint={freestyle ? "A Freestyle VM pauses itself when idle and bills only while awake; the API key lets the controller pause and start it." : "A machine of your own: a VPS, a home server. Nothing is paused."}>
              <Segmented
                ariaLabel="Provider"
                value={f.provider}
                onChange={(v) => set("provider", v)}
                options={[
                  { value: "freestyle", label: "Freestyle VM" },
                  { value: "static", label: "My own machine" },
                ]}
              />
            </Field>
            <Field label="SSH target" hint={freestyle ? "name+root:TOKEN@beta-ssh.freestyle.sh — the identity token from the runbook" : "user@host, reachable with the controller's key"}>
              {(w) => <Input {...w} mono value={f.ssh} onChange={(e) => set("ssh", e.target.value)} placeholder={freestyle ? "asb-host+root:…@beta-ssh.freestyle.sh" : "root@203.0.113.7"} spellCheck={false} />}
            </Field>
            {freestyle && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="VM id">{(w) => <Input {...w} mono value={f.vmId} onChange={(e) => set("vmId", e.target.value)} placeholder="vm-…" spellCheck={false} />}</Field>
                <Field label="API key" optional hint={host?.freestyle?.hasApiKey ? "Stored; leave blank to keep it" : "Lets the controller pause and start the VM"}>
                  {(w) => <Input {...w} mono type="password" value={f.apiKey} onChange={(e) => set("apiKey", e.target.value)} autoComplete="off" />}
                </Field>
              </div>
            )}
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Order" hint="Lower runs first">{(w) => <Input {...w} mono type="number" value={f.priority} onChange={(e) => set("priority", e.target.value)} />}</Field>
          <Field label="Sleep after" hint="Minutes quiet; 0 never">{(w) => <Input {...w} mono type="number" min={0} value={f.sleepMin} onChange={(e) => set("sleepMin", e.target.value)} />}</Field>
          {!primary && <Field label="Slots" hint="Machines at once" optional>{(w) => <Input {...w} mono type="number" min={1} value={f.maxBoxes} onChange={(e) => set("maxBoxes", e.target.value)} placeholder="same as primary" />}</Field>}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-meta">
            <Switch checked={f.warm} onCheckedChange={(v) => set("warm", v)} size="sm" aria-label="Keep a warm box" />
            Keep a warm box ready
          </label>
          <label className="flex items-center gap-2 text-meta">
            <Switch checked={f.enabled} onCheckedChange={(v) => set("enabled", v)} size="sm" aria-label="Enabled" />
            Takes new runs
          </label>
          <label className="flex items-center gap-2 text-meta">
            <Switch checked={f.metered} onCheckedChange={(v) => set("metered", v)} size="sm" aria-label="Metered" />
            Monthly allowance
          </label>
        </div>
        <Collapse open={f.metered}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="vCPU-hours a month" hint="Freestyle Free: 200; with a card: 400">{(w) => <Input {...w} mono type="number" min={1} value={f.vcpuHours} onChange={(e) => set("vcpuHours", e.target.value)} />}</Field>
            <Field label="vCPUs billed" hint="Per awake hour">{(w) => <Input {...w} mono type="number" min={1} value={f.vcpu} onChange={(e) => set("vcpu", e.target.value)} />}</Field>
            <Field label="Resets on day">{(w) => <Input {...w} mono type="number" min={1} max={28} value={f.resetDay} onChange={(e) => set("resetDay", e.target.value)} />}</Field>
          </div>
        </Collapse>
        {!primary && (
          <>
            <button type="button" className="text-muted-foreground hover:text-foreground self-start text-micro underline-offset-2 hover:underline" onClick={() => set("advanced", !f.advanced)}>
              {f.advanced ? "Hide paths and boot sources" : "Paths and boot sources…"}
            </button>
            <Collapse open={f.advanced}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="msb binary" optional>{(w) => <Input {...w} mono value={f.msb} onChange={(e) => set("msb", e.target.value)} placeholder="same as primary" />}</Field>
                <Field label="microsandbox home" optional>{(w) => <Input {...w} mono value={f.msbHome} onChange={(e) => set("msbHome", e.target.value)} placeholder="same as primary" />}</Field>
                <Field label="Staging dir" optional>{(w) => <Input {...w} mono value={f.stagingDir} onChange={(e) => set("stagingDir", e.target.value)} placeholder="same as primary" />}</Field>
                <Field label="Claude snapshot" optional hint="Blank: none on this host">{(w) => <Input {...w} mono value={f.snapshot} onChange={(e) => set("snapshot", e.target.value)} />}</Field>
                <Field label="Claude image" optional hint="Blank: the primary's">{(w) => <Input {...w} mono value={f.claudeImage} onChange={(e) => set("claudeImage", e.target.value)} />}</Field>
              </div>
            </Collapse>
          </>
        )}
        <Collapse open={!!err}>
          <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-meta" role="alert">
            {err}
          </p>
        </Collapse>
      </div>
      <DialogFooter>
        <Button type="button" size="sm" variant="ghost" onClick={onClose} className="ml-auto">
          Cancel
        </Button>
        <Button size="sm" loading={busy} disabled={!can} onClick={() => void submit()}>
          {host ? "Save" : "Add host"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
