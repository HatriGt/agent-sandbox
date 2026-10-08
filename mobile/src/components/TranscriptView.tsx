import React, { memo, useMemo, useState } from "react";
import { View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import type { PlanItem, ProducedFile, TraceEvent } from "@/lib/trace";
import { producedFiles, resultSummary } from "@/lib/trace";
import { parseTestReport } from "@/lib/testReport";
import { DiffText } from "./DiffText";
import { MarkdownLite } from "./MarkdownLite";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { McpItem, parseMcpName } from "./McpItem";
import { ProducedFiles } from "./ProducedFiles";
import { TestResultsCard } from "./TestResultsCard";
import { T } from "./ui/AppText";
import { Icon, toolIcon } from "./ui/Icon";
import { animateLayout, CrossFade, FadeInUp, PressScale, ProgressFill } from "@/components/motion";

/**
 * A rendered thread item. Consecutive tool calls are grouped into one "Worked"
 * card (like the web's folded tool work); prose stays prose; you-turns are
 * right-aligned bubbles. `produced` is appended once, after the run settles.
 */
export type ThreadItem =
  | { kind: "tools"; tools: Extract<TraceEvent, { kind: "tool" }>[] }
  | { kind: "produced"; files: ProducedFile[] }
  /** `ms`: bounded by the stamped events around it (think events carry no stamp), like the web. */
  | { kind: "think"; text: string; ms?: number }
  | Exclude<TraceEvent, { kind: "tool" | "usage" | "think" }>;

/**
 * Group trace events into thread items. Pass `{ done: true }` once the run has finished to append
 * the produced-files row (the files the agent wrote under /workspace); while a run is live the row
 * is withheld, like the web. `usage` events never render — see latestUsage.
 */
export function groupEvents(events: TraceEvent[], opts?: { done?: boolean }): ThreadItem[] {
  const out: ThreadItem[] = [];
  for (let idx = 0; idx < events.length; idx++) {
    const e = events[idx];
    if (e.kind === "tool") {
      const last = out[out.length - 1];
      if (last && last.kind === "tools") last.tools.push(e);
      else out.push({ kind: "tools", tools: [e] });
    } else if (e.kind === "usage") {
      continue;
    } else if (e.kind === "think") {
      let before: number | undefined;
      for (let j = idx - 1; j >= 0 && before === undefined; j--) {
        const p = events[j];
        if (p.kind === "tool" && p.at !== undefined) before = p.at + (p.ms ?? 0);
        else if ((p.kind === "say" || p.kind === "you" || p.kind === "plan" || p.kind === "memory") && p.at !== undefined) before = p.at;
      }
      let after: number | undefined;
      for (let j = idx + 1; j < events.length && after === undefined; j++) {
        const n = events[j];
        if ("at" in n && n.at !== undefined) after = n.at;
      }
      out.push({ kind: "think", text: e.text, ...(before !== undefined && after !== undefined && after > before ? { ms: after - before } : {}) });
    } else {
      out.push(e);
    }
  }
  if (opts?.done) {
    const files = producedFiles(events);
    if (files.length) out.push({ kind: "produced", files });
  }
  return out;
}

/** Cheap structural equality for two thread items of the same slot (texts compared, tools field-by-field). */
function sameItem(a: ThreadItem, b: ThreadItem): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "tools" && b.kind === "tools") {
    if (a.tools.length !== b.tools.length) return false;
    return a.tools.every((t, i) => {
      const u = b.tools[i];
      return t.name === u.name && t.arg === u.arg && t.result === u.result && t.failed === u.failed && t.diff === u.diff && t.ms === u.ms && t.streaming === u.streaming;
    });
  }
  // Prose kinds can be long: their text is the whole identity, so skip serializing them.
  if (a.kind === "think" && b.kind === "think") return a.text === b.text && a.ms === b.ms;
  if (a.kind === "say" || a.kind === "you" || a.kind === "ask") return "text" in b && a.text === b.text;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Structural sharing across stream ticks: every log tick re-parses the whole trace into fresh
 * objects, which defeats `memo(ThreadRow)` and re-renders (and re-parses the markdown of) every
 * message. Reusing the previous object for each unchanged slot means a tick renders only the rows
 * that actually changed — normally just the growing tail.
 */
export function shareItems(prev: ThreadItem[], next: ThreadItem[]): ThreadItem[] {
  let same = prev.length === next.length;
  const out = next.map((it, i) => {
    const p = prev[i];
    if (p && sameItem(p, it)) return p;
    same = false;
    return it;
  });
  return same ? prev : out;
}

export type UsageEvent = Extract<TraceEvent, { kind: "usage" }>;

/** The last `usage` stamp of the run (cumulative in/out tokens + the latest context footprint), or null. */
export function latestUsage(events: TraceEvent[]): UsageEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === "usage") return e;
  }
  return null;
}

export const ThreadRow = memo(function ThreadRow({
  item,
  animate,
  onRevert,
  onActions,
  session,
  live,
}: {
  item: ThreadItem;
  /** The newest assistant block of a running turn: reveal its growing tail with a typewriter cadence. */
  live?: boolean;
  animate?: boolean;
  /** Set on revertable `you` items: called when the user confirms a revert to before this message. */
  onRevert?: (messageText: string) => void;
  /** Long-press on a message (yours or the agent's prose): the thread opens its action sheet. */
  onActions?: (text: string, revert?: () => void) => void;
  /** The box session; needed by the `produced` row to fetch/share files. Without it the row lists names only. */
  session?: string;
}) {
  const body = (() => {
    switch (item.kind) {
      case "you":
        return <YouBubble text={item.text} onRevert={onRevert} onActions={onActions} />;
      case "say":
        return (
          <PressScale
            disabled={!onActions}
            onLongPress={onActions ? () => onActions(item.text) : undefined}
            accessibilityHint={onActions ? "Long press for actions" : undefined}
            style={{ paddingVertical: 8 }}
          >
            <StreamingMarkdown text={item.text} live={!!live} />
          </PressScale>
        );
      case "ask":
        return <AskRow text={item.text} />;
      case "tools":
        return <ToolGroup tools={item.tools} />;
      case "produced":
        return session ? <ProducedFiles session={session} files={item.files} /> : <ProducedNames files={item.files} />;
      case "think":
        return <ThinkRow text={item.text} ms={item.ms} live={!!live} />;
      case "plan":
        return <PlanRow items={item.items} />;
      case "memory":
        return <MemoryRow note={item.note} text={item.text} />;
      case "lifecycle":
        return <LifecycleRow label={item.label} detail={item.detail} />;
      default:
        return null;
    }
  })();
  // Frozen at mount: flipping the wrapper later would change the tree shape and remount the row
  // (dropping its open/closed state and restarting the streaming reveal).
  const [enter] = useState(!!animate);
  if (!body) return null;
  return enter ? <FadeInUp>{body}</FadeInUp> : <>{body}</>;
});

function YouBubble({ text, onRevert, onActions }: { text: string; onRevert?: (messageText: string) => void; onActions?: (text: string, revert?: () => void) => void }) {
  const { palette } = useTheme();
  // A leading /skill token renders as a tinted tag, like the web.
  const m = text.match(/^\/([a-z0-9][a-z0-9-]*)\s*([\s\S]*)$/);
  const skillTag = m?.[1];
  const body = m ? m[2] : text;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 8, marginVertical: 8 }}>
      {onRevert ? <RevertButton onConfirm={() => onRevert(text)} /> : null}
      <PressScale
        disabled={!onActions}
        onLongPress={onActions ? () => onActions(text, onRevert ? () => onRevert(text) : undefined) : undefined}
        accessibilityHint={onActions ? "Long press for actions" : undefined}
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
          <T variant="body" selectable={!onActions} style={{ color: palette.primaryForeground }}>
            {body}
          </T>
        ) : null}
      </PressScale>
    </View>
  );
}

/** Round revert affordance next to your bubble; the confirm lives in the thread. */
function RevertButton({ onConfirm }: { onConfirm: () => void }) {
  const { palette } = useTheme();
  return (
    <PressScale
      onPress={onConfirm}
      haptic="light"
      scaleTo={0.9}
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
    </PressScale>
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
  const mcp = single ? parseMcpName(tools[0].name) : null;
  const headerIcon = single ? (mcp ? "zap" : toolIcon(tools[0].name)) : "layers";
  const headerName = mcp ? `${mcp.server} · ${mcp.label}` : tools[0].name;

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
      <PressScale
        onPress={() => {
          animateLayout();
          setOpen((o) => !o);
        }}
        haptic="selection"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <Icon name={headerIcon} size={15} color={failed ? palette.destructive : palette.mutedForeground} />
        {single ? (
          <T variant="meta" weight="medium" numberOfLines={1} style={{ flex: 1, minWidth: 0 }} tone={failed ? "destructive" : "default"}>
            {headerName}
            {tools[0].arg ? (
              <T variant="meta" tone="faint" numberOfLines={1}>
                {"  "}
                {tools[0].arg.split("\n")[0]}
              </T>
            ) : null}
          </T>
        ) : (
          <T variant="meta" weight="medium" numberOfLines={1} style={{ flex: 1, minWidth: 0 }} tone={failed ? "destructive" : "default"}>
            Worked · {tools.length} steps
            {failed ? ` · ${failed} failed` : ""}
          </T>
        )}
        <View style={{ flexShrink: 0 }}>
          <Icon name={open ? "chevron-up" : "chevron-down"} size={15} color={palette.faint} />
        </View>
      </PressScale>
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

const RESULT_MAX_CHARS = 6000;
const DIFF_MAX_LINES = 200;

function ToolRow({ tool, last }: { tool: Extract<TraceEvent, { kind: "tool" }>; last: boolean }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(false);
  const mcp = parseMcpName(tool.name);
  // A finished test run reads as a card, never as a wall of runner output; while the shell is
  // still streaming the output is partial and the parse would flicker, so wait for it to settle.
  const report = useMemo(() => (tool.streaming ? null : parseTestReport(tool.result)), [tool.result, tool.streaming]);
  if (mcp) return <McpItem event={tool} call={mcp} last={last} />;

  const expandable = !!tool.result || !!tool.diff;
  const summary = report
    ? `${report.passed} passed${report.failed ? ` · ${report.failed} failed` : ""}${report.skipped ? ` · ${report.skipped} skipped` : ""}`
    : resultSummary(tool.result);
  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: palette.border }}>
      <PressScale
        onPress={() => {
          if (!expandable) return;
          animateLayout();
          setOpen((o) => !o);
        }}
        style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}
      >
        <Icon
          name={report ? (report.failed ? "x-circle" : "check-circle") : toolIcon(tool.name)}
          size={13}
          color={tool.failed || report?.failed ? palette.destructive : report ? palette.ok : palette.faint}
          style={{ marginTop: 2 }}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="code" mono tone={tool.failed ? "destructive" : "muted"} numberOfLines={open ? undefined : 1}>
            {tool.name}
            {tool.arg ? `: ${tool.arg.split("\n")[0]}` : ""}
            {tool.failed ? " — failed" : tool.streaming ? " — running" : ""}
          </T>
          {!open && summary ? (
            <T variant="code" mono tone={report?.failed ? "destructive" : "faint"} numberOfLines={1}>
              {summary}
            </T>
          ) : null}
        </View>
        {expandable ? <Icon name={open ? "minimize-2" : "maximize-2"} size={12} color={palette.faint} style={{ marginTop: 3 }} /> : null}
      </PressScale>
      {open ? (
        <View style={{ marginHorizontal: 12, marginBottom: 10, gap: 8 }}>
          {tool.diff ? <DiffText diff={tool.diff} maxLines={DIFF_MAX_LINES} /> : null}
          {report ? <TestResultsCard report={report} onRaw={() => setRaw((r) => !r)} rawOpen={raw} /> : null}
          {tool.result && (!report || raw) ? (
            <View style={{ backgroundColor: palette.trace, borderRadius: radius.lg, padding: 10 }}>
              <T variant="code" mono selectable style={{ color: palette.traceFg }}>
                {tool.result.length > RESULT_MAX_CHARS
                  ? `${tool.result.slice(0, RESULT_MAX_CHARS)}\n… (${tool.result.length - RESULT_MAX_CHARS} more chars)`
                  : tool.result}
              </T>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** The produced row without a session: names only (no fetch is possible). */
function ProducedNames({ files }: { files: ProducedFile[] }) {
  const { palette } = useTheme();
  return (
    <View style={{ gap: 6, marginVertical: 10 }}>
      <T variant="micro" tone="muted" weight="semibold" style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
        {files.length === 1 ? "Produced file" : "Produced files"}
      </T>
      {files.map((f) => (
        <View key={f.relPath} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="file" size={13} color={palette.mutedForeground} />
          <T variant="meta" mono numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1, minWidth: 0 }}>
            {f.relPath}
          </T>
        </View>
      ))}
    </View>
  );
}

const MEMORY_KIND: Record<string, string> = { preference: "Preference", rule: "Rule", domain: "Domain", fact: "Fact", decision: "Decision", lesson: "Lesson", playbook: "Playbook" };

/** A note the agent saved for future runs: one quiet line, never the raw `memory add` plumbing. */
function MemoryRow({ note, text }: { note: string; text: string }) {
  return (
    <T variant="meta" tone="faint" numberOfLines={1} style={{ marginVertical: 4 }}>
      Remembered · {MEMORY_KIND[note] ?? "Note"} — {text}
    </T>
  );
}

/** Folded to "Thought for Ns" ("Thinking…" while it is the live tail); tap to read the reasoning. */
function ThinkRow({ text, ms, live }: { text: string; ms?: number; live: boolean }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const label = live && ms === undefined ? "Thinking…" : ms !== undefined ? `Thought for ${Math.max(1, Math.round(ms / 1000))}s` : "Thought";
  return (
    <PressScale
      onPress={() => {
        animateLayout();
        setOpen((o) => !o);
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={{ marginVertical: 6, gap: 4 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="cloud" size={13} color={live && ms === undefined ? palette.live : palette.faint} />
        <T variant="meta" tone={live && ms === undefined ? "live" : "faint"} style={{ flex: 1 }}>
          {label}
        </T>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={13} color={palette.faint} />
      </View>
      {open ? (
        <T variant="meta" tone="faint" selectable style={{ fontStyle: "italic", paddingLeft: 21 }}>
          {text}
        </T>
      ) : null}
    </PressScale>
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
        <T variant="micro" tone="muted" weight="semibold" numberOfLines={1} style={{ flexShrink: 0 }}>
          Plan · {done}/{items.length}
        </T>
        <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: palette.muted, marginLeft: 6, overflow: "hidden" }}>
          <ProgressFill fraction={done / Math.max(1, items.length)} color={palette.ok} height={3} />
        </View>
      </View>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <CrossFade id={it.state} style={{ marginTop: 2 }}>
            <Icon
              name={it.state === "done" ? "check-circle" : it.state === "active" ? "loader" : "circle"}
              size={14}
              color={it.state === "done" ? palette.ok : it.state === "active" ? palette.live : palette.faint}
            />
          </CrossFade>
          <T
            variant="body"
            tone={it.state === "todo" ? "muted" : "default"}
            style={[{ flex: 1, minWidth: 0 }, it.state === "done" ? { textDecorationLine: "line-through" as const } : null]}
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
      {/* The rules must give way to the label, not the other way round: a long `detail` on a narrow
          phone would otherwise push the right-hand rule off-screen. */}
      <View style={{ flex: 1, minWidth: 8, height: 1, backgroundColor: palette.border }} />
      <Icon name="zap" size={11} color={palette.faint} />
      <T variant="micro" tone="faint" mono numberOfLines={1} style={{ flexShrink: 1, minWidth: 0 }}>
        {label}
        {detail ? ` · ${detail}` : ""}
      </T>
      <View style={{ flex: 1, minWidth: 8, height: 1, backgroundColor: palette.border }} />
    </View>
  );
}
