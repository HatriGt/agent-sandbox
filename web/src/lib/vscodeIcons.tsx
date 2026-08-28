import { siApachemaven, siAstro, siBabel, siBun, siC, siCloudflare, siCmake, siCplusplus, siCss, siDart, siDocker, siDotenv, siDotnet, siEditorconfig, siElixir, siEslint, siGit, siGithubactions, siGitignoredotio, siGnubash, siGo, siGradle, siGraphql, siHaskell, siHtml5, siJavascript, siJest, siJson, siJulia, siJupyter, siKotlin, siLatex, siLua, siMarkdown, siMdx, siNetlify, siNextdotjs, siNpm, siNuxt, siNx, siPhp, siPnpm, siPostgresql, siPrettier, siPrisma, siPython, siR, siReact, siRenovate, siRuby, siRust, siSass, siScala, siSvelte, siSvg, siSwift, siTailwindcss, siTerraform, siToml, siTurborepo, siTypescript, siVercel, siVite, siVitest, siVuedotjs, siWebassembly, siWebpack, siXml, siYaml, siYarn, siZig } from "simple-icons";
import { cn } from "@/lib/utils";

/**
 * A file-icon theme in the spirit of VS Code's Material icons: real brand glyphs (simple-icons) in
 * their conventional colours for languages and tools, name-aware special cases (package.json → npm,
 * tsconfig → TS, Dockerfile, .env, README, LICENSE, lockfiles, CI workflows…), and coloured folder
 * glyphs whose hue follows the folder's role (src, test, docs, public, components, config…). All
 * inline SVG — crisp at 16px, no icon font, works in both themes.
 */
type Glyph = { path: string; hex: string };
const S: Record<string, Glyph | undefined> = { siApachemaven, siAstro, siBabel, siBun, siC, siCloudflare, siCmake, siCplusplus, siCss, siDart, siDocker, siDotenv, siDotnet, siEditorconfig, siElixir, siEslint, siGit, siGithubactions, siGitignoredotio, siGnubash, siGo, siGradle, siGraphql, siHaskell, siHtml5, siJavascript, siJest, siJson, siJulia, siJupyter, siKotlin, siLatex, siLua, siMarkdown, siMdx, siNetlify, siNextdotjs, siNpm, siNuxt, siNx, siPhp, siPnpm, siPostgresql, siPrettier, siPrisma, siPython, siR, siReact, siRenovate, siRuby, siRust, siSass, siScala, siSvelte, siSvg, siSwift, siTailwindcss, siTerraform, siToml, siTurborepo, siTypescript, siVercel, siVite, siVitest, siVuedotjs, siWebassembly, siWebpack, siXml, siYaml, siYarn, siZig };
const g = (key: string, hex?: string): Glyph | undefined => {
  const icon = S[key];
  return icon ? { path: icon.path, hex: hex ?? icon.hex } : undefined;
};

// Exact basenames first (lowercased), then extensions.
const BY_NAME: Record<string, () => Glyph | undefined> = {
  "package.json": () => g("siNpm"),
  "package-lock.json": () => g("siNpm", "7a7a7a"),
  "yarn.lock": () => g("siYarn"),
  "pnpm-lock.yaml": () => g("siPnpm"),
  "bun.lockb": () => g("siBun"),
  "tsconfig.json": () => g("siTypescript"),
  "jsconfig.json": () => g("siJavascript"),
  dockerfile: () => g("siDocker"),
  "docker-compose.yml": () => g("siDocker"),
  "docker-compose.yaml": () => g("siDocker"),
  ".gitignore": () => g("siGit", "f05032"),
  ".gitattributes": () => g("siGit", "f05032"),
  ".editorconfig": () => g("siEditorconfig", "9a9a9a"),
  ".prettierrc": () => g("siPrettier"),
  ".eslintrc": () => g("siEslint"),
  "eslint.config.js": () => g("siEslint"),
  "eslint.config.mjs": () => g("siEslint"),
  "vite.config.ts": () => g("siVite"),
  "vite.config.js": () => g("siVite"),
  "tailwind.config.js": () => g("siTailwindcss"),
  "tailwind.config.ts": () => g("siTailwindcss"),
  "next.config.js": () => g("siNextdotjs"),
  "nuxt.config.ts": () => g("siNuxt"),
  "astro.config.mjs": () => g("siAstro"),
  "vitest.config.ts": () => g("siVitest"),
  "jest.config.js": () => g("siJest"),
  "playwright.config.ts": () => g("siPlaywright"),
  "webpack.config.js": () => g("siWebpack"),
  "babel.config.js": () => g("siBabel"),
  "turbo.json": () => g("siTurborepo"),
  "nx.json": () => g("siNx"),
  "renovate.json": () => g("siRenovate"),
  "prisma.schema": () => g("siPrisma"),
  "schema.prisma": () => g("siPrisma"),
  makefile: () => g("siCmake", "6d8086"),
  "cmakelists.txt": () => g("siCmake"),
  "build.gradle": () => g("siGradle"),
  "pom.xml": () => g("siApachemaven"),
  "cargo.toml": () => g("siRust"),
  "go.mod": () => g("siGo"),
  "go.sum": () => g("siGo", "7a7a7a"),
  "requirements.txt": () => g("siPython"),
  "pyproject.toml": () => g("siPython"),
  gemfile: () => g("siRuby"),
  "vercel.json": () => g("siVercel"),
  "netlify.toml": () => g("siNetlify"),
  "wrangler.toml": () => g("siCloudflare"),
};

const BY_EXT: Record<string, () => Glyph | undefined> = {
  ts: () => g("siTypescript"),
  mts: () => g("siTypescript"),
  cts: () => g("siTypescript"),
  tsx: () => g("siReact", "3178c6"),
  js: () => g("siJavascript"),
  mjs: () => g("siJavascript"),
  cjs: () => g("siJavascript"),
  jsx: () => g("siReact"),
  vue: () => g("siVuedotjs"),
  svelte: () => g("siSvelte"),
  astro: () => g("siAstro"),
  json: () => g("siJson", "cbcb41"),
  jsonc: () => g("siJson", "cbcb41"),
  json5: () => g("siJson", "cbcb41"),
  md: () => g("siMarkdown", "519aba"),
  markdown: () => g("siMarkdown", "519aba"),
  mdx: () => g("siMdx"),
  css: () => g("siCss", "563d7c"),
  scss: () => g("siSass"),
  sass: () => g("siSass"),
  html: () => g("siHtml5"),
  htm: () => g("siHtml5"),
  xml: () => g("siXml", "e37933"),
  svg: () => g("siSvg"),
  yml: () => g("siYaml", "cb171e"),
  yaml: () => g("siYaml", "cb171e"),
  toml: () => g("siToml"),
  py: () => g("siPython"),
  ipynb: () => g("siJupyter"),
  go: () => g("siGo"),
  rs: () => g("siRust", "dea584"),
  rb: () => g("siRuby"),
  php: () => g("siPhp"),
  java: () => g("siJava", "b07219"),
  kt: () => g("siKotlin"),
  kts: () => g("siKotlin"),
  swift: () => g("siSwift"),
  dart: () => g("siDart"),
  c: () => g("siC"),
  h: () => g("siC", "a074c4"),
  cpp: () => g("siCplusplus"),
  hpp: () => g("siCplusplus", "a074c4"),
  cs: () => g("siDotnet", "68217a"),
  scala: () => g("siScala"),
  ex: () => g("siElixir"),
  exs: () => g("siElixir"),
  hs: () => g("siHaskell"),
  lua: () => g("siLua"),
  zig: () => g("siZig"),
  r: () => g("siR"),
  jl: () => g("siJulia"),
  sh: () => g("siGnubash", "89e051"),
  bash: () => g("siGnubash", "89e051"),
  zsh: () => g("siGnubash", "89e051"),
  sql: () => g("siPostgresql", "e38c00"),
  graphql: () => g("siGraphql"),
  gql: () => g("siGraphql"),
  prisma: () => g("siPrisma"),
  tf: () => g("siTerraform"),
  env: () => g("siDotenv"),
  wasm: () => g("siWebassembly"),
  tex: () => g("siLatex"),
  lock: () => g("siGitignoredotio", "8a8a8a"),
};

// A few shapes simple-icons doesn't cover, drawn to the same 24-box.
const GENERIC = {
  file: "M6 2h8l6 6v14H6V2zm7 1.5V9h5.5L13 3.5z",
  text: "M6 2h8l6 6v14H6V2zm7 1.5V9h5.5L13 3.5zM8 12h8v1.5H8V12zm0 3h8v1.5H8V15zm0 3h5v1.5H8V18z",
  image: "M4 4h16v16H4V4zm2 2v9.6l3.5-3.6 3 3 3.5-4.5 2 2.6V6H6zm9 2.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z",
  info: "M12 2a10 10 0 110 20 10 10 0 010-20zm-1 8h2v7h-2v-7zm0-3.5h2v2h-2v-2z",
  key: "M14 2a6 6 0 00-5.7 7.9L2 16.2V22h5.8l1.4-1.4v-2.2h2.2l1.4-1.4V15l1.9-1.9A6 6 0 1014 2zm2 4a2 2 0 110 4 2 2 0 010-4z",
  history: "M13 3a9 9 0 100 18 9 9 0 100-18zm-1 5h1.5v4.2l3.6 2.1-.8 1.3L12 13V8z",
  shield: "M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5l8-3z",
  binary: "M6 2h8l6 6v14H6V2zm7 1.5V9h5.5L13 3.5zM8 12h2v6H8v-6zm4 0h4v1.5h-2.5V14H16v4h-4v-1.5h2.5V16H12v-4z",
};

export function fileGlyph(path: string): Glyph {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const lower = base.toLowerCase();
  const byName = BY_NAME[lower]?.();
  if (byName) return byName;
  if (lower.startsWith(".env")) return g("siDotenv") ?? { path: GENERIC.file, hex: "ecd53f" };
  if (lower.startsWith("readme")) return { path: GENERIC.info, hex: "42a5f5" };
  if (lower.startsWith("license") || lower.startsWith("licence")) return { path: GENERIC.key, hex: "d4a72c" };
  if (lower.startsWith("changelog") || lower === "history.md") return { path: GENERIC.history, hex: "8bc34a" };
  if (lower.startsWith("security")) return { path: GENERIC.shield, hex: "ef5350" };
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(lower)) return g("siVitest", "ffca28") ?? { path: GENERIC.file, hex: "ffca28" };
  if (/\.d\.ts$/.test(lower)) return g("siTypescript", "6b9bd2")!;
  if (/^\.github\//.test(path) && /\.ya?ml$/.test(lower)) return g("siGithubactions") ?? { path: GENERIC.file, hex: "2088ff" };
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  const byExt = BY_EXT[ext]?.();
  if (byExt) return byExt;
  if (/^(png|jpe?g|gif|webp|avif|ico|bmp)$/.test(ext)) return { path: GENERIC.image, hex: "a074c4" };
  if (/^(txt|log|csv|tsv|ini|cfg|conf|properties)$/.test(ext)) return { path: GENERIC.text, hex: "8a8f98" };
  if (/^(zip|gz|tgz|tar|7z|bin|exe|dll|so|dylib|pdf|woff2?|ttf|otf)$/.test(ext)) return { path: GENERIC.binary, hex: "8a8f98" };
  return { path: GENERIC.file, hex: "8a8f98" };
}

/** Folder hue by role, like the Material theme's coloured folders. */
const FOLDER_HUES: Array<[RegExp, string]> = [
  [/^(src|source|lib|app)$/i, "42a5f5"],
  [/^(test|tests|__tests__|spec|specs|e2e|cypress|playwright)$/i, "66bb6a"],
  [/^(docs?|documentation|wiki)$/i, "ab47bc"],
  [/^(public|static|assets|images?|img|media|fonts?)$/i, "ffca28"],
  [/^(components?|ui|widgets|views|pages|screens|layouts?)$/i, "ec407a"],
  [/^(hooks?|utils?|helpers?|shared|common|core)$/i, "26a69a"],
  [/^(config|configs?|settings|\.config|\.github|\.vscode|\.idea)$/i, "ff7043"],
  [/^(api|server|backend|services?|controllers?|routes?|handlers?)$/i, "5c6bc0"],
  [/^(styles?|css|scss|themes?)$/i, "26c6da"],
  [/^(scripts?|bin|tools?|ci|deploy|infra|terraform|k8s|kubernetes)$/i, "8d6e63"],
  [/^(node_modules|vendor|dist|build|out|target|\.next|\.turbo|coverage)$/i, "9e9e9e"],
  [/^(packages?|apps?|modules?|workspaces?|monorepo)$/i, "7e57c2"],
  [/^(types?|typings|interfaces|models?|schemas?|entities)$/i, "29b6f6"],
  [/^(migrations?|db|database|prisma|sql)$/i, "e38c00"],
];
export function folderHue(name: string): string {
  for (const [re, hex] of FOLDER_HUES) if (re.test(name)) return hex;
  return "90a4ae";
}

export function FileIcon({ path, className, size = 16 }: { path: string; className?: string; size?: number }) {
  const gl = fileGlyph(path);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cn("shrink-0", className)} aria-hidden>
      <path d={gl.path} fill={`#${gl.hex}`} />
    </svg>
  );
}

export function FolderIcon({ name, open, className, size = 16 }: { name: string; open?: boolean; className?: string; size?: number }) {
  const hex = `#${folderHue(name)}`;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cn("shrink-0", className)} aria-hidden>
      {open ? (
        <>
          <path d="M3 5.5A1.5 1.5 0 014.5 4h4.2l2 2H19.5A1.5 1.5 0 0121 7.5V9H3V5.5z" fill={hex} opacity={0.55} />
          <path d="M2.4 10.5A1.5 1.5 0 013.9 9h16.6a1.5 1.5 0 011.45 1.9l-1.9 7.2A1.5 1.5 0 0118.6 19.2H4.1A1.5 1.5 0 012.65 18L2.4 10.5z" fill={hex} />
        </>
      ) : (
        <>
          <path d="M3 5.5A1.5 1.5 0 014.5 4h4.2l2 2H19.5A1.5 1.5 0 0121 7.5v11a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5v-13z" fill={hex} />
          <path d="M3 8h18v1.5H3z" fill="#000" opacity={0.12} />
        </>
      )}
    </svg>
  );
}
