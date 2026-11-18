import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, ExternalLink, FileText, Paperclip, TextCursorInput, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useReducedMotion } from "@/lib/motion-pref";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Lightbox } from "@/components/ui/lightbox";
import { highlightHtml, useIsDark } from "@/components/ui/code-block";
import { languageOf } from "@/lib/fileIcon";
import { attachmentTitle, attachmentType, describeAttachment, fileToAttachment, fmtBytes, isLongPaste, MAX_ATTACHMENTS, pastedTextAttachment, PREVIEW_CHARS, type Attachment } from "@/lib/attachments";

/**
 * The attachments a composer holds, and the chips that show them.
 *
 * Shared by the thread composer (SendBar) and the new-task composer (Hub). Both accept the same
 * three gestures — paste, drop, pick — for the same kinds: pictures, PDFs, documents, and a long
 * passage pasted as text, which becomes a "Pasted text" chip instead of filling the box (the way a
 * long paste behaves in Claude or ChatGPT). A chip opens a preview; × removes it; a pasted chip can
 * be put back into the text from its preview.
 */
export function useAttachments(opts: { onInsertText?: (text: string) => void; initial?: Attachment[] } = {}) {
  const [items, setItems] = React.useState<Attachment[]>(() => opts.initial ?? []);
  const [preview, setPreview] = React.useState<Attachment | null>(null);
  // Files still being read: a send racing them would silently drop the file. The ref is for a send
  // that runs outside React's render (the thread composer retries from it); the state is for a
  // submit that wants to show the count.
  const [pending, setPending] = React.useState(0);
  const pendingRef = React.useRef(0);
  const pasteSeq = React.useRef(0);
  const onInsertText = React.useRef(opts.onInsertText);
  onInsertText.current = opts.onInsertText;

  const push = React.useCallback((a: Attachment) => {
    setItems((prev) => {
      if (prev.length >= MAX_ATTACHMENTS) {
        toast.error(`Up to ${MAX_ATTACHMENTS} attachments per message`);
        return prev;
      }
      return [...prev, a];
    });
  }, []);

  const addFiles = React.useCallback(
    (list: Iterable<File>) => {
      const files = [...list];
      if (!files.length) return;
      for (const f of files) {
        pendingRef.current++;
        setPending((n) => n + 1);
        fileToAttachment(f)
          .then((r) => {
            if (r.ok) push(r.attachment);
            else toast.error(r.reason);
          })
          .catch(() => toast.error(`Could not read ${f.name || "that file"}`))
          .finally(() => {
            pendingRef.current--;
            setPending((n) => n - 1);
          });
      }
    },
    [push]
  );

  const addPasted = React.useCallback(
    (text: string) => {
      pasteSeq.current++;
      push(pastedTextAttachment(text, pasteSeq.current));
    },
    [push]
  );

  const remove = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((a) => a.id !== id));
    setPreview((p) => (p?.id === id ? null : p));
  }, []);

  /** The pasted passage goes back into the text where the caret is, and the chip goes. */
  const insertAsText = React.useCallback(
    (a: Attachment) => {
      if (a.text === undefined) return;
      onInsertText.current?.(a.text);
      remove(a.id);
    },
    [remove]
  );

  /**
   * The paste handler for the composer. Files on the clipboard (a screenshot, a copied file) attach;
   * a long passage attaches as text; a short one lands in the box as typed. Returns true when the
   * paste was taken, so the caller can keep its own handling for the plain case.
   */
  const onPaste = React.useCallback(
    (e: React.ClipboardEvent): boolean => {
      const dt = e.clipboardData;
      if (!dt) return false;
      const files = [...dt.items].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => !!f);
      if (files.length) {
        e.preventDefault();
        addFiles(files);
        return true;
      }
      const text = dt.getData("text/plain");
      if (text && isLongPaste(text)) {
        e.preventDefault();
        addPasted(text);
        return true;
      }
      return false;
    },
    [addFiles, addPasted]
  );

  return { items, setItems, addFiles, addPasted, remove, insertAsText, preview, setPreview, pending, pendingRef, onPaste };
}

export type AttachmentList = ReturnType<typeof useAttachments>;

/** True when a drag carries files (not text or a link dragged out of the page). */
export function dragHasFiles(dt: DataTransfer): boolean {
  return [...dt.types].includes("Files") || [...dt.items].some((i) => i.kind === "file");
}

/** Attachment chips pop in from their own centre and shrink out; reduced motion keeps only the fade. */
export function chipMotion(still: boolean | null) {
  return {
    layout: !still,
    initial: still ? { opacity: 0 } : { opacity: 0, scale: 0.85 },
    animate: { opacity: 1, scale: 1 },
    exit: still ? { opacity: 0 } : { opacity: 0, scale: 0.85 },
    transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const },
  };
}

/**
 * The chips. A picture is a 64px tile of itself; everything else is a card of the same height: a
 * small page glyph (the first lines of a text, the type word for a PDF), the name and one line of
 * facts. Click opens the preview; × removes.
 */
export function AttachmentChips({ list, className }: { list: AttachmentList; className?: string }) {
  const still = useReducedMotion();
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {list.items.map((a) => (
        <motion.span key={a.id} {...chipMotion(still)} className={cn("group relative block", a.kind === "image" ? "size-16 overflow-hidden rounded-md border" : "h-16 w-[13.5rem] max-w-full", className)} title={a.kind === "image" ? a.name : undefined}>
          {a.kind === "image" ? (
            <button type="button" onClick={() => list.setPreview(a)} aria-label={`Preview ${a.name}`} className="block size-full cursor-zoom-in">
              <img src={a.dataUrl} alt={a.name} className="size-full object-cover transition-transform duration-200 group-hover:scale-105" />
            </button>
          ) : (
            <FileCard a={a} onOpen={() => list.setPreview(a)} />
          )}
          {a.kind === "image" && <span className="stamp absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-px text-[9px] text-white">{a.label ?? a.name}</span>}
          <button
            type="button"
            onClick={() => list.remove(a.id)}
            aria-label={`Remove ${attachmentTitle(a)}`}
            className="bg-card/90 text-foreground hover:bg-card absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-full opacity-0 shadow-e1 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <X className="size-3" />
          </button>
        </motion.span>
      ))}
    </AnimatePresence>
  );
}

/** The card for a non-picture attachment: page glyph, name, facts. */
function FileCard({ a, onOpen }: { a: Attachment; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-label={`Preview ${attachmentTitle(a)} — ${describeAttachment(a)}`} className="bg-muted hover:bg-accent flex size-full cursor-pointer items-center gap-2.5 rounded-md pr-7 pl-2 text-left transition-colors">
      <PageGlyph a={a} />
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-meta font-medium">{attachmentTitle(a)}</span>
        <span className="text-muted-foreground block truncate text-micro tabular-nums">{describeAttachment(a)}</span>
      </span>
    </button>
  );
}

/**
 * A 36×44 sheet of paper. For a text it carries the first lines at 5px — not to be read, to say
 * "this is the document you pasted" at a glance; for anything else the type word in mono.
 */
function PageGlyph({ a, className }: { a: Pick<Attachment, "kind" | "text" | "name" | "mime">; className?: string }) {
  const head = a.kind === "text" && a.text ? a.text.replace(/\t/g, "  ").split("\n").slice(0, 7).join("\n") : null;
  return (
    <span className={cn("bg-card text-muted-foreground relative grid h-11 w-9 shrink-0 place-items-center overflow-hidden rounded-[5px] shadow-e1 ring-1 ring-foreground/8", className)} aria-hidden>
      {head !== null ? (
        <>
          <pre className="text-foreground/70 absolute inset-0 overflow-hidden p-1 font-mono text-[5px] leading-[7px] whitespace-pre">{head}</pre>
          <span className="from-card absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t to-transparent" />
        </>
      ) : (
        <span className="font-mono text-[9px] leading-none font-semibold tracking-tight">{attachmentType(a).slice(0, 4)}</span>
      )}
    </span>
  );
}

/**
 * The preview. A picture opens in the Lightbox; a text in a dialog with the content highlighted; a
 * PDF or any other binary offers to open in a new tab (the browser's own viewer) or download —
 * the dashboard embeds nothing (CSP `frame-src 'none'`), and a blob URL in a new tab needs no
 * exception. A pasted passage can be put back into the message from here.
 */
export function AttachmentPreview({ list }: { list: AttachmentList }) {
  const a = list.preview;
  // The last non-picture preview stays mounted through the dialog's exit, so the content does not
  // vanish a frame before the panel does.
  const last = React.useRef<Attachment | null>(null);
  if (a && a.kind !== "image") last.current = a;
  const doc = a && a.kind !== "image" ? a : last.current;
  return (
    <>
      <Lightbox src={a?.kind === "image" ? a.dataUrl : null} name={a?.name ?? ""} open={a?.kind === "image"} onClose={() => list.setPreview(null)} />
      <Dialog open={!!a && a.kind !== "image"} onOpenChange={(o) => !o && list.setPreview(null)}>
        {doc && (
          <DialogContent dense title={attachmentTitle(doc)} className="w-[min(46rem,calc(100vw-2rem))]" bodyClassName="flex min-h-0 flex-1 flex-col px-4 pb-4">
            <p className="text-muted-foreground mb-2 text-micro tabular-nums">
              {describeAttachment(doc)}
              {doc.pasted && " · from the clipboard"}
              {doc.name !== attachmentTitle(doc) && <span className="font-mono"> · {doc.name}</span>}
            </p>
            {doc.kind === "text" && doc.text !== undefined ? (
              <TextPreview a={doc} />
            ) : (
              <div className="surface flex flex-col items-center gap-3 px-6 py-10 text-center">
                <span className="tile grid size-12 place-items-center rounded-xl shadow-e1">
                  {doc.kind === "pdf" ? <FileText className="text-muted-foreground size-5" aria-hidden /> : <Paperclip className="text-muted-foreground size-5" aria-hidden />}
                </span>
                <p className="text-muted-foreground max-w-[32ch] text-meta">
                  {doc.kind === "pdf" ? "The agent reads it page by page with its Read tool. Open it here in a new tab, or save a copy." : "The agent can open it in the sandbox with its tools."}
                </p>
                <div className="flex items-center gap-2">
                  {doc.kind === "pdf" && (
                    <Button variant="outline" size="sm" onClick={() => openBlob(doc.dataUrl, doc.mime)}>
                      <ExternalLink />
                      Open in a new tab
                    </Button>
                  )}
                  <a href={doc.dataUrl} download={doc.name} className="press inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-meta text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Download className="size-4" />
                    Download
                  </a>
                </div>
              </div>
            )}
            <DialogFooter className="-mx-4 px-4">
              <span className="text-muted-foreground mr-auto text-micro">Sent to the sandbox as a file the agent opens with its Read tool.</span>
              {doc.pasted && (
                <Button variant="ghost" size="sm" onClick={() => list.insertAsText(doc)}>
                  <TextCursorInput />
                  Put back as text
                </Button>
              )}
              <Button variant="danger" size="sm" onClick={() => list.remove(doc.id)}>
                <Trash2 />
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

/**
 * The whole text in one scrolling panel — no fold, no header: the dialog is the frame and its
 * title says what this is. Highlighted once the grammar lands; plain until then, and plain for
 * good past 60 KB, where highlighting would stall the main thread.
 */
function TextPreview({ a }: { a: Attachment }) {
  const text = a.text ?? "";
  const cut = text.length > PREVIEW_CHARS;
  const shown = cut ? text.slice(0, PREVIEW_CHARS) : text;
  const dark = useIsDark();
  const [html, setHtml] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    setHtml(null);
    if (shown.length > 60_000) return;
    highlightHtml(shown, languageOf(a.name), dark)
      .then((h) => !cancelled && setHtml(h))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shown, a.name, dark]);
  const pre = "code-scroll text-[12.5px] leading-[1.6] [&>pre]:!bg-transparent [&>pre]:px-4 [&>pre]:py-3 [&>pre]:whitespace-pre";
  return (
    <div className="bg-muted/40 flex min-h-0 flex-1 flex-col rounded-md border">
      <div className="min-h-0 flex-1 overflow-auto">
        {html ? (
          <div className={pre} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className={pre}>
            <pre className="font-mono">{shown}</pre>
          </div>
        )}
      </div>
      {cut && <p className="text-muted-foreground shrink-0 border-t px-3 py-2 text-micro">Showing the first {fmtBytes(PREVIEW_CHARS)} of {fmtBytes(a.size)}. The whole file is sent.</p>}
    </div>
  );
}

/** A blob URL in a new tab: the browser renders a PDF itself. Revoked once the tab has it. */
export function openBlob(dataUrl: string, mime: string) {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  openBlobObject(new Blob([bytes], { type: mime }));
}

export function openBlobObject(blob: Blob) {
  const url = URL.createObjectURL(blob);
  // No `noopener`: Chrome then returns null even when the tab opened, and the blob is same-origin anyway.
  const w = window.open(url, "_blank");
  if (!w) toast.error("The browser blocked the new tab", { description: "Allow pop-ups for this site, or download the file instead." });
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * The drop target is the whole composer, said in words: a dashed veil over everything, pointer
 * events off so the drop still lands on the input underneath.
 */
export function DropVeil({ show, still }: { show: boolean; still: boolean | null }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="drop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: still ? 0.08 : 0.15 }}
          aria-hidden
          className="bg-card/90 border-live text-live pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl border-2 border-dashed backdrop-blur-[2px]"
        >
          <span className="flex items-center gap-2 text-meta font-medium">
            <Paperclip className="size-4" aria-hidden />
            Drop files to attach
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The one line the + menu and the file picker share. */
export const ATTACH_LABEL = "Attach a file or image";
export const ATTACH_HINT = "PDF, text, image — or paste / drop one";
