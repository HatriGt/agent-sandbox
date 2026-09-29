import { cn } from "@/lib/utils"
import { marked } from "marked"
import { Children, isValidElement, memo, useId, useMemo, type ReactElement, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { normalizeBlocks } from "@/lib/markdown-normalize"
import { isCodeBlock } from "@/lib/markdown-code"
import { CodeBlock, CodeBlockCode } from "./code-block"
import { LinkChip } from "./link-chip"
import { smartBlock, tableFromMarkdown } from "@/components/viz/SmartBlock"
import { ChecklistCard, taskItems } from "@/components/viz/ChecklistCard"
import { CalloutBlock, alertFromBlockquote } from "@/components/viz/CalloutBlock"
import { calloutKind } from "@/lib/viz-extra"

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

    const language = extractLanguage(className)

    // Output visualizers (docs/output-visualizers.md): opt-in fences (chart / stats / flow / tree /
    // csv / tsv), parseable json, and auto-detected ASCII trees render rich; anything the router
    // does not confidently understand — including a fence still streaming in — stays a code block.
    const rich = smartBlock(language, text)
    if (rich) return rich

    return (
      <CodeBlock className={className}>
        <CodeBlockCode code={text} language={language} />
      </CodeBlock>
    )
  },
  // GFM tables upgrade to the sortable DataTable (numeric alignment, magnitude bars, copy CSV).
  // …but only when there is enough data to sort: a three-row table under a paragraph is prose, and
  // the sortable chrome (toolbar, magnitude bars) would outweigh it.
  table: function TableComponent({ children }) {
    const bodyRows = Children.toArray(children)
      .filter((s): s is ReactElement<{ children?: ReactNode }> => isValidElement(s) && s.type === "tbody")
      .reduce((n, s) => n + Children.toArray(s.props.children).length, 0)
    const rich = bodyRows >= 5 ? tableFromMarkdown(children) : null
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
