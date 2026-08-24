/**
 * Serve a file the agent produced inside a box's `/workspace`.
 *
 * SECURITY POSTURE: the dashboard token can spawn VMs, so a path parameter that reaches a shell is
 * hostile input. Confinement is defence-in-depth, in two layers:
 *
 *  1. `safeWorkspacePath` (pure, unit-tested) rejects the obvious escapes BEFORE anything touches the
 *     box: absolute paths, `..` traversal, NUL bytes, and over-long names. It returns a normalized
 *     path relative to `/workspace`.
 *  2. The remote read then resolves the REAL path on the box (`realpath`) and re-checks that it is
 *     still under `/workspace/` — this catches a symlink inside the workspace that points out (a
 *     check the pure layer cannot do because it doesn't know the box's filesystem). It also verifies
 *     the target is a regular file and within the size cap before emitting a single byte.
 *
 * The file is read as base64 over the existing multiplexed SSH `exec` channel (same mechanism
 * `gatherWatch` uses to read `.agent.log`) so binary content survives transport and no unbounded
 * process is spawned. The token and file contents are never logged.
 */
import type { Config } from "./config.js";
import { exec } from "./msb.js";
import { shellQuote } from "./exec.js";

/** The only directory a produced-file read may resolve inside. */
export const WORKSPACE_ROOT = "/workspace";
/** Hard cap on a served artifact. Beyond this the read returns a `too-large` error, not bytes. */
export const ARTIFACT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ArtifactResult {
  /** The confined path that was read, relative to /workspace (e.g. "report.md"). */
  relPath: string;
  /** Raw file bytes. */
  data: Buffer;
  /** Best-guess content type from the extension (never text/html). */
  contentType: string;
  /** True when the type is safe to render inline (text-ish); else force download. */
  inlineSafe: boolean;
}

export type ArtifactError =
  | { error: "bad-path"; message: string }
  | { error: "not-found"; message: string }
  | { error: "not-file"; message: string }
  | { error: "too-large"; message: string }
  | { error: "read-failed"; message: string };

/**
 * Validate a caller-supplied path and return it normalized relative to /workspace, or an error.
 *
 * Pure — no filesystem, no box. Accepts either a bare relative path ("report.md", "out/a.txt") or an
 * absolute path that is literally under /workspace ("/workspace/report.md"). Everything else — a
 * different absolute root, any `..` segment, a NUL byte, an empty or over-long path — is rejected.
 */
export function safeWorkspacePath(input: string): { ok: true; relPath: string } | { ok: false; message: string } {
  if (typeof input !== "string" || input.length === 0) return { ok: false, message: "path is required" };
  if (input.length > 1024) return { ok: false, message: "path too long" };
  if (input.includes("\0")) return { ok: false, message: "path contains a null byte" };

  // Normalise an absolute /workspace path down to its relative tail; reject any other absolute root.
  let rel = input;
  if (rel.startsWith("/")) {
    const prefix = WORKSPACE_ROOT + "/";
    if (rel === WORKSPACE_ROOT) return { ok: false, message: "path is a directory" };
    if (!rel.startsWith(prefix)) return { ok: false, message: "path escapes the workspace" };
    rel = rel.slice(prefix.length);
  }

  // Split and walk the segments; a single `..` (or `.` that could be abused) is a hard reject rather
  // than something we try to resolve — the whole point is to never let the read leave /workspace.
  const segments = rel.split("/");
  const clean: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue; // collapse // and ./ noise
    if (seg === "..") return { ok: false, message: "path traversal is not allowed" };
    clean.push(seg);
  }
  if (clean.length === 0) return { ok: false, message: "path is empty after normalisation" };
  return { ok: true, relPath: clean.join("/") };
}

/** Extension → (content-type, inline-safe). Deliberately conservative: unknown ⇒ download-only. */
const TYPES: Record<string, { ct: string; inline: boolean }> = {
  md: { ct: "text/markdown; charset=utf-8", inline: true },
  markdown: { ct: "text/markdown; charset=utf-8", inline: true },
  txt: { ct: "text/plain; charset=utf-8", inline: true },
  log: { ct: "text/plain; charset=utf-8", inline: true },
  json: { ct: "application/json; charset=utf-8", inline: true },
  yaml: { ct: "text/plain; charset=utf-8", inline: true },
  yml: { ct: "text/plain; charset=utf-8", inline: true },
  csv: { ct: "text/plain; charset=utf-8", inline: true },
  ts: { ct: "text/plain; charset=utf-8", inline: true },
  tsx: { ct: "text/plain; charset=utf-8", inline: true },
  js: { ct: "text/plain; charset=utf-8", inline: true },
  jsx: { ct: "text/plain; charset=utf-8", inline: true },
  py: { ct: "text/plain; charset=utf-8", inline: true },
  sh: { ct: "text/plain; charset=utf-8", inline: true },
  rs: { ct: "text/plain; charset=utf-8", inline: true },
  go: { ct: "text/plain; charset=utf-8", inline: true },
  toml: { ct: "text/plain; charset=utf-8", inline: true },
  png: { ct: "image/png", inline: false },
  jpg: { ct: "image/jpeg", inline: false },
  jpeg: { ct: "image/jpeg", inline: false },
  gif: { ct: "image/gif", inline: false },
  pdf: { ct: "application/pdf", inline: false },
};

/**
 * Classify a filename's content type. Never returns text/html (an .html artifact is served as
 * text/plain download so it can't execute as a page against our origin).
 */
export function classifyContentType(relPath: string): { contentType: string; inlineSafe: boolean } {
  const dot = relPath.lastIndexOf(".");
  const ext = dot >= 0 ? relPath.slice(dot + 1).toLowerCase() : "";
  const hit = TYPES[ext];
  if (hit) return { contentType: hit.ct, inlineSafe: hit.inline };
  // Unknown / .html / anything else: safe default, download-only.
  return { contentType: "application/octet-stream", inlineSafe: false };
}

/**
 * Read a produced file out of a box, with the on-box realpath/regular-file/size checks.
 *
 * The remote script prints one of a few sentinel lines on rejection (so we never emit partial or
 * wrong-target bytes), else `OK <size>` followed by the base64 of the file. Using base64 keeps
 * binary intact and avoids any shell mangling of the payload.
 */
export async function readArtifact(cfg: Config, box: string, inputPath: string): Promise<ArtifactResult | ArtifactError> {
  const safe = safeWorkspacePath(inputPath);
  if (!safe.ok) return { error: "bad-path", message: safe.message };

  const abs = `${WORKSPACE_ROOT}/${safe.relPath}`;
  // Build the remote guard as a single command. `f` is the quoted absolute path; `root` the quoted
  // workspace root. We resolve the real path, ensure it is the root or under root/, ensure it's a
  // regular file, check size, then base64 it. Each failure prints a distinct sentinel.
  const f = shellQuote(abs);
  const root = shellQuote(WORKSPACE_ROOT);
  const cap = ARTIFACT_MAX_BYTES;
  const remote =
    `f=${f}; root=${root}; ` +
    // realpath -e fails if the path doesn't exist; on failure -> NOTFOUND.
    `rp=$(realpath -e "$f" 2>/dev/null) || { echo __ASB_NOTFOUND__; exit 0; }; ` +
    // Symlink-escape / traversal defence: the RESOLVED path must be root itself or under root/.
    `case "$rp/" in "$root"/*) : ;; *) echo __ASB_ESCAPE__; exit 0;; esac; ` +
    // Must be a regular file (not a dir, device, socket…).
    `[ -f "$rp" ] || { echo __ASB_NOTFILE__; exit 0; }; ` +
    // Size cap before reading the bytes.
    `sz=$(wc -c < "$rp" 2>/dev/null || echo -1); ` +
    `if [ "$sz" -lt 0 ]; then echo __ASB_READFAIL__; exit 0; fi; ` +
    `if [ "$sz" -gt ${cap} ]; then echo __ASB_TOOLARGE__ "$sz"; exit 0; fi; ` +
    // Emit header then base64 payload. base64 (coreutils/busybox) is present in the node image.
    `echo __ASB_OK__ "$sz"; base64 "$rp"`;

  let out: string;
  try {
    const r = await exec(cfg, box, remote);
    out = r.stdout;
  } catch (e) {
    return { error: "read-failed", message: String((e as Error).message ?? e) };
  }

  const firstNl = out.indexOf("\n");
  const header = (firstNl >= 0 ? out.slice(0, firstNl) : out).trim();
  const body = firstNl >= 0 ? out.slice(firstNl + 1) : "";

  if (header.startsWith("__ASB_NOTFOUND__")) return { error: "not-found", message: "file not found" };
  if (header.startsWith("__ASB_ESCAPE__")) return { error: "bad-path", message: "path escapes the workspace" };
  if (header.startsWith("__ASB_NOTFILE__")) return { error: "not-file", message: "not a regular file" };
  if (header.startsWith("__ASB_TOOLARGE__")) return { error: "too-large", message: "file exceeds the size cap" };
  if (header.startsWith("__ASB_READFAIL__")) return { error: "read-failed", message: "could not read the file" };
  if (!header.startsWith("__ASB_OK__")) return { error: "read-failed", message: "unexpected reader output" };

  const data = Buffer.from(body.replace(/\s+/g, ""), "base64");
  const { contentType, inlineSafe } = classifyContentType(safe.relPath);
  return { relPath: safe.relPath, data, contentType, inlineSafe };
}
