import * as React from "react"
import { api } from "@/lib/api"
import { parseCodeRef, pathResolver, refLabel, symbolRefs, type CodeRef } from "@/lib/code-refs"
import { useSession } from "@/lib/session-context"
import { cn } from "@/lib/utils"

/** Provided by the box page (Thread): opens a file in the workspace at a line. Absent elsewhere. */
export const CodeNavContext = React.createContext<((ref: CodeRef) => void) | null>(null)

/** Symbols bound to locations in the message being rendered (lib/code-refs.ts symbolRefs). */
const SymbolContext = React.createContext<Map<string, CodeRef> | null>(null)
// Inside a ref already (`[`parseDag`](x.ts:5)`): inner code must not nest a second link.
const InRefContext = React.createContext(false)

export function CodeRefScope({ markdown, children }: { markdown: string; children: React.ReactNode }) {
  const nav = React.useContext(CodeNavContext)
  const symbols = React.useMemo(() => (nav ? symbolRefs(markdown) : null), [nav, markdown])
  return <SymbolContext.Provider value={symbols}>{children}</SymbolContext.Provider>
}

// One tree fetch per box, shared by every ref on the page.
type Resolve = (path: string) => string | null
const resolvers = new Map<string, Promise<Resolve>>()
function loadResolver(session: string): Promise<Resolve> {
  let p = resolvers.get(session)
  if (!p) {
    p = api.tree(session).then((r) => pathResolver(r.files))
    p.catch(() => resolvers.delete(session))
    resolvers.set(session, p)
  }
  return p
}
const ready = new Map<string, Resolve>()
let generation = 0
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function invalidateResolver(session: string): void {
  resolvers.delete(session)
  ready.delete(session)
  generation++
  for (const fn of listeners) fn()
}

function useResolver(session: string | null, enabled: boolean): Resolve | null {
  const gen = React.useSyncExternalStore(subscribe, () => generation)
  const [state, setState] = React.useState<{ gen: number; res: Resolve } | null>(() => {
    const r = session ? ready.get(session) : undefined
    return r ? { gen: generation, res: r } : null
  })
  const res = state && state.gen === gen ? state.res : null
  React.useEffect(() => {
    if (!session || !enabled || res) return
    let live = true
    loadResolver(session)
      .then((r) => {
        ready.set(session, r)
        if (live) setState({ gen, res: r })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [session, enabled, res, gen])
  return res
}

/** The resolved ref (real path in the box) for `parsed`, or null while unknown / unresolvable / off the box page. */
function useResolved(parsed: CodeRef | null): { nav: (r: CodeRef) => void; ref: CodeRef } | null {
  const nav = React.useContext(CodeNavContext)
  const session = useSession()
  const resolve = useResolver(session, !!(nav && parsed))
  if (!nav || !parsed || !resolve) return null
  const path = resolve(parsed.path)
  return path ? { nav, ref: { ...parsed, path } } : null
}

const REF_CLASS =
  "cursor-pointer underline decoration-dotted decoration-from-font underline-offset-[3px] decoration-current/50 transition-colors hover:bg-live/10 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-live rounded-[inherit]"

function RefTrigger({ target, className, children }: { target: { nav: (r: CodeRef) => void; ref: CodeRef }; className?: string; children: React.ReactNode }) {
  const open = (e: React.SyntheticEvent) => {
    e.preventDefault()
    e.stopPropagation()
    target.nav(target.ref)
  }
  return (
    <span
      role="link"
      tabIndex={0}
      title={`Open ${refLabel(target.ref)}`}
      data-code-ref={refLabel(target.ref)}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") open(e)
      }}
      className={cn(REF_CLASS, className)}
    >
      <InRefContext.Provider value={true}>{children}</InRefContext.Provider>
    </span>
  )
}

/**
 * Inline code that may be a code ref (path form, or a symbol bound earlier in the message).
 * `data-line` / `data-end-line` come from remark-code-refs when the prose around the backticks named
 * a line ("lines 3-5 of `x.ts`"); they apply only when the backticks carry no line of their own.
 */
export function InlineCode({ text, children, "data-line": hintLine, "data-end-line": hintEnd, ...props }: React.ComponentProps<"code"> & { text: string; "data-line"?: string; "data-end-line"?: string }) {
  const symbols = React.useContext(SymbolContext)
  const inRef = React.useContext(InRefContext)
  const parsed = React.useMemo(() => {
    if (inRef) return null
    const t = text.trim()
    const ref = parseCodeRef(t) ?? symbols?.get(t.replace(/\(\)$/, "")) ?? symbols?.get(t) ?? null
    const line = Number(hintLine) || undefined
    if (!ref || ref.line !== undefined || line === undefined) return ref
    const endLine = Number(hintEnd) || undefined
    return { ...ref, line, ...(endLine !== undefined && endLine > line && { endLine }) }
  }, [text, symbols, inRef, hintLine, hintEnd])
  const target = useResolved(parsed)
  const code = <code {...props}>{children}</code>
  return target ? <RefTrigger target={target}>{code}</RefTrigger> : code
}

/**
 * A markdown link whose href is a relative path. Off the box page it renders `fallback` (a LinkChip
 * for a typed link, the original words for a ref found in prose); on it, an unresolvable path
 * renders as its plain text — never a broken link.
 */
export function CodeRefLink({ parsed, fallback, children }: { parsed: CodeRef; fallback: React.ReactNode; children: React.ReactNode }) {
  const nav = React.useContext(CodeNavContext)
  const target = useResolved(parsed)
  if (!nav) return <>{fallback}</>
  if (!target) return <>{children}</>
  return <RefTrigger target={target}>{children}</RefTrigger>
}
