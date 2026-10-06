import { cn } from "@/lib/utils"
import { Check, ChevronDown, Copy } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { HighlighterCore } from "shiki/core"

/** Blocks longer than this many lines start folded; a short overrun is not worth a fold. */
const FOLD_AT = 24
const FOLD_SLACK = 4

export type CodeBlockProps = {
  children?: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        // A fenced block reads as a distinct panel: a header bar carrying the language + copy control,
        // a hairline, 8px corners, and a tinted body. `group` drives the copy button's hover reveal;
        // `overflow-clip` keeps highlighted content inside the rounded corners. The surface is the
        // muted token (NOT `--card`, which equals the white canvas in light mode and would read as
        // white-on-white). The body fill is set on CodeBlockCode so it sits under the code but the
        // header bar can carry a slightly stronger tint for separation.
        "group not-prose relative my-3 flex w-full flex-col overflow-clip rounded-md border",
        "border-border bg-muted/40 text-card-foreground shadow-e1",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * The copy control that lives in the code block's header bar. Shows the label "Copy" on wide blocks,
 * collapses to just the icon when space is tight, and confirms with a check for a beat so the click
 * registers.
 */
function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      // Clipboard can be blocked (permissions / insecure context); fail quietly rather than throw.
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy code"}
      className={cn(
        "text-muted-foreground hover:text-foreground -my-1 -mr-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1",
        "cursor-pointer text-micro font-medium transition-colors",
        "opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
      )}
    >
      {copied ? <Check className="text-ok size-3.5" /> : <Copy className="size-3.5" />}
      <span className="tabular hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
    </button>
  )
}

/**
 * The header bar: language tag on the left, copy control on the right. A quiet strip that names the
 * block as code without a heavy chrome. `language` is the resolved fence language (or "text").
 */
function CodeBlockHeader({ language, code }: { language: string; code: string }) {
  const label = language && language !== "text" && language !== "plaintext" ? language : "code"
  return (
    <div className="border-border bg-muted/60 text-muted-foreground flex items-center justify-between border-b px-3 py-1.5">
      <span className="stamp select-none">{label}</span>
      <CopyButton code={code} />
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

/** React to the app theme toggling (the `.dark` class flips on <html>) so code re-highlights live. */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  )
  useEffect(() => {
    const el = document.documentElement
    const update = () => setIsDark(el.classList.contains("dark"))
    update()
    const obs = new MutationObserver(update)
    obs.observe(el, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])
  return isDark
}

function CodeBlockCode({
  code,
  language = "tsx",
  theme,
  className,
  ...props
}: CodeBlockCodeProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)
  const isDark = useIsDark()

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
        // Follow the app theme (re-runs when `isDark` flips); a caller can still force one via `theme`.
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
  }, [code, language, theme, isDark])

  const classNames = cn(
    // 14px mono matches the reference. Shiki bakes the theme's own page background onto the generated
    // `<pre>` (github-light = white, github-dark = a slate) — force it transparent so our tinted panel
    // shows through and highlighted blocks share the same surface as plain/ASCII ones. `whitespace-pre`
    // preserves the column alignment of ASCII/box-drawing tables (the `df -h` case) and scrolls long
    // lines. No `pr-10` reserve is needed anymore — the copy control lives in the header, not floating.
    "w-full overflow-x-auto text-code [&>pre]:!bg-transparent [&>pre]:px-4 [&>pre]:py-3 [&>pre]:whitespace-pre",
    className
  )

  const lineCount = code.replace(/\n$/, "").split("\n").length
  const foldable = lineCount > FOLD_AT + FOLD_SLACK

  return (
    <>
      <CodeBlockHeader language={language} code={code} />
      {/* Fallback: plain code until the lazy highlighter resolves (or can't highlight this language). */}
      {/*
        The console's only `dangerouslySetInnerHTML`. Safe because `highlightedHtml` is never caller
        markup: it is always shiki's `codeToHtml` output, which escapes the code (`<` -> `&#x3C;`,
        `&` -> `&#x26;`) and emits only <pre>/<code>/<span> with class/style/tabindex. `code` is
        untrusted by design (agent output, repo files, web pages), so that property is pinned by
        test/code-highlight-escaping.test.ts — which also fails if a second such sink appears.
        Never pass anything but highlighter output through here.
      */}
      <Fold lines={lineCount} enabled={foldable}>
        {highlightedHtml ? (
          <div className={classNames} dangerouslySetInnerHTML={{ __html: highlightedHtml }} {...props} />
        ) : (
          <div className={classNames} {...props}>
            <pre>
              <code>{code}</code>
            </pre>
          </div>
        )}
      </Fold>
    </>
  )
}

/**
 * Caps a long block at FOLD_AT lines behind a bottom fade, with one control to unfold it. The
 * collapsed height is measured from the rendered <pre> (its real line-height + padding) rather than
 * guessed, so exactly 24 lines show and the fold never cuts a line in half. Expansion animates the
 * height on the product curve; reduced motion snaps. Horizontal scrolling stays inside the clipped
 * region, so wide code still scrolls while folded.
 */
function Fold({ lines, enabled, children }: { lines: number; enabled: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [collapsedH, setCollapsedH] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const still = useReducedMotion()

  useLayoutEffect(() => {
    if (!enabled) return
    const pre = ref.current?.querySelector("pre")
    if (!pre) return
    const cs = getComputedStyle(pre)
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5 || 21
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
    setCollapsedH(Math.round(FOLD_AT * lh + pad))
  }, [enabled, children])

  if (!enabled) return <>{children}</>

  const hidden = lines - FOLD_AT
  return (
    <div>
      <div className="relative">
        <motion.div
          ref={ref}
          initial={false}
          animate={{ height: open || collapsedH == null ? "auto" : collapsedH }}
          transition={still ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
        {/* Fade over the last lines while folded; fades itself out on expand so the seam never pops. */}
        <div
          aria-hidden
          className={cn(
            "from-background/95 pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-linear-to-t to-transparent transition-opacity duration-200",
            open ? "opacity-0" : "opacity-100"
          )}
        />
      </div>
      <div className="border-border bg-muted/40 flex justify-center border-t">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center justify-center gap-1.5 px-3 py-2 text-micro font-medium transition-colors"
        >
          <ChevronDown className={cn("size-3.5 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
          {open ? "Show less" : `Show ${hidden} more ${hidden === 1 ? "line" : "lines"}`}
        </button>
      </div>
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


/**
 * One-shot highlight to HTML for editors that draw their own text layer (the JSON editor): both
 * themes as CSS variables, so `.dark` flips colours without re-highlighting. Null until the grammar
 * is loaded, or for languages we do not bundle.
 */
export async function highlightHtml(code: string, language: string, dark: boolean): Promise<string | null> {
  const hl = await getHighlighter()
  const lang = await ensureLang(hl, language)
  if (!lang) return null
  return hl.codeToHtml(code, { lang, theme: dark ? "github-dark" : "github-light" })
}

/** A highlighted token: text plus its theme colour (absent → inherit). */
export type CodeToken = { content: string; color?: string }

/**
 * Per-line tokens for blocks that lay out their own lines (the annotate gutter). React renders the
 * spans, so no HTML sink is involved. Null for languages we do not bundle (caller draws plain text).
 */
export async function highlightTokens(code: string, language: string, dark: boolean): Promise<CodeToken[][] | null> {
  const hl = await getHighlighter()
  const lang = await ensureLang(hl, language)
  if (!lang) return null
  return hl.codeToTokens(code, { lang, theme: dark ? "github-dark" : "github-light" }).tokens.map((line) => line.map((t) => ({ content: t.content, color: t.color })))
}

