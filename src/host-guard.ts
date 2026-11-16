/**
 * Keep a sandbox away from the machine that hosts it.
 *
 * A box with open egress may reach "the public internet", and the host's own public address is
 * part of that: measured from inside a box, every port the host listens on answered (SSH, the
 * Docker swarm ports, other apps' admin panels), including ones a provider firewall hides from the
 * outside, because traffic from a guest to its host never passes that firewall. A page shown in
 * the box's browser, or an agent told to by a prompt injection, could talk to all of them.
 *
 * So every box is started with rules that refuse the host's own addresses, except the two ports a
 * web server answers on: the model endpoint and the person's own sites are often served from the
 * same machine over 443, and those are public by intent. Explicit rules win over the `public`
 * profile and over the allowlist's domain rules, and the first matching rule decides (verified on
 * msb 0.6.9: 22, 2377, 3000 and 9443 refused; 80, 443 and the rest of the internet unchanged).
 */

/** Addresses that are the host's own and globally routable: the ones the `public` profile lets through. */
export function publicAddrs(all: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of all) {
    const a = raw.trim().toLowerCase();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) {
      const [p, q] = a.split(".").map(Number);
      const local = p === 10 || p === 127 || p === 0 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 169 && q === 254) || (p === 100 && q >= 64 && q <= 127) || p >= 224;
      if (!local) out.push(a);
    } else if (/^[0-9a-f:]+$/.test(a) && a.includes(":")) {
      // Global unicast only (2000::/3): link-local, unique-local and loopback are not "public".
      if (/^[23]/.test(a)) out.push(a);
    }
  }
  return [...new Set(out)].slice(0, 16);
}

/** The `--net-rule` flags for those addresses: web ports stay, everything else is refused. */
export function hostGuardFlagsFor(addrs: readonly string[]): string[] {
  return publicAddrs(addrs).flatMap((a) => {
    const t = a.includes(":") ? `[${a}]` : a;
    return ["--net-rule", `allow@${t}:tcp:443,allow@${t}:tcp:80,deny@${t}`];
  });
}

// One entry per box host (keyed by its SSH target): a second host has its own addresses, and a
// box on it must be kept off THOSE, not the first host's.
interface Guard {
  flags: string[];
  learned: Promise<void> | null;
  failedAt: number;
}
const guards = new Map<string, Guard>();
let testFlags: string[] | null = null;
const guardOf = (key: string): Guard => {
  let g = guards.get(key);
  if (!g) {
    g = { flags: [], learned: null, failedAt: 0 };
    guards.set(key, g);
  }
  return g;
};

/** The rules learned so far for a host (empty until it has been asked once). */
export function hostGuardFlags(cfg?: { vpsSsh: string }): string[] {
  if (testFlags) return testFlags;
  return cfg ? guardOf(cfg.vpsSsh).flags : [];
}

/**
 * Ask a host for its addresses once. `EGRESS_HOST_GUARD=0` turns the guard off. A host that
 * cannot be asked leaves the boxes as they were and is asked again a minute later: a run must
 * never fail to start over this.
 */
export function ensureHostGuard(key: string, hostAddrs: () => Promise<string>): Promise<void> {
  if (process.env.EGRESS_HOST_GUARD === "0") return Promise.resolve();
  const g = guardOf(key);
  if (g.learned && !(g.failedAt && Date.now() - g.failedAt > 60_000)) return g.learned;
  g.failedAt = 0;
  g.learned = hostAddrs().then(
    (out) => {
      g.flags = hostGuardFlagsFor(out.split(/\s+/).filter(Boolean));
      console.error(`[net] boxes are kept off ${g.flags.length / 2} of the host's own public addresses (ports 80 and 443 stay open)`);
    },
    (e) => {
      g.failedAt = Date.now();
      console.error(`[net] could not read the host's addresses; boxes start without the host guard: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
    }
  );
  return g.learned;
}

/** Tests only. */
export function setHostGuardForTest(addrs: readonly string[] | null): void {
  testFlags = addrs ? hostGuardFlagsFor(addrs) : null;
}
