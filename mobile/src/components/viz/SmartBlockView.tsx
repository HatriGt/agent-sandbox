import React from "react";
import type { SmartSpec } from "@/lib/viz";
import type { IconName } from "../ui/Icon";
import { VizFrame } from "./VizFrame";
import { ChartBlock } from "./ChartBlock";
import { JsonBlock } from "./JsonBlock";
import { TableBlock } from "./TableBlock";
import { BadgesBlock, CalloutBlock, KvBlock, ProgressBlock, StatsBlock, StepsBlock, TestsBlock, TimelineBlock } from "./SmallBlocks";
import { GraphBlock } from "./GraphBlock";
import { SequenceBlock } from "./SequenceBlock";
import { MermaidBlock } from "./MermaidBlock";
import { AnnotateBlock, CompareBlock, FindingsBlock, FlowBlock, LayersBlock, TreeBlock } from "./ExplainBlocks";
import { CommitsBlock, DepsBlock, DiffstatBlock, FunnelBlock, HeatmapBlock, HttpBlock, KeysBlock, LogBlock, PaletteBlock, ScoreBlock, SpansBlock } from "./OpsBlocks";
import { CommandBlock, ComparisonBlock, CronBlock, EnvBlock, FileListBlock, IniBlock, JwtBlock, LinksBlock, StackTraceBlock, UrlBlock } from "./AutoBlocks";

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
  graph: "share-2",
  sequence: "git-commit",
  mermaid: "share-2",
  findings: "alert-triangle",
  compare: "columns",
  annotate: "message-square",
  layers: "layers",
  flow: "arrow-right",
  tree: "folder",
  log: "terminal",
  http: "globe",
  diffstat: "file-text",
  commits: "git-commit",
  deps: "package",
  env: "lock",
  stack: "alert-octagon",
  files: "folder",
  links: "link",
  commands: "terminal",
  url: "link",
  jwt: "key",
  cron: "clock",
};

/**
 * A parsed viz spec -> its native block, framed with the fence kind, title and a raw toggle.
 * Callouts hold markdown, so the caller renders their body (`renderMarkdown`) - that keeps this
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
  return (
    <VizFrame kind={spec.kind} title={spec.kind === "mermaid" ? spec.title ?? spec.label : spec.title} raw={raw} icon={KIND_ICON[spec.kind]}>
      {body(spec, raw)}
    </VizFrame>
  );
}

function body(spec: Exclude<SmartSpec, { kind: "callout" }>, raw: React.ReactNode): React.ReactNode {
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
    case "graph":
      return <GraphBlock dag={spec.dag} />;
    case "sequence":
      return <SequenceBlock sequence={spec.sequence} />;
    case "mermaid":
      return <MermaidBlock source={spec.source} label={spec.label} fallback={raw} />;
    case "findings":
      return <FindingsBlock findings={spec.findings} />;
    case "compare":
      return <CompareBlock options={spec.options} />;
    case "annotate":
      return <AnnotateBlock data={spec.data} />;
    case "layers":
      return <LayersBlock layers={spec.layers} />;
    case "flow":
      return <FlowBlock chains={spec.chains} />;
    case "tree":
      return <TreeBlock roots={spec.roots} />;
    case "score":
      return <ScoreBlock scores={spec.scores} />;
    case "keys":
      return <KeysBlock rows={spec.rows} />;
    case "palette":
      return <PaletteBlock swatches={spec.swatches} />;
    case "http":
      return <HttpBlock calls={spec.calls} />;
    case "log":
      return <LogBlock lines={spec.lines} />;
    case "diffstat":
      return <DiffstatBlock files={spec.files} />;
    case "commits":
      return <CommitsBlock commits={spec.commits} />;
    case "deps":
      return <DepsBlock deps={spec.deps} />;
    case "funnel":
      return <FunnelBlock stages={spec.stages} />;
    case "spans":
      return <SpansBlock spans={spec.spans} unit={spec.unit} />;
    case "heatmap":
      return <HeatmapBlock map={spec.map} />;
    case "ini":
      return <IniBlock sections={spec.sections} />;
    case "env":
      return <EnvBlock vars={spec.vars} />;
    case "stack":
      return <StackTraceBlock trace={spec.trace} />;
    case "files":
      return <FileListBlock entries={spec.entries} />;
    case "links":
      return <LinksBlock links={spec.links} />;
    case "commands":
      return <CommandBlock commands={spec.commands} />;
    case "comparison":
      return <ComparisonBlock rows={spec.rows} />;
    case "cron":
      return <CronBlock specs={spec.specs} />;
    case "url":
      return <UrlBlock url={spec.url} />;
    case "jwt":
      return <JwtBlock jwt={spec.jwt} />;
  }
}
