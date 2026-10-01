import * as React from "react";
import { ArrowUpRight, Check, ChevronRight, Copy, RotateCw, Square } from "lucide-react";
import { toast } from "sonner";
import type { RunDigest, RunOutcome } from "@/lib/api";
import type { RunStats } from "@/lib/transcript";
import type { ContextHealth } from "@/lib/context-health";
import { fmtDuration } from "@/lib/lifecycle";
import { friendlyName } from "@/lib/format";
import { Collapse } from "@/components/ui/collapse";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { TraceEvent } from "@/lib/trace";
import { deriveWatch, watchElapsedSec, type WatchState } from "@/lib/watch";
import { fmtTokens, fmtUsd } from "./OutcomeCard";

/**
 * The run-end pill: one muted, single-line, rounded-full summary per finished run, replacing the
 * outcome card and the digest card in the thread. Collapsed by default; Enter/click opens a quiet
 * borderless key-value list in place. Built only from recorded facts (outcome.json + digest.json):
 * an unknown or empty fact is simply absent — never "—", never a guess. Green done / red failed.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function A({ href, external, children }: { href: string; external?: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="text-foreground focus-visible:ring-ring inline-flex min-w-0 items-center gap-0.5 rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
    >
      {children}
    </a>
  );
}

function Action({ onClick, icon, label, title }: { onClick: () => void; icon: React.ReactNode; label: string; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none [&_svg]:size-3.5"
    >
      {icon}
    </button>
  );
}

export function RunPill({
  outcome: o,
  digest: d,
  label,
  detail,
  failed: failedProp,
  stats,
  durationSec,
  context,
  onCopy,
  onAgain,
  events,
}: {
  outcome: RunOutcome | null;
  digest: RunDigest | null;
  /** The live run's end label ("Completed", "Out of memory"…); used as the state word when it failed. */
  label?: string;
  detail?: string;
  failed?: boolean;
  stats?: RunStats;
  durationSec?: number;
  context?: ContextHealth | null;
  onCopy?: () => Promise<string>;
  onAgain?: () => void;
  /** The trace, so a finished WATCH reads "Stopped watching <target> · 12m" instead of "Run interrupted". */
  events?: TraceEvent[];
}) {
  const [open, setOpen] = React.useState(false);
  const watch = React.useMemo(() => (events ? deriveWatch(events) : null), [events]);
  const [copied, setCopied] = React.useState(false);
  const bodyId = React.useId();
  if (!o && !d && !stats) return null;

  // Stopping a watch interrupts the turn (exit 253): that is the intended end, not a failure.
  const stoppedWatch = !!watch && (!failedProp || label === "Run interrupted");
  const failed = !stoppedWatch && (failedProp || (o?.state ?? d?.state) === "failed");
  const liveMs = durationSec && durationSec > 0 ? durationSec * 1000 : null;
  const durMs = o?.cost.durationMs ?? (d?.startedAt && d.endedAt && d.endedAt > d.startedAt ? d.endedAt - d.startedAt : liveMs);
  const copy = async () => {
    if (!onCopy) return;
    try {
      await navigator.clipboard.writeText(await onCopy());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      toast.error("Could not copy", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const duration = durMs != null && durMs > 0 ? fmtDuration(Math.round(durMs / 1000)) : null;
  const tok = o?.cost.tokens ? o.cost.tokens.input + o.cost.tokens.output : d?.usage ? d.usage.inputTokens + d.usage.outputTokens : null;
  const tokens = tok ? `${fmtTokens(tok)} tokens` : null;
  const prs = o?.result.prs ?? [];
  const diff =
    o?.result.diff ??
    (d && d.files.length
      ? { files: d.files.length, additions: d.files.reduce((s, f) => s + f.additions, 0), deletions: d.files.reduce((s, f) => s + f.deletions, 0) }
      : null);
  const t = o?.trust.tests ?? null;
  const verified = o?.trust.verified ?? (d?.verified ? { pass: d.verified.pass } : null);
  const exitCode = o?.trust.exitCode ?? d?.exitCode ?? null;
  const questions = o?.trust.questions ?? d?.questions.length ?? 0;
  const openQ = o?.trust.openQuestions ?? 0;
  const p = d?.provenance;
  const driver = p?.agentLabel ?? p?.agent ?? null;
  const model = p?.model ? (p.provider ? `${p.provider} / ${p.model}` : p.model) : (o?.cost.model ?? null);
  const blocked = o?.trust.blocked ?? d?.blocked?.length ?? 0;
  const failedCmds = d?.failedCommands ?? [];
  // The digest headline is often just "done" — that would repeat the state, so skip it.
  const headline = d?.headline && !/^(done|failed|completed)\.?$/i.test(d.headline.trim()) ? d.headline : null;

  // Collapsed line: state, then the results that matter, then cost.
  const watchSec = watch ? watchElapsedSec(watch, false) : null;
  const summary: string[] = [
    stoppedWatch && watch
      ? `${watch.phase === "paused" ? "Watch paused" : watch.phase === "ended" ? "Finished watching" : "Stopped watching"} ${watch.target}`
      : failed
        ? label && label !== "Completed" ? label : "Failed"
        : "Done",
  ];
  if (stoppedWatch && watch) {
    if (watch.updates) summary.push(plural(watch.updates, "update"));
    if (watchSec) summary.push(fmtDuration(watchSec));
  }
  if (prs[0]) summary.push(`PR #${prs[0].number}${prs.length > 1 ? ` +${prs.length - 1}` : ""}`);
  if (diff && diff.files) summary.push(`${plural(diff.files, "file")} +${diff.additions} −${diff.deletions}`);
  if (t) summary.push(t.failed ? `tests ${t.passed}/${t.passed + t.failed} ✕` : `tests ${t.passed}/${t.passed} ✓`);
  else if (verified) summary.push(verified.pass ? "verified ✓" : "unverified");
  if (!prs.length && diff && !diff.files) summary.push("no changes");
  if (duration && !(stoppedWatch && watchSec)) summary.push(duration);
  if (tokens) summary.push(tokens);

  const rows: [string, React.ReactNode][] = [];
  if (headline) rows.push(["summary", headline]);
  if (stoppedWatch && watch) rows.push(["watch", `${watch.target}${watch.every ? ` · every ${watch.every}` : ""}${watch.phase === "paused" ? " · say continue to resume" : ""}`]);
  else if (detail) rows.push(["note", <span className={failed ? "text-destructive" : undefined}>{detail}</span>]);
  if (o?.header.label)
    rows.push([
      "started by",
      o.header.link ? (
        <A href={o.header.link.href} external={o.header.link.external}>
          {o.header.label}
          {o.header.link.external && <ArrowUpRight className="size-3" aria-hidden />}
        </A>
      ) : (
        o.header.label
      ),
    ]);
  if (driver) rows.push(["driver", driver]);
  if (model) rows.push(["model", model]);
  if (prs.length)
    rows.push([
      prs.length > 1 ? "pull requests" : "pull request",
      <span className="flex flex-wrap gap-x-3">
        {prs.map((pr) => (
          <A key={pr.url} href={pr.url} external>
            {pr.repo}#{pr.number}
            <ArrowUpRight className="size-3" aria-hidden />
          </A>
        ))}
      </span>,
    ]);
  if (diff && diff.files)
    rows.push([
      "diff",
      <span className="stamp">
        {plural(diff.files, "file")} <span className="text-ok">+{diff.additions}</span> <span className="text-destructive">−{diff.deletions}</span>
      </span>,
    ]);
  if (t)
    rows.push([
      "tests",
      <span className={t.failed ? "text-destructive" : "text-ok"}>
        {t.failed ? `${t.failed} of ${t.passed + t.failed} failed` : `${t.passed}/${t.passed} passed`}
        <span className="text-muted-foreground"> · {t.runner}</span>
      </span>,
    ]);
  if (verified)
    rows.push([
      "verify",
      <span className={verified.pass ? "text-ok" : "text-destructive"}>
        {verified.pass ? "passed" : "failed"}
        {o?.trust.testedWith && <code className="text-muted-foreground ml-1.5 font-mono">{o.trust.testedWith}</code>}
      </span>,
    ]);
  // Exit code only when it says something the tests/verify do not.
  if (exitCode != null && (exitCode !== 0 || (!t && !verified)))
    rows.push(["exit code", <span className={cn("stamp", exitCode !== 0 && "text-destructive")}>{exitCode}</span>]);
  if (failedCmds.length)
    rows.push([
      "failed",
      <span className="stamp text-destructive flex flex-col">
        {failedCmds.map((c, i) => (
          <span key={i} className="truncate">
            {c.name}
            {c.arg ? ` ${c.arg}` : ""}
          </span>
        ))}
      </span>,
    ]);
  if (questions > 0) rows.push(["questions", `${questions} asked${openQ ? ` · ${openQ} unanswered` : ""}`]);
  if (blocked > 0) rows.push(["sandbox", `${plural(blocked, "call")} blocked`]);
  if (o?.trust.prOnly) rows.push(["pushes", "PR-only"]);
  if (stats) {
    const work = [
      stats.steps ? plural(stats.steps, "step") : null,
      stats.commands ? plural(stats.commands, "command") : null,
      stats.failed ? `${stats.failed} failed` : null,
      !diff && stats.files ? plural(stats.files, "file") + " touched" : null,
    ].filter(Boolean);
    if (work.length) rows.push(["work", work.join(" · ")]);
  }
  if (context) rows.push(["context", <span className="stamp">{Math.round(context.fraction * 100)}% used</span>]);
  if (duration) rows.push(["duration", <span className="stamp">{duration}</span>]);
  if (tokens) rows.push(["tokens", <span className="stamp">{tokens}</span>]);
  if (o && o.cost.usd !== null) rows.push(["cost", <span className="stamp">{fmtUsd(o.cost.usd)}</span>]);
  if (o?.result.followedBy)
    rows.push(["followed by", <A href={`/dashboard/box/${encodeURIComponent(o.result.followedBy.box)}`}>{friendlyName(o.result.followedBy.box)}</A>]);
  (o?.result.followups ?? []).forEach((f) =>
    rows.push([
      f.kind === "ci" ? "CI follow-up" : "review follow-up",
      <span className={f.state === "failed" ? "text-destructive" : undefined}>
        <A href={`/dashboard/box/${encodeURIComponent(f.box)}`}>{f.line ?? f.subject}</A>
      </span>,
    ]),
  );

  return (
    <div data-run-pill={stoppedWatch ? "watch-stopped" : failed ? "failed" : "done"} className="enter flex min-w-0 flex-col items-start">
      <div className="flex max-w-full min-w-0 items-center gap-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        title={summary.join(" · ")}
        className="text-muted-foreground hover:text-foreground hover:bg-muted/60 focus-visible:ring-ring border-border/60 flex h-7 max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-full border px-3 text-micro transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className={cn("size-1.5 shrink-0 rounded-full transition-colors duration-200 ease-out", stoppedWatch ? "bg-faint" : failed ? "bg-destructive" : "bg-ok")} aria-hidden />
        <span className="min-w-0 truncate">
          <span className={cn("font-medium", failed ? "text-destructive" : "text-foreground")}>{summary[0]}</span>
          {summary.slice(1).map((s) => ` · ${s}`)}
        </span>
        <ChevronRight className={cn("size-3 shrink-0 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
      </button>
      <span className="ml-1 flex items-center" data-run-pill-actions>
        {onCopy && <Action onClick={copy} icon={copied ? <Check className="text-ok" /> : <Copy />} label={copied ? "Copied" : "Copy transcript"} />}
        {onAgain && <Action onClick={onAgain} icon={<RotateCw />} label="Run again" title="Run again — new machine, same brief and repositories" />}
      </span>
      </div>
      <Collapse open={open} className="w-full">
        <dl id={bodyId} data-run-pill-details className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 px-3 pt-2 pb-1 text-micro">
          {rows.map(([k, v], i) => (
            <React.Fragment key={i}>
              <dt className="text-faint">{k}</dt>
              <dd className="text-foreground min-w-0 break-words">{v}</dd>
            </React.Fragment>
          ))}
        </dl>
      </Collapse>
    </div>
  );
}

/**
 * The live pill for a WATCH (the agent loops on a monitoring task until told to stop): "Watching
 * backend logs · 4 updates · 3m", a calm live-blue breathing dot (never amber — nothing needs you),
 * and a quiet Stop that interrupts the turn (session kept). Renders nothing unless the trace holds a
 * current watch, so the thread can mount it unconditionally while a run is going.
 */
export function WatchPill({ session, events, running = true }: { session: string; events: TraceEvent[]; running?: boolean }) {
  const watch = React.useMemo(() => deriveWatch(events), [events]);
  const [stopping, setStopping] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const live = running && !!watch && watch.phase === "on";
  React.useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [live]);
  React.useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);
  if (!watch || !running) return null;
  return <WatchLine watch={watch} live={live} now={now} stopping={stopping} onStop={async () => {
    setStopping(true);
    try {
      await api.interrupt(session);
    } catch (e) {
      setStopping(false);
      toast.error("Could not stop the watch", { description: e instanceof Error ? e.message : String(e) });
    }
  }} />;
}

function WatchLine({ watch, live, now, stopping, onStop }: { watch: WatchState; live: boolean; now: number; stopping: boolean; onStop: () => void }) {
  const sec = watchElapsedSec(watch, live, now);
  const bits = [watch.updates ? plural(watch.updates, "update") : "starting", sec != null ? fmtDuration(sec) : null].filter(Boolean);
  const word = stopping ? "Stopping" : watch.phase === "paused" ? "Watch paused:" : watch.phase === "ended" ? "Finished watching" : "Watching";
  return (
    <div data-watch-pill={stopping ? "stopping" : live ? "live" : watch.phase} role="status" aria-live="polite" className="enter flex max-w-full min-w-0 items-center gap-1.5">
      <span
        className={cn(
          "border-border/60 text-muted-foreground flex h-7 max-w-full min-w-0 items-center gap-2 rounded-full border px-3 text-micro transition-[color,border-color,background-color] duration-200 ease-out",
          live && !stopping && "border-live/30 bg-live/5",
        )}
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full transition-colors duration-200 ease-out",
            live && !stopping ? "bg-live breathe motion-reduce:animate-none" : "bg-faint",
          )}
          aria-hidden
        />
        <span className="min-w-0 truncate">
          <span className={cn("font-medium transition-colors duration-200 ease-out", live && !stopping ? "text-live" : "text-foreground")}>
            {word} {watch.target}
          </span>
          <span className="stamp"> · {bits.join(" · ")}</span>
        </span>
      </span>
      {live && (
        <button
          type="button"
          onClick={onStop}
          disabled={stopping}
          data-watch-stop
          aria-label={`Stop watching ${watch.target}`}
          title="Stop watching — the agent's session is kept; send a message to pick it back up"
          className="text-foreground hover:bg-muted focus-visible:ring-ring border-border flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-micro font-medium transition-[background-color,opacity] duration-200 ease-out focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default disabled:opacity-60 motion-reduce:transition-none [&_svg]:size-2.5"
        >
          <Square className="fill-current" aria-hidden />
          {stopping ? "Stopping…" : "Stop"}
        </button>
      )}
    </div>
  );
}
