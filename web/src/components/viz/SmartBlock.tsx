import * as React from "react";
import { nodeText, parseChartSpec, parseDelimited, parseFlow, parseStats, parseTree } from "@/lib/viz";
import {
  calloutKind,
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
import { sniffBare, sniffLanguage } from "@/lib/viz-auto";
import type { AutoBlock } from "@/lib/viz-auto-types";
import { CommandBlock, ComparisonBlock, CronBlock, EnvBlock, FileListBlock, IniBlock, JwtBlock, LinksBlock, StackTraceBlock, UrlBlock } from "./AutoBlocks";

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
    case "txt":
    case "plain":
    case "output":
    case "console-output":
    case "": {
      // Auto-upgrades for bare fences: the sniffer (lib/viz-auto.ts) recognises the shapes agents
      // put in plain fences — env files, stack traces, `docker ps` columns, psql grids, `ls -l`,
      // before → after lines, cron, URLs, JWTs… — and every existing opt-in shape it can confirm.
      el = renderAuto(sniffBare(src), src);
      break;
    }
    default: {
      // A language the router does not render rich on its own: yaml, toml/ini, env, mermaid, a
      // `$`-prompted shell session.
      el = renderAuto(sniffLanguage(language, src), src);
    }
  }
  return el && <VizBoundary source={src}>{el}</VizBoundary>;
}

/** One sniffed shape → its block. Shapes the existing parsers own are re-parsed from the source. */
function renderAuto(auto: AutoBlock | null, src: string): React.ReactElement | null {
  if (!auto) return null;
  switch (auto.kind) {
    case "table":
      return <DataTable head={auto.table.head} rows={auto.table.rows} texts={auto.table.rows} title={auto.title} />;
    case "csv": {
      const t = parseDelimited(src, auto.delimiter === "|" ? "," : auto.delimiter);
      return t && <DataTable head={t.head} rows={t.rows} texts={t.rows} />;
    }
    case "json":
      return <JsonBlock value={auto.value} source={src} />;
    case "kv":
      return <KvBlock rows={auto.rows} source={src} />;
    case "ini":
      return <IniBlock sections={auto.sections} source={src} />;
    case "env":
      return <EnvBlock vars={auto.vars} source={src} />;
    case "stack":
      return <StackTraceBlock trace={auto.trace} source={src} />;
    case "files":
      return <FileListBlock entries={auto.entries} source={src} />;
    case "links":
      return <LinksBlock links={auto.links} source={src} />;
    case "commands":
      return <CommandBlock commands={auto.commands} source={src} />;
    case "comparison":
      return <ComparisonBlock rows={auto.rows} source={src} />;
    case "cron":
      return <CronBlock specs={auto.specs} source={src} />;
    case "url":
      return <UrlBlock url={auto.url} source={src} />;
    case "jwt":
      return <JwtBlock jwt={auto.jwt} source={src} />;
    case "semver":
      return <DepsBlock deps={auto.rows} source={src} />;
    case "dag": {
      const dag = parseDag(auto.edges.length ? auto.edges.map(([a, b]) => `${a} -> ${b}`).join("\n") : src);
      return dag && <GraphBlock dag={dag} source={src} />;
    }
    case "progress": {
      const rows = parseProgress(src);
      return rows && <ProgressBlock rows={rows} source={src} />;
    }
    case "badges": {
      const badges = parseBadges(src);
      return badges && <BadgesBlock badges={badges} source={src} />;
    }
    case "http": {
      const calls = parseHttp(src);
      return calls && <HttpBlock calls={calls} source={src} />;
    }
    case "log": {
      const lines = parseLog(src);
      return lines && <LogBlock lines={lines} source={src} />;
    }
    case "tests": {
      const report = parseTests(src);
      return report && <TestsBlock report={report} source={src} />;
    }
    case "timeline": {
      const events = parseTimeline(src);
      return events && <TimelineBlock events={events} source={src} />;
    }
    case "steps": {
      const steps = parseSteps(src);
      return steps && <StepsBlock steps={steps} source={src} />;
    }
    case "deps": {
      const deps = parseDeps(src);
      return deps && <DepsBlock deps={deps} source={src} />;
    }
    case "diffstat": {
      const files = parseDiffstat(src);
      return files && <DiffstatBlock files={files} source={src} />;
    }
    case "commits": {
      const commits = parseCommits(src);
      return commits && <CommitsBlock commits={commits} source={src} />;
    }
    case "tree": {
      const roots = parseTree(src);
      return roots && <TreeBlock roots={roots} source={src} />;
    }
  }
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
