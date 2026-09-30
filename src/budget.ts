/**
 * Per-run budgets and the heartbeat (plan workstream D).
 *
 * A budget is `{maxMinutes, maxUsd?, maxTokens?}` on a delegation. It is written into the box
 * (BUDGET_PATH) so it survives a controller restart, and checked by the controller's fleet sweep
 * against what the box already reports: wall-clock since the task started, and the ⟦usage⟧ lines
 * the formatter stamps (src/trace.ts). When a cap is hit the controller does NOT kill the run — it
 * writes a question (QUESTION_MARK), which every supervised driver's gate turns into "stop at the
 * next tool call". The operator answers (continue / stop) like any other question. A cap trips at
 * most once per run: the answer is the operator's decision, so it is not re-asked every sweep.
 *
 * Honest limits:
 *  - Token/USD totals move when a ⟦usage⟧ line lands, i.e. at turn end for Claude Code. A single
 *    long turn is therefore only caught by maxMinutes while it is still going.
 *  - Dollars are computed ONLY for models with a known price (exact id, or MSB_MODEL_PRICES).
 *    An unknown price means tokens only — never a guessed $, and a maxUsd cap on an unpriced model
 *    is reported as "not enforceable" instead of silently passing.
 */
export const BUDGET_PATH = "/root/.agent-budget.json";

export interface RunBudget {
  maxMinutes: number;
  maxUsd?: number;
  maxTokens?: number;
}

export type BudgetCap = "minutes" | "usd" | "tokens";

/** What lives in BUDGET_PATH: the caps plus which ones already asked. */
export interface BudgetState extends RunBudget {
  model?: string;
  /** Epoch ms the delegation started — the maxMinutes clock (a follow-up does not reset it). */
  startedAt?: number;
  tripped?: BudgetCap[];
}

export function normalizeBudget(raw: unknown): RunBudget | undefined {
  if (raw === undefined || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, name: string, max: number): number | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > max) throw new Error(`budget.${name} must be a positive number up to ${max}`);
    return n;
  };
  const maxMinutes = num(r.maxMinutes, "maxMinutes", 24 * 60);
  if (maxMinutes === undefined) throw new Error("budget.maxMinutes is required");
  const maxUsd = num(r.maxUsd, "maxUsd", 10_000);
  const maxTokens = num(r.maxTokens, "maxTokens", 1e10);
  return { maxMinutes, ...(maxUsd ? { maxUsd } : {}), ...(maxTokens ? { maxTokens: Math.round(maxTokens) } : {}) };
}

export function parseBudgetState(text: string | undefined): BudgetState | undefined {
  if (!text?.trim()) return undefined;
  try {
    const j = JSON.parse(text) as BudgetState;
    const b = normalizeBudget(j);
    if (!b) return undefined;
    const tripped = Array.isArray(j.tripped) ? j.tripped.filter((c): c is BudgetCap => c === "minutes" || c === "usd" || c === "tokens") : [];
    return {
      ...b,
      ...(typeof j.model === "string" ? { model: j.model } : {}),
      ...(Number.isFinite(j.startedAt) && (j.startedAt ?? 0) > 0 ? { startedAt: j.startedAt } : {}),
      tripped,
    };
  } catch {
    return undefined;
  }
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
}

/** Sum every `⟦usage⟧ in= out= ctx=` line (one per turn; each is that turn's cumulative total). */
export function sumUsage(text: string): UsageTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^⟦usage⟧ in=(\d+) out=(\d+)/);
    if (m) {
      inputTokens += Number(m[1]);
      outputTokens += Number(m[2]);
    }
  }
  return { inputTokens, outputTokens };
}

/** USD per million tokens. Exact ids only — an alias or an unlisted model has no price. */
const KNOWN_PRICES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-5": { in: 3, out: 15 },
  "claude-sonnet-4": { in: 3, out: 15 },
  "claude-opus-4-1": { in: 15, out: 75 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

export function priceFor(model: string | undefined, env: NodeJS.ProcessEnv = process.env): { in: number; out: number } | undefined {
  if (!model) return undefined;
  try {
    const extra = env.MSB_MODEL_PRICES ? (JSON.parse(env.MSB_MODEL_PRICES) as Record<string, { in?: unknown; out?: unknown }>) : {};
    const e = extra[model];
    if (e && Number.isFinite(Number(e.in)) && Number.isFinite(Number(e.out))) return { in: Number(e.in), out: Number(e.out) };
  } catch {
    /* a malformed override is ignored, never guessed around */
  }
  return KNOWN_PRICES[model];
}

/** Dollars for a usage total, or undefined when the model's price is unknown. */
export function costUsd(u: UsageTotals, model: string | undefined, env?: NodeJS.ProcessEnv): number | undefined {
  const p = priceFor(model, env);
  if (!p) return undefined;
  return (u.inputTokens * p.in + u.outputTokens * p.out) / 1e6;
}

export interface BudgetCheck {
  cap: BudgetCap;
  question: string;
}

/** The first untripped cap that is exceeded, with the question to ask; null when within budget. */
export function checkBudget(
  b: BudgetState,
  facts: { startedAtMs?: number; nowMs: number; usage: UsageTotals },
  env?: NodeJS.ProcessEnv
): BudgetCheck | null {
  const tripped = new Set(b.tripped ?? []);
  const tokens = facts.usage.inputTokens + facts.usage.outputTokens;
  const usd = costUsd(facts.usage, b.model, env);
  const spent = `${Math.round(tokens).toLocaleString("en-US")} tokens${usd !== undefined ? ` (~$${usd.toFixed(2)})` : ""}`;
  const tail = " Reply 'continue' to keep going past this cap (it will not ask again for it), or 'stop' to end here.";
  const started = facts.startedAtMs ?? b.startedAt;
  if (!tripped.has("minutes") && started && facts.nowMs - started >= b.maxMinutes * 60_000) {
    const mins = Math.round((facts.nowMs - started) / 60_000);
    return { cap: "minutes", question: `Budget reached: this run has been going ${mins} min (cap ${b.maxMinutes} min); spent ${spent}.${tail}` };
  }
  if (!tripped.has("tokens") && b.maxTokens && tokens >= b.maxTokens) {
    return { cap: "tokens", question: `Budget reached: ${spent} used (cap ${b.maxTokens.toLocaleString("en-US")} tokens).${tail}` };
  }
  if (!tripped.has("usd") && b.maxUsd && usd !== undefined && usd >= b.maxUsd) {
    return { cap: "usd", question: `Budget reached: ~$${usd.toFixed(2)} spent (cap $${b.maxUsd.toFixed(2)}); ${spent}.${tail}` };
  }
  return null;
}

/** Whether a maxUsd cap can be enforced at all for this model (the UI says so up front). */
export function usdEnforceable(b: RunBudget, model: string | undefined, env?: NodeJS.ProcessEnv): boolean {
  return !b.maxUsd || priceFor(model, env) !== undefined;
}

/** A run is STALLED when it says running but its log has not moved for this long. */
export const STALL_AFTER_MS = 10 * 60_000;

export function isStalled(runState: string | undefined, lastOutputAtSec: number | undefined, nowMs: number, afterMs = STALL_AFTER_MS): boolean {
  return runState === "running" && !!lastOutputAtSec && nowMs - lastOutputAtSec * 1000 >= afterMs;
}
