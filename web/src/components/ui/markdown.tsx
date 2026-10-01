import { cn } from "@/lib/utils"
import { marked } from "marked"
import { Children, isValidElement, memo, useId, useMemo, type ReactElement, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { normalizeBlocks } from "@/lib/markdown-normalize"
import { isCodeBlock } from "@/lib/markdown-code"
import { splitOpenFence } from "@/lib/markdown-stream"
import { CodeBlock, CodeBlockCode } from "./code-block"
import { LinkChip } from "./link-chip"
import { smartBlock, tableFromMarkdown } from "@/components/viz/SmartBlock"
import { ChecklistCard, taskItems } from "@/components/viz/ChecklistCard"
import { DefinitionListBlock, StatusListBlock, listItemTexts } from "@/components/viz/ListBlocks"
import { LinksBlock } from "@/components/viz/AutoBlocks"
import { parseDefinitions, parseLinks, parseStatusItems } from "@/lib/viz-auto"
import { CalloutBlock, alertFromBlockquote } from "@/components/viz/CalloutBlock"
import { calloutKind } from "@/lib/viz-extra"
import { nodeText } from "@/lib/viz"
import { progressFromItems, tableWorthRich } from "@/lib/viz-tool-output"
import { ProgressBlock } from "@/components/viz/SmallBlocks"
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
      return (
        <code
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
        </code>
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
  table: function TableComponent({ children }) {
    const body = Children.toArray(children)
      .filter((s): s is ReactElement<{ children?: ReactNode }> => isValidElement(s) && s.type === "tbody")
      .flatMap((s) => Children.toArray(s.props.children))
      .filter((tr): tr is ReactElement<{ children?: ReactNode }> => isValidElement(tr))
      .map((tr) =>
        Children.toArray(tr.props.children)
          .filter((c): c is ReactElement<{ children?: ReactNode }> => isValidElement(c))
          .map((c) => nodeText(c.props.children).trim())
      )
    const rich = tableWorthRich(body) ? tableFromMarkdown(children) : null
    if (rich) return rich
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    )
  },
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
  pre: function PreComponent({ children }) {
    return <>{children}</>
  },
  // Every link — typed `[text](url)` or an autolinked bare URL — renders as a chip with an icon for
  // what it points at and a short label (`queue-service#142`, `github.com/acme/…`).
  a: function LinkComponent({ href, children }) {
    if (!href) return <>{children}</>
    return <LinkChip href={href}>{children}</LinkChip>
  },
}

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    components = INITIAL_COMPONENTS,
  }: {
    content: string
    components?: Partial<Components>
  }) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    )
  },
  function propsAreEqual(prevProps, nextProps) {
    return prevProps.content === nextProps.content
  }
)

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock"

function MarkdownComponent({
  children,
  id,
  className,
  components = INITIAL_COMPONENTS,
}: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children])

  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          key={`${blockId}-block-${index}`}
          content={block}
          components={components}
        />
      ))}
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown }
