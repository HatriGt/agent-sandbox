import type * as React from "react";
import { cn } from "@/lib/utils";
import { FileMark } from "@/lib/fileIcon";
import type { Commit, DepUpdate, DiffStat } from "@/lib/viz-extra";
import { VizFrame } from "./VizFrame";

/**
 * ```diffstat (auto-detected for `git diff --stat` in bare fences) → GitHub-style changeset:
 * file with icon, +adds/−dels in text, and a proportional green/red bar.
 */
export function DiffstatBlock({ files, source }: { files: DiffStat[]; source: string }) {
  const max = Math.max(...files.map((f) => f.add + f.del), 1);
  const addTotal = files.reduce((a, f) => a + f.add, 0);
  const delTotal = files.reduce((a, f) => a + f.del, 0);
  return (
    <VizFrame
      title={`${files.length} ${files.length === 1 ? "file" : "files"} changed`}
      source={source}
      actions={
        <span className="mr-1 text-micro font-medium tabular-nums">
          <span className="text-ok">+{addTotal}</span> <span className="text-destructive">−{delTotal}</span>
        </span>
      }
    >
      <div className="max-h-80 overflow-auto px-3 py-1.5">
        {files.map((f) => {
          const total = f.add + f.del;
          const w = (total / max) * 96;
          return (
            <div key={f.path} className="flex items-center gap-2 py-1">
              <FileMark path={f.path} />
              <span className="text-foreground min-w-0 flex-1 truncate font-mono text-micro">{f.path}</span>
              <span className="text-muted-foreground shrink-0 text-right text-micro tabular-nums">
                <span className="text-ok">+{f.add}</span> <span className="text-destructive">−{f.del}</span>
              </span>
              <span aria-hidden className="flex h-1.5 w-24 shrink-0 justify-end gap-px overflow-hidden">
                <span className="rounded-l-full" style={{ width: total ? (w * f.add) / total : 0, background: "var(--ok)" }} />
                <span className="rounded-r-full" style={{ width: total ? (w * f.del) / total : 0, background: "var(--destructive)" }} />
              </span>
            </div>
          );
        })}
      </div>
    </VizFrame>
  );
}

/** ```commits (auto-detected for `git log --oneline`) → hash chips + messages, conventional-commit prefix tinted. */
export function CommitsBlock({ commits, source }: { commits: Commit[]; source: string }) {
  return (
    <VizFrame title={`${commits.length} ${commits.length === 1 ? "commit" : "commits"}`} source={source}>
      <div className="max-h-80 overflow-auto px-3 py-1.5">
        {commits.map((c, i) => {
          const m = c.message.match(/^(feat|fix|ux|docs|chore|refactor|perf|test|build|ci|style)(\([^)]*\))?(!)?:\s*(.*)$/);
          return (
            <div key={i} className="border-border/50 stagger-item flex items-baseline gap-2.5 border-b py-1.5 last:border-0" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
              <code className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-micro">{c.hash.slice(0, 7)}</code>
              <span className="text-foreground min-w-0 truncate text-meta">
                {m ? (
                  <>
                    <span className={cn("font-medium", m[1] === "fix" ? "text-attention-text" : m[1] === "feat" ? "text-ok" : "text-muted-foreground")}>
                      {m[1]}
                      {m[2] ?? ""}
                      {m[3] ?? ""}:
                    </span>{" "}
                    {m[4]}
                  </>
                ) : (
                  c.message
                )}
              </span>
            </div>
          );
        })}
      </div>
    </VizFrame>
  );
}

/** ```deps → dependency upgrades with the semver jump named and toned (major = loudest). */
export function DepsBlock({ deps, source }: { deps: DepUpdate[]; source: string }) {
  return (
    <VizFrame title={`${deps.length} ${deps.length === 1 ? "update" : "updates"}`} source={source}>
      <div className="max-h-80 overflow-auto px-3 py-1.5">
        {deps.map((d) => (
          <div key={d.name} className="border-border/50 flex items-center gap-3 border-b py-1.5 last:border-0">
            <span className="text-foreground min-w-0 flex-1 truncate font-mono text-micro">{d.name}</span>
            <span className="text-muted-foreground shrink-0 font-mono text-micro tabular-nums">
              {d.from} <span className="text-faint">→</span> <span className="text-foreground">{d.to}</span>
            </span>
            <span
              className={cn(
                "w-14 shrink-0 rounded-full border px-1.5 py-0.5 text-center text-micro font-medium",
                d.jump === "major" && "border-destructive/40 text-destructive",
                d.jump === "minor" && "border-attention/60 text-attention-text",
                d.jump === "patch" && "border-ok/40 text-ok",
                d.jump === "other" && "text-muted-foreground"
              )}
            >
              {d.jump}
            </span>
          </div>
        ))}
      </div>
    </VizFrame>
  );
}
