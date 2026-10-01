/**
 * Plain cost reporting: token totals from the ⟦usage⟧ lines the formatter stamps (src/trace.ts)
 * and dollars for models with a known price.
 *
 * Honest limits:
 *  - Token totals move when a ⟦usage⟧ line lands, i.e. at turn end for Claude Code.
 *  - Dollars are computed ONLY for models with a known price (exact id, or MSB_MODEL_PRICES).
 *    An unknown price means tokens only — never a guessed $.
 */
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
