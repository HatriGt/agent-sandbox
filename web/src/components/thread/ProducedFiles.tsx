import * as React from "react";
import { ChevronRight, Download, FileText, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { ProducedFile } from "@/lib/trace";
import { Markdown } from "@/components/ui/markdown";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
import { cn } from "@/lib/utils";

/**
 * The files the agent produced this run, surfaced as downloadable artifact cards.
 *
 * Each card shows the filename with View (inline preview — markdown rendered as markdown, everything
 * else highlighted as code) and Download (a real browser download via the token-guarded /artifact
 * endpoint). Preview text is fetched lazily on first expand and cached, so opening a card once and
 * re-opening it doesn't re-hit the box. If the box has been torn down the fetch 404s and the card
 * shows a calm "no longer available" line instead of crashing the thread.
 */
export function ProducedFiles({ session, files }: { session: string; files: ProducedFile[] }) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="stamp text-muted-foreground">{files.length === 1 ? "produced file" : "produced files"}</span>
      <div className="flex flex-col gap-2">
        {files.map((f) => (
          <ArtifactCard key={f.relPath} session={session} file={f} />
        ))}
      </div>
    </div>
  );
}

/** Extension → the language hint CodeBlockCode understands (falls back to plaintext). */
function languageOf(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return ext || "plaintext";
}

/** Markdown files render through the Markdown renderer; everything else through the code highlighter. */
function isMarkdown(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

type Load =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; text: string }
  | { state: "error"; message: string; gone: boolean };

function ArtifactCard({ session, file }: { session: string; file: ProducedFile }) {
  const [open, setOpen] = React.useState(false);
  const [load, setLoad] = React.useState<Load>({ state: "idle" });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Fetch the preview on first expand only; cache it for subsequent toggles.
    if (next && load.state === "idle") {
      setLoad({ state: "loading" });
      api
        .artifactText(session, file.relPath)
        .then((text) => setLoad({ state: "ready", text }))
        .catch((e) => {
          const gone = e instanceof ApiError && e.status === 404;
          const message = gone ? "This file is no longer available (the machine was torn down)." : errorText(e);
          setLoad({ state: "error", message, gone });
        });
    }
  };

  return (
    <div className="border-border bg-card overflow-hidden rounded-xl border">
      <div className="flex items-center gap-2 px-3 py-2">
        <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <span className="text-foreground min-w-0 flex-1 truncate font-mono text-meta">{file.name}</span>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="text-muted-foreground hover:text-foreground hover:bg-muted flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-meta transition-colors"
        >
          {load.state === "loading" ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} aria-hidden />
          )}
          <span>{open ? "hide" : "view"}</span>
        </button>
        <a
          href={api.artifactUrl(session, file.relPath)}
          download={file.name}
          className="text-muted-foreground hover:text-foreground hover:bg-muted flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-meta transition-colors"
        >
          <Download className="size-3.5" aria-hidden />
          <span>download</span>
        </a>
      </div>

      {open && (
        <div className="border-border/60 border-t">
          {load.state === "ready" ? (
            isMarkdown(file.name) ? (
              <div className="prose-agent text-foreground max-h-96 overflow-auto px-4 py-3">
                <Markdown>{load.text}</Markdown>
              </div>
            ) : (
              <CodeBlock className="max-h-96 overflow-auto rounded-none border-0">
                <CodeBlockCode code={load.text} language={languageOf(file.name)} />
              </CodeBlock>
            )
          ) : load.state === "error" ? (
            <p className="text-muted-foreground px-4 py-3 text-meta">{load.message}</p>
          ) : (
            <p className="text-muted-foreground px-4 py-3 text-meta">Loading preview…</p>
          )}
        </div>
      )}
    </div>
  );
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : "Could not load this file.";
}
