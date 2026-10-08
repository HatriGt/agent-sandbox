/**
 * Model providers (plan workstream B): a per-user registry of where models come from — the user's
 * own Anthropic or OpenAI key, any OpenAI-compatible endpoint, a local Ollama, or a ccproxy. Stored
 * in the per-owner AES-GCM blob store (src/user-store.ts), so a key is sealed at rest and scoped
 * to its owner; the API only ever returns it MASKED.
 *
 * A thread that names a provider gets:
 *  - that provider's host added to the box's egress allowlist (the same allowDomains mechanism a
 *    delegate call's per-call extras use, so net-guard/config stay the one source of truth), and
 *  - its env (base URL, key) written to PROVIDER_ENV_PATH in the box, which every turn sources, so
 *    resumes from any lane keep the provider the thread started on.
 */
import { randomUUID } from "node:crypto";
import { allBlobs, loadBlob, ownerKey, saveBlob } from "./user-store.js";
import type { DriverKind, ModelSource } from "./drivers/types.js";
import { DRIVERS } from "./drivers/index.js";
import { maskSecret } from "./redact.js";

export type ProviderKind = "anthropic" | "openai" | "openai-compatible" | "ollama" | "ccproxy";
export const PROVIDER_KINDS: readonly ProviderKind[] = ["anthropic", "openai", "openai-compatible", "ollama", "ccproxy"];

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-compatible": "OpenAI-compatible",
  ollama: "Ollama (local)",
  ccproxy: "ccproxy",
};

const DEFAULT_BASE: Partial<Record<ProviderKind, string>> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
};

/** Which driver model source a provider kind feeds (src/drivers/types.ts ModelSource). */
export const SOURCE_OF: Record<ProviderKind, ModelSource> = {
  anthropic: "anthropic",
  ccproxy: "anthropic",
  openai: "openai",
  "openai-compatible": "openai-compatible",
  ollama: "local",
};

/**
 * Shown next to "sign in with your subscription" style CLI logins. Personal plans are licensed to
 * a person, not to a hosted multi-user service — so this path is for a deployment you run yourself.
 */
export const CLI_LOGIN_POLICY =
  "Signing a coding-agent CLI in with a personal subscription (Claude Pro/Max, ChatGPT) is for self-hosted deployments you run for yourself only. On a shared or hosted deployment, add an API key instead.";

export interface ProviderRecord {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  apiKey?: string;
  models?: string[];
  modelsFetchedAt?: string;
  createdAt: string;
}

/** What leaves the controller: the key is masked, never echoed. */
export interface ProviderView extends Omit<ProviderRecord, "apiKey"> {
  hasKey: boolean;
  apiKeyMasked: string | null;
  source: ModelSource;
  drivers: DriverKind[];
}

export const PROVIDERS_KIND = "providers";

export function driversFor(kind: ProviderKind): DriverKind[] {
  const src = SOURCE_OF[kind];
  return (Object.values(DRIVERS).filter((d) => d.capabilities.modelSources.includes(src)).map((d) => d.kind));
}

export function viewOf(p: ProviderRecord): ProviderView {
  const { apiKey, ...rest } = p;
  return { ...rest, hasKey: !!apiKey, apiKeyMasked: apiKey ? maskSecret(apiKey) : null, source: SOURCE_OF[p.kind], drivers: driversFor(p.kind) };
}

function isKind(v: unknown): v is ProviderKind {
  return typeof v === "string" && (PROVIDER_KINDS as readonly string[]).includes(v);
}

/**
 * Validate a caller-supplied provider. The base URL ends up in the box env and the egress
 * allowlist, so it must be a plain http(s) URL; plain http only for local/self-hosted kinds.
 */
export function normalizeProviderInput(raw: unknown, existing?: ProviderRecord): Omit<ProviderRecord, "id" | "createdAt"> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const kind = r.kind ?? existing?.kind;
  if (!isKind(kind)) throw new Error(`kind must be one of: ${PROVIDER_KINDS.join(", ")}`);
  const label = String(r.label ?? existing?.label ?? PROVIDER_LABELS[kind]).trim().slice(0, 60) || PROVIDER_LABELS[kind];
  const baseRaw = String(r.baseUrl ?? existing?.baseUrl ?? DEFAULT_BASE[kind] ?? "").trim().replace(/\/+$/, "");
  if (!baseRaw) throw new Error(`${PROVIDER_LABELS[kind]} needs a base URL`);
  let u: URL;
  try {
    u = new URL(baseRaw);
  } catch {
    throw new Error("baseUrl is not a valid URL");
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && (kind === "ollama" || kind === "openai-compatible"))) {
    throw new Error("baseUrl must be https (plain http only for Ollama / OpenAI-compatible endpoints)");
  }
  if (u.username || u.password) throw new Error("put credentials in apiKey, not in the URL");
  if (/['"\s\\$`]/.test(baseRaw)) throw new Error("baseUrl contains characters that are not allowed");
  // A blank key on update keeps the stored one (the form never receives it back).
  const keyIn = typeof r.apiKey === "string" ? r.apiKey.trim() : "";
  const apiKey = keyIn || existing?.apiKey;
  if (apiKey && /[\s'"\\]/.test(apiKey)) throw new Error("apiKey contains characters that are not allowed");
  if (!apiKey && kind !== "ollama" && kind !== "openai-compatible") throw new Error(`${PROVIDER_LABELS[kind]} needs an API key`);
  return { kind, label, baseUrl: baseRaw, ...(apiKey ? { apiKey } : {}), ...(existing?.models ? { models: existing.models, modelsFetchedAt: existing.modelsFetchedAt } : {}) };
}

export function loadProviders(owner = ownerKey()): ProviderRecord[] {
  try {
    const raw = loadBlob(PROVIDERS_KIND, owner);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list.filter((p) => p && isKind((p as ProviderRecord).kind)) as ProviderRecord[]) : [];
  } catch {
    return [];
  }
}

/** Every owner's provider keys — for the log redactor, which must know all secrets. */
export function allProviderSecrets(): string[] {
  const out: string[] = [];
  for (const raw of allBlobs(PROVIDERS_KIND)) {
    try {
      for (const p of JSON.parse(raw) as ProviderRecord[]) if (p?.apiKey && p.apiKey.length >= 8) out.push(p.apiKey);
    } catch {
      /* a corrupt blob has nothing to redact */
    }
  }
  return out;
}

function saveAll(list: ProviderRecord[], owner: string): void {
  saveBlob(PROVIDERS_KIND, JSON.stringify(list), owner);
}

export function getProvider(id: string, owner = ownerKey()): ProviderRecord | undefined {
  return loadProviders(owner).find((p) => p.id === id);
}

export function upsertProvider(raw: unknown, id?: string, owner = ownerKey()): ProviderRecord {
  const list = loadProviders(owner);
  const i = id ? list.findIndex((p) => p.id === id) : -1;
  if (id && i < 0) throw new Error("no such provider");
  const existing = i >= 0 ? list[i] : undefined;
  const next = normalizeProviderInput(raw, existing);
  // A changed endpoint or key invalidates the cached model list.
  const stale = existing && (existing.baseUrl !== next.baseUrl || existing.apiKey !== next.apiKey || existing.kind !== next.kind);
  const rec: ProviderRecord = {
    ...next,
    ...(stale ? { models: undefined, modelsFetchedAt: undefined } : {}),
    id: existing?.id ?? randomUUID(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  if (i >= 0) list[i] = rec;
  else list.push(rec);
  saveAll(list, owner);
  return rec;
}

export function deleteProvider(id: string, owner = ownerKey()): boolean {
  const list = loadProviders(owner);
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  saveAll(next, owner);
  return true;
}

/** The model-list request for a provider (exported for tests). */
export function modelsRequest(p: ProviderRecord): { url: string; headers: Record<string, string> } {
  switch (p.kind) {
    case "anthropic":
    case "ccproxy":
      return { url: `${p.baseUrl}/v1/models`, headers: { "x-api-key": p.apiKey ?? "", "anthropic-version": "2023-06-01" } };
    case "ollama":
      return { url: `${p.baseUrl}/api/tags`, headers: {} };
    default:
      return { url: `${p.baseUrl}/models`, headers: p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {} };
  }
}

export function parseModelList(kind: ProviderKind, body: unknown): string[] {
  const b = (body ?? {}) as { data?: { id?: unknown }[]; models?: { name?: unknown; model?: unknown }[] };
  const ids =
    kind === "ollama"
      ? (b.models ?? []).map((m) => m?.name ?? m?.model)
      : (b.data ?? []).map((m) => m?.id);
  return Array.from(new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 200))).sort();
}

export const MODELS_TTL_MS = 6 * 60 * 60 * 1000;

/** Fetch (or serve the cached) model list; a fetch failure keeps the old cache and says so. */
export async function refreshModels(
  id: string,
  opts: { force?: boolean; fetchImpl?: typeof fetch; owner?: string } = {}
): Promise<{ models: string[]; cached: boolean; error?: string }> {
  const owner = opts.owner ?? ownerKey();
  const list = loadProviders(owner);
  const p = list.find((x) => x.id === id);
  if (!p) throw new Error("no such provider");
  const fresh = p.modelsFetchedAt && Date.now() - Date.parse(p.modelsFetchedAt) < MODELS_TTL_MS;
  if (p.models && fresh && !opts.force) return { models: p.models, cached: true };
  const { url, headers } = modelsRequest(p);
  try {
    const r = await (opts.fetchImpl ?? fetch)(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`${PROVIDER_LABELS[p.kind]} answered ${r.status}`);
    const models = parseModelList(p.kind, await r.json());
    p.models = models;
    p.modelsFetchedAt = new Date().toISOString();
    saveAll(list, owner);
    return { models, cached: false };
  } catch (e) {
    return { models: p.models ?? [], cached: true, error: (e as Error).message };
  }
}

/** Hosts the box must reach for this provider — merged onto the curated allowlist per delegation. */
export function providerEgressDomains(p: ProviderRecord): string[] {
  try {
    return [new URL(p.baseUrl).hostname];
  } catch {
    return [];
  }
}

/** The env a provider hands the in-box agent, by driver family. */
export function providerEnv(p: ProviderRecord, model?: string): Record<string, string> {
  const env: Record<string, string> = {};
  const key = p.apiKey ?? "";
  if (p.kind === "anthropic" || p.kind === "ccproxy") {
    env.ANTHROPIC_BASE_URL = p.baseUrl;
    env.ANTHROPIC_API_KEY = key;
    if (model) env.ANTHROPIC_MODEL = model;
  } else {
    const base = p.kind === "ollama" ? `${p.baseUrl}/v1` : p.baseUrl;
    env.OPENAI_BASE_URL = base;
    env.OPENAI_API_KEY = key || "local";
    env.CODEX_API_KEY = key || "local";
  }
  if (model) env.AGENT_MODEL = model;
  return env;
}

/** The PROVIDER_ENV_PATH file body. Values are validated above; quoting is belt and braces. */
export function providerEnvFile(env: Record<string, string>): string {
  const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
  return Object.entries(env)
    .filter(([k]) => /^[A-Z_][A-Z0-9_]*$/.test(k))
    .map(([k, v]) => `export ${k}=${q(v)}`)
    .join("\n") + "\n";
}

/** Can this driver run on this provider? (The delegate flow refuses a mismatch up front.) */
export function providerFitsDriver(p: ProviderRecord, driver: DriverKind): boolean {
  return DRIVERS[driver].capabilities.modelSources.includes(SOURCE_OF[p.kind]);
}
