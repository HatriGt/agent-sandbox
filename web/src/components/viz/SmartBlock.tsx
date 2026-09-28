import * as React from "react";
import { nodeText, parseChartSpec, parseDelimited, parseFlow, parseStats, parseTree, looksLikeTree } from "@/lib/viz";
import {
  calloutKind,
  looksLikeCommits,
  looksLikeDiffstat,
  parseBadges,
  parseCommits,
  parseDag,
  parseDeps,
  parseDiffstat,
  parseFunnel,
  parseHeatmap,
  parseHttp,
  parseKeys,
  parseKv,
  parseLog,
  parsePalette,
  parseProgress,
  parseScores,
  parseSpans,
  parseSteps,
  parseTests,
  parseTimeline,
} from "@/lib/viz-extra";
import { Markdown } from "@/components/ui/markdown";
import { ChartBlock } from "./ChartBlock";
import { CalloutBlock } from "./CalloutBlock";
import { HeatmapBlock, FunnelBlock, SpansBlock } from "./ChartExtras";
import { DataTable } from "./DataTable";
import { FlowBlock } from "./FlowBlock";
import { CommitsBlock, DepsBlock, DiffstatBlock } from "./GitBlocks";
import { GraphBlock } from "./GraphBlock";
import { JsonBlock } from "./JsonBlock";
import { HttpBlock, LogBlock, TestsBlock } from "./OpsBlocks";
import { BadgesBlock, KeysBlock, KvBlock, PaletteBlock, ProgressBlock, ScoreBlock } from "./SmallBlocks";
import { StatsBlock } from "./StatsBlock";
import { TimelineBlock, StepsBlock } from "./TimelineBlock";
import { TreeBlock } from "./TreeBlock";

/**
 * The output-visualizer router (docs/output-visualizers.md). Given a fenced block's language and
 * text, return a rich rendering — or null, which means "plain code block". Null is the contract:
 * a fence that is malformed, half-streamed, or simply not what it claims falls back to code, so a
 * visualizer can never lose content or crash the transcript (parsers throw nothing; the boundary
 * below catches renderer bugs).
 */
export function smartBlock(language: string, code: string): React.ReactElement | null {
  const src = code.replace(/\n$/, "");
  let el: React.ReactElement | null = null;
  switch (language) {
    case "chart": {
      const spec = parseChartSpec(src);
      el = spec && <ChartBlock spec={spec} source={src} />;
      break;
    }
    case "stats": {
      const stats = parseStats(src);
      el = stats && <StatsBlock stats={stats} source={src} />;
      break;
    }
    case "flow": {
      const chains = parseFlow(src);
      el = chains && <FlowBlock chains={chains} source={src} />;
      break;
    }
    case "tree": {
      const roots = parseTree(src);
      el = roots && <TreeBlock roots={roots} source={src} />;
      break;
    }
    case "csv":
    case "tsv": {
      const t = parseDelimited(src, language === "csv" ? "," : "\t");
      el = t && <DataTable head={t.head} rows={t.rows} texts={t.rows} />;
      break;
    }
    case "json":
    case "jsonc": {
      // Object/array payloads worth exploring: multi-line, or a compact one-liner long enough
      // that folding beats reading. Scalars and short snippets stay highlighted code, and an
      // unparseable (possibly still-streaming) fence stays code until it completes.
      if (!src.includes("\n") && src.length <= 80) break;
      try {
        const v: unknown = JSON.parse(src);
        if (typeof v === "object" && v !== null) el = <JsonBlock value={v} source={src} />;
      } catch {
        /* not (yet) valid JSON → plain highlighted code */
      }
      break;
    }
    case "timeline": {
      const events = parseTimeline(src);
      el = events && <TimelineBlock events={events} source={src} />;
      break;
    }
    case "steps": {
      const steps = parseSteps(src);
      el = steps && <StepsBlock steps={steps} source={src} />;
      break;
    }
    case "progress": {
      const rows = parseProgress(src);
      el = rows && <ProgressBlock rows={rows} source={src} />;
      break;
    }
    case "kv": {
      const rows = parseKv(src);
      el = rows && <KvBlock rows={rows} source={src} />;
      break;
    }
    case "badges": {
      const badges = parseBadges(src);
      el = badges && <BadgesBlock badges={badges} source={src} />;
      break;
    }
    case "score": {
      const scores = parseScores(src);
      el = scores && <ScoreBlock scores={scores} source={src} />;
      break;
    }
    case "keys":
    case "shortcuts": {
      const rows = parseKeys(src);
      el = rows && <KeysBlock rows={rows} source={src} />;
      break;
    }
    case "palette": {
      const swatches = parsePalette(src);
      el = swatches && <PaletteBlock swatches={swatches} source={src} />;
      break;
    }
    case "http": {
      const calls = parseHttp(src);
      el = calls && <HttpBlock calls={calls} source={src} />;
      break;
    }
    case "tests": {
      const report = parseTests(src);
      el = report && <TestsBlock report={report} source={src} />;
      break;
    }
    case "log": {
      const lines = parseLog(src);
      el = lines && <LogBlock lines={lines} source={src} />;
      break;
    }
    case "diffstat": {
      const files = parseDiffstat(src);
      el = files && <DiffstatBlock files={files} source={src} />;
      break;
    }
    case "commits": {
      const commits = parseCommits(src);
      el = commits && <CommitsBlock commits={commits} source={src} />;
      break;
    }
    case "deps": {
      const deps = parseDeps(src);
      el = deps && <DepsBlock deps={deps} source={src} />;
      break;
    }
    case "graph":
    case "dag": {
      const dag = parseDag(src);
      el = dag && <GraphBlock dag={dag} source={src} />;
      break;
    }
    case "funnel": {
      const stages = parseFunnel(src);
      el = stages && <FunnelBlock stages={stages} source={src} />;
      break;
    }
    case "gantt":
    case "spans": {
      const r = parseSpans(src);
      el = r && <SpansBlock spans={r.spans} unit={r.unit} source={src} />;
      break;
    }
    case "heatmap": {
      const map = parseHeatmap(src);
      el = map && <HeatmapBlock map={map} source={src} />;
      break;
    }
    case "note":
    case "info":
    case "tip":
    case "important":
    case "warn":
    case "warning":
    case "caution":
    case "danger":
    case "success":
    case "error": {
      const kind = calloutKind(language);
      // Callout content is markdown — it re-enters the same pipeline, so a table inside a warning
      // still renders rich. No VizBoundary needed: CalloutBlock has no parser to disagree with.
      if (kind) return <CalloutBlock kind={kind}>{<Markdown>{src}</Markdown>}</CalloutBlock>;
      break;
    }
    case "plaintext":
    case "text":
    case "": {
      // Auto-upgrades for bare fences with an unmistakable shape.
      if (looksLikeTree(src)) {
        const roots = parseTree(src);
        el = roots && <TreeBlock roots={roots} source={src} />;
      } else if (looksLikeDiffstat(src)) {
        const files = parseDiffstat(src);
        el = files && <DiffstatBlock files={files} source={src} />;
      } else if (looksLikeCommits(src)) {
        const commits = parseCommits(src);
        el = commits && <CommitsBlock commits={commits} source={src} />;
      }
      break;
    }
  }
  return el && <VizBoundary source={src}>{el}</VizBoundary>;
}

/**
 * Markdown `table` override: walk the thead/tbody react-markdown produced, keep each cell's
 * rendered nodes, mirror them as text, and hand both to DataTable. Any unexpected shape → null,
 * caller renders the stock table.
 */
export function tableFromMarkdown(children: React.ReactNode): React.ReactElement | null {
  const rows: React.ReactNode[][] = [];
  const texts: string[][] = [];
  let head: React.ReactNode[] | null = null;

  const cellsOf = (tr: React.ReactElement<{ children?: React.ReactNode }>): React.ReactNode[] =>
    React.Children.toArray(tr.props.children).filter((c) => React.isValidElement(c)).map((c) => (c as React.ReactElement<{ children?: React.ReactNode }>).props.children);

  for (const section of React.Children.toArray(children)) {
    if (!React.isValidElement<{ children?: React.ReactNode }>(section)) continue;
    const isHead = section.type === "thead";
    for (const tr of React.Children.toArray(section.props.children)) {
      if (!React.isValidElement<{ children?: React.ReactNode }>(tr)) continue;
      const cells = cellsOf(tr);
      if (isHead && !head) head = cells;
      else {
        rows.push(cells);
        texts.push(cells.map((c) => nodeText(c).trim()));
      }
    }
  }
  if (!head || rows.length === 0 || rows.some((r) => r.length !== head!.length)) return null;
  const headTexts = head.map((h) => nodeText(h).trim());
  const source = [headTexts, ...texts].map((r) => r.join("\t")).join("\n");
  return (
    <VizBoundary source={source}>
      <DataTable head={headTexts.map((t, i) => t || head![i])} rows={rows} texts={texts} />
    </VizBoundary>
  );
}

/**
 * Last line of defense: a visualizer renderer bug shows the plain source, never a broken thread.
 * (Parsers already return null on bad input; this catches what they can't predict.)
 */
class VizBoundary extends React.Component<{ source: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <pre className="bg-muted/40 my-3 overflow-x-auto rounded-md border px-4 py-3 font-mono text-code whitespace-pre">{this.props.source}</pre>
    );
  }
}
