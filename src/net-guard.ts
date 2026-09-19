/**
 * Outbound-request guard: the controller POSTs to tenant-supplied URLs (notification webhooks, MCP
 * server probes) — the classic SSRF shape. Everything here exists to make those requests unable to
 * reach the controller's own API, the container network, or the host/cloud metadata service.
 *
 * Two layers, both required:
 *  1. Lexical vetting (`isPublicHttpUrl`): https-only, real dotted hostname, no credentials, no
 *     private/loopback/link-local/CGNAT literals, no obviously-internal names.
 *  2. Resolution pinning (`fetchPinned`): resolve the hostname ONCE, vet every address, then make
 *     undici connect to the vetted IP (SNI/Host keep the original name). Without the pin, a
 *     DNS-rebinding server passes the lookup check and re-resolves to 169.254.169.254 for the
 *     actual connection (TOCTOU).
 */
import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

function privateV4(addr: string): boolean {
  const [a, b] = addr.split(".").map(Number);
  return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/** Lexical SSRF check for a tenant-supplied outbound URL. https only — a webhook or probe target on plain http would also leak its payload to the path. */
export function isPublicHttpUrl(raw: unknown): boolean {
  if (typeof raw !== "string" || !raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".")) return false; // localhost, bare container names
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) && privateV4(h)) return false;
  if (h === "host.docker.internal" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (h.startsWith("[") || h.includes(":")) return false; // IPv6 literals: not needed, hard to vet
  return true;
}

/**
 * Fetch a vetted public URL with the resolved address PINNED for the connection. Never follows
 * redirects (a public host 302ing to link-local must not be chased). Throws on non-public
 * resolution. The caller still owns timeouts via `signal`.
 */
export async function fetchPinned(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
): Promise<UndiciResponse> {
  if (!isPublicHttpUrl(url)) throw new Error("only public https URLs are allowed");
  const hostname = new URL(url).hostname;
  const addrs = await lookup(hostname, { all: true }).catch(() => []);
  if (!addrs.length || !addrs.every((a) => a.family === 4 && !privateV4(a.address))) {
    throw new Error("host does not resolve to a public address");
  }
  const pinned = addrs[0].address;
  const agent = new Agent({
    connect: {
      // Pin the connection to the address we vetted; TLS still verifies against the original name.
      lookup: (_host, opts, cb) =>
        (opts as { all?: boolean }).all
          ? (cb as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: pinned, family: 4 }])
          : (cb as unknown as (e: null, a: string, f: number) => void)(null, pinned, 4),
    },
  });
  try {
    return await undiciFetch(url, { ...init, redirect: "manual", dispatcher: agent });
  } finally {
    void agent.close().catch(() => {});
  }
}
