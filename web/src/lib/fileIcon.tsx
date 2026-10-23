import { FileIcon, fileIcon } from "@/lib/iconTheme";
import { cn } from "@/lib/utils";

/**
 * File-type marks for lists. The default is a neutral square with the extension in mono: the type is
 * read from the letters, not from a hue, so the transcript's docks and blocks stay on the console's
 * palette. `variant="icon"` draws the explorer's icon set (lib/iconTheme) for lists that are scanned
 * like an explorer, such as the @ menu. Both carry `data-file-kind` from the same table.
 */
const MARKS: Record<string, string> = { ts: "TS", tsx: "TS", js: "JS", jsx: "JS", mjs: "JS", cjs: "JS", json: "{}", md: "MD", mdx: "MD", css: "#", scss: "#", html: "<>", py: "PY", go: "GO", rs: "RS", java: "JV", kt: "KT", rb: "RB", php: "PHP", sh: ">_", bash: ">_", yml: "YML", yaml: "YML", toml: "TML", sql: "SQL", svg: "SVG", png: "IMG", jpg: "IMG", jpeg: "IMG", gif: "IMG", webp: "IMG", lock: "LCK", env: ".e", dockerfile: "DK", txt: "TXT" };

function markOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (base === "dockerfile") return MARKS.dockerfile;
  if (base.startsWith(".env")) return MARKS.env;
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  return MARKS[ext] ?? (ext ? ext.slice(0, 3).toUpperCase() : "·");
}

export function FileMark({ path, className, variant = "mono" }: { path: string; className?: string; variant?: "mono" | "icon" }) {
  if (variant === "icon") return <FileIcon path={path} className={className} />;
  const mark = markOf(path);
  return (
    <span
      className={cn("bg-muted-foreground/20 text-muted-foreground grid size-4 shrink-0 place-items-center rounded-[4px] font-mono text-[8px] leading-none font-semibold", mark.length > 2 && "text-[7px] tracking-tight", className)}
      aria-hidden
      data-file-mark
      data-file-kind={fileIcon(path).kind}
    >
      {mark}
    </span>
  );
}

/** Language hint for the syntax highlighter, from the extension. */
export function languageOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  const map: Record<string, string> = { ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", py: "python", rb: "ruby", yml: "yaml", md: "markdown", sh: "bash", kt: "kotlin", rs: "rust" };
  return map[ext] ?? ext ?? "plaintext";
}
