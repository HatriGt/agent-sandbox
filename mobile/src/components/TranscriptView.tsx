import React, { memo, useState } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import type { PlanItem, TraceEvent } from "@/lib/trace";
import { resultSummary } from "@/lib/trace";
import { MarkdownLite } from "./MarkdownLite";
import { T } from "./ui/AppText";

/** One trace event, phone-sized: prose is prose, tool work folds away, you-turns are quoted. */
export const TraceRow = memo(function TraceRow({ event, streaming }: { event: TraceEvent; streaming?: boolean }) {
  switch (event.kind) {
    case "you":
      return <YouRow text={event.text} />;
    case "say":
      return (
        <View style={{ paddingVertical: 6 }}>
          <MarkdownLite text={event.text} />
          {streaming ? <StreamCaret /> : null}
        </View>
      );
    case "ask":
      return <AskRow text={event.text} />;
    case "tool":
      return <ToolRow name={event.name} arg={event.arg} result={event.result} failed={event.failed} />;
    case "think":
      return <ThinkRow text={event.text} />;
    case "plan":
      return <PlanRow items={event.items} />;
    case "lifecycle":
      return <LifecycleRow label={event.label} detail={event.detail} />;
    default:
      return null;
  }
});

function StreamCaret() {
  const { palette } = useTheme();
  return (
    <View style={{ width: 8, height: 16, backgroundColor: palette.live, borderRadius: 2, marginTop: 4 }} />
  );
}

function YouRow({ text }: { text: string }) {
  const { palette } = useTheme();
  return (
    <View
      style={{
        backgroundColor: palette.secondary,
        borderRadius: radius.xl,
        padding: 12,
        marginVertical: 8,
        alignSelf: "flex-end",
        maxWidth: "92%",
      }}
    >
      <T variant="micro" tone="faint" weight="medium" style={{ marginBottom: 2 }}>
        You
      </T>
      <T variant="body" selectable>
        {text}
      </T>
    </View>
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
      }}
    >
      <T variant="micro" tone="attention" weight="medium" style={{ marginBottom: 4 }}>
        ◆ Agent asked
      </T>
      <MarkdownLite text={text} />
    </View>
  );
}

function ToolRow({ name, arg, result, failed }: { name: string; arg?: string; result?: string; failed?: boolean }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const summary = resultSummary(result);
  return (
    <Pressable onPress={() => result && setOpen((o) => !o)} style={{ marginVertical: 3 }}>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
        <T variant="code" mono tone={failed ? "destructive" : "faint"}>
          →
        </T>
        <View style={{ flex: 1 }}>
          <T variant="code" mono tone={failed ? "destructive" : "muted"} numberOfLines={open ? undefined : 1}>
            {name}
            {arg ? `: ${arg}` : ""}
            {failed ? " — failed" : ""}
          </T>
          {!open && summary ? (
            <T variant="code" mono tone="faint" numberOfLines={1}>
              {summary}
            </T>
          ) : null}
        </View>
      </View>
      {open && result ? (
        <View style={{ backgroundColor: palette.trace, borderRadius: radius.lg, padding: 10, marginTop: 6 }}>
          <T variant="code" mono selectable style={{ color: palette.traceFg }}>
            {result.length > 6000 ? `${result.slice(0, 6000)}\n… (${result.length - 6000} more chars)` : result}
          </T>
        </View>
      ) : null}
    </Pressable>
  );
}

function ThinkRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={{ marginVertical: 4 }}>
      <T variant="meta" tone="faint" style={{ fontStyle: "italic" }}>
        {open ? text : `Thought · ${text.split("\n")[0].slice(0, 80)}…`}
      </T>
    </Pressable>
  );
}

function PlanRow({ items }: { items: PlanItem[] }) {
  const { palette } = useTheme();
  return (
    <View
      style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, padding: 12, marginVertical: 8, gap: 6 }}
    >
      <T variant="micro" tone="faint" weight="medium">
        Plan
      </T>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <T variant="body" tone={it.state === "done" ? "ok" : it.state === "active" ? "live" : "faint"}>
            {it.state === "done" ? "✓" : it.state === "active" ? "●" : "○"}
          </T>
          <T
            variant="body"
            tone={it.state === "todo" ? "muted" : "default"}
            style={it.state === "done" ? { textDecorationLine: "line-through" } : undefined}
          >
            {it.text}
          </T>
        </View>
      ))}
    </View>
  );
}

function LifecycleRow({ label, detail }: { label: string; detail?: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "center", marginVertical: 8 }}>
      <T variant="micro" tone="faint">
        ●
      </T>
      <T variant="micro" tone="faint" mono>
        {label}
        {detail ? ` · ${detail}` : ""}
      </T>
    </View>
  );
}
