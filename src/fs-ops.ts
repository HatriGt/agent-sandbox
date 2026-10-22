import { safeWorkspacePath } from "./artifact.js";
import { shellQuote } from "./exec.js";

/** A path already confined by safeWorkspacePath, relative to /workspace. */
export type RelPath = string & { readonly __relPath: true };

export type FsOp = { op: "create" | "mkdir" | "delete"; path: string } | { op: "move" | "copy"; path: string; to: string };
export type SafeFsOp = { op: "create" | "mkdir" | "delete"; path: RelPath } | { op: "move" | "copy"; path: RelPath; to: RelPath };

export type FsRefusal = { ok: false; status: 400 | 409; message: string };

const OPS = new Set<FsOp["op"]>(["create", "mkdir", "delete", "move", "copy"]);

const EXIT = { otherKind: 3, missing: 4, targetExists: 5 } as const;

const isRepoRoot = (rel: RelPath) => !rel.includes("/");

export function confineFsOp(body: unknown): { ok: true; op: SafeFsOp } | FsRefusal {
  const b = (body ?? {}) as { op?: unknown; path?: unknown; to?: unknown };
  if (typeof b.op !== "string" || !OPS.has(b.op as FsOp["op"])) return { ok: false, status: 400, message: "op must be create | mkdir | delete | move | copy" };
  const op = b.op as FsOp["op"];
  const path = safeWorkspacePath(b.path as string);
  if (!path.ok) return { ok: false, status: 400, message: path.message };
  const rel = path.relPath as RelPath;
  if ((op === "delete" || op === "move") && isRepoRoot(rel)) return { ok: false, status: 409, message: "a repository root cannot be deleted or moved" };
  if (op === "create" || op === "mkdir" || op === "delete") return { ok: true, op: { op, path: rel } };
  const to = safeWorkspacePath(b.to as string);
  if (!to.ok) return { ok: false, status: 400, message: `to: ${to.message}` };
  const toRel = to.relPath as RelPath;
  if (toRel === rel) return { ok: false, status: 400, message: "source and target are the same path" };
  if (toRel.startsWith(`${rel}/`)) return { ok: false, status: 400, message: "target is inside the source" };
  return { ok: true, op: { op, path: rel, to: toRel } };
}

const abs = (rel: RelPath) => shellQuote(`/workspace/${rel}`);
const parentOf = (rel: RelPath) => shellQuote(`/workspace/${rel}`.replace(/\/[^/]*$/, ""));

export function fsCommand(op: SafeFsOp): string {
  const p = abs(op.path);
  switch (op.op) {
    case "create":
      return `if [ -d ${p} ]; then exit ${EXIT.otherKind}; elif [ ! -e ${p} ]; then mkdir -p ${parentOf(op.path)} && : > ${p}; fi`;
    case "mkdir":
      return `if [ -e ${p} ] && [ ! -d ${p} ]; then exit ${EXIT.otherKind}; else mkdir -p ${p}; fi`;
    case "delete":
      return `rm -rf -- ${p}`;
    case "move":
    case "copy": {
      const t = abs(op.to);
      const verb = op.op === "move" ? "mv --" : "cp -r --";
      return `{ [ -e ${p} ] || [ -L ${p} ]; } || exit ${EXIT.missing}; [ -e ${t} ] && exit ${EXIT.targetExists}; mkdir -p ${parentOf(op.to)} && ${verb} ${p} ${t}`;
    }
  }
}

export function exitCodeOf(e: unknown): number | null {
  const m = String((e as Error)?.message ?? e).match(/^Command failed \((\d+)\)/);
  return m ? Number(m[1]) : null;
}

export function fsFailure(code: number | null): { status: 404 | 409; message: string } | null {
  if (code === EXIT.otherKind) return { status: 409, message: "already exists" };
  if (code === EXIT.missing) return { status: 404, message: "no such file or folder" };
  if (code === EXIT.targetExists) return { status: 409, message: "target exists" };
  return null;
}
