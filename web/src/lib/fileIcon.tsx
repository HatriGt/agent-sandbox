import { cn } from "@/lib/utils";

/**
 * File-type marks for lists: a two-letter monogram in the language's conventional colour, the way
 * editors do it. Vector-crisp at 16px, no icon-font dependency; unknown types fall back to a neutral
 * mark. Colours are chosen to read on both themes.
 */
const KINDS: Record<string, { mark: string; color: string }> = {
  ts: { mark: "TS", color: "bg-[#3178c6] text-white" },
  tsx: { mark: "TS", color: "bg-[#3178c6] text-white" },
  js: { mark: "JS", color: "bg-[#f7df1e] text-black" },
  jsx: { mark: "JS", color: "bg-[#f7df1e] text-black" },
  mjs: { mark: "JS", color: "bg-[#f7df1e] text-black" },
  json: { mark: "{}", color: "bg-[#cbcb41] text-black" },
  md: { mark: "M↓", color: "bg-[#519aba] text-white" },
  mdx: { mark: "M↓", color: "bg-[#519aba] text-white" },
  css: { mark: "#", color: "bg-[#563d7c] text-white" },
  scss: { mark: "S", color: "bg-[#c6538c] text-white" },
  html: { mark: "<>", color: "bg-[#e34c26] text-white" },
  py: { mark: "Py", color: "bg-[#3572a5] text-white" },
  go: { mark: "Go", color: "bg-[#00add8] text-white" },
  rs: { mark: "Rs", color: "bg-[#dea584] text-black" },
  java: { mark: "J", color: "bg-[#b07219] text-white" },
  kt: { mark: "Kt", color: "bg-[#a97bff] text-white" },
  rb: { mark: "Rb", color: "bg-[#701516] text-white" },
  php: { mark: "Php", color: "bg-[#4f5d95] text-white" },
  sh: { mark: ">_", color: "bg-[#89e051] text-black" },
  bash: { mark: ">_", color: "bg-[#89e051] text-black" },
  yml: { mark: "Y", color: "bg-[#cb171e] text-white" },
  yaml: { mark: "Y", color: "bg-[#cb171e] text-white" },
  toml: { mark: "T", color: "bg-[#9c4221] text-white" },
  sql: { mark: "SQL", color: "bg-[#e38c00] text-white" },
  svg: { mark: "◇", color: "bg-[#ffb13b] text-black" },
  png: { mark: "▣", color: "bg-muted-foreground/30 text-foreground" },
  jpg: { mark: "▣", color: "bg-muted-foreground/30 text-foreground" },
  lock: { mark: "🔒", color: "bg-muted text-foreground" },
  env: { mark: ".e", color: "bg-[#ecd53f] text-black" },
  dockerfile: { mark: "🐳", color: "bg-[#384d54] text-white" },
  txt: { mark: "≡", color: "bg-muted-foreground/30 text-foreground" },
};

export function fileKind(path: string): { mark: string; color: string } {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (base === "dockerfile") return KINDS.dockerfile;
  if (base.startsWith(".env")) return KINDS.env;
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  return KINDS[ext] ?? { mark: ext ? ext.slice(0, 3).toUpperCase() : "·", color: "bg-muted text-muted-foreground" };
}

export function FileMark({ path, className }: { path: string; className?: string }) {
  const k = fileKind(path);
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-[3px] font-mono text-[8px] leading-none font-bold",
        k.color,
        className
      )}
    >
      {k.mark}
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
