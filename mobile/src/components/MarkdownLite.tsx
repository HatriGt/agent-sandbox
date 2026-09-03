import React from "react";
import { View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { T } from "./ui/AppText";

/**
 * Lightweight markdown for agent prose: headings, fenced code, inline code,
 * bold, lists, blockquotes. Rendered at the .prose-agent scale (15.5/1.7).
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

function InlineText({ text, muted }: { text: string; muted?: boolean }) {
  const { palette } = useTheme();
  const parts = parseInline(text);
  return (
    <T variant="prose" tone={muted ? "muted" : "default"} selectable>
      {parts.map((p, i) =>
        p.code ? (
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

function parseInline(text: string): { text: string; bold?: boolean; code?: boolean }[] {
  const out: { text: string; bold?: boolean; code?: boolean }[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("`")) out.push({ text: tok.slice(1, -1), code: true });
    else out.push({ text: tok.slice(2, -2), bold: true });
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

function stripInline(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}
