/**
 * Workspace file index for `@` mentions in the dashboard composer.
 *
 * One `find` over /workspace per box, cached briefly, filtered server-side so the browser gets at
 * most a few dozen matches per keystroke. Excludes dependency and VCS trees and the `.agent.*`
 * sentinels (mechanism, not content). The listing is read-only and path-confined to /workspace —
 * the same boundary /artifact enforces.
 *
 * Pure parts (filter/rank, exclusion) are exported for tests; the exec is injected.
 */

export const FILE_INDEX_CAP = 4000;
export const FILE_MATCH_LIMIT = 40;

/** The `find` that produces the index: paths relative to /workspace, one per line. */
export function fileListCommand(): string {
  return (
    "cd /workspace 2>/dev/null && find . -type f " +
    "-not -path './node_modules/*' -not -path '*/node_modules/*' " +
    "-not -path './.git/*' -not -path '*/.git/*' " +
    "-not -path '*/dist/*' -not -path '*/build/*' -not -path '*/.next/*' -not -path '*/target/*' " +
    "-not -path '*/__pycache__/*' -not -path '*/.venv/*' -not -path '*/venv/*' " +
    "-not -name '.agent.*' -not -name '*.lock' -not -name '*.log' " +
    `2>/dev/null | sed 's#^\\./##' | head -n ${FILE_INDEX_CAP}`
  );
}

export function parseFileList(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(".agent."));
}

/**
 * Rank paths against a query the way editors do: a basename prefix match beats a basename substring,
 * which beats a path substring; subsequence ("fuzzy") matches come last. Ties break on shorter path.
 */
export function matchFiles(paths: string[], query: string, limit = FILE_MATCH_LIMIT): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return paths.slice(0, limit);
  const scored: Array<[number, string]> = [];
  for (const p of paths) {
    const lower = p.toLowerCase();
    const base = lower.slice(lower.lastIndexOf("/") + 1);
    let score: number | null = null;
    if (base.startsWith(q)) score = 0;
    else if (base.includes(q)) score = 1;
    else if (lower.includes(q)) score = 2;
    else if (isSubsequence(q, lower)) score = 3;
    if (score !== null) scored.push([score * 10_000 + p.length, p]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  return scored.slice(0, limit).map(([, p]) => p);
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}

/** Cached per-box index reader; `exec` runs a shell command in the box and returns stdout. */
export function makeFileIndex(
  exec: (box: string, sh: string) => Promise<string>,
  opts: { ttlMs?: number; now?: () => number } = {}
): (box: string, query: string, limit?: number) => Promise<{ files: string[]; total: number; truncated: boolean }> {
  const ttl = opts.ttlMs ?? 20_000;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; paths: string[] }>();
  const inFlight = new Map<string, Promise<string[]>>();

  const index = async (box: string): Promise<string[]> => {
    const c = cache.get(box);
    if (c && now() - c.at < ttl) return c.paths;
    const pending = inFlight.get(box);
    if (pending) return pending;
    const p = exec(box, fileListCommand())
      .then((out) => {
        const paths = parseFileList(out);
        cache.set(box, { at: now(), paths });
        return paths;
      })
      .finally(() => inFlight.delete(box));
    inFlight.set(box, p);
    return p;
  };

  return async (box, query, limit) => {
    const paths = await index(box);
    return { files: matchFiles(paths, query, limit), total: paths.length, truncated: paths.length >= FILE_INDEX_CAP };
  };
}
