import { cn } from "@/lib/utils"
import { marked } from "marked"
import { Children, createContext, isValidElement, memo, useCallback, useContext, useId, useMemo, useState, type ComponentProps, type ReactElement, type ReactNode } from "react"
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { ArrowUpRight, Check, Ellipsis, Link2 } from "lucide-react"
import { toast } from "sonner"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu"
import { csvField } from "@/lib/viz"
import "@/styles/markdown.css"
import { normalizeBlocks } from "@/lib/markdown-normalize"
import { isCodeBlock } from "@/lib/markdown-code"
import { splitOpenFence } from "@/lib/markdown-stream"
import { CodeBlock, CodeBlockCode } from "./code-block"
import { LinkChip } from "./link-chip"
import { CodeRefLink, CodeRefScope, InlineCode } from "./code-ref"
import { parseCodeRef } from "@/lib/code-refs"
import { smartBlock, tableFromMarkdown } from "@/components/viz/SmartBlock"
import { ChecklistCard, taskItems } from "@/components/viz/ChecklistCard"
import { DefinitionListBlock, StatusListBlock, listItemTexts } from "@/components/viz/ListBlocks"
import { LinksBlock } from "@/components/viz/AutoBlocks"
import { parseDefinitions, parseLinks, parseStatusItems, procedureFromItems } from "@/lib/viz-auto"
import { CalloutBlock, alertFromBlockquote } from "@/components/viz/CalloutBlock"
import { calloutKind } from "@/lib/viz-extra"
import { nodeText } from "@/lib/viz"
import { progressFromItems, tableWorthRich } from "@/lib/viz-tool-output"
import { ProgressBlock } from "@/components/viz/SmallBlocks"
import { StepsBlock } from "@/components/viz/TimelineBlock"
import { COPY_LANG, splitLiveTag } from "@/lib/viz-identity"
import { LiveCopyRow, LiveSlotContext } from "@/components/viz/live-blocks"

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Partial<Components>
}

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(normalizeBlocks(markdown))
  return tokens.map((token) => token.raw)
}

// ---------------------------------------------------------------- headings: stable ids

/** "Sliding-window limiter is in" → "sliding-window-limiter-is-in" (GitHub-style; markup stripped). */
export function slugify(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
}

/** One id per heading block, de-duplicated across the document: `done`, `done-1`, `done-2`. */
export function headingIds(blocks: string[]): (string | undefined)[] {
  const seen = new Map<string, number>()
  return blocks.map((raw) => {
    const m = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw.trim().split("\n")[0])
    if (!m) return undefined
    const base = slugify(m[1]) || "section"
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n ? `${base}-${n}` : base
  })
}

/** The id the enclosing block was assigned (marked emits one block per heading, so one id each). */
const HeadingIdContext = createContext<string | undefined>(undefined)

function HeadingAnchor({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    const hash = `#${id}`
    void navigator.clipboard?.writeText(hash).then(
      () => {
        setCopied(true)
        toast.success("Section link copied", { description: hash })
        window.setTimeout(() => setCopied(false), 1600)
      },
      () => toast.error("Could not copy")
    )
  }, [id])
  return (
    <button type="button" className="md-anchor no-press" onClick={copy} aria-label="Copy link to this section" title="Copy link">
      {copied ? <Check className="size-3.5 text-ok" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
    </button>
  )
}

function heading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  const Tag = `h${level}` as const
  return function HeadingComponent({ children, node: _node, ...props }: ComponentProps<typeof Tag> & { node?: unknown }) {
    const id = useContext(HeadingIdContext)
    return (
      <Tag id={id} className="md-heading" {...props}>
        {children}
        {id && <HeadingAnchor id={id} />}
      </Tag>
    )
  }
}

// ---------------------------------------------------------------- tables: copy menu

type TableCells = { head: string[]; rows: string[][] }

/** The same thead/tbody walk as viz/SmartBlock.tsx `tableFromMarkdown`, kept to each cell's text. */
function tableCells(children: ReactNode): TableCells {
  let head: string[] = []
  const rows: string[][] = []
  for (const section of Children.toArray(children)) {
    if (!isValidElement<{ children?: ReactNode }>(section)) continue
    const isHead = section.type === "thead"
    for (const tr of Children.toArray(section.props.children)) {
      if (!isValidElement<{ children?: ReactNode }>(tr)) continue
      const cells = Children.toArray(tr.props.children)
        .filter((c): c is ReactElement<{ children?: ReactNode }> => isValidElement(c))
        .map((c) => nodeText(c.props.children).trim())
      if (isHead && !head.length) head = cells
      else rows.push(cells)
    }
  }
  return { head, rows }
}

export function tableToMarkdown({ head, rows }: TableCells): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ")
  const line = (r: string[]) => `| ${r.map(cell).join(" | ")} |`
  return [line(head), `| ${head.map(() => "---").join(" | ")} |`, ...rows.map(line)].join("\n")
}

export function tableToCsv({ head, rows }: TableCells): string {
  return [head, ...rows].map((r) => r.map(csvField).join(",")).join("\n")
}

/**
 * The frame around every table: the table itself plus a hover-revealed "⋯" at its top-right with
 * Copy as Markdown / Copy as CSV. A rich table (DataTable inside a VizFrame) already has a toolbar
 * row there, so the trigger sits inside that row, left of the frame's own icons (`data-rich`).
 */
function TableFrame({ cells, rich, children }: { cells: TableCells; rich: boolean; children: ReactNode }) {
  const copy = (what: "Markdown" | "CSV") => {
    const text = what === "CSV" ? tableToCsv(cells) : tableToMarkdown(cells)
    void navigator.clipboard?.writeText(text).then(
      () => toast.success(`Table copied as ${what}`),
      () => toast.error("Could not copy")
    )
  }
  return (
    <div className="md-table" data-rich={rich || undefined}>
      {children}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="md-table-menu no-press" aria-label="Table options">
            <Ellipsis className="size-3.5" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[11rem]">
          <DropdownMenuItem onSelect={() => copy("Markdown")}>Copy as Markdown</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copy("CSV")}>Copy as CSV</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** A link that leaves this origin: absolute http(s) to another host. */
function isExternal(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false
  try {
    return new URL(href).origin !== location.origin
  } catch {
    return false
  }
}

function extractLanguage(className?: string): string {
  if (!className) return "plaintext"
  const match = className.match(/language-(\w+)/)
  return match ? match[1] : "plaintext"
}

const INITIAL_COMPONENTS: Partial<Components> = {
  code: function CodeComponent({ className, children, ...props }) {
    // Block vs inline, decided by CONTENT not source geometry. The old heuristic
    // (start.line === end.line → inline) misclassified any fenced block whose content happens to be
    // one line, and worse, sent multi-line fenced content down the inline <span> path — collapsing
    // code/JSON/ASCII art into a proportional-font, whitespace-normalized blob. A node is a block
    // whenever it carries a `language-*` class (always set by remark for a fenced ``` block) OR its
    // text contains a newline (a fenced block with no language, e.g. plain ASCII art). Only genuine
    // single-line inline code (`like this`) takes the <span> path.
    const text = typeof children === "string" ? children : Array.isArray(children) ? children.join("") : ""

    if (!isCodeBlock(className, text)) {
      // On the box page a path (`web/src/x.ts:42`) or a symbol bound earlier in the message opens
      // the file in the workspace; everywhere else, and for anything unresolved, plain inline code.
      return (
        <InlineCode
          text={text}
          className={cn(
            // A tinted chip, not the invisible near-white fill this used to carry. Claude's inline
            // code is a subtle bg + a distinct accent text colour; we mirror that with our tokens so
            // `inline code` reads as code against prose in both themes.
            "font-mono [overflow-wrap:anywhere] whitespace-pre-wrap",
            className
          )}
          {...props}
        >
          {children}
        </InlineCode>
      )
    }

    // A fence still streaming in arrives tagged `<lang>__open` (lib/markdown-stream.ts).
    // A live block (lib/viz-identity.ts) is tagged `<lang>__live<n>`; a collapsed later copy is `vizwas`.
    const { language: tagged, open } = splitOpenFence(extractLanguage(className))
    if (tagged === COPY_LANG) return <LiveCopyRow spec={text} />
    const { language, slot } = splitLiveTag(tagged)

    // Output visualizers (docs/output-visualizers.md): opt-in fences (chart / stats / flow / tree /
    // csv / tsv), parseable json, and auto-detected ASCII trees render rich; anything the router
    // does not confidently understand stays a code block. An OPEN fence of a visual language draws
    // the part that has arrived (or a skeleton) so it never flips from code into a chart.
    // Always the same provider element around the block, so a fence that becomes a live slot (or
    // gets a new version) keeps its mounted visual: values tween instead of the block replaying.
    const rich = smartBlock(language, text, { open })
    return (
      <LiveSlotContext.Provider value={slot}>
        {rich ?? (
          <CodeBlock className={`language-${language}`}>
            <CodeBlockCode code={text} language={language} />
          </CodeBlock>
        )}
      </LiveSlotContext.Provider>
    )
  },
  // GFM tables upgrade to the sortable DataTable (numeric alignment, magnitude bars, copy CSV).
  // …but only when there is something to sort or chart: three or more rows, or two rows with a
  // numeric column. A two-row table of words under a paragraph is prose; card chrome would outweigh it.
  // Every table, rich or plain, gets a hover-revealed copy menu (Markdown / CSV) at its top-right.
  table: function TableComponent({ children }) {
    const cells = tableCells(children)
    const rich = tableWorthRich(cells.rows) ? tableFromMarkdown(children) : null
    return (
      <TableFrame cells={cells} rich={!!rich}>
        {rich ?? (
          <div className="table-wrap">
            <table>{children}</table>
          </div>
        )}
      </TableFrame>
    )
  },
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),
  // GitHub-style alerts (`> [!NOTE]` …) upgrade to callout cards; ordinary quotes stay quotes.
  blockquote: function BlockquoteComponent({ children, node: _node, ...props }) {
    const alert = alertFromBlockquote(children, calloutKind)
    if (alert) return <CalloutBlock kind={alert.kind}>{alert.children}</CalloutBlock>
    return <blockquote {...props}>{children}</blockquote>
  },
  // Task lists upgrade to a checklist card with a progress line; ordinary lists stay untouched.
  ul: function ListComponent({ children, node: _node, ...props }) {
    const items = taskItems(children)
    if (items) return <ChecklistCard items={items} />
    // Lists that are really structures: every item `Term — detail` (a glossary, a file-by-file
    // summary) or every item opening with a status glyph (a checks report). Mixed lists stay lists.
    const texts = listItemTexts(children)
    if (texts) {
      // Every item `label: NN%` / `label: a/b` → progress bars, no fence needed.
      const progress = progressFromItems(texts)
      if (progress) return <ProgressBlock rows={progress} source={texts.join("\n")} />
      const joined = texts.join("\n")
      const links = parseLinks(joined)
      if (links) return <LinksBlock links={links} source={joined} />
      const status = parseStatusItems(texts)
      if (status) return <StatusListBlock items={status} />
      const defs = parseDefinitions(texts)
      if (defs) return <DefinitionListBlock items={defs} />
    }
    return <ul {...props}>{children}</ul>
  },
  // Numbered walkthroughs ("1. Exits early… 2. Selects… 3. Groups…") upgrade to a plain procedure
  // card when most items open with a verb; narrative numbered lists stay stock. The rendered `<li>`
  // children stay as the step titles so inline code chips survive the upgrade.
  ol: function OrderedListComponent({ children, node: _node, ...props }) {
    const texts = listItemTexts(children)
    const steps = texts ? procedureFromItems(texts) : null
    if (steps && texts) {
      const titles = Children.toArray(children)
        .filter((li): li is ReactElement<{ children?: ReactNode }> => isValidElement(li))
        .map((li) => li.props.children)
      if (titles.length === steps.length) return <StepsBlock steps={steps.map((s, i) => ({ ...s, title: titles[i] }))} source={texts.map((t, i) => `${i + 1}. ${t}`).join("\n")} />
    }
    return <ol {...props}>{children}</ol>
  },
  pre: function PreComponent({ children }) {
    return <>{children}</>
  },
  // Every link — typed `[text](url)` or an autolinked bare URL — renders as a chip with an icon for
  // what it points at and a short label (`queue-service#142`, `github.com/acme/…`). A link that
  // leaves the site says so: it opens in a new tab (rel=noreferrer) and carries a small outward
  // arrow after it. Same-origin and in-page links stay in this tab, plain, with no glyph.
  a: function LinkComponent({ href, children }) {
    if (!href) return <>{children}</>
    // A relative path (`[parseDag](web/src/lib/viz-extra.ts:515)`) is a code ref, not a web link.
    const ref = parseCodeRef(href)
    const chip = <LinkChip href={href}>{children}</LinkChip>
    if (ref) return <CodeRefLink parsed={ref} fallback={chip}>{children}</CodeRefLink>
    if (isExternal(href))
      return (
        <span className="md-ext">
          {chip}
          <ArrowUpRight className="md-ext-glyph size-3 text-faint" aria-hidden />
        </span>
      )
    return <a href={href}>{children}</a>
  },
}

// `viz.ts:42` looks like a `viz.ts:` scheme to the default sanitiser, which would blank it; a
// relative code path is kept as written (it never becomes an href — see the `a` override).
const urlTransform = (url: string) => (parseCodeRef(url) && !/^[a-z][\w+.-]*:\/\//i.test(url) ? url : defaultUrlTransform(url))

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    headingId,
    components = INITIAL_COMPONENTS,
  }: {
    content: string
    headingId?: string
    components?: Partial<Components>
  }) {
    return (
      <HeadingIdContext.Provider value={headingId}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
          {content}
        </ReactMarkdown>
      </HeadingIdContext.Provider>
    )
  },
  function propsAreEqual(prevProps, nextProps) {
    return prevProps.content === nextProps.content && prevProps.headingId === nextProps.headingId
  }
)

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock"

function MarkdownComponent({
  children,
  id,
  className,
  components: overrides,
}: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children])
  const ids = useMemo(() => headingIds(blocks), [blocks])
  // Caller overrides layer OVER the defaults: a surface that only wants to wrap `p`/`li` (the
  // streaming reveal's fresh-word spans) must not lose code blocks, tables, headings and links.
  // Pass a stable object to keep the per-block memo intact.
  const components = useMemo(() => (overrides ? { ...INITIAL_COMPONENTS, ...overrides } : INITIAL_COMPONENTS), [overrides])

  return (
    <div className={className}>
      <CodeRefScope markdown={children}>
        {blocks.map((block, index) => (
          <MemoizedMarkdownBlock
            key={`${blockId}-block-${index}`}
            content={block}
            headingId={ids[index]}
            components={components}
          />
        ))}
      </CodeRefScope>
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown }
