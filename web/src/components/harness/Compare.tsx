import * as React from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { api, type AttemptFacts, type AttemptGroupSummary, type AttemptGroupView as AttemptGroup, type CompareDetail, type CompareFacts, type HarnessView } from "@/lib/api";
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
function CompareView({ id, onOpenBox }: { id: string; onOpenBox?: (box: string) => void }) {
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

const STATUS_LABEL: Record<AttemptGroup["status"], string> = {
  running: "running",
  deciding: "picking the best",
  "needs-pick": "needs your pick",
  decided: "decided",
  "no-winner": "no winner",
  failed: "failed",
};

/** Tasks run several ways at once ("Tries several approaches"). */
export function AttemptGroupList({ refresh, onOpenBox }: { refresh?: number; onOpenBox?: (box: string) => void }) {
  const [rows, setRows] = React.useState<AttemptGroupSummary[] | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  React.useEffect(() => {
    api.attemptGroups().then((r) => setRows(r.groups)).catch(() => setRows([]));
  }, [refresh]);
  if (!rows) return null;
  if (!rows.length) return <p className="text-muted-foreground text-meta">No multi-attempt runs yet. Set Attempts to 2 or 3 in the composer.</p>;
  return (
    <Panel className="divide-y">
      {rows.map((g) => (
        <div key={g.id}>
          <button type="button" onClick={() => setOpen(open === g.id ? null : g.id)} aria-expanded={open === g.id} className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors">
            <ChevronRight className={cn("text-muted-foreground size-4 shrink-0 transition-transform", open === g.id && "rotate-90")} />
            <span className="text-foreground min-w-0 flex-1 truncate text-meta">{g.task}</span>
            <span className={cn("shrink-0 text-micro", g.status === "needs-pick" ? "text-foreground font-medium" : "text-faint")}>{STATUS_LABEL[g.status] ?? g.status}</span>
            <span className="text-faint shrink-0 text-micro tabular-nums">
              {g.attempts.length} · {fmtAgo(g.createdAt)}
            </span>
          </button>
          {open === g.id && <AttemptGroupView id={g.id} onOpenBox={onOpenBox} />}
        </div>
      ))}
    </Panel>
  );
}

const ATTEMPT_ROWS: Array<{ label: string; cell: (f: AttemptFacts) => React.ReactNode }> = [
  { label: "State", cell: (f) => (f.state === "failed" && f.exitCode !== null ? `failed (exit ${f.exitCode})` : f.state) },
  { label: "Verified", cell: (f) => (f.verified === null ? <span className="text-faint">not checked</span> : f.verified ? <span className="text-ok">passed</span> : <span className="text-destructive">failed</span>) },
  {
    label: "Tests",
    cell: (f) =>
      f.tests ? (
        <span>
          <span className="text-ok">{f.tests.passed} passed</span>
          {" · "}
          <span className={f.tests.failed ? "text-destructive" : undefined}>{f.tests.failed} failed</span>
        </span>
      ) : (
        <span className="text-faint">none found</span>
      ),
  },
  { label: "Diff", cell: (f) => (f.files === null && f.diffLines === null ? <span className="text-faint">—</span> : `${f.files ?? "?"} files · ${f.diffLines ?? "?"} lines`) },
  {
    label: "Cost",
    cell: (f) => (f.costUsd !== null ? `$${f.costUsd.toFixed(f.costUsd < 1 ? 3 : 2)}` : f.tokens !== null ? `${f.tokens.toLocaleString()} tokens` : <span className="text-faint">unknown</span>),
  },
  { label: "Time", cell: (f) => (f.durationMs !== null ? fmtDuration(f.durationMs) : <span className="text-faint">—</span>) },
];

/** Every attempt side by side; the winner is highlighted and the others can be picked instead. */
export function AttemptGroupView({ id, onOpenBox }: { id: string; onOpenBox?: (box: string) => void }) {
  const [d, setD] = React.useState<AttemptGroup | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Poll only while the outcome can still change on its own.
  const active = !d || d.status === "running" || d.status === "deciding";
  React.useEffect(() => {
    let live = true;
    const load = () => api.attemptGroup(id).then((r) => live && setD(r)).catch((e: Error) => live && setErr(e.message));
    void load();
    const t = active ? setInterval(load, 10_000) : undefined;
    return () => {
      live = false;
      if (t) clearInterval(t);
    };
  }, [id, active]);
  const pick = async (body: { id: string; box: string } | { id: string; choice: number }) => {
    setBusy(true);
    try {
      setD(await api.attemptPick(body));
      toast.success("Winner picked");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (err) return <p className="text-destructive px-4 pb-3 text-micro">{err}</p>;
  if (!d) return <div className="bg-muted mx-4 mb-3 h-24 animate-pulse rounded" />;
  const overrideClosed = d.overrideUntil !== null && Date.now() > d.overrideUntil;
  const questionText = d.question?.split(/\n\s*Options:/i)[0].trim();
  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <div className="text-micro text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-foreground font-medium">{STATUS_LABEL[d.status] ?? d.status}</span>
        {d.decidedBy && (
          <span>
            {d.decidedBy === "auto" ? "picked automatically" : "picked by you"}
            {d.decidedAt ? ` ${fmtAgo(d.decidedAt)}` : ""}
          </span>
        )}
        {d.prUrls.map((u) => (
          <a key={u} href={u} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
            {u.replace(/^https?:\/\/(www\.)?github\.com\//, "")}
          </a>
        ))}
      </div>
      {d.note && <p className="text-muted-foreground text-micro">{d.note}</p>}
      {d.status === "needs-pick" && d.question && (
        <div className="bg-muted/50 flex flex-col gap-2 rounded-md p-3">
          <p className="text-foreground text-micro whitespace-pre-wrap">{questionText}</p>
          <div className="flex flex-wrap gap-2">
            {d.choices.map((c, i) => (
              <Button key={i} size="sm" variant="outline" disabled={busy} title={c.answer} onClick={() => void pick({ id: d.id, choice: i })}>
                {c.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] text-left text-micro">
          <thead>
            <tr>
              <th className="w-24 py-1.5" />
              {d.attempts.map((a) => (
                <th key={a.index} className={cn("text-foreground py-1.5 pr-2 font-medium", a.winner && "bg-ok/10")}>
                  <span className="text-faint mr-1">#{a.index + 1}</span>
                  {a.label}
                  {a.winner && <span className="text-ok ml-2 font-normal">winner</span>}
                  {a.box && onOpenBox && (
                    <button type="button" onClick={() => onOpenBox(a.box!)} className="text-muted-foreground hover:text-foreground ml-2 font-mono font-normal underline-offset-2 hover:underline">
                      {a.box}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {ATTEMPT_ROWS.map((r) => (
              <tr key={r.label}>
                <td className="text-muted-foreground py-1.5 pr-2">{r.label}</td>
                {d.attempts.map((a) => (
                  <td key={a.index} className={cn("text-foreground py-1.5 pr-2 tabular-nums", a.winner && "bg-ok/10")}>
                    {a.facts ? r.cell(a.facts) : <span className="text-faint">{a.error ?? "did not start"}</span>}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td />
              {d.attempts.map((a) => {
                const finished = !!a.facts && a.facts.state !== "running" && a.facts.state !== "not-started";
                const canShow = !a.winner && finished && !!a.box && (d.status === "decided" || d.status === "no-winner" || d.status === "needs-pick");
                const why = a.tornDown ? "This attempt's sandbox was already torn down." : overrideClosed ? "The window to change the pick has closed." : undefined;
                return (
                  <td key={a.index} className={cn("py-1.5 pr-2", a.winner && "bg-ok/10")}>
                    {canShow && (
                      <Button size="sm" variant="ghost" disabled={busy || !!why} title={why ?? "Make this attempt the winner"} onClick={() => void pick({ id: d.id, box: a.box! })}>
                        Pick this one instead
                      </Button>
                    )}
                    {canShow && why && <p className="text-faint text-micro">{why}</p>}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
