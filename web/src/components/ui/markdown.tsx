import { cn } from "@/lib/utils"
import { marked } from "marked"
import { memo, useId, useMemo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { normalizeBlocks } from "@/lib/markdown-normalize"
import { isCodeBlock } from "@/lib/markdown-code"
import { CodeBlock, CodeBlockCode } from "./code-block"

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
            "bg-muted text-foreground border-border rounded-md border px-1.5 py-0.5 font-mono text-[0.85em]",
            className
          )}
          {...props}
        >
          {children}
        </code>
      )
    }

    const language = extractLanguage(className)

    return (
      <CodeBlock className={className}>
        <CodeBlockCode code={text} language={language} />
      </CodeBlock>
    )
  },
  pre: function PreComponent({ children }) {
    return <>{children}</>
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
