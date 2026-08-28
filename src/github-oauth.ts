/**
 * GitHub OAuth (web application flow) for signing in. The client secret never leaves the server; the
 * browser only ever sees the authorize redirect and the callback. Scopes are the minimum to identify
 * a person: `read:user user:email`. Repository access is a separate, per-user integration.
 */
export interface GithubIdentity {
  id: string;
  login: string;
  email: string | null;
  avatarUrl: string | null;
}

export function githubAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", "read:user user:email");
  u.searchParams.set("state", state);
  u.searchParams.set("allow_signup", "true");
  return u.toString();
}

export async function githubExchangeCode(clientId: string, clientSecret: string, code: string, redirectUri: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(body.error_description || body.error || `GitHub token exchange failed (${res.status})`);
  return body.access_token;
}

export async function githubIdentity(accessToken: string, fetchFn: typeof fetch = fetch): Promise<GithubIdentity> {
  const h = { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json", "User-Agent": "agent-sandbox" };
  const u = await fetchFn("https://api.github.com/user", { headers: h });
  if (!u.ok) throw new Error(`GitHub /user failed (${u.status})`);
  const user = (await u.json()) as { id: number; login: string; email?: string | null; avatar_url?: string };
  let email = user.email ?? null;
  if (!email) {
    const e = await fetchFn("https://api.github.com/user/emails", { headers: h }).catch(() => null);
    if (e?.ok) {
      const list = (await e.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
      email = list.find((x) => x.primary && x.verified)?.email ?? list.find((x) => x.verified)?.email ?? null;
    }
  }
  return { id: String(user.id), login: user.login, email, avatarUrl: user.avatar_url ?? null };
}
