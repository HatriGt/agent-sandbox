/**
 * The model catalog — Cursor-style per-message model switching, half 1 (the source of truth).
 *
 * The boxes talk to Anthropic through ccproxy, whose /v1/models serves the alias list the operator
 * actually pays for (ak-claude-opus-4.8, ak-claude-haiku-4.5, …) mixed with non-Anthropic ids the
 * driver must not use. This module fetches + filters + labels that list, and provides the
 * allowlist check every model override MUST pass before it reaches an -e ANTHROPIC_MODEL flag:
 * model routing is a controller decision (the same reasoning that put ANTHROPIC_MODEL in
 * RESERVED_SECRET_KEYS), so a caller picks FROM the catalog, never names an arbitrary id.
 *
 * Pure parts (label/tier/filter/allow) exported for tests; the fetch is the same ssh+curl hop the
 * GitHub probe uses (the proxy may be reachable only from the VPS network).
 */
import type { Config } from "./config.js";
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";

export interface ModelInfo {
  /** The exact alias to inject as ANTHROPIC_MODEL. */
  id: string;
  /** Human label for the picker: "Opus 4.8", "Opus 5 (medium)". */
  label: string;
  tier: "opus" | "sonnet" | "haiku" | "other";
}

/** Only Claude aliases belong in the driver picker; gpt-x and other routes are for other tools. */
export function isClaudeAlias(id: string): boolean {
  return /claude/i.test(id);
}

export function tierOf(id: string): ModelInfo["tier"] {
  const l = id.toLowerCase();
  if (l.includes("opus") || l.includes("fable")) return "opus";
  if (l.includes("sonnet")) return "sonnet";
  if (l.includes("haiku")) return "haiku";
  return "other";
}

/**
 * "ak-claude-opus-4.8" → "Opus 4.8" · "ak-claude-opus-5-medium" → "Opus 5 (medium)" ·
 * "ak-claude-opus4-7" → "Opus 4.7" · "claude-3-7-sonnet-20250219" → "Sonnet 3.7" ·
 * anything unparseable falls back to the raw id (never hide what will actually run).
 */
export function labelFor(id: string): string {
  const effort = id.match(/-(high|medium|low)$/i)?.[1]?.toLowerCase();
  const base = effort ? id.slice(0, -(effort.length + 1)) : id;
  // Dated API ids (claude-3-7-sonnet-20250219) first — their trailing date would otherwise be
  // misread as the version by the generic family match below.
  const dated = base.match(/claude-(\d+)-(\d+)-(opus|sonnet|haiku)/i);
  if (dated) return `${cap(dated[3])} ${dated[1]}.${dated[2]}`;
  const fam = base.match(/(opus|sonnet|haiku|fable)[-]?(\d+(?:[.-]\d+)?)?/i);
  if (!fam) return id;
  const name = cap(fam[1]);
  const ver = fam[2]?.replace("-", ".") ?? "";
  return `${name}${ver ? ` ${ver}` : ""}${effort ? ` (${effort})` : ""}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const TIER_ORDER: Record<ModelInfo["tier"], number> = { opus: 0, sonnet: 1, haiku: 2, other: 3 };

/** Parse a /v1/models body into the picker catalog: Claude only, tier-ordered, labeled. */
export function parseCatalog(body: string): ModelInfo[] {
  let ids: string[] = [];
  try {
    const j = JSON.parse(body) as { data?: Array<{ id?: string }> };
    ids = (j.data ?? []).map((m) => String(m.id ?? "")).filter(Boolean);
  } catch {
    return [];
  }
  return ids
    .filter(isClaudeAlias)
    .map((id) => ({ id, label: labelFor(id), tier: tierOf(id) }))
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.label.localeCompare(b.label));
}

/**
 * The allowlist gate for any model override. The configured defaults are always allowed even if
 * the proxy listing momentarily omits them (a proxy hiccup must not brick the default).
 */
export function isAllowedModel(id: string, catalog: ModelInfo[], cfg: Pick<Config, "anthropicModel" | "askModel">): boolean {
  if (id === cfg.anthropicModel || (cfg.askModel && id === cfg.askModel)) return true;
  return catalog.some((m) => m.id === id);
}

/* ── IO: fetch through the VPS (the proxy may be LAN-only) with a short cache ── */

const CACHE_TTL_MS = 5 * 60_000;
let cached: { at: number; models: ModelInfo[] } | null = null;

export async function fetchModels(cfg: Config): Promise<ModelInfo[]> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.models;
  const remote =
    `curl -sf -m 10 -H ${shellQuote(`Authorization: Bearer ${cfg.anthropicApiKey}`)} ` +
    `-H ${shellQuote(`x-api-key: ${cfg.anthropicApiKey}`)} ` +
    `${shellQuote(`${cfg.anthropicBaseUrl.replace(/\/+$/, "")}/v1/models`)}`;
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, remote], { check: false });
  const models = parseCatalog(r.stdout ?? "");
  // Never cache an empty result over a good one (transient proxy failure).
  if (models.length > 0 || !cached) cached = { at: Date.now(), models };
  return cached.models;
}
