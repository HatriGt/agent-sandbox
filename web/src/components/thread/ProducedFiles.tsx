import * as React from "react";
import { ChevronRight, Download, FolderOpen, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { ProducedFile } from "@/lib/trace";
import { Markdown } from "@/components/ui/markdown";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
import { Collapse } from "@/components/ui/collapse";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { cn } from "@/lib/utils";
import { FileIcon } from "@/lib/iconTheme";
import { languageOf } from "@/lib/fileIcon";
import { CodeNavContext } from "@/components/ui/code-ref";

/**
 * The files the agent produced this run, surfaced as downloadable artifact cards.
 *
 * Each card shows the file with Preview (markdown rendered as markdown, a picture as a picture,
 * everything else highlighted as code in its own language), Open in the Files pane and
 * Download (a real browser download via the token-guarded /artifact endpoint). Preview text is fetched lazily on first expand and cached, so opening a card once and
 * re-opening it doesn't re-hit the box. If the box has been torn down the fetch 404s and the card
 * shows a calm "no longer available" line instead of crashing the thread.
 */
export function ProducedFiles({ session, files }: { session: string; files: ProducedFile[] }) {
  const still = useReducedMotion();
  if (files.length === 0) return null;
  return (
    // The block arrives when the run settles (null until then), so it rises in rather than popping.
    <motion.div
      initial={still ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: still ? 0.12 : 0.26, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-2"
    >
      <span className="label text-muted-foreground">{files.length === 1 ? "Produced file" : "Produced files"}</span>
      <div className="flex flex-col gap-2">
        {files.map((f, i) => (
          <motion.div
            key={f.relPath}
            initial={still ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.05 + Math.min(i, 8) * 0.03, ease: [0.22, 1, 0.36, 1] }}
          >
            <ArtifactCard session={session} file={f} />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

/** Pictures preview as pictures (an SVG too: an <img> runs none of its scripts). */
function isImage(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name);
}

const ACTION = "text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-meta transition-colors focus-visible:ring-2 focus-visible:outline-none";

/** Markdown files render through the Markdown renderer; everything else through the code highlighter. */
function isMarkdown(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

type Load =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; text: string; image?: string }
  | { state: "error"; message: string; gone: boolean };

function ArtifactCard({ session, file }: { session: string; file: ProducedFile }) {
  const [open, setOpen] = React.useState(false);
  const [load, setLoad] = React.useState<Load>({ state: "idle" });
  const openRef = React.useContext(CodeNavContext);
  const image = isImage(file.name);
  const slash = file.relPath.lastIndexOf("/");
  const dir = slash > 0 ? file.relPath.slice(0, slash) : "";
  const imageUrl = load.state === "ready" ? load.image : undefined;
  React.useEffect(() => () => void (imageUrl && URL.revokeObjectURL(imageUrl)), [imageUrl]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Fetch the preview on first expand only; cache it for subsequent toggles.
    if (next && load.state === "idle") {
      setLoad({ state: "loading" });
      (image ? api.artifactBlob(session, file.relPath).then((b) => ({ text: "", image: URL.createObjectURL(b) })) : api.artifactText(session, file.relPath).then((text) => ({ text })))
        .then((r) => setLoad({ state: "ready", ...r }))
        .catch((e) => {
          const gone = e instanceof ApiError && e.status === 404;
          const message = gone ? "This file is no longer available (the machine was torn down)." : errorText(e);
          setLoad({ state: "error", message, gone });
        });
    }
  };

  return (
    <div className="border-border bg-card overflow-hidden rounded-xl border">
      <div className="flex items-center gap-1 py-1.5 pr-1.5 pl-1.5">
        <button type="button" onClick={toggle} aria-expanded={open} className="hover:bg-muted/60 focus-visible:ring-ring flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none">
          {load.state === "loading" ? (
            <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" aria-hidden />
          ) : (
            <ChevronRight className={cn("text-faint size-3.5 shrink-0 transition-transform duration-150", open && "rotate-90")} aria-hidden />
          )}
          <FileIcon path={file.name} className="shrink-0" />
          <span className="text-foreground truncate text-meta font-medium">{file.name}</span>
          {dir && <span className="text-faint min-w-0 truncate font-mono text-micro">{dir}</span>}
          <span className="sr-only">{open ? "Hide preview" : "Preview"}</span>
        </button>
        {openRef && (
          <button type="button" title="Open in the Files pane" onClick={() => openRef({ path: file.relPath })} className={ACTION}>
            <FolderOpen className="size-3.5" aria-hidden />
            <span className="max-sm:sr-only">Open</span>
          </button>
        )}
        <button
          type="button"
          title="Download"
          onClick={() => {
            api
              .artifactBlob(session, file.relPath)
              .then((blob) => {
                const href = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = href;
                a.download = file.name;
                a.click();
                setTimeout(() => URL.revokeObjectURL(href), 10_000);
              })
              .catch((e: unknown) => setLoad({ state: "error", message: errorText(e), gone: e instanceof ApiError && e.status === 404 }));
          }}
          className={ACTION}
        >
          <Download className="size-3.5" aria-hidden />
          <span className="max-sm:sr-only">Download</span>
        </button>
      </div>

      <Collapse open={open}>
        <div className="border-border/60 border-t">
          {load.state === "ready" ? (
            load.image ? (
              <div className="bg-muted/40 grid max-h-96 place-items-center overflow-auto p-3">
                <img src={load.image} alt={file.name} className="max-h-80 max-w-full rounded-md object-contain" />
              </div>
            ) : isMarkdown(file.name) ? (
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
      </Collapse>
    </div>
  );
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : "Could not load this file.";
}
