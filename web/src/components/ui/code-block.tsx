import { cn } from "@/lib/utils"
import React, { useEffect, useState } from "react"
import type { HighlighterCore } from "shiki/core"

export type CodeBlockProps = {
  children?: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "not-prose flex w-full flex-col overflow-clip border",
        "border-border bg-card text-card-foreground rounded-xl",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/*
 * Shiki, code-split and narrowed.
 *
 * The default `shiki` bundle ships EVERY language grammar and theme plus the Oniguruma WASM engine —
 * hundreds of KB of grammars and a ~600KB wasm blob, all in the initial chunk. We only ever render a
 * handful of languages in traces and markdown fences, so instead we build a `shiki/core` highlighter
 * with just those grammars, the JavaScript regex engine (no wasm), and a light+dark theme — and we
 * `import()` it lazily so none of it lands in the initial chunk. Until it resolves (and for any code
 * that needs no highlighting) we render a plain <pre>, so text is always legible.
 */
const LANGS = {
  bash: () => import("shiki/langs/bash.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
} as const

/** Aliases → one of the grammars we actually load; anything else falls back to plaintext (no highlight). */
const ALIASES: Record<string, keyof typeof LANGS> = {
  sh: "bash",
  shell: "shellscript",
  zsh: "bash",
  bash: "bash",
  shellscript: "shellscript",
  json: "json",
  jsonc: "json",
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "javascript",
  javascript: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  diff: "diff",
  patch: "diff",
}

let highlighterPromise: Promise<HighlighterCore> | null = null

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/javascript"),
          import("shiki/themes/github-light.mjs"),
          import("shiki/themes/github-dark.mjs"),
        ])
      return createHighlighterCore({
        // Grammars are loaded on demand per-language in ensureLang; start with none.
        langs: [],
        themes: [light.default, dark.default],
        engine: createJavaScriptRegexEngine(),
      })
    })()
  }
  return highlighterPromise
}

const loaded = new Set<keyof typeof LANGS>()

/** Load a grammar into the shared highlighter once; returns the resolved grammar name or null. */
async function ensureLang(hl: HighlighterCore, requested: string): Promise<keyof typeof LANGS | null> {
  const name = ALIASES[requested.toLowerCase()]
  if (!name) return null
  if (!loaded.has(name)) {
    const mod = await LANGS[name]()
    await hl.loadLanguage(mod.default)
    loaded.add(name)
  }
  return name
}

export type CodeBlockCodeProps = {
  code: string
  language?: string
  theme?: string
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlockCode({
  code,
  language = "tsx",
  theme,
  className,
  ...props
}: CodeBlockCodeProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function highlight() {
      if (!code) {
        if (!cancelled) setHighlightedHtml("<pre><code></code></pre>")
        return
      }
      try {
        const hl = await getHighlighter()
        const lang = await ensureLang(hl, language)
        // Follow the app theme (the `.dark` class on <html>); a caller can still force one via `theme`.
        const isDark = document.documentElement.classList.contains("dark")
        const chosen = theme ?? (isDark ? "github-dark" : "github-light")
        const html = hl.codeToHtml(code, { lang: lang ?? "text", theme: chosen })
        if (!cancelled) setHighlightedHtml(html)
      } catch {
        // Any failure (unknown grammar, load error) leaves the plain <pre> fallback in place.
        if (!cancelled) setHighlightedHtml(null)
      }
    }
    highlight()
    return () => {
      cancelled = true
    }
  }, [code, language, theme])

  const classNames = cn(
    "w-full overflow-x-auto text-[13px] [&>pre]:px-4 [&>pre]:py-4",
    className
  )

  // Fallback: plain code until the lazy highlighter resolves (or if it can't highlight this language).
  return highlightedHtml ? (
    <div
      className={classNames}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      {...props}
    />
  ) : (
    <div className={classNames} {...props}>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>

function CodeBlockGroup({
  children,
  className,
  ...props
}: CodeBlockGroupProps) {
  return (
    <div
      className={cn("flex items-center justify-between", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock }
