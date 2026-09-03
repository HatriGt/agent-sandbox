import React, { memo, useState } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import type { PlanItem, TraceEvent } from "@/lib/trace";
import { resultSummary } from "@/lib/trace";
import { MarkdownLite } from "./MarkdownLite";
import { T } from "./ui/AppText";
import { Icon, toolIcon } from "./ui/Icon";
import { FadeInUp } from "./ui/Motion";

/**
 * A rendered thread item. Consecutive tool calls are grouped into one "Worked"
 * card (like the web's folded tool work); prose stays prose; you-turns are
 * right-aligned bubbles.
 */
export type ThreadItem =
  | { kind: "tools"; tools: Extract<TraceEvent, { kind: "tool" }>[] }
  | Exclude<TraceEvent, { kind: "tool" }>;

export function groupEvents(events: TraceEvent[]): ThreadItem[] {
  const out: ThreadItem[] = [];
  for (const e of events) {
    if (e.kind === "tool") {
      const last = out[out.length - 1];
      if (last && last.kind === "tools") last.tools.push(e);
      else out.push({ kind: "tools", tools: [e] });
    } else {
      out.push(e);
    }
  }
  return out;
}

export const ThreadRow = memo(function ThreadRow({
  item,
  animate,
  onRevert,
}: {
  item: ThreadItem;
  animate?: boolean;
  /** Set on revertable `you` items: called when the user confirms a revert to before this message. */
  onRevert?: (messageText: string) => void;
}) {
  const body = (() => {
    switch (item.kind) {
      case "you":
        return <YouBubble text={item.text} onRevert={onRevert} />;
      case "say":
        return (
          <View style={{ paddingVertical: 8 }}>
            <MarkdownLite text={item.text} />
          </View>
        );
      case "ask":
        return <AskRow text={item.text} />;
      case "tools":
        return <ToolGroup tools={item.tools} />;
      case "think":
        return <ThinkRow text={item.text} />;
      case "plan":
        return <PlanRow items={item.items} />;
      case "lifecycle":
        return <LifecycleRow label={item.label} detail={item.detail} />;
      default:
        return null;
    }
  })();
  if (!body) return null;
  return animate ? <FadeInUp>{body}</FadeInUp> : <>{body}</>;
});

function YouBubble({ text, onRevert }: { text: string; onRevert?: (messageText: string) => void }) {
  const { palette } = useTheme();
  // A leading /skill token renders as a tinted tag, like the web.
  const m = text.match(/^\/([a-z0-9][a-z0-9-]*)\s*([\s\S]*)$/);
  const skillTag = m?.[1];
  const body = m ? m[2] : text;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 8, marginVertical: 8 }}>
      {onRevert ? <RevertButton onConfirm={() => onRevert(text)} /> : null}
      <View
        style={{
          backgroundColor: palette.primary,
          borderRadius: radius["2xl"],
          borderBottomRightRadius: radius.sm,
          paddingVertical: 10,
          paddingHorizontal: 14,
          maxWidth: "82%",
        }}
      >
        {skillTag ? (
          <T variant="micro" mono weight="semibold" style={{ color: palette.live, marginBottom: body ? 2 : 0 }}>
            /{skillTag}
          </T>
        ) : null}
        {body ? (
          <T variant="body" selectable style={{ color: palette.primaryForeground }}>
            {body}
          </T>
        ) : null}
      </View>
    </View>
  );
}

/** Round revert affordance next to your bubble; the confirm lives in the thread. */
function RevertButton({ onConfirm }: { onConfirm: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onConfirm}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.card,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 2,
        opacity: pressed ? 0.6 : 0.85,
      })}
    >
      <Icon name="rotate-ccw" size={13} color={palette.mutedForeground} />
    </Pressable>
  );
}

function AskRow({ text }: { text: string }) {
  const { palette } = useTheme();
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: palette.attention,
        borderRadius: radius.xl,
        padding: 12,
        marginVertical: 8,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="help-circle" size={14} color={palette.attentionText} />
        <T variant="micro" tone="attention" weight="semibold">
          Agent asked
        </T>
      </View>
      <MarkdownLite text={text} />
    </View>
  );
}

/** Grouped tool work: a compact "Worked · n steps" header expanding to per-tool rows. */
function ToolGroup({ tools }: { tools: Extract<TraceEvent, { kind: "tool" }>[] }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const failed = tools.filter((t) => t.failed).length;
  const single = tools.length === 1;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: palette.border,
        borderRadius: radius.xl,
        marginVertical: 6,
        backgroundColor: palette.card,
        overflow: "hidden",
      }}
    >
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icon name={single ? toolIcon(tools[0].name) : "layers"} size={15} color={failed ? palette.destructive : palette.mutedForeground} />
        {single ? (
          <T variant="meta" weight="medium" numberOfLines={1} style={{ flex: 1 }} tone={failed ? "destructive" : "default"}>
            {tools[0].name}
            {tools[0].arg ? (
              <T variant="meta" tone="faint" numberOfLines={1}>
                {"  "}
                {tools[0].arg.split("\n")[0]}
              </T>
            ) : null}
          </T>
        ) : (
          <T variant="meta" weight="medium" style={{ flex: 1 }} tone={failed ? "destructive" : "default"}>
            Worked · {tools.length} steps
            {failed ? ` · ${failed} failed` : ""}
          </T>
        )}
        <Icon name={open ? "chevron-up" : "chevron-down"} size={15} color={palette.faint} />
      </Pressable>
      {open && (
        <View style={{ borderTopWidth: 1, borderTopColor: palette.border }}>
          {tools.map((t, i) => (
            <ToolRow key={i} tool={t} last={i === tools.length - 1} />
          ))}
        </View>
      )}
    </View>
  );
}

function ToolRow({ tool, last }: { tool: Extract<TraceEvent, { kind: "tool" }>; last: boolean }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const summary = resultSummary(tool.result);
  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: palette.border }}>
      <Pressable
        onPress={() => tool.result && setOpen((o) => !o)}
        style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}
      >
        <Icon name={toolIcon(tool.name)} size={13} color={tool.failed ? palette.destructive : palette.faint} style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <T variant="code" mono tone={tool.failed ? "destructive" : "muted"} numberOfLines={open ? undefined : 1}>
            {tool.name}
            {tool.arg ? `: ${tool.arg.split("\n")[0]}` : ""}
            {tool.failed ? " — failed" : ""}
          </T>
          {!open && summary ? (
            <T variant="code" mono tone="faint" numberOfLines={1}>
              {summary}
            </T>
          ) : null}
        </View>
        {tool.result ? <Icon name={open ? "minimize-2" : "maximize-2"} size={12} color={palette.faint} style={{ marginTop: 3 }} /> : null}
      </Pressable>
      {open && tool.result ? (
        <View style={{ backgroundColor: palette.trace, marginHorizontal: 12, marginBottom: 10, borderRadius: radius.lg, padding: 10 }}>
          <T variant="code" mono selectable style={{ color: palette.traceFg }}>
            {tool.result.length > 6000 ? `${tool.result.slice(0, 6000)}\n… (${tool.result.length - 6000} more chars)` : tool.result}
          </T>
        </View>
      ) : null}
    </View>
  );
}

function ThinkRow({ text }: { text: string }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={{ marginVertical: 6, flexDirection: "row", gap: 8 }}>
      <Icon name="cloud" size={13} color={palette.faint} style={{ marginTop: 3 }} />
      <T variant="meta" tone="faint" style={{ fontStyle: "italic", flex: 1 }}>
        {open ? text : `Thought · ${text.split("\n")[0].slice(0, 80)}…`}
      </T>
    </Pressable>
  );
}

function PlanRow({ items }: { items: PlanItem[] }) {
  const { palette } = useTheme();
  const done = items.filter((i) => i.state === "done").length;
  return (
    <View
      style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, padding: 12, marginVertical: 8, gap: 8, backgroundColor: palette.card }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="check-square" size={13} color={palette.mutedForeground} />
        <T variant="micro" tone="muted" weight="semibold">
          Plan · {done}/{items.length}
        </T>
        <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: palette.muted, marginLeft: 6 }}>
          <View style={{ width: `${Math.round((done / Math.max(1, items.length)) * 100)}%`, height: 3, borderRadius: 2, backgroundColor: palette.ok }} />
        </View>
      </View>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <Icon
            name={it.state === "done" ? "check-circle" : it.state === "active" ? "loader" : "circle"}
            size={14}
            color={it.state === "done" ? palette.ok : it.state === "active" ? palette.live : palette.faint}
            style={{ marginTop: 2 }}
          />
          <T
            variant="body"
            tone={it.state === "todo" ? "muted" : "default"}
            style={[{ flex: 1 }, it.state === "done" ? { textDecorationLine: "line-through" as const } : null]}
          >
            {it.text}
          </T>
        </View>
      ))}
    </View>
  );
}

function LifecycleRow({ label, detail }: { label: string; detail?: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginVertical: 10 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: palette.border }} />
      <Icon name="zap" size={11} color={palette.faint} />
      <T variant="micro" tone="faint" mono>
        {label}
        {detail ? ` · ${detail}` : ""}
      </T>
      <View style={{ flex: 1, height: 1, backgroundColor: palette.border }} />
    </View>
  );
}
