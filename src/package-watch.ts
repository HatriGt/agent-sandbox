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

export function rebakeDueText(list: readonly Outdated[], publicUrl: string): string {
  const items = list.map((o) => `${o.name} ${o.baked} → ${o.latest}`).join(", ");
  const where = publicUrl ? ` ${publicUrl.replace(/\/+$/, "")}/dashboard/#/mcp` : "";
  return `Rebake due: ${list.length === 1 ? "a baked MCP server package has" : `${list.length} baked MCP server packages have`} a newer release (${items}). Boxes keep the baked versions until the next bake.${where}`;
}
