/**
 * What the boxes carry, and whether the world moved on. The baked image / snapshot writes a
 * manifest of the globally installed npm packages (`npm ls -g --depth=0 --json`, see
 * bakedManifestSh in msb.ts); every box reports it at task start, so the controller knows — without
 * reading a snapshot it cannot open — which MCP server packages are free (baked), which cost an
 * install per run, and which were left out of a run. Once a day the baked versions are compared to
 * the registry's `latest`, and the operator hears when a rebake is due, instead of a package
 * release quietly changing what boxes do (the 2026-10-26 incident: a new release of one server
 * pulled in a machine-learning runtime and the boxes stopped fitting).
 */

/** The `npm ls -g --depth=0 --json` shape → { name: version }. Tolerant of partial output. */
export function parseBakedManifest(json: string): Record<string, string> {
  const out: Record<string, string> = {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return out;
  }
  const deps = (parsed as { dependencies?: Record<string, { version?: string }> } | null)?.dependencies;
  if (!deps || typeof deps !== "object") return out;
  for (const [name, v] of Object.entries(deps)) {
    const ver = v && typeof v === "object" ? v.version : undefined;
    if (typeof ver === "string" && ver) out[name] = ver;
  }
  return out;
}

/** `@scope/name@1.2.3` → `@scope/name`; `name@latest` → `name`; a bare name stays. */
export function packageNameOf(spec: string): string {
  const s = spec.trim();
  const at = s.lastIndexOf("@");
  return at > 0 ? s.slice(0, at) : s;
}

export type Provision = "baked" | "per-run" | "dropped";

export interface LastProvision {
  at: number;
  box: string;
  skipped: string[];
  failed: string[];
  dropped: string[];
}

/**
 * How a server's package reaches a box: baked into the image, installed on every task start, or
 * left out of the last run (skipped for disk, or its install failed). A spec pinned to a version
 * other than the baked one counts as per-run — npm installs it over the baked copy.
 */
export function provisionOf(spec: string, baked: Record<string, string>, last: LastProvision | undefined): Provision {
  const name = packageNameOf(spec);
  if (last && [...last.dropped, ...last.skipped, ...last.failed].some((d) => d === spec || packageNameOf(d) === name)) return "dropped";
  const bakedVer = baked[name];
  if (!bakedVer) return "per-run";
  const at = spec.lastIndexOf("@");
  const wanted = at > 0 ? spec.slice(at + 1) : "";
  if (wanted && wanted !== "latest" && wanted !== bakedVer) return "per-run";
  return "baked";
}

export interface Outdated {
  name: string;
  baked: string;
  latest: string;
}

/** Baked packages whose registry `latest` differs. Unknown latest (fetch failed) is not "outdated". */
export function outdatedPackages(baked: Record<string, string>, latest: Record<string, string | undefined>, only?: readonly string[]): Outdated[] {
  const names = only ? only.map(packageNameOf) : Object.keys(baked);
  const out: Outdated[] = [];
  for (const name of names) {
    const b = baked[name];
    const l = latest[name];
    if (b && l && b !== l) out.push({ name, baked: b, latest: l });
  }
  return out;
}

/** `latest` of each package from the public registry; a failed lookup is undefined, never a throw. */
export async function fetchLatestVersions(
  names: readonly string[],
  fetchFn: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }> = (u) => fetch(u, { signal: AbortSignal.timeout(10_000) })
): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  await Promise.all(
    names.map(async (name) => {
      try {
        const r = await fetchFn(`https://registry.npmjs.org/${name.split("/").map(encodeURIComponent).join("/")}/latest`);
        if (!r.ok) return;
        const j = (await r.json()) as { version?: unknown };
        if (typeof j?.version === "string") out[name] = j.version;
      } catch {
        /* unknown */
      }
    })
  );
  return out;
}

/**
 * The MCP server packages every sandbox image carries, chosen for everyone who uses the service,
 * not for whoever runs it. Until 2026-11-11 the bake took the operator's own MCP list, so every
 * user's image carried three SAP servers (btp-mcp-server: 43 downloads a week on npm) that almost
 * nobody else runs. The rule now: a package is baked only if it is
 *
 *   - widely used (npm weekly downloads in the hundreds of thousands or more),
 *   - useful without an account or a key, or the bridge other servers need, and
 *   - small, and complete on its own inside the box.
 *
 * mcp-remote: the bridge that connects a box to remote (HTTP) MCP servers; most hosted servers
 *   (Linear, Sentry, Notion, Atlassian, Supabase) are reached through it or directly over HTTP,
 *   so they need nothing baked at all. ~1.9M downloads a week, 2.3M.
 * @upstash/context7-mcp: current library documentation for the agent; works without a key.
 *   ~1.1M a week, 240K.
 * @modelcontextprotocol/server-sequential-thinking: the reference reasoning server. ~280K a
 *   week, 28K.
 *
 * Left out on purpose: browser servers (@playwright/mcp, chrome-devtools-mcp) — they need a
 * browser that the image does not have, so baking the package alone ships something that cannot
 * start; filesystem/git servers — the agent already has file and shell tools in its own box;
 * servers that need the user's account (Notion, Supabase, Sentry, Figma, Firecrawl) — those
 * users install them per run in a few seconds, or use the hosted endpoint; deprecated reference
 * servers (server-github, server-postgres). Anything not baked still works: it is installed when
 * the task starts.
 */
export const BAKED_MCP_PACKAGES: readonly string[] = ["mcp-remote", "@upstash/context7-mcp", "@modelcontextprotocol/server-sequential-thinking"];

export const CLAUDE_CODE_PACKAGE = "@anthropic-ai/claude-code";
/** In the baked manifest but not ours to choose: they come with the base image's node. */
export const BASE_PACKAGES: ReadonlySet<string> = new Set(["npm", "corepack"]);

/**
 * How the image differs from what it should carry: a newer release of a package it has
 * (`baked` → `latest`), a package on the list it lacks (`baked` is ""), a package it carries that
 * is no longer on the list (`latest` is ""). Claude Code is compared like any baked package.
 * A package whose latest could not be looked up is left alone.
 */
export function imageChanges(baked: Readonly<Record<string, string>>, latest: Readonly<Record<string, string | undefined>>, list: readonly string[] = BAKED_MCP_PACKAGES): Outdated[] {
  const out: Outdated[] = [];
  const wanted = new Set(list.map(packageNameOf));
  for (const name of [CLAUDE_CODE_PACKAGE, ...wanted]) {
    const b = baked[name];
    const l = latest[name];
    if (!l) continue;
    if (!b) {
      if (name !== CLAUDE_CODE_PACKAGE) out.push({ name, baked: "", latest: l });
    } else if (b !== l) out.push({ name, baked: b, latest: l });
  }
  for (const [name, version] of Object.entries(baked)) {
    if (BASE_PACKAGES.has(name) || name === CLAUDE_CODE_PACKAGE || wanted.has(name)) continue;
    out.push({ name, baked: version, latest: "" });
  }
  return out;
}

/** One change in words: `context7-mcp added`, `btp-mcp-server removed`, `claude-code 1 → 2`. */
export function changeText(o: Outdated): string {
  return !o.baked ? `${o.name} ${o.latest} added` : !o.latest ? `${o.name} removed` : `${o.name} ${o.baked} → ${o.latest}`;
}

export function rebakeDueText(list: readonly Outdated[], publicUrl: string): string {
  const items = list.map(changeText).join(", ");
  // The alert ends where the fix is: the Fleet page's notice has the Update image button.
  const where = publicUrl ? ` Update it from ${publicUrl.replace(/\/+$/, "")}/dashboard/#/sandboxes` : " Update it from the Fleet page.";
  return `Sandbox image can be updated (${items}). Sandboxes keep what they have until the image is updated.${where}`;
}
