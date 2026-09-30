import * as React from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { api, type CompareDetail, type CompareFacts, type HarnessView } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { Panel, PanelFooter } from "@/components/ui/settings";

/** Start one task on two harnesses: a compare row, then two ordinary delegations linked to it. */
export function CompareLauncher({ harnesses, onCancel, onStarted }: { harnesses: HarnessView[]; onCancel: () => void; onStarted: () => void }) {
  const [task, setTask] = React.useState("");
  const [a, setA] = React.useState(harnesses[0]?.id ?? "");
  const [b, setB] = React.useState(harnesses[1]?.id ?? "");
  const [busy, setBusy] = React.useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const { id } = await api.compareCreate({ task: task.trim(), harnessA: a, harnessB: b });
      const sides = await Promise.allSettled(
        (["a", "b"] as const).map((side) => api.delegate({ task: task.trim(), harness: side === "a" ? a : b, compareId: id, compareSide: side }))
      );
      const failed = sides.filter((s) => s.status === "rejected" || (s.status === "fulfilled" && !s.value.ok));
      if (failed.length) toast.error(`${failed.length === 2 ? "Neither side" : "One side"} started`, { description: failed.map((f) => (f.status === "rejected" ? (f.reason as Error).message : f.value.ok ? "" : f.value.question)).join(" · ") });
      else toast.success("Compare started: two runs");
      onStarted();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pick = (v: string, set: (s: string) => void, label: string) => (
    <Field label={label}>
      {(w) => (
        <select {...w} className={inputClass} value={v} onChange={(e) => set(e.target.value)}>
          {harnesses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
  return (
    <Panel className="mb-4">
      <div className="flex flex-col gap-4 p-4">
        <Field label="Task">
          {(w) => <textarea {...w} className={cn(inputClass, "h-24 py-2")} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Add input validation to the signup form" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {pick(a, setA, "Harness A")}
          {pick(b, setB, "Harness B")}
        </div>
        {a === b && <p className="text-destructive text-micro">Pick two different harnesses.</p>}
      </div>
      <PanelFooter className="justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy || !task.trim() || a === b} onClick={() => void start()}>
          Start both
        </Button>
      </PanelFooter>
    </Panel>
  );
}

type CompareSummary = Awaited<ReturnType<typeof api.compares>>["compares"][number];

export function CompareList({ refresh, onOpenBox, canStart }: { refresh: number; onOpenBox?: (box: string) => void; canStart: boolean }) {
  const [rows, setRows] = React.useState<CompareSummary[] | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  React.useEffect(() => {
    api.compares().then((r) => setRows(r.compares)).catch(() => setRows([]));
  }, [refresh]);
  if (!rows) return null;
  if (!rows.length)
    return <p className="text-muted-foreground text-meta">{canStart ? "No compares yet." : "Save two harnesses to compare them."}</p>;
  return (
    <Panel className="divide-y">
      {rows.map((c) => (
        <div key={c.id}>
          <button type="button" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id} className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors">
            <ChevronRight className={cn("text-muted-foreground size-4 shrink-0 transition-transform", open === c.id && "rotate-90")} />
            <span className="text-foreground min-w-0 flex-1 truncate text-meta">{c.task}</span>
            <span className="text-faint shrink-0 text-micro tabular-nums">
              {c.sides.length}/2 · {fmtAgo(c.createdAt)}
            </span>
          </button>
          {open === c.id && <CompareView id={c.id} onOpenBox={onOpenBox} />}
        </div>
      ))}
    </Panel>
  );
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const ROWS: Array<{ label: string; cell: (f: CompareFacts) => React.ReactNode }> = [
  { label: "State", cell: (f) => f.state },
  { label: "Verified", cell: (f) => (f.verified === null ? <span className="text-faint">not checked</span> : f.verified ? <span className="text-ok">passed</span> : <span className="text-destructive">failed</span>) },
  { label: "Questions", cell: (f) => f.questions },
  { label: "Tokens", cell: (f) => (f.tokens ? `${f.tokens.input.toLocaleString()} in · ${f.tokens.output.toLocaleString()} out` : <span className="text-faint">not reported</span>) },
  { label: "Cost", cell: (f) => (f.costUsd !== null ? `$${f.costUsd.toFixed(f.costUsd < 1 ? 3 : 2)}` : <span className="text-faint">unknown</span>) },
  { label: "Duration", cell: (f) => (f.durationMs !== null ? fmtDuration(f.durationMs) : <span className="text-faint">—</span>) },
  { label: "Files", cell: (f) => (f.files.length ? <span title={f.files.join("\n")}>{f.files.length} changed</span> : "none") },
];

/** Both receipts, row by row. Every cell is a fact the run reported; unknown stays unknown. */
export function CompareView({ id, onOpenBox }: { id: string; onOpenBox?: (box: string) => void }) {
  const [d, setD] = React.useState<CompareDetail | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    const load = () => api.compare(id).then((r) => live && setD(r)).catch((e: Error) => live && setErr(e.message));
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id]);
  if (err) return <p className="text-destructive px-4 pb-3 text-micro">{err}</p>;
  if (!d) return <div className="bg-muted mx-4 mb-3 h-24 animate-pulse rounded" />;
  return (
    <div className="overflow-x-auto px-4 pb-4">
      <table className="w-full min-w-[20rem] text-left text-micro">
        <thead>
          <tr>
            <th className="w-24 py-1.5" />
            {d.sides.map((s) => (
              <th key={s.side} className="text-foreground py-1.5 pr-2 font-medium">
                <span className="text-faint mr-1 uppercase">{s.side}</span>
                {s.harnessName}
                {s.box && onOpenBox && (
                  <button type="button" onClick={() => onOpenBox(s.box!)} className="text-muted-foreground hover:text-foreground ml-2 font-mono font-normal underline-offset-2 hover:underline">
                    {s.box}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {ROWS.map((r) => (
            <tr key={r.label}>
              <td className="text-muted-foreground py-1.5 pr-2">{r.label}</td>
              {d.sides.map((s) => (
                <td key={s.side} className="text-foreground py-1.5 pr-2 tabular-nums">
                  {s.facts ? r.cell(s.facts) : <span className="text-faint">{s.source === "not-started" ? "did not start" : "run gone"}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
