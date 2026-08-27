/**
 * Secret redaction for everything the dashboard shows from inside a sandbox: the agent log, tool
 * output, artifacts, questions. Two layers:
 *
 *   1. KNOWN secrets — the exact tokens the controller itself holds (GitHub tokens, MCP env/header
 *      secrets, the npm token, the dashboard bearer). If one of these appears verbatim anywhere in
 *      sandbox output, it is replaced. This is the strong guarantee: we know these strings.
 *   2. SHAPED secrets — anything that looks like a credential by format (GitHub `ghp_…`, PATs,
 *      `x-access-token:…@`, `Bearer …`, OpenAI/Slack/AWS/GitLab/npm key shapes, `password=` pairs).
 *      Catches tokens we don't hold (the agent found one in a repo or an env dump).
 *
 * Replacement keeps a short tail (`ghp_…ABCD`) so the operator can still tell WHICH credential leaked
 * without being able to use it. Pure functions; the http layer wires them in front of the log paths.
 */

const SHAPES: RegExp[] = [
  // URL-embedded basic auth: https://user:secret@host — keep the user, drop the secret.
  /(https?:\/\/[^\s/:@]+:)([^\s@/]{4,})(@)/g,
  // GitHub: classic/OAuth/app/refresh tokens and fine-grained PATs.
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // Bearer / token headers.
  /(\b(?:Bearer|token)\s+)([A-Za-z0-9._~+/=-]{20,})/g,
  // OpenAI/Anthropic-style, Slack, AWS access key, GitLab PAT, npm, Stripe, Google API keys.
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // KEY=value / "key": "value" pairs whose key smells like a secret and whose value is long enough.
  /((?:^|[\s"',{])(?:[A-Za-z0-9_-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Za-z0-9_-]*)["']?\s*[:=]\s*["']?)([^\s"',}…]{8,})/gi,
];

function tail(v: string): string {
  return v.length >= 12 ? `…${v.slice(-4)}` : "…";
}

/** Redact secrets by shape. Idempotent: an already-redacted value has no matching shape. */
export function redactShapes(text: string): string {
  if (!text) return text;
  let out = text;
  for (const re of SHAPES) {
    out = out.replace(re, (m: string, ...groups: unknown[]) => {
      // Patterns with capture groups keep their prefix/suffix; bare patterns replace the whole match.
      const g = groups.filter((x) => typeof x === "string") as string[];
      if (re.source.startsWith("(https?")) return `${g[0]}${tail(g[1])}${g[2]}`;
      if (g.length >= 2) return `${g[0]}${tail(g[1])}`;
      return `${m.slice(0, Math.min(4, m.indexOf("_") + 1 || 3))}${tail(m)}`;
    });
  }
  return out;
}

/** Redact exact known secrets (each ≥ 8 chars; shorter values would shred normal text). */
export function redactKnown(text: string, secrets: Iterable<string>): string {
  if (!text) return text;
  let out = text;
  for (const s of new Set(secrets)) {
    if (!s || s.length < 8) continue;
    if (!out.includes(s)) continue;
    out = out.split(s).join(tail(s));
  }
  return out;
}

export function redactSecrets(text: string, known: Iterable<string> = []): string {
  return redactShapes(redactKnown(text, known));
}

/**
 * A redactor whose known-secret list refreshes lazily from the controller's stores. `secretsFn` is
 * awaited at most once per `ttlMs`; between refreshes the last list is used. A failing refresh keeps
 * the old list — redaction never blocks a log read.
 */
export function makeRedactor(secretsFn: () => Promise<string[]>, ttlMs = 60_000, now = Date.now) {
  let known: string[] = [];
  let at = 0;
  let inflight: Promise<void> | null = null;
  const refresh = () => {
    if (inflight) return inflight;
    inflight = secretsFn()
      .then((list) => {
        known = list.filter((s) => typeof s === "string" && s.length >= 8);
        at = now();
      })
      .catch(() => {})
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
  return {
    /** Redact `text`; kicks a refresh in the background when the list is stale. */
    redact(text: string): string {
      if (now() - at > ttlMs) void refresh();
      return redactSecrets(text, known);
    },
    /** Await a fresh secret list (used once at startup so the first log read is already covered). */
    prime: refresh,
    get known() {
      return known;
    },
  };
}
