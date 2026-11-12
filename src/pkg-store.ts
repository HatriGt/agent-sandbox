/**
 * The package store: the npm packages behind people's `npx …` MCP servers, installed ONCE on the
 * host and shown read-only to every box (`msb run --mount-dir`), instead of once per box.
 *
 * Why. A box boots in under a second, but a server added on the MCP page is not in the image, so
 * every box installed it itself: measured live, 47 s of npm for three packages while a warm box
 * was being prepared, the same again on a cold start, and a fourth package (with a 600 MB runtime)
 * never fitted on the 1 GB box disk at all, failed, and was retried for 20 s at the start of every
 * task and every follow-up message. With the store a box links to the copy on the host: no
 * download, no disk used in the box, the same on a warm box and a cold one.
 *
 * What is shared is public npm packages and nothing else: no server config, no header, no secret.
 * A box cannot write to the store (the mount is read-only). Each package is installed by a
 * throwaway builder box whose only writable mount is that one package's staging directory, so the
 * install scripts of one package cannot touch another; the host then moves the finished directory
 * into place in one rename. A package that cannot be built is left to the old in-box install.
 *
 * Layout on the host: <root>/pkgs/<key>/v<epoch seconds>/lib/node_modules/<name>. A box uses the
 * newest version directory; an unpinned spec is built again after a week and the two newest are
 * kept, so a box linked to the previous one keeps working.
 */

/** Where every box sees the store. */
export const PKG_STORE_MOUNT = "/opt/asb-store";
/** Builder boxes carry this prefix; they are not sessions and are left out of counts and lists. */
export const STORE_BOX_PREFIX = "asbstore-";
export const isStoreBox = (name: string): boolean => name.startsWith(STORE_BOX_PREFIX);

/** An unpinned spec is built again once its newest copy is this old. */
export const STORE_REFRESH_SEC = 7 * 24 * 3600;
/** A spec that failed to build is left alone this long. */
export const STORE_RETRY_SEC = 6 * 3600;

/** `name` of `name@version` (a leading @scope is part of the name). */
export function specName(spec: string): string {
  const at = spec.indexOf("@", 1);
  return at > 0 ? spec.slice(0, at) : spec;
}

/** Only an exact version never changes; a tag or a range (`@latest`, `@^1`) can. */
export function isPinned(spec: string): boolean {
  const at = spec.indexOf("@", 1);
  return at > 0 && /^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(spec.slice(at + 1));
}

/** A spec the store will hold: what npxPackagesOf accepts, minus names made only of dots. */
export function storable(spec: string): boolean {
  if (spec.startsWith("-") || !/^(@[\w.-]+\/)?[\w.-]+(@[\w.^~-]+)?$/.test(spec)) return false;
  return specName(spec).split("/").every((part) => /[A-Za-z0-9]/.test(part));
}

/** The spec as one safe directory name (never empty, never dots alone, no slash). */
export function storeKey(spec: string): string {
  return "p_" + spec.replace(/[^\w.@-]/g, "_");
}

/**
 * Shell (for the box) that prints the newest stored copy of a spec, or nothing. Version
 * directories are `v` + epoch seconds, the same width for centuries, so a plain sort orders them.
 */
export function storedPathSh(spec: string, quote: (s: string) => string): string {
  return `ls -d ${PKG_STORE_MOUNT}/${quote(storeKey(spec))}/v*/lib/node_modules/${quote(specName(spec))} 2>/dev/null | sort | tail -1`;
}

/** `pkgs/<key>/v<sec>` lines (from a host `ls`) as key -> newest version time. */
export function parseStoreListing(stdout: string): Map<string, number> {
  const have = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    const m = line.trim().match(/(?:^|\/)(p_[^/\s]+)\/v(\d+)$/);
    if (!m) continue;
    const at = Number(m[2]);
    if (at > (have.get(m[1]) ?? 0)) have.set(m[1], at);
  }
  return have;
}

/** Which of these specs need a build now: absent, or unpinned and a week old; not a recent failure. */
export function planStoreBuilds(specs: readonly string[], have: ReadonlyMap<string, number>, failedAt: ReadonlyMap<string, number>, nowSec: number): string[] {
  const out: string[] = [];
  for (const spec of new Set(specs)) {
    if (!storable(spec)) continue;
    const failed = failedAt.get(spec);
    if (failed !== undefined && nowSec - failed < STORE_RETRY_SEC) continue;
    const at = have.get(storeKey(spec));
    if (at === undefined || (!isPinned(spec) && nowSec - at > STORE_REFRESH_SEC)) out.push(spec);
  }
  return out;
}

export interface PkgStoreIO {
  nowSec: () => number;
  /** `pkgs/<key>/v<sec>` paths on the host, one per line. */
  list: () => Promise<string>;
  /** Install one spec into the store as version `ver`; throws when it could not. */
  build: (spec: string, ver: string) => Promise<void>;
  log: (m: string) => void;
}

/**
 * The queue behind the store: `want(specs)` returns at once; anything missing is built in the
 * background, one package at a time (a builder is a 1 GB box on a host that is usually near full).
 */
export function makePkgStore(io: PkgStoreIO) {
  const failedAt = new Map<string, number>();
  const queued = new Set<string>();
  let have: Map<string, number> | undefined;
  let listedAt = 0;
  let running = false;

  let listingNow: Promise<Map<string, number>> | undefined;
  const listing = (): Promise<Map<string, number>> => {
    if (have && io.nowSec() - listedAt <= 60) return Promise.resolve(have);
    return (listingNow ??= (async () => {
      try {
        have = parseStoreListing(await io.list());
        listedAt = io.nowSec();
        return have;
      } finally {
        listingNow = undefined;
      }
    })());
  };

  const drain = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const spec = queued.values().next().value as string | undefined;
        if (spec === undefined) break;
        const t0 = io.nowSec();
        try {
          await io.build(spec, `v${t0}`);
          have?.set(storeKey(spec), t0);
          failedAt.delete(spec);
          io.log(`[pkg-store] ${spec} stored in ${io.nowSec() - t0}s`);
        } catch (e) {
          failedAt.set(spec, io.nowSec());
          io.log(`[pkg-store] ${spec} could not be stored (boxes install it themselves): ${String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(0, 240)}`);
        }
        queued.delete(spec);
      }
    } finally {
      running = false;
    }
  };

  return {
    /** Make sure these specs are (or soon will be) in the store. Never throws, never waits. */
    want(specs: readonly string[]): void {
      if (!specs.length) return;
      void (async () => {
        try {
          for (const s of planStoreBuilds(specs, await listing(), failedAt, io.nowSec())) queued.add(s);
          await drain();
        } catch (e) {
          io.log(`[pkg-store] ${String((e as Error)?.message ?? e).slice(0, 200)}`);
        }
      })();
    },
    /** For tests and the health page: what is waiting and what failed. */
    state: () => ({ queued: [...queued], failed: [...failedAt.keys()], building: running }),
    /** Resolves when the queue is empty (tests). */
    idle: async (): Promise<void> => {
      while (running || queued.size) await new Promise((r) => setTimeout(r, 5));
    },
  };
}
