import React from "react";
import { View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Icon, type IconName } from "./ui/Icon";

/**
 * Lightweight markdown for agent prose: headings, fenced code, inline code,
 * bold, italics, lists, blockquotes — and links. Rendered at the .prose-agent
 * scale (15.5/1.7). Links match the web's LinkChip treatment: a URL in prose
 * becomes a tappable chip with an icon for what it points at (PR, issue,
 * commit, file, repo, web) and a short human label instead of the raw address.
 */
export function MarkdownLite({ text }: { text: string }) {
  const { palette } = useTheme();
  const blocks = splitBlocks(text);
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((b, i) => {
        if (b.kind === "code") {
          return (
            <View
              key={i}
              style={{ backgroundColor: palette.trace, borderRadius: radius.lg, padding: 12 }}
            >
              {b.lang ? (
                <T variant="micro" mono tone="faint" style={{ marginBottom: 6 }}>
                  {b.lang}
                </T>
              ) : null}
              <T variant="code" mono style={{ color: palette.traceFg }} selectable>
                {b.text}
              </T>
            </View>
          );
        }
        if (b.kind === "heading") {
          return (
            <T key={i} variant={b.level <= 2 ? "h3" : "body"} weight="semibold" selectable>
              {stripInline(b.text)}
            </T>
          );
        }
        if (b.kind === "quote") {
          return (
            <View key={i} style={{ borderLeftWidth: 2, borderLeftColor: palette.lineStrong, paddingLeft: 10 }}>
              <InlineText text={b.text} muted />
            </View>
          );
        }
        if (b.kind === "list") {
          return (
            <View key={i} style={{ gap: 4 }}>
              {b.items.map((it, j) => (
                <View key={j} style={{ flexDirection: "row", gap: 8 }}>
                  <T variant="prose" tone="faint">
                    {it.ordered ? `${it.n}.` : "•"}
                  </T>
                  <View style={{ flex: 1 }}>
                    <InlineText text={it.text} />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        return <InlineText key={i} text={b.text} />;
      })}
    </View>
  );
}

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
function LinkChip({ href, text }: { href: string; text?: string }) {
  const { palette } = useTheme();
  const d = describeUrl(href);
  const custom = text && text !== href && text.replace(/\/$/, "") !== href.replace(/\/$/, "");
  const tint = d.kind === "pr" ? palette.ok : d.kind === "issue" ? palette.live : palette.foreground;
  return (
    <T
      variant="prose"
      weight="semibold"
      onPress={() => WebBrowser.openBrowserAsync(href).catch(() => {})}
      style={{ backgroundColor: palette.muted, borderRadius: radius.sm, color: tint }}
    >
      {" "}
      <Icon name={custom && d.kind === "web" ? "link" : LINK_ICON[d.kind]} size={12} color={tint} />{" "}
      {custom ? text : d.label} <Icon name="arrow-up-right" size={11} color={palette.faint} />{" "}
    </T>
  );
}

function InlineText({ text, muted }: { text: string; muted?: boolean }) {
  const { palette } = useTheme();
  const parts = parseInline(text);
  return (
    <T variant="prose" tone={muted ? "muted" : "default"} selectable>
      {parts.map((p, i) =>
        p.href ? (
          <LinkChip key={i} href={p.href} text={p.text !== p.href ? p.text : undefined} />
        ) : p.code ? (
          <T
            key={i}
            variant="code"
            mono
            selectable
            style={{ backgroundColor: palette.muted, color: palette.foreground }}
          >
            {p.text}
          </T>
        ) : p.bold ? (
          <T key={i} variant="prose" weight="semibold" selectable>
            {p.text}
          </T>
        ) : p.italic ? (
          <T key={i} variant="prose" selectable style={{ fontStyle: "italic" }}>
            {p.text}
          </T>
        ) : (
          p.text
        ),
      )}
    </T>
  );
}

type Block =
  | { kind: "para" | "quote"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; text: string; lang?: string }
  | { kind: "list"; items: { text: string; ordered: boolean; n: number }[] };

function splitBlocks(text: string): Block[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", text: buf.join("\n"), lang: fence[1] || undefined });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push({ kind: "heading", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ kind: "quote", text: buf.join("\n") });
      continue;
    }
    const li = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      const items: { text: string; ordered: boolean; n: number }[] = [];
      let n = 1;
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
        if (!m) break;
        const ordered = /\d/.test(m[1]);
        items.push({ text: m[2], ordered, n: ordered ? parseInt(m[1], 10) || n : n });
        n++;
        i++;
      }
      blocks.push({ kind: "list", items });
      continue;
    }
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    blocks.push({ kind: "para", text: buf.join("\n") });
  }
  return blocks;
}

type InlinePart = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };

// Order matters: code first (a URL inside backticks stays code), then [text](url),
// then bare URLs, then bold, then italics.
const INLINE_RE = /(`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()"']+|\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g;

function parseInline(text: string): InlinePart[] {
  const out: InlinePart[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("`")) out.push({ text: tok.slice(1, -1), code: true });
    else if (tok.startsWith("[")) {
      const lm = tok.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (lm) out.push({ text: lm[1], href: lm[2] });
      else out.push({ text: tok });
    } else if (/^https?:\/\//.test(tok)) {
      // Trailing punctuation belongs to the sentence, not the URL.
      const trimmed = tok.replace(/[.,;:!?]+$/, "");
      out.push({ text: trimmed, href: trimmed });
      if (trimmed.length < tok.length) out.push({ text: tok.slice(trimmed.length) });
    } else if (tok.startsWith("**")) out.push({ text: tok.slice(2, -2), bold: true });
    else out.push({ text: tok.slice(1, -1), italic: true });
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

function stripInline(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}
