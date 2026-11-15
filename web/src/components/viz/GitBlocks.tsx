import { cn } from "@/lib/utils";
import { FileMark } from "@/lib/fileIcon";
import type { Commit, DepUpdate, DiffStat } from "@/lib/viz-extra";
import { count, VizFrame } from "./VizFrame";
import { useRowEntrance } from "./motion";
import { Pill, type Tone } from "./tone";

/**
 * ```diffstat (auto-detected for `git diff --stat` in bare fences) → GitHub-style changeset:
 * file with icon, +adds/−dels in text, and a proportional green/red bar that grows from its right
 * anchor once, on the row's first paint.
 */
export function DiffstatBlock({ files, source }: { files: DiffStat[]; source: string }) {
  const max = Math.max(...files.map((f) => f.add + f.del), 1);
  const addTotal = files.reduce((a, f) => a + f.add, 0);
  const delTotal = files.reduce((a, f) => a + f.del, 0);
  const entrance = useRowEntrance(files.map((f) => f.path));
  return (
    <VizFrame
      title={`${count(files.length, "file")} changed`}
      source={source}
      actions={
        <span className="mr-1 text-micro font-medium tabular-nums">
          <span className="text-ok">+{addTotal}</span> <span className="text-destructive">−{delTotal}</span>
        </span>
      }
    >
      <ul className="m-0 max-h-80 list-none overflow-auto p-0 in-data-viz-fullscreen:max-h-(--viz-full)">
        {files.map((f, i) => {
          const total = f.add + f.del;
          const w = (total / max) * 96;
          const e = entrance(f.path);
          return (
            <li key={f.path} className={cn("flex items-center gap-2.5 px-4 py-1.5", i > 0 && "border-border/60 border-t", e.className)} style={e.style}>
              <FileMark path={f.path} />
              <span className="text-foreground min-w-0 flex-1 truncate font-mono text-micro">{f.path}</span>
              <span className="text-muted-foreground shrink-0 text-right text-micro tabular-nums">
                <span className="text-ok">+{f.add}</span> <span className="text-destructive">−{f.del}</span>
              </span>
              <span aria-hidden className={cn("flex h-1.5 w-24 shrink-0 origin-right justify-end gap-px overflow-hidden", e.className && "viz-grow-x")}>
                <span className="viz-tween-w rounded-l-full" style={{ width: total ? (w * f.add) / total : 0, background: "var(--ok)" }} />
                <span className="viz-tween-w rounded-r-full" style={{ width: total ? (w * f.del) / total : 0, background: "var(--destructive)" }} />
              </span>
            </li>
          );
        })}
      </ul>
    </VizFrame>
  );
}

/** ```commits (auto-detected for `git log --oneline`) → hash chips + messages, conventional-commit prefix tinted. */
export function CommitsBlock({ commits, source }: { commits: Commit[]; source: string }) {
  const entrance = useRowEntrance(commits.map((c, i) => `${i}|${c.hash}`));
  return (
    <VizFrame title={count(commits.length, "commit")} source={source}>
      <ul className="m-0 max-h-80 list-none overflow-auto p-0 in-data-viz-fullscreen:max-h-(--viz-full)">
        {commits.map((c, i) => {
          const m = c.message.match(/^(feat|fix|ux|docs|chore|refactor|perf|test|build|ci|style)(\([^)]*\))?(!)?:\s*(.*)$/);
          const e = entrance(`${i}|${c.hash}`);
          return (
            <li key={i} className={cn("flex items-baseline gap-2.5 px-4 py-2", i > 0 && "border-border/60 border-t", e.className)} style={e.style}>
              <code className="bg-muted text-muted-foreground shrink-0 rounded-md px-1.5 py-0.5 font-mono text-micro tabular-nums">{c.hash.slice(0, 7)}</code>
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
            </li>
          );
        })}
      </ul>
    </VizFrame>
  );
}

const JUMP_TONE: Record<DepUpdate["jump"], Tone> = { major: "fail", minor: "warn", patch: "ok", other: "neutral" };

/** ```deps → dependency upgrades with the semver jump named and toned (major = loudest). */
export function DepsBlock({ deps, source }: { deps: DepUpdate[]; source: string }) {
  const entrance = useRowEntrance(deps.map((d) => d.name));
  return (
    <VizFrame title={count(deps.length, "update")} source={source}>
      <ul className="m-0 max-h-80 list-none overflow-auto p-0 in-data-viz-fullscreen:max-h-(--viz-full)">
        {deps.map((d, i) => {
          const e = entrance(d.name);
          return (
            <li key={d.name} className={cn("flex items-center gap-3 px-4 py-2", i > 0 && "border-border/60 border-t", e.className)} style={e.style}>
              <span className="text-foreground min-w-0 flex-1 truncate font-mono text-micro">{d.name}</span>
              <span className="text-muted-foreground shrink-0 font-mono text-micro tabular-nums">
                {d.from} <span className="text-faint">→</span> <span className="text-foreground">{d.to}</span>
              </span>
              <Pill tone={JUMP_TONE[d.jump]} className="w-14 justify-center">
                {d.jump}
              </Pill>
            </li>
          );
        })}
      </ul>
    </VizFrame>
  );
}
