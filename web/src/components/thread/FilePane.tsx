import * as React from "react";
import { Download, FileCode2, FileDiff, Loader2, X } from "lucide-react";
import { motion } from "motion/react";
import { api, ApiError, type ChangedFile } from "@/lib/api";
import { parseUnifiedDiff, diffForNewFile, type ParsedDiff } from "@/lib/diff";
import { FileMark, languageOf } from "@/lib/fileIcon";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
import { Markdown } from "@/components/ui/markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The file pane — a VS Code-style side panel for one file from the sandbox: its diff against HEAD
 * (two gutters, coloured lines, per-hunk headers) or its full content with syntax highlighting.
 * Fetched lazily and cached per (session, path); download via the token-guarded artifact route.
 */
export function FilePane({ session, file, onClose }: { session: string; file: ChangedFile; onClose: () => void }) {
  const [tab, setTab] = React.useState<"diff" | "file">(file.status === "deleted" ? "diff" : "diff");
  const [diff, setDiff] = React.useState<ParsedDiff | null>(null);
  const [content, setContent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setDiff(null);
    setContent(null);
    setError(null);
    setTab(file.status === "modified" || file.status === "renamed" || file.status === "deleted" ? "diff" : "file");
  }, [session, file.path, file.status]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        if (tab === "diff") {
          if (diff) return;
          const d = await api.diff(session, file.path);
          if (cancelled) return;
          if (d.untracked) {
            const text = content ?? (await api.artifactText(session, file.path));
            if (cancelled) return;
            setContent(text);
            setDiff(diffForNewFile(text));
          } else setDiff(parseUnifiedDiff(d.diff));
        } else {
          if (content !== null) return;
          const text = await api.artifactText(session, file.path);
          if (!cancelled) setContent(text);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError && e.status === 404 ? "This file is no longer available in the sandbox." : e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, file.path, tab]);

  const download = async () => {
    try {
      const blob = await api.artifactBlob(session, file.path);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = file.path.slice(file.path.lastIndexOf("/") + 1);
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const base = file.path.slice(file.path.lastIndexOf("/") + 1);
  const dir = file.path.slice(0, Math.max(0, file.path.lastIndexOf("/")));
  const isMd = /\.(md|markdown)$/i.test(base);

  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="bg-card absolute inset-0 z-20 flex min-w-0 flex-col md:relative md:inset-auto md:h-full md:w-[46%] md:min-w-[26rem] md:border-l"
      aria-label={`File ${file.path}`}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <FileMark path={file.path} />
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate font-mono text-meta font-medium">{base}</p>
          {dir && <p className="stamp text-muted-foreground truncate">{dir}</p>}
        </div>
        <span className="stamp flex shrink-0 items-center gap-1.5">
          {file.additions > 0 && <span className="text-ok">+{file.additions}</span>}
          {file.deletions > 0 && <span className="text-destructive">−{file.deletions}</span>}
        </span>
        <div role="tablist" className="bg-muted ml-2 inline-flex h-7 items-center gap-0.5 rounded-md p-0.5">
          <Tab active={tab === "diff"} onClick={() => setTab("diff")} icon={<FileDiff className="size-3.5" />} label="Diff" />
          <Tab active={tab === "file"} onClick={() => setTab("file")} icon={<FileCode2 className="size-3.5" />} label="File" disabled={file.status === "deleted"} />
        </div>
        <Button variant="ghost" size="icon-sm" onClick={download} aria-label="Download" disabled={file.status === "deleted"}>
          <Download />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close file pane">
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="text-muted-foreground px-4 py-6 text-meta">{error}</p>
        ) : loading && ((tab === "diff" && !diff) || (tab === "file" && content === null)) ? (
          <p className="text-muted-foreground flex items-center gap-2 px-4 py-6 text-meta">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading {tab === "diff" ? "diff" : "file"}…
          </p>
        ) : tab === "diff" && diff ? (
          <DiffView diff={diff} path={file.path} />
        ) : tab === "file" && content !== null ? (
          isMd ? (
            <div className="prose-agent text-foreground px-5 py-4">
              <Markdown>{content}</Markdown>
            </div>
          ) : (
            <CodeBlock className="my-0 rounded-none border-0 shadow-none">
              <CodeBlockCode code={content} language={languageOf(file.path)} />
            </CodeBlock>
          )
        ) : null}
      </div>
    </motion.aside>
  );
}

function Tab({ active, onClick, icon, label, disabled }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-6 cursor-pointer items-center gap-1 rounded px-2 text-micro font-medium disabled:cursor-not-allowed disabled:opacity-40",
        active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Two-gutter unified diff: old/new line numbers, +/- rows tinted, hunk headers as dividers. */
export function DiffView({ diff, path }: { diff: ParsedDiff; path: string }) {
  if (diff.binary) return <p className="text-muted-foreground px-4 py-6 text-meta">Binary file — no textual diff.</p>;
  if (!diff.hunks.length) return <p className="text-muted-foreground px-4 py-6 text-meta">No differences against HEAD for {path}.</p>;
  return (
    <div className="font-mono text-micro leading-[1.6]">
      {diff.hunks.map((h, i) => (
        <div key={i}>
          <div className="bg-muted/60 text-muted-foreground sticky top-0 flex items-center gap-2 border-y px-3 py-1 backdrop-blur">
            <span className="text-live">@@</span>
            <span className="truncate">{h.header || "…"}</span>
          </div>
          {h.lines.map((l, j) => (
            <div
              key={j}
              className={cn(
                "grid grid-cols-[3rem_3rem_1ch_1fr] items-start",
                l.kind === "add" && "bg-ok/10",
                l.kind === "del" && "bg-destructive/10",
                l.kind === "meta" && "text-muted-foreground italic"
              )}
            >
              <span className="text-muted-foreground/60 select-none px-2 text-right tabular">{l.oldNo ?? ""}</span>
              <span className="text-muted-foreground/60 select-none px-2 text-right tabular">{l.newNo ?? ""}</span>
              <span className={cn("select-none", l.kind === "add" ? "text-ok" : l.kind === "del" ? "text-destructive" : "text-transparent")}>
                {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
              </span>
              <span className="text-foreground/90 pr-4 whitespace-pre">{l.text || " "}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
