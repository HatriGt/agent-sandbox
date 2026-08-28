import * as React from "react";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars, scrollPastEnd } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, HighlightStyle, StreamLanguage, LanguageDescription } from "@codemirror/language";
import { unifiedMergeView } from "@codemirror/merge";
import { tags as t } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { yaml } from "@codemirror/lang-yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { useIsDark } from "@/components/ui/code-block";
import { cn } from "@/lib/utils";

/**
 * The code editor, on CodeMirror 6 — a real editor: one scroller, native selection, undo history,
 * ⌘F search, bracket matching, folding, indentation-aware Enter, Tab as indent. Themed from the
 * console's own tokens (fonts, `--text-code`, muted/foreground), light and dark. `onChange` fires on
 * every document change so the caller can autosave; ⌘S calls `onSave`. `UnifiedDiff` renders the
 * HEAD version against the working copy as a unified merge view with per-hunk accept/revert.
 */
export function languageFor(path: string): Extension {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : base;
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "json":
    case "jsonc":
    case "json5":
      return json();
    case "md":
    case "markdown":
    case "mdx":
      return markdown({ codeLanguages: [LanguageDescription.of({ name: "javascript", alias: ["js", "ts"], load: async () => javascript() })] });
    case "py":
      return python();
    case "css":
    case "scss":
      return css();
    case "html":
    case "htm":
    case "vue":
    case "svelte":
      return html();
    case "yml":
    case "yaml":
      return yaml();
    case "sh":
    case "bash":
    case "zsh":
    case "dockerfile":
      return StreamLanguage.define(shell);
    default:
      return [];
  }
}

// Highlight styles in the console's palette (same hues shiki's github themes use, so code blocks and
// the editor agree). Light/dark picked by the `.dark` class through CSS variables where possible.
const lightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword], color: "#cf222e" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "#0a3069" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#0550ae" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: "#8250df" },
  { tag: [t.typeName, t.className, t.namespace], color: "#953800" },
  { tag: [t.propertyName, t.attributeName], color: "#0550ae" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#6e7781", fontStyle: "italic" },
  { tag: [t.variableName], color: "#24292f" },
  { tag: t.heading, fontWeight: "600", color: "#0550ae" },
  { tag: [t.link, t.url], color: "#0a3069", textDecoration: "underline" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.invalid, color: "#f85149" },
]);
const darkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword], color: "#ff7b72" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "#a5d6ff" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#79c0ff" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: "#d2a8ff" },
  { tag: [t.typeName, t.className, t.namespace], color: "#ffa657" },
  { tag: [t.propertyName, t.attributeName], color: "#79c0ff" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#8b949e", fontStyle: "italic" },
  { tag: [t.variableName], color: "#e6edf3" },
  { tag: t.heading, fontWeight: "600", color: "#79c0ff" },
  { tag: [t.link, t.url], color: "#a5d6ff", textDecoration: "underline" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.invalid, color: "#ff7b72" },
]);

/** Structural theme: our fonts and tokens; colours come from CSS variables so light/dark just work. */
const chrome = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--text-code)", backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6", overflow: "auto" },
  ".cm-content": { padding: "10px 0 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 14px 0 6px" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": { backgroundColor: "transparent", color: "color-mix(in oklch, var(--muted-foreground) 70%, transparent)", border: "none", paddingLeft: "6px" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 6px", minWidth: "3.2ch" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--foreground) 3.5%, transparent)" },
  ".cm-foldGutter .cm-gutterElement": { color: "var(--muted-foreground)", opacity: "0.6" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in oklch, var(--live) 22%, transparent) !important" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)", borderLeftWidth: "1.5px" },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in oklch, var(--live) 18%, transparent)", outline: "1px solid color-mix(in oklch, var(--live) 40%, transparent)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in oklch, var(--attention) 22%, transparent)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in oklch, var(--attention) 35%, transparent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in oklch, var(--attention) 60%, transparent)" },
  ".cm-panels": { backgroundColor: "var(--card)", color: "var(--foreground)", borderColor: "var(--border)", fontFamily: "var(--font-sans)", fontSize: "12px" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panel.cm-search": { padding: "6px 10px" },
  ".cm-panel.cm-search input, .cm-panel.cm-search button": { fontFamily: "var(--font-sans)", fontSize: "12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", padding: "2px 8px" },
  ".cm-panel.cm-search label": { fontSize: "11px", color: "var(--muted-foreground)" },
  // Merge view
  ".cm-changedLine": { backgroundColor: "color-mix(in oklch, var(--ok) 12%, transparent)" },
  ".cm-deletedChunk": { backgroundColor: "color-mix(in oklch, var(--destructive) 10%, transparent)", padding: "0 14px 0 6px" },
  ".cm-deletedChunk .cm-deletedText": { textDecoration: "none", backgroundColor: "color-mix(in oklch, var(--destructive) 22%, transparent)" },
  ".cm-changedText": { backgroundColor: "color-mix(in oklch, var(--ok) 28%, transparent)" },
  ".cm-changeGutter": { width: "3px", paddingLeft: "2px" },
  ".cm-changedLineGutter": { backgroundColor: "var(--ok)" },
  ".cm-deletedLineGutter": { backgroundColor: "var(--destructive)" },
  ".cm-chunkButtons": { fontFamily: "var(--font-sans)", fontSize: "11px" },
  ".cm-chunkButtons button": { color: "var(--muted-foreground)", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "5px", padding: "1px 6px", marginLeft: "4px", cursor: "pointer" },
});

const baseExtensions = (readOnly: boolean): Extension => [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter({ openText: "▾", closedText: "▸" }),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  scrollPastEnd(),
  keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
  EditorState.readOnly.of(readOnly),
  EditorView.editable.of(!readOnly),
  chrome,
];

export function CodeEditor({
  value,
  onChange,
  onSave,
  language = "",
  path,
  readOnly = false,
  className,
  ariaLabel = "Code",
  autoFocus = false,
}: {
  value: string;
  onChange?: (v: string) => void;
  onSave?: () => void;
  /** Explicit language name, or leave empty and pass `path` to detect from the extension. */
  language?: string;
  path?: string;
  readOnly?: boolean;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const view = React.useRef<EditorView | null>(null);
  const dark = useIsDark();
  const themeComp = React.useRef(new Compartment());
  const langComp = React.useRef(new Compartment());
  const onChangeRef = React.useRef(onChange);
  const onSaveRef = React.useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  const langExt = React.useMemo(() => languageFor(path ?? (language ? `x.${language === "typescript" ? "ts" : language === "javascript" ? "js" : language}` : "")), [path, language]);

  React.useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        baseExtensions(readOnly),
        themeComp.current.of(syntaxHighlighting(dark ? darkHighlight : lightHighlight)),
        langComp.current.of(langExt),
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
        }),
        EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    if (autoFocus) v.focus();
    return () => {
      v.destroy();
      view.current = null;
    };
    // The document is seeded once; later external changes are applied through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // Theme + language follow props without recreating the view (keeps undo history and scroll).
  React.useEffect(() => {
    view.current?.dispatch({ effects: themeComp.current.reconfigure(syntaxHighlighting(dark ? darkHighlight : lightHighlight)) });
  }, [dark]);
  React.useEffect(() => {
    view.current?.dispatch({ effects: langComp.current.reconfigure(langExt) });
  }, [langExt]);
  // External value change (a different file, or a reload) — only when it differs from the doc.
  React.useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  return <div ref={host} className={cn("cm-host h-full min-h-0 w-full overflow-hidden text-code", className)} />;
}

/** Unified merge view: HEAD (original) vs the working copy, with accept/revert per hunk (read-only). */
export function UnifiedDiff({ original, modified, path, className }: { original: string; modified: string; path: string; className?: string }) {
  const host = React.useRef<HTMLDivElement>(null);
  const dark = useIsDark();
  React.useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: modified,
      extensions: [
        baseExtensions(true),
        syntaxHighlighting(dark ? darkHighlight : lightHighlight),
        languageFor(path),
        unifiedMergeView({ original, mergeControls: false, highlightChanges: true, gutter: true, collapseUnchanged: { margin: 3, minSize: 6 } }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    return () => v.destroy();
  }, [original, modified, path, dark]);
  return <div ref={host} className={cn("cm-host h-full min-h-0 w-full overflow-hidden text-code", className)} />;
}
