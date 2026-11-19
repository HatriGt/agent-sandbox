import * as React from "react";
import { Activity, Camera, Loader2, Moon, Pencil, Plus, Server, Sun, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { api, type HostPrepare, type HostProviderInfo, type HostSpecInput, type HostView, type HealthResponse } from "@/lib/api";
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
import { NumberTicker } from "@/components/ui/number-ticker";
import { ProgressRing } from "@/components/ui/progress-ring";
import { useNow } from "@/hooks/useNow";
import { cn } from "@/lib/utils";

/**
 * The box hosts: every machine a run may land on. One line per host in the fleet's grammar — the
 * host's state as a dot and a word (awake, asleep, unreachable, paused, off), its machines against
 * its slots, how much of this month's allowance a metered account has left, and where it stands in
 * the order runs are handed out. Admins only; a host is the operator's infrastructure, so a member
 * never sees this section (the server answers 403 and the panel stays away).
 *
 * The primary host comes from .env: its connection is shown, not edited, and it cannot be removed.
 * Any other host is a form: an SSH target and, for a cloud VM, the VM id and an API key that lets
 * the controller pause it the moment it falls asleep and start it the moment a run needs it. The
 * providers on offer come from the server (`providers` on /hosts.json), so a new adapter shows up
 * here without a dashboard change; one that can build a machine from a key alone gets the second
 * mode of the add dialog, "from an API key".
 */

/** The server's list, or the two every controller has had, for a dashboard ahead of its controller. */
const FALLBACK_PROVIDERS: HostProviderInfo[] = [
  { id: "freestyle", label: "Freestyle VM", hint: "A Freestyle VM pauses itself when idle and bills only while awake; the API key lets the controller pause and start it.", needs: ["vmId"], secrets: ["apiKey"], sshHint: "name+root:TOKEN@beta-ssh.freestyle.sh — the identity token from the runbook", sshPlaceholder: "asb-host+root:…@beta-ssh.freestyle.sh", canProvision: false, canSnapshot: false, metered: true },
  { id: "static", label: "My own machine", hint: "A machine of your own: a VPS, a home server. Nothing is paused.", needs: [], secrets: [], sshHint: "user@host, reachable with the controller's key", sshPlaceholder: "root@203.0.113.7", canProvision: false, canSnapshot: false, metered: false },
];
export function HostsPanel({ onChanged }: { onChanged?: () => void }) {
  // Admin-only: the server answers /hosts.json with 403 for anyone else (and /health.json says
  // admin: false), so the gate is the response, not a client-side identity that token mode never sets.
  const health = useCached<HealthResponse>("health", (signal) => api.health(signal));
  const admin = health.data?.admin !== false;
  const { data, refresh } = useCached<{ hosts: HostView[]; capacity: number; providers?: HostProviderInfo[] }>("hosts", (signal) => (admin ? api.hosts(signal) : Promise.reject(new Error("not an admin"))));
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
  const providers = data.providers?.length ? data.providers : FALLBACK_PROVIDERS;

  const act = async (host: HostView, action: "check" | "wake" | "pause" | "remove" | "snapshot" | "prepare") => {
    setBusy((b) => ({ ...b, [host.id]: action }));
    try {
      if (action === "snapshot") {
        const s = await api.hostSnapshot(host.id);
        toast.success(`${host.name} snapshotted: ${s.slug ?? s.snapshotId}`, { description: s.hint ?? s.snapshotId, duration: 15_000 });
        return;
      }
      const r = await api.hostAction({ action, id: host.id });
      if (action === "check") {
        if (r.check?.ok) toast.success(`${host.name} answers`, { description: `${r.check.detail} · ${(r.check.ms / 1000).toFixed(1)} s` });
        else toast.error(`${host.name} did not answer`, { description: r.check?.detail });
      } else if (action === "remove") toast.success(`${host.name} removed`);
      else if (action === "prepare") toast.success(`${host.name} is being prepared`, { description: "The msb shim, rsync and the box images from the primary; a few minutes. The row shows each step." });
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
    { id: "host", header: "Host", primary: true, cell: (h) => <HostCell host={h} providers={providers} /> },
    { id: "state", header: "State", width: "w-[10rem]", cell: (h) => <StateCell host={h} /> },
    { id: "machines", header: "Machines", width: "w-[7rem]", align: "end", sort: (h) => h.running, cell: (h) => <MachinesCell host={h} /> },
    { id: "allowance", header: "This month", width: "w-[11rem]", hideBelow: "md", cell: (h) => <AllowanceCell host={h} /> },
    { id: "order", header: "Order", width: "w-[5rem]", align: "end", hideBelow: "sm", sort: (h) => h.priority, cell: (h) => <span className="stamp text-muted-foreground">{h.priority}</span> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "w-[9.5rem]",
      align: "end",
      cell: (h) => <HostActions host={h} provider={providers.find((p) => p.id === h.provider)} busy={busy[h.id]} onAct={(a) => void act(h, a)} onEdit={() => setEditing(h)} />,
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
            Where machines boot. A run goes to the lowest order number with a free slot; equal hosts share by what is warm, awake and least used this month.{" "}
            <a className="text-foreground/70 hover:text-foreground underline underline-offset-2" href="https://github.com/HatriGt/agent-sandbox/blob/main/docs/hosts.md" target="_blank" rel="noreferrer">
              How box hosts work
            </a>
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
            providers={providers}
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

function StateCell({ host: h }: { host: HostView }) {
  // "awake · sleeps in 4m": the clock is the host's own, so it ticks here once a minute.
  const now = useNow(!!h.sleepsAt, 30_000);
  if (!h.enabled)
    return h.draining ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <StatusDot tone="muted">draining · {h.running}</StatusDot>
          </span>
        </TooltipTrigger>
        <TooltipContent>Disabled; no new run lands here. The {h.running} machine(s) still on it are watched until they finish.</TooltipContent>
      </Tooltip>
    ) : (
      <StatusDot tone="muted">off</StatusDot>
    );
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
  // Starting before asleep: a resuming VM counts as dormant to the pool (nothing SSHes it yet), but
  // what the operator wants to see is that it is on its way up.
  if (h.providerState?.state === "starting") return <StatusDot tone="live" pulse>starting</StatusDot>;
  if (h.asleep) return <StatusDot tone="sleep">asleep{h.sleepSince ? ` · ${fmtAgo(Math.floor(h.sleepSince / 1000))}` : ""}</StatusDot>;
  if (h.providerState?.state === "paused") return <StatusDot tone="sleep">paused</StatusDot>;
  if (h.running > 0) return <StatusDot tone="live" pulse>working</StatusDot>;
  const sleepsIn = h.sleepsAt ? Math.max(0, Math.ceil((h.sleepsAt - now) / 60_000)) : 0;
  if (h.sleepsAt && sleepsIn <= 15)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <StatusDot tone="ok">awake · sleeps in {sleepsIn < 1 ? "<1m" : `${sleepsIn}m`}</StatusDot>
          </span>
        </TooltipTrigger>
        <TooltipContent>Nothing is working here; the VM is paused when the sleep-after passes. A new run resets the clock.</TooltipContent>
      </Tooltip>
    );
  return <StatusDot tone="ok">awake</StatusDot>;
}

function HostCell({ host: h, providers }: { host: HostView; providers: HostProviderInfo[] }) {
  return (
    <div className="min-w-0">
      <p className="text-foreground truncate text-meta">
        {h.name}
        {h.primary && <span className="text-faint ml-1.5 text-micro">· from .env</span>}
      </p>
      {/* Only the SSH target gives way when the column is narrow; the words around it stay whole. */}
      <span className="text-muted-foreground stamp mt-0.5 flex min-w-0 items-center gap-2 text-micro">
        <span className="shrink-0">{h.provider === "static" ? "your machine" : (providers.find((p) => p.id === h.provider)?.label ?? h.provider)}</span>
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
      {h.prepare && <PrepareLine prepare={h.prepare} />}
    </div>
  );
}

/** One line under the host while it is being prepared, and the outcome after: the last step, or what failed. */
function PrepareLine({ prepare: p }: { prepare: HostPrepare }) {
  const last = p.steps[p.steps.length - 1];
  if (p.running)
    return (
      <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate text-micro" aria-live="polite">
        <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
        <span className="truncate">preparing{last ? ` · ${last}` : "…"}</span>
      </p>
    );
  if (p.ok === false) return <p className="text-destructive mt-0.5 truncate text-micro">prepare failed: {p.error}</p>;
  return <p className="text-muted-foreground mt-0.5 truncate text-micro">prepared · {p.steps.join(" · ")}</p>;
}

function MachinesCell({ host: h }: { host: HostView }) {
  const used = h.running + h.reserved;
  const full = used >= h.maxBoxes;
  // A ring beside the count: a slot filling springs the arc, a box leaving unwinds it. The number
  // ticks with the same spring so the two never disagree mid-motion.
  return (
    <span className="stamp text-muted-foreground inline-flex items-center gap-2" title={h.reserved ? `${h.running} running, ${h.reserved} starting` : undefined}>
      <ProgressRing value={used / Math.max(1, h.maxBoxes)} tone={used > 0 && !full ? "live" : "foreground"} size={16} />
      <span className={cn(full && "text-foreground")}>
        <NumberTicker value={used} from={used} />/{h.maxBoxes}
      </span>
    </span>
  );
}

function AllowanceCell({ host: h }: { host: HostView }) {
  const a = h.allowance;
  if (!a) return <span className="stamp text-faint">unmetered</span>;
  const nearly = a.pct >= 85;
  const left = Math.round(a.leftHours);
  // The ring is what is used (it fills as the month is spent, warn past 85 %); the words say what
  // is left, which is the number an operator acts on.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-2">
          <ProgressRing value={a.pct / 100} tone={nearly ? "warn" : "ok"} size={16} label={`${a.pct}% of this month's allowance used`} />
          <span className={cn("stamp text-micro", nearly ? "text-warn-text" : "text-muted-foreground")}>
            <NumberTicker value={left} from={left} /> of {a.vcpuHours} vCPU-h left
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {a.usedHours.toFixed(1)} vCPU-hours used in {a.month} on {a.vcpu} vCPU · resets on day {a.resetDay}
      </TooltipContent>
    </Tooltip>
  );
}

function HostActions({ host: h, provider, busy, onAct, onEdit }: { host: HostView; provider?: HostProviderInfo; busy?: string; onAct: (a: "check" | "wake" | "pause" | "remove" | "snapshot" | "prepare") => void; onEdit: () => void }) {
  const metered = h.provider !== "static" && h.cloud?.hasApiKey;
  return (
    <div className="flex items-center justify-end gap-0.5" onClick={stopRow} onKeyDown={stopRow}>
      {provider?.boxRuntime === "docker" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`Prepare ${h.name}`} loading={busy === "prepare" || !!h.prepare?.running} onClick={() => onAct("prepare")} className="text-muted-foreground">
              <Wrench />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Prepare: install the msb shim and rsync, stream the box images from the primary (only what is missing)</TooltipContent>
        </Tooltip>
      )}
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
      {metered && provider?.canSnapshot && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`Snapshot ${h.name}`} loading={busy === "snapshot"} onClick={() => onAct("snapshot")} className="text-muted-foreground">
              <Camera />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Snapshot the VM in its account, with msb and the images on it, so the next host built there boots ready</TooltipContent>
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
  provider: string;
  ssh: string;
  sshExtraOpts: string;
  vmId: string;
  apiKey: string;
  /** Provision mode: the image the new VM boots from; blank is the provider's stock image. */
  snapshotId: string;
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

const formOf = (h: HostView | null, providers: HostProviderInfo[]): Form => ({
  name: h?.name ?? "",
  provider: h?.provider ?? providers[0]?.id ?? "static",
  ssh: h && !h.primary ? h.ssh : "",
  sshExtraOpts: "",
  vmId: h?.cloud?.vmId ?? "",
  apiKey: "",
  snapshotId: "",
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

function HostDialog({ host, providers, onClose, onSaved }: { host: HostView | null; providers: HostProviderInfo[]; onClose: () => void; onSaved: () => Promise<void> }) {
  // Offered first: a provider that can build the machine itself (the usual case for a new account).
  const provisionable = providers.filter((p) => p.canProvision);
  const [mode, setMode] = React.useState<"provision" | "existing">(!host && provisionable.length ? "provision" : "existing");
  const [f, setF] = React.useState<Form>(() => formOf(host, mode === "provision" ? provisionable : providers));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const primary = !!host?.primary;
  const provision = !host && mode === "provision";
  const provider = providers.find((p) => p.id === f.provider) ?? providers[0];
  const needsVm = !!provider?.needs.includes("vmId");
  const hasKeyField = !!provider?.secrets.includes("apiKey");
  // An SSH target, or (where the provider mints one) the API key and the machine id instead.
  const sshGiven = !!f.ssh.trim() || (!!provider?.sshOptional && (!!f.apiKey.trim() || !!host?.cloud?.hasApiKey) && !!f.vmId.trim());
  const can = !!f.name.trim() && (primary || (provision ? !!f.apiKey.trim() : sshGiven && (!needsVm || !!f.vmId.trim())));
  const submit = async () => {
    if (!can || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (provision) {
        const r = await api.hostProvision({
          provider: f.provider,
          name: f.name.trim(),
          apiKey: f.apiKey.trim(),
          ...(f.snapshotId.trim() ? { snapshotId: f.snapshotId.trim() } : {}),
          priority: Number(f.priority) || 0,
          sleepAfterMs: Math.max(0, Number(f.sleepMin) || 0) * 60_000,
          ...(f.maxBoxes.trim() ? { maxBoxes: Number(f.maxBoxes) } : {}),
          warm: f.warm,
          enabled: f.enabled,
          allowance: f.metered ? { vcpuHours: Number(f.vcpuHours) || 0, vcpu: Number(f.vcpu) || 1, resetDay: Number(f.resetDay) || 1 } : null,
        });
        const built = r.host?.name ?? f.name.trim();
        if (r.check && !r.check.ok) toast.warning(`${built} built, but it does not answer yet: ${r.check.detail}`, { duration: 12_000 });
        else toast.success(`${built} built and added${r.check ? ` · ${r.check.detail}` : ""}`, { description: f.snapshotId.trim() ? undefined : "A stock image: install msb and load the box images before a run lands here (see the runbook).", duration: 15_000 });
        await onSaved();
        onClose();
        return;
      }
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
        spec.cloud = needsVm || hasKeyField ? { vmId: f.vmId.trim(), apiKey: f.apiKey.trim() } : null;
        if (f.advanced || host) {
          spec.msb = f.msb.trim();
          spec.msbHome = f.msbHome.trim();
          spec.stagingDir = f.stagingDir.trim();
          spec.snapshot = f.snapshot.trim();
          spec.claudeImage = f.claudeImage.trim();
        } else if (provider?.metered) {
          // A fresh VM has no snapshot of the primary's: boot from the image, or cold.
          spec.snapshot = "";
        }
      }
      const r = await api.hostAction({ action: "upsert", ...(host ? { id: host.id } : {}), spec });
      if (r.check && !r.check.ok) toast.warning(`${spec.name} ${host ? "updated" : "added"}, but it does not answer: ${r.check.detail}`, { duration: 12_000 });
      else if (r.host?.prepare?.running) toast.success(`${spec.name} ${host ? "updated" : "added"}${r.check ? ` · ${r.check.detail}` : ""}`, { description: "Being prepared in the background: the msb shim, rsync, then the box images from the primary (a few minutes). The row shows each step.", duration: 15_000 });
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
      description={
        primary
          ? "The primary host's connection comes from .env; the rest is yours to tune."
          : provision
            ? "The provider builds the machine from your account key: a VM, an identity with root on it and a token for SSH. One to three minutes."
            : "A machine with microsandbox installed that the controller can reach over SSH. Runs are handed out by order number; equal hosts share."
      }
      className="w-[min(36rem,calc(100vw-2rem))]"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <div className="flex flex-col gap-4">
        {!host && provisionable.length > 0 && (
          <Segmented
            ariaLabel="How to add the host"
            value={mode}
            onChange={(v) => {
              setMode(v);
              setF((p) => ({ ...p, provider: v === "provision" ? (provisionable.some((x) => x.id === p.provider) ? p.provider : provisionable[0].id) : p.provider }));
            }}
            options={[
              { value: "provision", label: "From an API key" },
              { value: "existing", label: "An existing machine" },
            ]}
          />
        )}
        <Field label="Name">{(w) => <Input {...w} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Freestyle account A" autoFocus />}</Field>
        {!primary && (
          <>
            <Field label="Provider" hint={provider?.hint}>
              <Segmented ariaLabel="Provider" value={f.provider} onChange={(v) => set("provider", v)} options={(provision ? provisionable : providers).map((p) => ({ value: p.id, label: p.label }))} />
            </Field>
            {provision ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="API key" hint="The account's key; stored with the host, never shown again">
                  {(w) => <Input {...w} mono type="password" value={f.apiKey} onChange={(e) => set("apiKey", e.target.value)} autoComplete="off" />}
                </Field>
                <Field label="Boot from" optional hint="A snapshot you took of a ready host; blank is the stock image, which still needs msb and the box images">
                  {(w) => <Input {...w} mono value={f.snapshotId} onChange={(e) => set("snapshotId", e.target.value)} placeholder="snapshot id or slug" spellCheck={false} />}
                </Field>
              </div>
            ) : (
              <>
                <Field label="SSH target" optional={!!provider?.sshOptional} hint={provider?.sshHint}>
                  {(w) => <Input {...w} mono value={f.ssh} onChange={(e) => set("ssh", e.target.value)} placeholder={provider?.sshPlaceholder} spellCheck={false} />}
                </Field>
                {(needsVm || hasKeyField) && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {needsVm && <Field label="VM id">{(w) => <Input {...w} mono value={f.vmId} onChange={(e) => set("vmId", e.target.value)} placeholder="vm-…" spellCheck={false} />}</Field>}
                    {hasKeyField && (
                      <Field label="API key" optional hint={host?.cloud?.hasApiKey ? "Stored; leave blank to keep it" : "Lets the controller pause and start the VM"}>
                        {(w) => <Input {...w} mono type="password" value={f.apiKey} onChange={(e) => set("apiKey", e.target.value)} autoComplete="off" />}
                      </Field>
                    )}
                  </div>
                )}
              </>
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
        {!primary && !provision && (
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
          {host ? "Save" : provision ? (busy ? "Building the VM…" : "Build and add") : "Add host"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
