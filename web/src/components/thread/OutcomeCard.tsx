import * as React from "react";
import { ArrowUpRight, GitPullRequest, ShieldCheck } from "lucide-react";
import { api, type RunOutcome } from "@/lib/api";
import { fmtDuration } from "@/lib/lifecycle";
import { friendlyName } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The outcome card (docs/plan-demo-parity.md bet 2): what did I get, can I trust it, what did it
 * cost — and why the run started. Every figure comes from GET /history/outcome.json, which only
 * carries recorded facts; an unknown renders as "—", never a guess. Colour: green for passing,
 * red for failing, neutral otherwise — amber is reserved for "needs you" and never appears here.
 */

const DASH = "—";

export function fmtTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}
export function fmtUsd(n: number): string {
  return n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function testsText(o: RunOutcome): { text: string; tone: "ok" | "bad" | "plain" } {
  const t = o.trust.tests;
  if (t) {
    const total = t.passed + t.failed;
    return { text: t.failed ? `${t.failed} of ${total} tests failed` : `${t.passed}/${total} tests passed`, tone: t.failed ? "bad" : "ok" };
  }
  if (o.trust.exitCode === null) return { text: `tests ${DASH}`, tone: "plain" };
  return { text: `exit ${o.trust.exitCode}`, tone: o.trust.exitCode === 0 ? "plain" : "bad" };
}

/** The compact one-line form (History rows): only facts that exist. */
export function outcomeFacts(o: RunOutcome): string[] {
  const out: string[] = [];
  const pr = o.result.prs[0];
  if (pr) out.push(`PR #${pr.number}${o.result.prs.length > 1 ? ` +${o.result.prs.length - 1}` : ""}`);
  if (o.result.diff && o.result.diff.files) out.push(`+${o.result.diff.additions} −${o.result.diff.deletions}`);
  if (o.trust.tests) out.push(testsText(o).text);
  if (o.trust.questions) out.push(`asked ${plural(o.trust.questions, "question")}`);
  if (o.cost.tokens) out.push(`${fmtTokens(o.cost.tokens.input + o.cost.tokens.output)} tokens`);
  if (o.cost.usd !== null) out.push(fmtUsd(o.cost.usd));
  if (o.result.followedBy) out.push(`followed by ${friendlyName(o.result.followedBy.box)}`);
  for (const f of o.result.followups ?? []) if (f.line) out.push(f.line);
  return out;
}

export function useOutcome(q: { id: number } | { box: string } | null, key: string | number = 0): RunOutcome | null {
  const [o, setO] = React.useState<RunOutcome | null>(null);
  const k = q ? ("id" in q ? `i${q.id}` : `b${q.box}`) : "";
  React.useEffect(() => {
    setO(null);
    if (!q) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The archive lands a moment after the finish edge (after verification): retry a few times.
    const load = (left: number) =>
      api
        .outcome(q, ctrl.signal)
        .then((r) => setO(r.outcome))
        .catch(() => {
          if (!ctrl.signal.aborted && left > 0) timer = setTimeout(() => load(left - 1), 4000);
        }); // never archived: the card simply isn't there
    load(3);
    return () => {
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, key]);
  return o;
}

function Col({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="label text-muted-foreground mb-1.5">{title}</p>
      <div className="flex flex-col gap-1 text-meta">{children}</div>
    </div>
  );
}

function Link({ href, external, children }: { href: string; external?: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="text-foreground focus-visible:ring-ring inline-flex min-w-0 items-center gap-1 rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
    >
      {children}
    </a>
  );
}

export function OutcomeCard({ outcome: o, className }: { outcome: RunOutcome; className?: string }) {
  const failed = o.state === "failed";
  const tests = testsText(o);
  const tokens = o.cost.tokens ? o.cost.tokens.input + o.cost.tokens.output : null;
  const dur = o.cost.durationMs !== null ? fmtDuration(Math.round(o.cost.durationMs / 1000)) : DASH;

  return (
    <section aria-label="Run outcome" className={cn("enter bg-card raised rounded-xl px-4 py-3", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn("size-2 shrink-0 rounded-full", failed ? "bg-destructive" : "bg-ok")} aria-hidden />
        <span className={cn("label shrink-0", failed ? "text-destructive" : "text-ok")}>Outcome</span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-micro">
          {o.header.label ? (
            <>
              started by{" "}
              {o.header.link ? (
                <Link href={o.header.link.href} external={o.header.link.external}>
                  {o.header.label}
                  {o.header.link.external && <ArrowUpRight className="size-3 shrink-0" aria-hidden />}
                </Link>
              ) : (
                <span className="text-foreground">{o.header.label}</span>
              )}
            </>
          ) : (
            `started by ${DASH}`
          )}
        </span>
      </div>

      <div className="mt-3 grid gap-x-8 gap-y-3 border-t pt-3 sm:grid-cols-3">
        <Col title="What you got">
          {o.result.prs.length ? (
            o.result.prs.map((p) => (
              <Link key={p.url} href={p.url} external>
                <GitPullRequest className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">
                  {p.repo}#{p.number}
                </span>
              </Link>
            ))
          ) : (
            <span className="text-muted-foreground">no pull request</span>
          )}
          <span className="stamp text-muted-foreground">
            {o.result.diff ? (
              o.result.diff.files ? (
                <>
                  {plural(o.result.diff.files, "file")} · <span className="text-ok">+{o.result.diff.additions}</span>{" "}
                  <span className="text-destructive">−{o.result.diff.deletions}</span>
                </>
              ) : (
                "no file changes"
              )
            ) : (
              `diff ${DASH}`
            )}
          </span>
          {o.result.followedBy && (
            <span className="text-muted-foreground text-micro">
              followed by <Link href={`/dashboard/box/${encodeURIComponent(o.result.followedBy.box)}`}>{friendlyName(o.result.followedBy.box)}</Link>
            </span>
          )}
          {(o.result.followups ?? []).map((f) => (
            <span key={f.box} className={cn("text-micro", f.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
              <Link href={`/dashboard/box/${encodeURIComponent(f.box)}`}>{f.line ?? f.subject}</Link>
            </span>
          ))}
        </Col>

        <Col title="Can you trust it">
          <span className={cn(tests.tone === "ok" ? "text-ok" : tests.tone === "bad" ? "text-destructive" : "text-foreground")}>
            {tests.text}
            {o.trust.tests && <span className="text-muted-foreground stamp"> · {o.trust.tests.runner}</span>}
          </span>
          {o.trust.testedWith && (
            <span className="text-muted-foreground min-w-0 truncate text-micro" title={o.trust.testedWith}>
              Tested with <code className="text-foreground font-mono">{o.trust.testedWith}</code>
            </span>
          )}
          {o.trust.verified && (
            <span className={cn("text-micro", o.trust.verified.pass ? "text-ok" : "text-destructive")}>{o.trust.verified.pass ? "✓ verified" : "UNVERIFIED"}</span>
          )}
          {o.trust.prOnly && (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-micro" title="Pushes to the default branch were refused; changes land as a pull request">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
              PR-only
            </span>
          )}
          <span className="text-muted-foreground text-micro">
            {o.trust.questions ? `you were asked ${plural(o.trust.questions, "question")}` : "no questions asked"}
            {o.trust.openQuestions ? ` · ${o.trust.openQuestions} unanswered` : ""}
          </span>
          {o.trust.blocked > 0 && <span className="text-muted-foreground text-micro">{plural(o.trust.blocked, "call")} blocked by the sandbox</span>}
        </Col>

        <Col title="What it cost">
          <span className="stamp text-foreground">{dur}</span>
          <span className="stamp text-foreground">{tokens !== null ? `${fmtTokens(tokens)} tokens` : `tokens ${DASH}`}</span>
          <span className="stamp text-foreground" title={o.cost.usd === null ? "No price is known for this model" : undefined}>
            {o.cost.usd !== null ? fmtUsd(o.cost.usd) : `$ ${DASH}`}
          </span>
        </Col>
      </div>
    </section>
  );
}
