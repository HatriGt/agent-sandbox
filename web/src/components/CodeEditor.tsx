import * as React from "react";
import { highlightHtml, useIsDark } from "@/components/ui/code-block";
import { cn } from "@/lib/utils";

/**
 * A small code editor, the way an IDE shows a file: line-number gutter, syntax colours (shiki,
 * same themes as the rest of the console), caret line and an optional error line marked. It is a
 * plain <textarea> underneath — every keyboard behaviour is the browser's — with a highlighted <pre>
 * drawn exactly behind it. Tab inserts two spaces, Enter keeps indentation, ⌘/Ctrl+S saves.
 * Languages we don't bundle fall back to plain text (still editable, still legible).
 */
export function CodeEditor({
  value,
  onChange,
  onSave,
  language = "json",
  errorLine,
  minRows = 16,
  readOnly = false,
  className,
  ariaLabel = "Code",
}: {
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
  language?: string;
  /** 1-based line to mark red (from a parse error), if any. */
  errorLine?: number | null;
  minRows?: number;
  readOnly?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const dark = useIsDark();
  const [html, setHtml] = React.useState<string | null>(null);
  const [caretLine, setCaretLine] = React.useState(1);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const preRef = React.useRef<HTMLDivElement>(null);
  const gutterRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let alive = true;
    // Very large files skip highlighting (the regex engine is O(n) per line but the DOM is not).
    if (value.length > 200_000) {
      setHtml(null);
      return;
    }
    highlightHtml(value.endsWith("\n") ? value + " " : value, language, dark).then((h) => alive && setHtml(h));
    return () => {
      alive = false;
    };
  }, [value, dark, language]);

  const lines = React.useMemo(() => value.split("\n").length, [value]);
  const rows = Math.max(minRows, lines);

  const syncScroll = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };
  const updateCaret = () => {
    const ta = taRef.current;
    if (!ta) return;
    setCaretLine(value.slice(0, ta.selectionStart).split("\n").length);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave?.();
      return;
    }
    if (readOnly) return;
    if (e.key === "Tab") {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = ta;
      onChange(value.slice(0, s) + "  " + value.slice(en));
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 2;
      });
    } else if (e.key === "Enter") {
      const s = ta.selectionStart;
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const indent = /^[ \t]*/.exec(value.slice(lineStart, s))?.[0] ?? "";
      const prev = value[s - 1];
      const extra = prev === "{" || prev === "[" || prev === "(" || prev === ":" ? "  " : "";
      e.preventDefault();
      const insert = "\n" + indent + extra;
      onChange(value.slice(0, s) + insert + value.slice(ta.selectionEnd));
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + insert.length;
      });
    }
  };

  const mono = "font-mono text-code";
  return (
    <div className={cn("bg-card relative flex overflow-hidden", className)}>
      <div ref={gutterRef} aria-hidden className={cn("bg-muted/40 text-muted-foreground/70 shrink-0 overflow-hidden border-r px-2 py-3 text-right select-none", mono)} style={{ minWidth: `${String(rows).length + 1.5}ch` }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={cn(i + 1 === caretLine && "text-foreground", i + 1 === errorLine && "text-destructive font-semibold")}>
            {i + 1}
          </div>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden py-3", mono)}>
          {errorLine != null && errorLine >= 1 && errorLine <= rows && <div className="bg-destructive/10 absolute right-0 left-0" style={{ top: `calc(0.75rem + ${(errorLine - 1) * 1.6}em)`, height: "1.6em" }} />}
          {errorLine !== caretLine && <div className="bg-foreground/[0.035] absolute right-0 left-0" style={{ top: `calc(0.75rem + ${(caretLine - 1) * 1.6}em)`, height: "1.6em" }} />}
        </div>
        <div ref={preRef} aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden px-3 py-3 whitespace-pre", mono, "[&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:!p-0 [&_code]:!bg-transparent")}>
          {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="text-foreground">{value}</pre>}
        </div>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          onKeyUp={updateCaret}
          onClick={updateCaret}
          onSelect={updateCaret}
          readOnly={readOnly}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          rows={rows}
          wrap="off"
          aria-label={ariaLabel}
          className={cn("caret-foreground relative block w-full resize-none bg-transparent px-3 py-3 whitespace-pre text-transparent outline-none selection:bg-[oklch(0.62_0.19_255/0.25)]", mono)}
        />
      </div>
    </div>
  );
}
