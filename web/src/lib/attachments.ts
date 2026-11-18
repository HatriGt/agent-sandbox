/**
 * What rides with a message besides the words: pictures, PDFs, documents, and long passages that
 * were pasted into the composer.
 *
 * One model for every kind. Each attachment is held as a data URL (what the controller writes into
 * the sandbox under /workspace/.attachments) plus the few facts the chip needs: a kind, a size, the
 * text and its line count when the bytes are text. On send the message ends with an
 * `Attached files (open with the Read tool):` list naming each in-box path, so the agent opens
 * them with its Read tool (Claude Code reads images and PDFs natively) — the same shape the Hub's
 * launch takes server-side, and the shape `lib/you-message.ts` folds back into chips in the bubble.
 *
 * Long pastes become attachments on purpose: a 300-line JSON dropped into the text box buries the
 * question under it, scrolls the composer off the screen and is sent as prose the agent has to
 * read inline. As a file it is one chip, previewable, and the agent reads it with the tool it would
 * use for any file. The chip can always be put back as text.
 */
export type AttachmentKind = "image" | "pdf" | "text" | "file";

export interface Attachment {
  id: string;
  /** File name as it is written in the box: a safe stem plus the extension. */
  name: string;
  kind: AttachmentKind;
  mime: string;
  /** Bytes, decoded. */
  size: number;
  /** The bytes as a data URL, uploaded as-is. */
  dataUrl: string;
  /** Text attachments: the content, for the preview. */
  text?: string;
  /** Text attachments: line count, for the chip. */
  lines?: number;
  /** Came from the clipboard as text (not as a file): the chip says so and can be undone into the text. */
  pasted?: boolean;
  /** What the chip is called, when the file name is not the point (a browser element). */
  label?: string;
  /** What the agent is told about it, under its path (a browser element's selector and markup). */
  note?: string;
}

/** Past either of these a paste is a document, not a sentence. */
export const PASTE_AS_FILE = { chars: 1500, lines: 30 } as const;
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS = 8;
/** Beyond this the preview shows the head of the text only; the whole file is still sent. */
export const PREVIEW_CHARS = 200_000;

export function isLongPaste(text: string): boolean {
  if (text.length >= PASTE_AS_FILE.chars) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  return lines >= PASTE_AS_FILE.lines;
}

export function countLines(text: string): number {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  // A trailing newline does not start a line.
  return text.endsWith("\n") ? n - 1 : n;
}

const TEXT_EXT = new Set(["txt", "md", "markdown", "json", "jsonl", "csv", "tsv", "log", "xml", "yaml", "yml", "toml", "ini", "env", "cfg", "conf", "html", "htm", "css", "scss", "js", "jsx", "mjs", "cjs", "ts", "tsx", "py", "rb", "go", "rs", "java", "kt", "sh", "bash", "zsh", "sql", "graphql", "gql", "php", "c", "h", "cpp", "hpp", "cs", "swift", "diff", "patch", "svg", "tex", "rst", "properties"]);
const TEXT_MIME = /^(text\/|application\/(json|xml|javascript|x-sh|x-yaml|yaml|toml|sql|graphql|x-ndjson))/;

function extOf(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
  return base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
}

/** `report (final).PDF` → `report-final` — what is safe in a path and short enough to read. */
function safeStem(name: string, fallback: string): string {
  const stem = name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 40);
  return stem || fallback;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

/** Whether the bytes read as text: no NUL in the head and the whole thing decodes as UTF-8. */
function looksText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** What a pasted passage is: JSON when it parses, markdown when it is shaped like it, else plain text. */
export function pastedExtension(text: string): "json" | "md" | "txt" {
  const t = text.trim();
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      /* not JSON: fall through */
    }
  }
  if (/^#{1,6} /m.test(t) || /^```/m.test(t)) return "md";
  return "txt";
}

/** A passage from the clipboard as an attachment named `pasted-N.<ext>`. */
export function pastedTextAttachment(text: string, seq: number): Attachment {
  const ext = pastedExtension(text);
  const bytes = new TextEncoder().encode(text);
  const mime = ext === "json" ? "application/json" : ext === "md" ? "text/markdown" : "text/plain";
  return { id: newId(), name: `pasted-${seq}.${ext}`, kind: "text", mime, size: bytes.length, dataUrl: `data:${mime};base64,${toBase64(bytes)}`, text, lines: countLines(text), pasted: true };
}

export type AttachmentResult = { ok: true; attachment: Attachment } | { ok: false; reason: string };

/** A File (dropped, picked or pasted) as an attachment: the kind by type, then by extension, then by sniffing. */
export async function fileToAttachment(file: File): Promise<AttachmentResult> {
  const name = file.name || "";
  if (file.size === 0) return { ok: false, reason: `${name || "That file"} is empty` };
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, reason: `${name || "That file"} is over 8 MB` };
  const ext = extOf(name);
  const type = file.type || "";
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
    const mime = type || `image/${ext === "jpg" ? "jpeg" : ext}`;
    const outExt = (mime.split("/")[1] || ext || "png").replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "png";
    const dataUrl = await readDataUrl(file);
    return { ok: true, attachment: { id: newId(), name: `${safeStem(name, "pasted")}.${outExt}`, kind: "image", mime, size: file.size, dataUrl } };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  // The chip keeps the file's own name ("Rate limiting RFC (draft 3).pdf"); the box gets the safe one.
  const label = (safe: string) => (name && name !== safe ? { label: name } : {});
  if (type === "application/pdf" || ext === "pdf") {
    const safe = `${safeStem(name, "document")}.pdf`;
    return { ok: true, attachment: { id: newId(), name: safe, kind: "pdf", mime: "application/pdf", size: file.size, dataUrl: `data:application/pdf;base64,${toBase64(bytes)}`, ...label(safe) } };
  }
  const textual = TEXT_MIME.test(type) || TEXT_EXT.has(ext) || (!type && looksText(bytes)) || (type === "application/octet-stream" && looksText(bytes));
  if (textual && looksText(bytes)) {
    const text = new TextDecoder("utf-8").decode(bytes);
    const mime = TEXT_MIME.test(type) ? type : ext === "json" ? "application/json" : ext === "md" ? "text/markdown" : "text/plain";
    const safe = `${safeStem(name, "file")}.${ext || "txt"}`;
    return { ok: true, attachment: { id: newId(), name: safe, kind: "text", mime, size: file.size, dataUrl: `data:${mime};base64,${toBase64(bytes)}`, text, lines: countLines(text), ...label(safe) } };
  }
  // Anything else (a spreadsheet, an archive, a binary dump): the agent can still open it in the box.
  const mime = type || "application/octet-stream";
  const safe = ext ? `${safeStem(name, "file")}.${ext}` : safeStem(name, "file");
  return { ok: true, attachment: { id: newId(), name: safe, kind: "file", mime, size: file.size, dataUrl: `data:${mime};base64,${toBase64(bytes)}`, ...label(safe) } };
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(file);
  });
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** The type word on a chip: `JSON`, `PDF`, `PNG`, `TXT`. */
export function attachmentType(a: Pick<Attachment, "name" | "kind" | "mime">): string {
  const ext = extOf(a.name);
  if (ext) return ext.toUpperCase();
  return a.kind === "pdf" ? "PDF" : a.kind === "image" ? "IMAGE" : a.kind === "text" ? "TXT" : "FILE";
}

/** The chip's second line: `JSON · 240 lines · 12 KB`. */
export function describeAttachment(a: Attachment): string {
  const parts = [attachmentType(a)];
  if (a.lines !== undefined) parts.push(`${a.lines} ${a.lines === 1 ? "line" : "lines"}`);
  parts.push(fmtBytes(a.size));
  return parts.join(" · ");
}

/** The chip's first line: "Pasted text" for a paste, the file's own name otherwise. */
export function attachmentTitle(a: Attachment): string {
  return a.label ?? (a.pasted ? "Pasted text" : a.name);
}

/**
 * The lines that end the message: every attachment's in-box path, with its note under it. The
 * word is "image(s)" when they all are (the wording the agent has always seen) and "file(s)" otherwise.
 */
export function attachmentsTail(items: { path: string; kind: AttachmentKind; note?: string }[]): string {
  if (!items.length) return "";
  const allImages = items.every((i) => i.kind === "image");
  const noun = allImages ? (items.length === 1 ? "image" : "images") : items.length === 1 ? "file" : "files";
  return `Attached ${noun} (open with the Read tool):\n${items.map((i) => `- ${i.path}${i.note ? `\n  ${i.note}` : ""}`).join("\n")}`;
}

/** What the agent is told under a pasted passage's path. */
export function attachmentNote(a: Attachment): string | undefined {
  if (a.note) return a.note;
  if (a.pasted) return `text pasted into the message, ${a.lines} ${a.lines === 1 ? "line" : "lines"}`;
  return undefined;
}

/** `20261118093000-2-pasted-1.json` → `pasted-1.json`: the name without the send stamp. */
export function attachmentDisplayName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/^\d{14}-\d+-/, "");
}

export const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp)$/i;
export const isImagePath = (p: string) => IMAGE_EXT_RE.test(p);
export const isPdfPath = (p: string) => /\.pdf$/i.test(p);
export const isTextPath = (p: string) => TEXT_EXT.has(extOf(p));
