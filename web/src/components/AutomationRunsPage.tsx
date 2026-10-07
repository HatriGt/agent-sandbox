import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowUpRight, FlaskConical, History as HistoryIcon, Play, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { api, type Automation, type AutomationDelivery } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { fmtAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";
import { Swap } from "@/components/ui/swap";
import { EmptyState } from "@/components/ui/empty-state";
import { Bar } from "@/components/thread/Skeletons";
import { GLYPH, KIND_LABEL, countsLine, deliveryLine, deliveryTone } from "@/components/Automations";

/**
 * One automation's run history: every delivery the controller saw for it, newest first — what fired
 * (and the box it opened), what was skipped and why, what was rejected. Reached from the Runs button
 * on an automation row; the editor stays about the rule, this page is about what the rule did.
 */

type Filter = "all" | "fired" | "skipped" | "rejected";

const OUTCOME_WORD: Record<AutomationDelivery["outcome"], string> = { fired: "Fired", skipped: "Skipped", rejected: "Rejected", failed: "Could not start" };

/** Rows sit under a day heading, so the stamp is the time alone — second precision so bursts read as separate events. */
function stamp(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Calendar-day buckets ("Today", "Yesterday", "Tue 3 Oct") so a long log has landmarks. */
function dayLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

export function AutomationRunsPage({ id, onBack, onOpenBox }: { id: string; onBack: () => void; onOpenBox: (box: string) => void }) {
  const still = useReducedMotion();
  const triggers = useCached("triggers", (signal) => api.triggers(signal));
  const a: Automation | undefined = triggers.data?.triggers.find((t) => t.id === id);
  const [deliveries, setDeliveries] = React.useState<AutomationDelivery[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [busy, setBusy] = React.useState<"run" | "test" | null>(null);

  const load = React.useCallback(() => {
    setError(null);
    return api
      .triggerDeliveries(id)
      .then((r) => setDeliveries(r.deliveries))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);
  React.useEffect(() => {
    void load();
  }, [load]);
  // A running box finishes without us; keep the receipts moving while something is in flight.
  React.useEffect(() => {
    const live = (a?.active ?? 0) > 0;
    const t = window.setInterval(() => {
      void load();
      void triggers.refresh();
    }, live ? 10_000 : 60_000);
    return () => window.clearInterval(t);
  }, [a?.active, load, triggers]);

  const act = async (kind: "run" | "test") => {
    setBusy(kind);
    try {
      if (kind === "run") {
        const r = await api.runTrigger(id);
        if (r.result.outcome === "started") toast.success("Started", { description: r.result.box });
        else toast.error(r.result.outcome === "skipped" ? "Skipped" : "Could not start", { description: r.result.reason });
      } else {
        const r = await api.testTrigger(id);
        if (r.result?.outcome === "started") toast.success("Test event fired a run", { description: r.result.box });
        else toast.error("Test event did not fire", { description: r.result?.reason ?? r.skipped ?? r.ignored });
      }
    } catch (e) {
      toast.error(kind === "run" ? "Could not start" : "Could not send the test event", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
      void load();
      void triggers.refresh();
    }
  };

  const all = deliveries ?? [];
  const counts = {
    all: all.length,
    fired: all.filter((d) => d.outcome === "fired").length,
    skipped: all.filter((d) => d.outcome === "skipped").length,
    rejected: all.filter((d) => d.outcome === "rejected" || d.outcome === "failed").length,
  };
  const rows = all.filter((d) => (filter === "all" ? true : filter === "rejected" ? d.outcome === "rejected" || d.outcome === "failed" : d.outcome === filter));
  // Group by calendar day, keeping the newest-first order from the controller.
  const groups: { day: string; items: AutomationDelivery[] }[] = [];
  for (const d of rows) {
    const day = dayLabel(d.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(d);
    else groups.push({ day, items: [d] });
  }

  const Glyph = a ? GLYPH[a.kind] : HistoryIcon;
  const canTest = a?.kind === "webhook" && !!a.spec.preset;

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-[1000px] px-5 py-6 md:px-8 md:py-8">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3">
          <ArrowLeft className="size-4" />
          Automations
        </Button>

        <header className="mb-6 flex flex-wrap items-start gap-4">
          <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl border", a?.enabled ? "border-live/20 bg-live/10 text-live" : "border-border bg-muted text-muted-foreground")} aria-hidden>
            <Glyph className="size-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="label text-muted-foreground">Runs</p>
            {a ? (
              <>
                <h1 className="text-foreground truncate font-serif text-h1 font-normal tracking-[-0.01em]">{a.name}</h1>
                <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1.5 text-meta">
                  <span className="text-foreground/80">{KIND_LABEL[a.kind]}</span>
                  <span className="text-faint">·</span>
                  <span>{a.when}</span>
                  {a.quiet && a.counts && (
                    <>
                      <span className="text-faint">·</span>
                      <span>{countsLine(a.counts)}</span>
                    </>
                  )}
                  {!a.enabled && (
                    <>
                      <span className="text-faint">·</span>
                      <span>paused</span>
                    </>
                  )}
                </p>
              </>
            ) : triggers.error ? (
              <h1 className="text-destructive font-serif text-h1 font-normal">Could not load this automation</h1>
            ) : triggers.data ? (
              <h1 className="text-foreground font-serif text-h1 font-normal">This automation no longer exists</h1>
            ) : (
              <Bar className="mt-1 h-7 w-64" />
            )}
          </div>
          {a && (
            <div className="flex shrink-0 items-center gap-2">
              {a.kind !== "chain" && (
                <Button size="sm" variant="outline" onClick={() => void act("run")} loading={busy === "run"}>
                  <Play />
                  Run now
                </Button>
              )}
              {canTest && (
                <Button size="sm" variant="outline" onClick={() => void act("test")} loading={busy === "test"}>
                  <FlaskConical />
                  Send test event
                </Button>
              )}
            </div>
          )}
        </header>

        <div role="radiogroup" aria-label="Filter runs" className="mb-4 flex flex-wrap items-center gap-2">
          <FilterChip group="automation-runs" active={filter === "all"} onClick={() => setFilter("all")} label="All" count={counts.all} />
          <FilterChip group="automation-runs" active={filter === "fired"} onClick={() => setFilter("fired")} label="Fired" count={counts.fired} tone="ok" />
          <FilterChip group="automation-runs" active={filter === "skipped"} onClick={() => setFilter("skipped")} label="Skipped" count={counts.skipped} />
          <FilterChip group="automation-runs" active={filter === "rejected"} onClick={() => setFilter("rejected")} label="Rejected" count={counts.rejected} tone="destructive" />
          <span className="text-faint ml-auto text-micro">last 50 deliveries</span>
        </div>

        <Swap state={error ? "error" : deliveries === null ? "loading" : rows.length ? "list" : "empty"}>
          {error ? (
            <EmptyState
              icon={HistoryIcon}
              tone="destructive"
              title="Could not load the runs"
              line={error}
              action={
                <Button size="sm" variant="outline" onClick={() => void load()}>
                  <RotateCw />
                  Retry
                </Button>
              }
            />
          ) : deliveries === null ? (
            <div className="bg-card overflow-hidden rounded-xl border" aria-busy="true" aria-label="Loading runs">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-b-0">
                  <Bar className="size-2 rounded-full" />
                  <Bar className="h-3 w-36" />
                  <Bar className="h-3 flex-1" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={HistoryIcon}
              title={counts.all === 0 ? "Nothing has arrived yet" : "Nothing matches this filter"}
              line={counts.all === 0 ? "Every delivery lands here: fired (with the box it opened), skipped and why, or rejected." : undefined}
              action={
                counts.all === 0 && a && a.kind !== "chain" ? (
                  <Button size="sm" onClick={() => void act("run")} loading={busy === "run"}>
                    <Play />
                    Run now
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map((g) => (
                <section key={g.day} aria-label={g.day}>
                  <p className="label text-faint mb-2 px-1">{g.day}</p>
                  <ol className="bg-card overflow-hidden rounded-xl border shadow-e1">
                    <AnimatePresence initial={false}>
                      {g.items.map((d, i) => (
                        <motion.li
                          key={d.id}
                          layout="position"
                          initial={still ? { opacity: 0 } : { opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: still ? 0.1 : 0.2, delay: Math.min(i, 10) * 0.025, ease: [0.22, 1, 0.36, 1] }}
                          className="border-b last:border-b-0"
                        >
                          <DeliveryRow d={d} onOpenBox={onOpenBox} />
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ol>
                </section>
              ))}
            </div>
          )}
        </Swap>
      </div>
    </div>
  );
}

function DeliveryRow({ d, onOpenBox }: { d: AutomationDelivery; onOpenBox: (box: string) => void }) {
  const tone = deliveryTone(d);
  const dot = d.outcome === "fired" ? "bg-ok" : d.outcome === "skipped" ? "bg-muted-foreground/50" : "bg-destructive";
  const openable = d.outcome === "fired" && !!d.box;
  const body = (
    <>
      <span className={cn("mt-[7px] size-2 shrink-0 rounded-full", dot)} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className={cn("text-meta font-medium", tone)}>{d.test ? `Test · ${OUTCOME_WORD[d.outcome]}` : OUTCOME_WORD[d.outcome]}</span>
          {d.reason && d.outcome !== "fired" && <span className="text-muted-foreground text-meta">{deliveryLine(d).split(" · ").slice(1).join(" · ")}</span>}
          {d.box && <span className="stamp text-muted-foreground truncate">{d.box}</span>}
          {d.quiet && (
            <span className="text-faint text-micro" title="Nothing needed you — no notification was sent">
              quiet
            </span>
          )}
        </span>
        {d.detail && (
          <span className="text-faint truncate text-micro" title={d.detail}>
            {d.detail}
          </span>
        )}
      </span>
      <span className="stamp text-faint shrink-0 tabular text-right" title={new Date(d.at).toLocaleString()}>
        <span className="hidden sm:inline">{stamp(d.at)}</span>
        <span className="sm:hidden">{fmtAgo(Math.round(d.at / 1000))}</span>
      </span>
      {openable && <ArrowUpRight className="text-faint group-hover/run:text-muted-foreground size-3.5 shrink-0 transition-colors" aria-hidden />}
    </>
  );
  return openable ? (
    <button type="button" onClick={() => onOpenBox(d.box!)} className="group/run hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-ring/40 flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset" aria-label={`Open ${d.box}`}>
      {body}
    </button>
  ) : (
    <div className="flex items-start gap-3 px-4 py-3">{body}</div>
  );
}
