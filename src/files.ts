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

/** Directories never listed or searched, wherever they sit under /workspace. */
export const EXCLUDED_DIRS = ["node_modules", ".git", "dist", "build", ".next", "target", "__pycache__", ".venv", "venv"] as const;
/** File names (glob) never listed or searched: the controller's sentinels and generated noise. */
export const EXCLUDED_NAMES = [".agent.*", "*.lock", "*.log"] as const;

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** `find` predicates; `*` in -path crosses `/`, so one pattern per dir covers every depth. */
function findExclusions(): string {
  return [...EXCLUDED_DIRS.map((d) => `-not -path ${q(`*/${d}/*`)}`), ...EXCLUDED_NAMES.map((n) => `-not -name ${q(n)}`)].join(" ");
}

/** The `find` that produces the index: paths relative to /workspace, one per line. */
export function fileListCommand(): string {
  return `cd /workspace 2>/dev/null && find . -type f ${findExclusions()} 2>/dev/null | sed 's#^\\./##' | head -n ${FILE_INDEX_CAP}`;
}

/** Like fileListCommand but with size and mtime per line: `<bytes> TAB <epoch> TAB <path>`.
 *  -printf stays AFTER the exclusion predicates so it only fires on kept files; %P is the path
 *  relative to the search root, so no sed cleanup is needed. */
export function fileDetailsCommand(): string {
  return `cd /workspace 2>/dev/null && find . -type f ${findExclusions()} -printf '%s\\t%T@\\t%P\\n' 2>/dev/null | head -n ${FILE_INDEX_CAP}`;
}

/** Most matching lines one search returns; the command fetches one more to learn it was cut. */
export const SEARCH_LINE_CAP = 500;

export interface SearchMatch {
  path: string;
  /** 1-based. */
  line: number;
  text: string;
}

const GREP_EXIT_MARK = "__GREP_EXIT=";

/**
 * Content search under /workspace. The pattern arrives on stdin (`-f -`), never in argv, so no
 * byte of it is shell-quoted; -Z puts a NUL after the path so a path containing ':' still parses.
 * `head` caps the output and kills grep early through SIGPIPE, which also makes the pipeline's
 * status head's; grep's own status therefore travels on stderr as a marker (searchExitStatus).
 */
export function searchCommand(opts: { regex: boolean; caseSensitive: boolean }): string {
  const flags = ["-rnIZ", "--color=never", ...(opts.caseSensitive ? [] : ["-i"]), opts.regex ? "-E" : "-F"];
  const excludes = [...EXCLUDED_DIRS.map((d) => `--exclude-dir=${q(d)}`), ...EXCLUDED_NAMES.map((n) => `--exclude=${q(n)}`)];
  return `cd /workspace 2>/dev/null && { grep ${flags.join(" ")} ${excludes.join(" ")} -f - .; echo "${GREP_EXIT_MARK}$?" >&2; } | head -n ${SEARCH_LINE_CAP + 1}`;
}

/** grep's exit status from the command's stderr (0 matched, 1 nothing matched, 2 error); null when the marker is missing. */
export function searchExitStatus(stderr: string): number | null {
  const m = stderr.match(/__GREP_EXIT=(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

/** The stderr a user may see: grep's messages without the status marker. */
export function searchStderr(stderr: string): string {
  return stderr.replace(/__GREP_EXIT=\d+\s*$/, "").trim();
}

/** `path\0line:text` lines → matches, capped at SEARCH_LINE_CAP; `truncated` when more were present. */
export function parseSearchOutput(stdout: string): { matches: SearchMatch[]; truncated: boolean } {
  const matches: SearchMatch[] = [];
  for (const raw of stdout.split("\n")) {
    const nul = raw.indexOf("\0");
    if (nul < 0) continue;
    const rest = raw.slice(nul + 1);
    const colon = rest.indexOf(":");
    const line = colon > 0 ? Number(rest.slice(0, colon)) : Number.NaN;
    if (!Number.isInteger(line)) continue;
    const path = raw.slice(0, nul).replace(/^\.\//, "");
    matches.push({ path, line, text: rest.slice(colon + 1).replace(/\r$/, "") });
  }
  return { matches: matches.slice(0, SEARCH_LINE_CAP), truncated: matches.length > SEARCH_LINE_CAP };
}

export interface FileDetail {
  path: string;
  bytes: number;
  /** Unix seconds. */
  mtime: number;
}

export function parseFileDetails(stdout: string): FileDetail[] {
  const out: FileDetail[] = [];
  for (const l of stdout.split("\n")) {
    const m = l.match(/^(\d+)\t(\d+)(?:\.\d+)?\t(.+)$/);
    if (!m) continue;
    const path = m[3].trim();
    if (!path || path.startsWith(".agent.")) continue;
    out.push({ path, bytes: Number(m[1]), mtime: Number(m[2]) });
  }
  return out;
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
export interface FileIndex {
  (box: string, query: string, limit?: number): Promise<{ files: string[]; total: number; truncated: boolean }>;
  /** Forget the box's listing (and any `find` still running for it) after a mutation under /workspace. */
  invalidate(box: string): void;
}

export function makeFileIndex(exec: (box: string, sh: string) => Promise<string>, opts: { ttlMs?: number; now?: () => number } = {}): FileIndex {
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
        // A `find` that started before an invalidate saw the old tree: hand it to its callers, cache nothing.
        if (inFlight.get(box) === p) cache.set(box, { at: now(), paths });
        return paths;
      })
      .finally(() => {
        if (inFlight.get(box) === p) inFlight.delete(box);
      });
    inFlight.set(box, p);
    return p;
  };

  const read: FileIndex = async (box, query, limit) => {
    const paths = await index(box);
    return { files: matchFiles(paths, query, limit), total: paths.length, truncated: paths.length >= FILE_INDEX_CAP };
  };
  read.invalidate = (box) => {
    cache.delete(box);
    inFlight.delete(box);
  };
  return read;
}
