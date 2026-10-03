import React, { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import type { TraceEvent } from "@/lib/trace";
import { T } from "./ui/AppText";
import { Icon } from "./ui/Icon";

/**
 * MCP calls in the thread. The wire name `mcp__hana-qa__execute_sql` is claude's namespacing, not a
 * label a human should read. Pure helpers ported from web/src/lib/mcp.ts (parse + shape-derived
 * summary), then a row that renders "server · tool" under a plug glyph with args and result like the
 * other tools, but with JSON results pretty-printed.
 */

export interface McpCall {
  server: string;
  /** Wire tool segment, e.g. "execute_sql". */
  tool: string;
  /** Humanized: "execute sql". */
  label: string;
}

/** Parse claude's MCP tool namespacing. Anything else is a local tool → null. */
export function parseMcpName(name: string): McpCall | null {
  const m = name.match(/^mcp__([\w.-]+)__([\w.-]+)$/);
  if (!m) return null;
  return { server: m[1], tool: m[2], label: m[2].replace(/[_-]+/g, " ").toLowerCase() };
}

/** A stable accent hue per server so hana-qa always looks like hana-qa across runs. */
export function serverHue(server: string): number {
  let h = 0;
  for (let i = 0; i < server.length; i++) h = (h * 31 + server.charCodeAt(i)) >>> 0;
  return h % 360;
}

export type McpResultView =
  | { kind: "json"; pretty: string; summary: string }
  | { kind: "text"; text: string; summary: string }
  | { kind: "empty" };

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Classify a raw result string. MCP servers often wrap payloads as
 * `{"content":[{"type":"text","text":"…json…"}]}` — unwrap one level of that before judging shape.
 */
export function analyzeResult(raw: string | undefined): McpResultView {
  const text = (raw ?? "").trim();
  if (!text) return { kind: "empty" };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { kind: "text", text, summary: firstLine(text) };
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const content = (v as Record<string, unknown>).content;
    if (Array.isArray(content) && content.length === 1) {
      const inner = content[0] as Record<string, unknown> | null;
      if (inner && inner.type === "text" && typeof inner.text === "string") {
        try {
          v = JSON.parse(inner.text);
        } catch {
          return { kind: "text", text: inner.text, summary: firstLine(inner.text) };
        }
      }
    }
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return { kind: "empty" };
    const rows = v.every((r) => r && typeof r === "object" && !Array.isArray(r));
    const pretty = JSON.stringify(v, null, 2);
    return { kind: "json", pretty, summary: rows ? `${v.length} ${v.length === 1 ? "row" : "rows"}` : `JSON · ${pretty.split("\n").length} lines` };
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    const flat = entries.length > 0 && entries.length <= 12 && entries.every(([, val]) => val === null || typeof val !== "object");
    const pretty = JSON.stringify(v, null, 2);
    return { kind: "json", pretty, summary: flat ? `${entries.length} ${entries.length === 1 ? "field" : "fields"}` : `JSON · ${pretty.split("\n").length} lines` };
  }
  const s = cell(v);
  return { kind: "text", text: s, summary: firstLine(s) };
}

function firstLine(text: string): string {
  const first = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  return first.length > 80 ? `${first.slice(0, 79)}…` : first;
}

/** Collapsed one-liner derived from the SHAPE of the result, not its first line. */
export function mcpSummary(view: McpResultView): string {
  return view.kind === "empty" ? "no data" : view.summary;
}

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;
const MAX_CHARS = 6000;

/** One MCP call as a row inside a tool group. */
export function McpItem({ event, call, last }: { event: ToolEvent; call: McpCall; last: boolean }) {
  const { palette, dark } = useTheme();
  const [open, setOpen] = useState(!!event.failed);
  const view = useMemo(() => analyzeResult(event.result), [event.result]);
  const output = view.kind === "json" ? view.pretty : view.kind === "text" ? view.text : "(no data returned)";
  const hasOutput = !!event.result;
  const live = !!event.streaming || (!hasOutput && !event.failed && event.ms === undefined);
  const hue = serverHue(call.server);
  // RN accepts `hsl()` / `hsla()` but not the space-separated `/ alpha` syntax.
  const srv = `hsl(${hue}, 55%, ${dark ? 72 : 36}%)`;
  const srvSoft = `hsla(${hue}, 55%, ${dark ? 72 : 36}%, 0.12)`;

  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: palette.border }}>
      <Pressable
        onPress={() => hasOutput && setOpen((o) => !o)}
        style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}
      >
        <View style={{ width: 20, height: 20, borderRadius: radius.sm, backgroundColor: srvSoft, alignItems: "center", justifyContent: "center", marginTop: 0 }}>
          <Icon name="zap" size={12} color={event.failed ? palette.destructive : srv} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <T variant="code" mono weight="semibold" numberOfLines={1} style={{ color: event.failed ? palette.destructive : srv, flexShrink: 1 }}>
              {call.server}
            </T>
            <T variant="code" tone="faint">
              ·
            </T>
            <T variant="code" mono tone={event.failed ? "destructive" : "muted"} numberOfLines={1} style={{ flexShrink: 1 }}>
              {call.label}
            </T>
            <T variant="micro" tone="faint" style={{ flexShrink: 0 }}>
              MCP
            </T>
            {live ? (
              <T variant="micro" tone="live" weight="medium" style={{ flexShrink: 0 }}>
                running
              </T>
            ) : event.failed ? (
              <T variant="micro" tone="destructive" weight="medium" style={{ flexShrink: 0 }}>
                failed
              </T>
            ) : null}
          </View>
          {event.arg ? (
            <T variant="code" mono tone="muted" numberOfLines={open ? undefined : 1}>
              › {event.arg}
            </T>
          ) : null}
          {!open && hasOutput ? (
            <T variant="code" mono tone="faint" numberOfLines={1}>
              {mcpSummary(view)}
            </T>
          ) : null}
        </View>
        {hasOutput ? <Icon name={open ? "minimize-2" : "maximize-2"} size={12} color={palette.faint} style={{ marginTop: 3 }} /> : null}
      </Pressable>
      {open && hasOutput ? (
        <View style={{ backgroundColor: palette.trace, marginHorizontal: 12, marginBottom: 10, borderRadius: radius.lg, padding: 10 }}>
          <T variant="code" mono selectable style={{ color: palette.traceFg }}>
            {output.length > MAX_CHARS ? `${output.slice(0, MAX_CHARS)}\n… (${output.length - MAX_CHARS} more chars)` : output}
          </T>
        </View>
      ) : null}
    </View>
  );
}
