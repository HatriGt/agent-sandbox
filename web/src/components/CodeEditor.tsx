import * as React from "react";
import { EditorState, EditorSelection, Compartment, Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, lineNumbers, placeholder, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars, scrollPastEnd } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { closeSearchPanel, highlightSelectionMatches, openSearchPanel, search, searchPanelOpen, selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { AnimatePresence } from "motion/react";
import { EditorFind } from "@/components/EditorFind";
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, HighlightStyle, StreamLanguage, LanguageDescription, LanguageSupport, Language } from "@codemirror/language";
import { classHighlighter, highlightCode, tags as t } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { yaml } from "@codemirror/lang-yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { useIsDark } from "@/components/ui/code-block";
import { symbolsIn, type CodeSymbol } from "@/lib/symbols";
import { cn } from "@/lib/utils";

/**
 * The code editor, on CodeMirror 6 — a real editor: one scroller, native selection, undo history,
 * ⌘F find (the floating `EditorFind` widget), bracket matching, folding, indentation-aware Enter,
 * Tab as indent. Themed from the console's own tokens (fonts, `--text-code`, muted/foreground),
 * light and dark. `onChange` fires on every document change so the caller can autosave; ⌘S calls
 * `onSave`; `onStatus` reports the caret for a status strip. The `ref` handle lets a host open the
 * find widget or focus the editor from a window-level shortcut. `tokenizeLines` lends the same
 * grammars to the two-gutter diff so code reads the same in the editor and in a diff.
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
  // VS Code's fold gutter: a 16px chevron column, open chevrons shown only while the gutter is hovered.
  ".cm-foldGutter .cm-gutterElement": { width: "16px", padding: "0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--muted-foreground)" },
  ".cm-foldGutter .cm-gutterElement:hover": { color: "var(--foreground)" },
  ".cm-foldGutter span": { padding: "0", display: "flex", transition: "opacity 100ms" },
  ".cm-foldGutter span[data-fold=open]": { opacity: "0" },
  ".cm-gutters:hover .cm-foldGutter span[data-fold=open]": { opacity: "1" },
  ":root[data-motion=reduced] & .cm-foldGutter span": { transition: "none" },
  ".cm-foldPlaceholder": { backgroundColor: "color-mix(in oklch, var(--muted-foreground) 14%, transparent)", border: "none", color: "var(--muted-foreground)", borderRadius: "3px", margin: "0 2px", padding: "0 5px", fontSize: "0.85em", cursor: "pointer" },
  ".cm-foldPlaceholder:hover": { backgroundColor: "color-mix(in oklch, var(--muted-foreground) 24%, transparent)", color: "var(--foreground)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in oklch, var(--live) 22%, transparent) !important" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)", borderLeftWidth: "1.5px" },
  // A revealed line (a code ref clicked in chat) flashes, then settles to nothing.
  ".cm-reveal-line": { animation: "cm-reveal 2s ease-out forwards" },
  "@keyframes cm-reveal": { "0%, 35%": { backgroundColor: "color-mix(in oklch, var(--live) 18%, transparent)" }, "100%": { backgroundColor: "transparent" } },
  ".cm-preview-line": { backgroundColor: "color-mix(in oklch, var(--live) 12%, transparent)" },
  ".cm-placeholder": { color: "var(--muted-foreground)", opacity: "0.7", fontStyle: "normal" },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in oklch, var(--live) 18%, transparent)", outline: "1px solid color-mix(in oklch, var(--live) 40%, transparent)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in oklch, var(--attention) 22%, transparent)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in oklch, var(--attention) 35%, transparent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in oklch, var(--attention) 60%, transparent)" },
  // The search panel exists only to switch match highlighting on; the find widget is the UI.
  ".cm-panels": { display: "none" },
});

/**
 * @codemirror/search paints `.cm-searchMatch` only while its panel is open (searchHighlighter checks
 * `panel` before decorating), so the panel is a hidden element and the widget opens and closes it.
 */
const hiddenSearchPanel = () => {
  const dom = document.createElement("div");
  dom.hidden = true;
  return { dom, top: true };
};

/**
 * Authoring, not coding: a touch larger type, looser leading, wider measure padding and a gutter that
 * sits back — for markdown a person writes and reads, like a skill's SKILL.md.
 */
const proseChrome = EditorView.theme({
  "&": { fontSize: "13.5px" },
  ".cm-scroller": { lineHeight: "1.75" },
  ".cm-content": { padding: "18px 0 0" },
  ".cm-line": { padding: "0 24px 0 10px" },
  ".cm-gutters": { color: "color-mix(in oklch, var(--muted-foreground) 45%, transparent)", paddingLeft: "10px" },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "2.6ch", padding: "0 8px 0 4px" },
  ".cm-activeLine": { backgroundColor: "transparent" },
});

const CHEVRON = { open: "m6 9 6 6 6-6", closed: "m9 18 6-6-6-6" };
/** The fold marker: lucide's chevron as a 16px inline SVG, down for an open region, right for a folded one. */
const foldMarker = (open: boolean) => {
  const el = document.createElement("span");
  el.dataset.fold = open ? "open" : "closed";
  el.title = open ? "Fold line" : "Unfold line";
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${open ? CHEVRON.open : CHEVRON.closed}"/></svg>`;
  return el;
};

const baseExtensions = (readOnly: boolean): Extension => [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter({ markerDOM: foldMarker }),
  codeFolding({ placeholderText: "⋯" }),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  search({ createPanel: hiddenSearchPanel, top: true }),
  scrollPastEnd(),
  keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab, { key: "Mod-d", run: selectNextOccurrence, preventDefault: true }, { key: "Shift-Mod-l", run: selectSelectionMatches, preventDefault: true }]),
  EditorState.readOnly.of(readOnly),
  EditorView.editable.of(!readOnly),
  chrome,
];

/** Lines flashed by `reveal` (a tint that fades out) or held tinted while go-to-symbol previews (`steady`). */
const setRevealLines = StateEffect.define<{ from: number; to: number; steady?: boolean } | null>();
const revealLine = Decoration.line({ class: "cm-reveal-line" });
const previewLine = Decoration.line({ class: "cm-preview-line", attributes: { "data-range-highlight": "" } });
const revealField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setRevealLines)) continue;
      if (!e.value) return Decoration.none;
      const doc = tr.state.doc;
      const mark = e.value.steady ? previewLine : revealLine;
      const ranges = [];
      for (let n = e.value.from; n <= e.value.to; n++) ranges.push(mark.range(doc.line(n).from));
      deco = Decoration.set(ranges);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Select lines `from`–`to` (1-based, clamped), centre them and flash them. */
function revealLines(v: EditorView, from: number, to: number) {
  const doc = v.state.doc;
  const a = Math.min(Math.max(1, from), doc.lines);
  const b = Math.min(Math.max(a, to), doc.lines);
  const start = doc.line(a).from;
  v.dispatch({
    selection: EditorSelection.single(start, a === b ? start : doc.line(b).to),
    effects: [setRevealLines.of({ from: a, to: b }), EditorView.scrollIntoView(start, { y: "center" })],
  });
}

/** What a status strip shows: the caret's line and column (1-based) and the main selection's length. */
export type EditorStatus = { line: number; col: number; selected: number };
export type CodeEditorHandle = {
  openFind(): void;
  closeFind(): void;
  focus(): void;
  /** The document's outline, read off the syntax tree. */
  symbols(): CodeSymbol[];
  /** The main selection's head, so go-to-symbol can open on the symbol the caret sits in. */
  caret(): number;
  /**
   * Bring a symbol on screen, centred only when it is off screen, as VS Code reveals. `select` puts
   * the caret at the start of the name with the name selected and focuses the editor; otherwise
   * every line of the declaration is banded and the caret stays put.
   */
  reveal(sym: CodeSymbol, opts: { select: boolean }): void;
  /** Capture scroll and selection; the returned function puts them back and clears the preview tint. */
  snapshot(): () => void;
};

/** Whether `pos` is inside the scroller's visible band; outside the rendered viewport counts as off screen. */
const onScreen = (v: EditorView, pos: number): boolean => {
  const c = v.coordsAtPos(pos);
  if (!c) return false;
  const box = v.scrollDOM.getBoundingClientRect();
  return c.top >= box.top && c.bottom <= box.bottom;
};

const statusOf = (state: EditorState): EditorStatus => {
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  return { line: line.number, col: main.head - line.from + 1, selected: main.to - main.from };
};

export function CodeEditor({
  ref,
  value,
  onChange,
  onSave,
  onStatus,
  language = "",
  path,
  readOnly = false,
  className,
  ariaLabel = "Code",
  autoFocus = false,
  prose = false,
  placeholder: placeholderText,
  reveal,
  wrap = false,
}: {
  ref?: React.Ref<CodeEditorHandle>;
  value: string;
  onChange?: (v: string) => void;
  onSave?: () => void;
  /** The caret moved or the document changed. */
  onStatus?: (s: EditorStatus) => void;
  /** Explicit language name, or leave empty and pass `path` to detect from the extension. */
  language?: string;
  path?: string;
  readOnly?: boolean;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  /** Markdown a person writes: larger type, looser leading, quieter gutter. */
  prose?: boolean;
  /** Shown in the empty document. */
  placeholder?: string;
  /** Scroll to, select and flash lines `from`–`to` (1-based); a new `nonce` repeats it. */
  reveal?: { from: number; to: number; nonce: number };
  /** Soft-wrap long lines. Prose always wraps. */
  wrap?: boolean;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const view = React.useRef<EditorView | null>(null);
  const dark = useIsDark();
  const themeComp = React.useRef(new Compartment());
  const langComp = React.useRef(new Compartment());
  const wrapComp = React.useRef(new Compartment());
  const onChangeRef = React.useRef(onChange);
  const onSaveRef = React.useRef(onSave);
  const onStatusRef = React.useRef(onStatus);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onStatusRef.current = onStatus;
  // The live view as state, so the find widget renders once it exists; `rev` ticks on every
  // document or selection change so the widget's match count follows the editor.
  const [live, setLive] = React.useState<EditorView | null>(null);
  const [rev, setRev] = React.useState(0);
  const [find, setFind] = React.useState({ open: false, nonce: 0 });
  const findOpen = React.useRef(false);
  findOpen.current = find.open;
  // Whether find is wanted, independent of the view: a host may ask before the view mounts (⌘F on
  // a tab still loading), and the view is recreated under StrictMode and on a readOnly change.
  const findWanted = React.useRef(false);
  const openFind = React.useCallback(() => {
    findWanted.current = true;
    const v = view.current;
    if (!v) return;
    if (!searchPanelOpen(v.state)) openSearchPanel(v);
    setFind((f) => ({ open: true, nonce: f.nonce + 1 }));
  }, []);
  const closeFind = React.useCallback(() => {
    findWanted.current = false;
    const v = view.current;
    if (v) {
      closeSearchPanel(v);
      v.focus();
    }
    setFind((f) => (f.open ? { ...f, open: false } : f));
  }, []);
  React.useImperativeHandle(
    ref,
    () => ({
      openFind,
      closeFind,
      focus: () => view.current?.focus(),
      symbols: () => (view.current ? symbolsIn(view.current.state) : []),
      caret: () => view.current?.state.selection.main.head ?? 0,
      reveal: (sym, { select }) => {
        const v = view.current;
        if (!v || sym.to > v.state.doc.length) return;
        const bring = EditorView.scrollIntoView(sym.from, { y: onScreen(v, sym.from) ? "nearest" : "center" });
        if (select) {
          v.dispatch({ selection: EditorSelection.single(sym.to, sym.from), effects: [setRevealLines.of(null), bring] });
          v.focus();
        } else {
          v.dispatch({ effects: [setRevealLines.of({ from: sym.line, to: Math.min(sym.endLine, v.state.doc.lines), steady: true }), bring] });
        }
      },
      snapshot: () => {
        const v = view.current;
        if (!v) return () => {};
        const selection = v.state.selection;
        // CM's own scroll effect, not a scrollTop write: it lands in CM's measure cycle, after a
        // focus return, so CM's focus handler never "repairs" a fresh 0 back to the stale position.
        const scroll = v.scrollSnapshot();
        return () => {
          const w = view.current;
          if (!w) return;
          w.dispatch({ selection: selection.ranges.every((r) => r.to <= w.state.doc.length) ? selection : undefined, effects: [setRevealLines.of(null), scroll] });
        };
      },
    }),
    [openFind, closeFind]
  );

  const langExt = React.useMemo(() => languageFor(path ?? (language ? `x.${language === "typescript" ? "ts" : language === "javascript" ? "js" : language}` : "")), [path, language]);

  React.useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        baseExtensions(readOnly),
        revealField,
        themeComp.current.of(syntaxHighlighting(dark ? darkHighlight : lightHighlight)),
        langComp.current.of(langExt),
        wrapComp.current.of(wrap ? EditorView.lineWrapping : []),
        prose ? [Prec.high(proseChrome), EditorView.lineWrapping] : [],
        placeholderText ? placeholder(placeholderText) : [],
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
          { key: "Mod-f", run: () => (openFind(), true) },
          { key: "Escape", run: () => findOpen.current && (closeFind(), true) },
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          if (u.docChanged || u.selectionSet) {
            onStatusRef.current?.(statusOf(u.state));
            setRev((r) => r + 1);
          }
        }),
        EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    setLive(v);
    onStatusRef.current?.(statusOf(v.state));
    if (autoFocus) v.focus();
    if (findWanted.current) openFind();
    return () => {
      v.destroy();
      view.current = null;
      setLive(null);
    };
    // The document is seeded once; later external changes are applied through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, prose, placeholderText]);

  // Theme + language follow props without recreating the view (keeps undo history and scroll).
  React.useEffect(() => {
    view.current?.dispatch({ effects: themeComp.current.reconfigure(syntaxHighlighting(dark ? darkHighlight : lightHighlight)) });
  }, [dark]);
  React.useEffect(() => {
    view.current?.dispatch({ effects: langComp.current.reconfigure(langExt) });
  }, [langExt]);
  React.useEffect(() => {
    view.current?.dispatch({ effects: wrapComp.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);
  // External value change (a different file, or a reload) — only when it differs from the doc.
  React.useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);
  // Reveal after the doc is in place (declared after the value effect, so it runs on the loaded text).
  React.useEffect(() => {
    const v = view.current;
    if (!v || !reveal) return;
    revealLines(v, reveal.from, reveal.to);
    const t = window.setTimeout(() => view.current?.dispatch({ effects: setRevealLines.of(null) }), 2000);
    return () => window.clearTimeout(t);
  }, [reveal?.nonce, readOnly, prose, placeholderText]);

  return (
    <div className={cn("relative h-full min-h-0 w-full overflow-hidden", className)}>
      <div ref={host} className="cm-host h-full min-h-0 w-full overflow-hidden text-code" />
      <AnimatePresence>{find.open && live && <EditorFind key="find" view={live} nonce={find.nonce} editable={!readOnly} rev={rev} onClose={closeFind} />}</AnimatePresence>
    </div>
  );
}

/**
 * Syntax tokens for a block of code, line by line, using the editor's grammar for `path` and the
 * stable `tok-*` classes (styled in index.css for light and dark). Files without a grammar come back
 * as one plain token per line. Sync, so a diff hunk highlights in the same render it appears.
 */
export type CodeToken = { text: string; cls: string };
export function tokenizeLines(code: string, path: string): CodeToken[][] {
  const ext = languageFor(path);
  const lang = ext instanceof LanguageSupport ? ext.language : ext instanceof Language ? ext : null;
  if (!lang) return code.split("\n").map((t) => (t ? [{ text: t, cls: "" }] : []));
  const lines: CodeToken[][] = [[]];
  highlightCode(
    code,
    lang.parser.parse(code),
    classHighlighter,
    (text, cls) => lines[lines.length - 1].push({ text, cls }),
    () => lines.push([])
  );
  return lines;
}
