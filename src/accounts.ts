/**
 * GitHub accounts for the dashboard: what the operator sees and how new ones arrive.
 *
 * The token store (gh-token-store.ts) is login-keyed and lives on the VPS with 600 perms. The
 * dashboard never receives a token back — only a masked hint — and adds accounts two ways:
 *
 *   1. **Paste a personal access token.** Probed against GitHub (login, orgs), stored by login.
 *   2. **Sign in with GitHub** (OAuth *device flow*): the controller asks GitHub for a one-time code,
 *      the operator enters it at github.com/login/device, the dashboard polls until GitHub returns a
 *      token, which is then probed and stored exactly like a pasted one. Needs a GitHub OAuth App
 *      client id (`GITHUB_OAUTH_CLIENT_ID`); no client secret is required for the device flow.
 *
 * Pure shaping and the device-flow protocol are here with `fetch` injected, so they are unit-tested.
 */
import type { Account, TokenStore } from "./gh-token-store.js";

export interface AccountView {
  login: string;
  type: Account["type"];
  orgs: string[];
  verifiedRepos: string[];
  /** e.g. "ghp_…3f9a" — enough to recognise a token, never enough to use it. */
  tokenHint: string;
  isDefault: boolean;
}

export function maskToken(token: string): string {
  const t = token.trim();
  if (t.length <= 8) return "••••";
  const prefix = t.match(/^(gh[pousr]_|github_pat_)/)?.[1] ?? t.slice(0, 3);
  return `${prefix}…${t.slice(-4)}`;
}

export function viewAccounts(store: TokenStore, effectiveDefault: string | undefined): AccountView[] {
  return Object.values(store.accounts)
    .map((a) => ({
      login: a.login,
      type: a.type,
      orgs: a.orgs ?? [],
      verifiedRepos: a.verifiedRepos ?? [],
      tokenHint: maskToken(a.token),
      isDefault: a.login === effectiveDefault,
    }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.login.localeCompare(b.login));
}

/* ───────────────────────────── GitHub OAuth device flow ───────────────────────────── */

export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export type DevicePoll =
  | { status: "pending"; interval?: number }
  | { status: "token"; token: string }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "error"; message: string };

/** Scopes: private repo access, org membership (for access resolution), Actions triggers. */
export const DEVICE_SCOPES = "repo read:org workflow";

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export async function deviceStart(clientId: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<DeviceStart> {
  const res = await fetchFn("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: DEVICE_SCOPES }),
  });
  const body = (await res.json()) as Partial<DeviceStart> & { error?: string; error_description?: string };
  if (!res.ok || !body.device_code || !body.user_code) {
    throw new Error(body.error_description || body.error || `GitHub device flow failed (${res.status})`);
  }
  return {
    device_code: body.device_code,
    user_code: body.user_code,
    verification_uri: body.verification_uri || "https://github.com/login/device",
    expires_in: body.expires_in ?? 900,
    interval: body.interval ?? 5,
  };
}

export async function devicePoll(clientId: string, deviceCode: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<DevicePoll> {
  const res = await fetchFn("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const body = (await res.json()) as { access_token?: string; error?: string; error_description?: string; interval?: number };
  if (body.access_token) return { status: "token", token: body.access_token };
  switch (body.error) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "pending", interval: body.interval ?? 10 };
    case "expired_token":
      return { status: "expired" };
    case "access_denied":
      return { status: "denied" };
    default:
      return { status: "error", message: body.error_description || body.error || `GitHub returned ${res.status}` };
  }
}
