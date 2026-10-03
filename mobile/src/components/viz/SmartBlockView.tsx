import React from "react";
import type { SmartSpec } from "@/lib/viz";
import type { IconName } from "../ui/Icon";
import { VizFrame } from "./VizFrame";
import { ChartBlock } from "./ChartBlock";
import { JsonBlock } from "./JsonBlock";
import { TableBlock } from "./TableBlock";
import { BadgesBlock, CalloutBlock, KvBlock, ProgressBlock, StatsBlock, StepsBlock, TestsBlock, TimelineBlock } from "./SmallBlocks";

export { VizFrame } from "./VizFrame";

const KIND_ICON: Partial<Record<SmartSpec["kind"], IconName>> = {
  chart: "bar-chart-2",
  stats: "activity",
  kv: "list",
  badges: "tag",
  progress: "percent",
  steps: "list",
  table: "grid",
  json: "code",
  tests: "check-square",
  timeline: "clock",
};

/**
 * A parsed viz spec → its native block, framed with the fence kind, title and a raw toggle.
 * Callouts hold markdown, so the caller renders their body (`renderMarkdown`) — that keeps this
 * module free of a MarkdownLite import cycle.
 */
export function SmartBlockView({
  spec,
  raw,
  renderMarkdown,
}: {
  spec: SmartSpec;
  raw: React.ReactNode;
  renderMarkdown: (text: string) => React.ReactNode;
}) {
  if (spec.kind === "callout") {
    return (
      <CalloutBlock kind={spec.callout} title={spec.title}>
        {renderMarkdown(spec.body)}
      </CalloutBlock>
    );
  }
  const kindLabel = spec.kind === "table" ? "table" : spec.kind;
  return (
    <VizFrame kind={kindLabel} title={spec.title} raw={raw} icon={KIND_ICON[spec.kind]}>
      {body(spec)}
    </VizFrame>
  );
}

function body(spec: SmartSpec): React.ReactNode {
  switch (spec.kind) {
    case "chart":
      return <ChartBlock spec={spec.spec} />;
    case "stats":
      return <StatsBlock stats={spec.stats} />;
    case "kv":
      return <KvBlock rows={spec.rows} />;
    case "badges":
      return <BadgesBlock badges={spec.badges} />;
    case "progress":
      return <ProgressBlock rows={spec.rows} />;
    case "steps":
      return <StepsBlock steps={spec.steps} />;
    case "table":
      return <TableBlock table={spec.table} />;
    case "json":
      return <JsonBlock value={spec.value} />;
    case "tests":
      return <TestsBlock report={spec.report} />;
    case "timeline":
      return <TimelineBlock events={spec.events} />;
    default:
      return null;
  }
}
