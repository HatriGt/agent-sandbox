import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Clipboard from "expo-clipboard";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import {
  calloutKind,
  parseGfmTable,
  isTableDelimiterRow,
  parseStatusItems,
  progressFromItems,
  smartBlock,
  type CalloutKind,
  type ParsedTable,
  type SmartSpec,
} from "@/lib/viz";
import { T } from "./ui/AppText";
import { Icon, type IconName } from "./ui/Icon";
import { SmartBlockView, VizFrame } from "./viz/SmartBlockView";
import { parseCodeRef, symbolRefs, type CodeRef } from "@/lib/code-refs";
import { CodeRefLink, CodeRefSession, CodeRefSymbols } from "./CodeRef";
import { TableBlock } from "./viz/TableBlock";
import { CalloutBlock, ChecklistBlock, ProgressBlock, StatusListBlock } from "./viz/SmallBlocks";
import { MiniAction } from "./viz/VizFrame";
import { PressScale } from "@/components/motion";

/**
 * Lightweight markdown for agent prose, mirroring the web console's `Markdown` + viz router:
 * headings, paragraphs, fenced code (with language label, copy, 80-line cap), GFM tables, task
 * lists (checklist card), nested lists (3 levels), rules, blockquotes and `> [!NOTE]` callouts,
 * images (as link chips — never fetched), inline code / bold / italic / strike / links (LinkChip).
 *
 * Viz fences (every kind web SmartBlock routes - charts, graphs, sequence/mermaid, findings,
 * compare, annotate, layers, flow, tree, ops/git blocks, callouts - plus bare fences sniffed by
 * lib/viz-auto.ts) render natively through lib/viz.ts `smartBlock`; anything the router does not
 * understand, or a fence still streaming in, stays a code block.
 */
export function MarkdownLite({ text }: { text: string }) {
  const blocks = React.useMemo(() => splitBlocks(text), [text]);
  const outer = React.useContext(CodeRefSymbols);
  const symbols = React.useMemo(() => {
    const own = symbolRefs(text);
    return outer ? new Map([...own, ...outer]) : own;
  }, [text, outer]);
  return (
    <CodeRefSymbols.Provider value={symbols}>
      <Blocks blocks={blocks} />
    </CodeRefSymbols.Provider>
  );
}

/** Inline code; a file ref (or a symbol bound to one in this message) opens the file viewer when a box session is in scope. */
function InlineCode({ text, refTo }: { text: string; refTo?: CodeRef }) {
  const { palette } = useTheme();
  const symbols = React.useContext(CodeRefSymbols);
  const ref = refTo ?? symbols?.get(text);
  const session = React.useContext(CodeRefSession);
  if (ref && session) return <CodeRefLink refTo={ref} text={text} />;
  return (
    <T variant="code" mono selectable style={{ backgroundColor: palette.muted, color: palette.foreground }}>
      {text}
    </T>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </View>
  );
}

function BlockView({ block: b }: { block: Block }) {
  const { palette } = useTheme();
  switch (b.kind) {
    case "code": {
      const raw = <CodeBlock text={b.text} lang={b.lang} />;
      if (b.spec) return <SmartBlockView spec={b.spec} raw={raw} renderMarkdown={(t) => <MarkdownLite text={t} />} />;
      return raw;
    }
    case "heading":
      return (
        <T variant={b.level === 1 ? "h2" : b.level === 2 ? "h3" : "body"} weight="semibold" selectable style={b.level <= 2 ? { marginTop: 4 } : undefined}>
          {stripInline(b.text)}
        </T>
      );
    case "hr":
      return <View style={{ height: 1, backgroundColor: palette.border, marginVertical: 4 }} />;
    case "quote":
      return (
        <View style={{ borderLeftWidth: 2, borderLeftColor: palette.lineStrong, paddingLeft: 10 }}>
          <MarkdownLite text={b.text} />
        </View>
      );
    case "callout":
      return (
        <CalloutBlock kind={b.callout} title={b.title}>
          <MarkdownLite text={b.text} />
        </CalloutBlock>
      );
    case "table":
      return <TableBlock table={b.table} renderCell={(t) => <InlineText text={t} variant="meta" />} />;
    case "list":
      return <ListView items={b.items} />;
    default:
      return <InlineText text={b.text} />;
  }
}

// ---------------------------------------------------------------- lists

function ListView({ items }: { items: ListItem[] }) {
  const { palette } = useTheme();
  const tree = React.useMemo(() => nest(items), [items]);
  const flat = items.every((it) => it.depth === 0);
  // Task list → checklist card (every item must be a task; mixed lists stay lists).
  if (flat && items.length > 0 && items.every((it) => it.task !== undefined)) {
    return (
      <ChecklistBlock
        items={items.map((it) => ({ checked: it.task === true, text: it.text }))}
        renderText={(t, muted) => <InlineText text={t} variant="meta" muted={muted} />}
      />
    );
  }
  if (flat && !items.some((it) => it.ordered)) {
    const texts = items.map((it) => it.text);
    const progress = progressFromItems(texts);
    if (progress) {
      return (
        <VizFrame kind="progress" raw={<CodeBlock text={texts.join("\n")} />} icon="percent">
          <ProgressBlock rows={progress} />
        </VizFrame>
      );
    }
    const status = parseStatusItems(texts);
    if (status) return <StatusListBlock items={status} renderText={(t) => <InlineText text={t} />} />;
  }
  const render =(nodes: ListNode[], depth: number): React.ReactNode => (
    <View style={{ gap: 4 }}>
      {nodes.map((n, j) => (
        <View key={j}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {n.task !== undefined ? (
              <Icon name={n.task ? "check-circle" : "circle"} size={14} color={n.task ? palette.ok : palette.faint} style={{ marginTop: 6 }} />
            ) : (
              <T variant="prose" tone="faint" style={{ minWidth: 14, textAlign: n.ordered ? "right" : "center" }}>
                {n.ordered ? `${n.n}.` : depth === 0 ? "•" : depth === 1 ? "◦" : "▪"}
              </T>
            )}
            <View style={{ flex: 1 }}>
              <InlineText text={n.text} muted={n.task === true} />
            </View>
          </View>
          {n.children.length ? <View style={{ paddingLeft: 22, paddingTop: 4 }}>{render(n.children, depth + 1)}</View> : null}
        </View>
      ))}
    </View>
  );
  return <>{render(tree, 0)}</>;
}

type ListNode = ListItem & { children: ListNode[] };

function nest(items: ListItem[]): ListNode[] {
  const roots: ListNode[] = [];
  const stack: ListNode[] = [];
  for (const it of items) {
    const node: ListNode = { ...it, children: [] };
    // A deeper item with no parent at that depth attaches to the nearest existing ancestor.
    const depth = Math.min(it.depth, stack.length);
    while (stack.length > depth) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return roots;
}

// ---------------------------------------------------------------- code block

const CODE_LINE_CAP = 80;

function CodeBlock({ text, lang }: { text: string; lang?: string }) {
  const { palette } = useTheme();
  const [all, setAll] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const lines = React.useMemo(() => text.split("\n"), [text]);
  const capped = !all && lines.length > CODE_LINE_CAP;
  const shown = capped ? lines.slice(0, CODE_LINE_CAP).join("\n") : text;
  const copy = () => {
    Clipboard.setStringAsync(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };
  return (
    <View style={{ backgroundColor: palette.trace, borderRadius: radius.lg, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 8 }}>
        <T variant="micro" mono style={{ color: palette.traceFg, opacity: 0.6, flex: 1 }}>
          {lang || "text"}
        </T>
        <PressScale onPress={copy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Copy code" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name={copied ? "check" : "copy"} size={12} color={palette.traceFg} style={{ opacity: 0.7 }} />
          <T variant="micro" style={{ color: palette.traceFg, opacity: 0.7 }}>
            {copied ? "Copied" : "Copy"}
          </T>
        </PressScale>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false} contentContainerStyle={{ padding: 12, paddingTop: 6 }}>
        <T variant="code" mono style={{ color: palette.traceFg }} selectable>
          {shown}
        </T>
      </ScrollView>
      {capped ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingBottom: 10 }}>
          <T variant="micro" style={{ color: palette.traceFg, opacity: 0.6 }}>
            …{lines.length - CODE_LINE_CAP} more lines
          </T>
          <MiniAction label="Show all" onPress={() => setAll(true)} />
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- links

/** What a URL points at, mirrored from the web's describeUrl: GitHub gets first-class treatment. */
type LinkKind = "pr" | "issue" | "commit" | "file" | "repo" | "github" | "web";

export function describeUrl(href: string): { kind: LinkKind; label: string } {
  const m = href.match(/^https?:\/\/([^/\s]+)(\/[^\s]*)?$/);
  if (!m) return { kind: "web", label: href };
  const host = m[1].replace(/^www\./, "");
  const segs = (m[2] ?? "").split("/").filter(Boolean);
  if (host === "github.com" && segs.length >= 2) {
    const repoName = segs[1];
    const [, , kind, ...rest] = segs;
    if (kind === "pull" && rest[0]) return { kind: "pr", label: `${repoName}#${rest[0]}` };
    if (kind === "issues" && rest[0]) return { kind: "issue", label: `${repoName}#${rest[0]}` };
    if (kind === "commit" && rest[0]) return { kind: "commit", label: `${repoName}@${rest[0].slice(0, 7)}` };
    if ((kind === "blob" || kind === "tree") && rest.length >= 2) {
      const path = rest.slice(1).join("/");
      return { kind: "file", label: path.split("/").pop() || path };
    }
    if (!kind) return { kind: "repo", label: `${segs[0]}/${repoName}` };
    return { kind: "github", label: `${repoName}/${kind}` };
  }
  const first = segs[0] ? `/${segs[0]}${segs.length > 1 ? "/…" : ""}` : "";
  return { kind: "web", label: `${host}${first}` };
}

const LINK_ICON: Record<LinkKind, IconName> = {
  pr: "git-pull-request",
  issue: "circle",
  commit: "git-commit",
  file: "file-text",
  repo: "github",
  github: "github",
  web: "globe",
};

/** A URL as a tappable chip inside prose — icon · short label · arrow, like the web's LinkChip. */
function LinkChip({ href, text, image, variant = "prose" }: { href: string; text?: string; image?: boolean; variant?: "prose" | "meta" }) {
  const { palette } = useTheme();
  const d = describeUrl(href);
  const custom = text && text !== href && text.replace(/\/$/, "") !== href.replace(/\/$/, "");
  const tint = d.kind === "pr" ? palette.ok : d.kind === "issue" ? palette.live : palette.foreground;
  const icon: IconName = image ? "image" : custom && d.kind === "web" ? "link" : LINK_ICON[d.kind];
  return (
    <T
      variant={variant}
      weight="semibold"
      onPress={() => WebBrowser.openBrowserAsync(href).catch(() => {})}
      style={{ backgroundColor: palette.muted, borderRadius: radius.sm, color: tint }}
    >
      {" "}
      <Icon name={icon} size={12} color={tint} /> {custom ? text : d.label} <Icon name="arrow-up-right" size={11} color={palette.faint} />{" "}
    </T>
  );
}

// ---------------------------------------------------------------- inline

function InlineText({ text, muted, variant = "prose" }: { text: string; muted?: boolean; variant?: "prose" | "meta" }) {
  const { palette } = useTheme();
  const parts = React.useMemo(() => parseInline(text), [text]);
  return (
    <T variant={variant} tone={muted ? "muted" : "default"} selectable>
      {parts.map((p, i) =>
        p.href ? (
          <LinkChip key={i} href={p.href} text={p.text !== p.href ? p.text : undefined} image={p.image} variant={variant} />
        ) : p.code ? (
          <InlineCode key={i} text={p.text} refTo={p.ref} />
        ) : p.bold ? (
          <T key={i} variant={variant} weight="semibold" selectable>
            {p.text}
          </T>
        ) : p.italic ? (
          <T key={i} variant={variant} selectable style={{ fontStyle: "italic" }}>
            {p.text}
          </T>
        ) : p.strike ? (
          <T key={i} variant={variant} tone="muted" selectable style={{ textDecorationLine: "line-through" }}>
            {p.text}
          </T>
        ) : (
          p.text
        ),
      )}
    </T>
  );
}

// ---------------------------------------------------------------- block parser

type ListItem = { text: string; ordered: boolean; n: number; depth: number; task?: boolean };

type Block =
  | { kind: "para"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "callout"; callout: CalloutKind; title?: string; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "hr" }
  | { kind: "code"; text: string; lang?: string; closed: boolean; spec: SmartSpec | null }
  | { kind: "table"; table: ParsedTable }
  | { kind: "list"; items: ListItem[] };

const LIST_RE = /^(\s*)([-*•+]|\d+[.)])\s+(.*)$/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

function isTableStart(lines: string[], i: number): boolean {
  return lines[i].includes("|") && i + 1 < lines.length && isTableDelimiterRow(lines[i + 1]);
}

function startsBlock(line: string): boolean {
  return /^```/.test(line) || /^(#{1,6})\s+/.test(line) || /^>\s?/.test(line) || LIST_RE.test(line) || HR_RE.test(line);
}

export function splitBlocks(text: string): Block[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const marker = fence[1];
      const closeRe = new RegExp(`^\\s{0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
      const buf: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (closeRe.test(lines[i])) {
          closed = true;
          i++;
          break;
        }
        buf.push(lines[i++]);
      }
      const lang = fence[2].trim().split(/\s+/)[0].replace(/[^\w+#.-]/g, "").toLowerCase();
      const code = buf.join("\n");
      // smartBlock only on closed fences: a half-streamed chart must never flip between code and chart.
      // Bare fences go through too - viz-auto sniffs what they really are.
      blocks.push({ kind: "code", text: code, lang: lang || undefined, closed, spec: closed ? smartBlock(lang, code) : null });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push({ kind: "heading", level: h[1].length, text: h[2].replace(/\s+#+\s*$/, "") });
      i++;
      continue;
    }
    if (isTableStart(lines, i)) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) buf.push(lines[i++]);
      const table = parseGfmTable(buf);
      if (table) {
        blocks.push({ kind: "table", table });
        continue;
      }
      blocks.push({ kind: "para", text: buf.join("\n") });
      continue;
    }
    if (HR_RE.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      const alert = buf[0]?.match(/^\s*\[!([A-Za-z]+)\]\s*(.*)$/);
      const ck = alert ? calloutKind(alert[1]) : null;
      if (alert && ck) {
        blocks.push({ kind: "callout", callout: ck, title: alert[2].trim() || undefined, text: buf.slice(1).join("\n") });
      } else blocks.push({ kind: "quote", text: buf.join("\n") });
      continue;
    }
    if (LIST_RE.test(line)) {
      const items: ListItem[] = [];
      const base = (line.match(LIST_RE) as RegExpMatchArray)[1].length;
      let n = 1;
      while (i < lines.length) {
        const cur = lines[i];
        const m = cur.match(LIST_RE);
        if (m) {
          const indent = Math.max(0, m[1].length - base);
          const depth = Math.min(2, Math.floor(indent / 2));
          const ordered = /\d/.test(m[2]);
          let body = m[3];
          let task: boolean | undefined;
          const tm = body.match(/^\[([ xX])\]\s+(.*)$/);
          if (tm) {
            task = tm[1] !== " ";
            body = tm[2];
          }
          items.push({ text: body, ordered, n: ordered ? parseInt(m[2], 10) || n : n, depth, task });
          if (depth === 0) n++;
          i++;
          continue;
        }
        // Lazy continuation: an indented non-empty line belongs to the previous item.
        if (cur.trim() && /^\s+/.test(cur) && items.length && !/^\s{0,3}```/.test(cur)) {
          items[items.length - 1].text += " " + cur.trim();
          i++;
          continue;
        }
        break;
      }
      blocks.push({ kind: "list", items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !isTableStart(lines, i)) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]); // guarantee progress; never loop forever on an odd line
    blocks.push({ kind: "para", text: buf.join("\n") });
  }
  return blocks;
}

// ---------------------------------------------------------------- inline parser

type InlinePart = { text: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; href?: string; image?: boolean; ref?: CodeRef };

// Order matters: code first (a URL inside backticks stays code), then ![alt](url), [text](target),
// bare URLs, bold, strike, then italics. Underscore italics need word boundaries (snake_case).
const INLINE_RE =
  /(`[^`\n]+`|!\[[^\]\n]*\]\(https?:\/\/[^\s)]+\)|\[[^\]\n]+\]\([^\s)]+\)|https?:\/\/[^\s<>()"']+|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|(?<![\w])_[^_\n]+_(?![\w]))/g;

export function parseInline(text: string): InlinePart[] {
  const out: InlinePart[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    const tok = m[0];
    if (tok.startsWith("`")) {
      const code = tok.slice(1, -1);
      const ref = parseCodeRef(code);
      out.push(ref ? { text: code, code: true, ref } : { text: code, code: true });
    } else if (tok.startsWith("![")) {
      const lm = tok.match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/);
      if (lm) out.push({ text: lm[1] || "image", href: lm[2], image: true });
      else out.push({ text: tok });
    } else if (tok.startsWith("[")) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
      const ref = lm && !/^https?:\/\//.test(lm[2]) ? parseCodeRef(lm[2]) : null;
      if (lm && /^https?:\/\//.test(lm[2])) out.push({ text: stripInline(lm[1]), href: lm[2] });
      else if (lm && ref) out.push({ text: stripInline(lm[1]), code: true, ref });
      else out.push({ text: tok });
    } else if (/^https?:\/\//.test(tok)) {
      // Trailing punctuation belongs to the sentence, not the URL.
      const trimmed = tok.replace(/[.,;:!?]+$/, "");
      out.push({ text: trimmed, href: trimmed });
      if (trimmed.length < tok.length) out.push({ text: tok.slice(trimmed.length) });
    } else if (tok.startsWith("**")) out.push({ text: tok.slice(2, -2), bold: true });
    else if (tok.startsWith("~~")) out.push({ text: tok.slice(2, -2), strike: true });
    else out.push({ text: tok.slice(1, -1), italic: true });
    last = at + tok.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

function stripInline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}
