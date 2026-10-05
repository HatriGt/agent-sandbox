/**
 * Shapes the AUTOMATIC visualizers recognise in ordinary agent output — a bare code fence, a plain
 * list, a paragraph — with no cooperation from the agent (no special fence language). Parsers live
 * in lib/viz-auto.ts (pure, tested); renderers in components/viz/AutoBlocks.tsx. Every parser
 * returns null unless it is confident: the fallback is always the plain rendering.
 */
import type { Dag, Sequence } from "./viz-extra";

/** A `.env` / shell-export style listing. Secrets are detected by key name and masked by default. */
export interface EnvVar {
  key: string;
  value: string;
  secret: boolean;
  comment?: string;
}

export interface StackFrame {
  fn?: string;
  file?: string;
  line?: number;
  col?: number;
  /** node_modules / site-packages / stdlib — folded by default so the app's own frames stand out. */
  vendor: boolean;
  raw: string;
}
export interface StackTrace {
  /** The error line(s) above the frames, e.g. `TypeError: x is not a function`. */
  message: string;
  name?: string;
  frames: StackFrame[];
  language: "js" | "py" | "java" | "go" | "rust" | "other";
}

/** `ls -l`, `du -sh`, `find -ls` style listings. */
export interface FileEntry {
  name: string;
  kind: "file" | "dir" | "link";
  bytes?: number;
  sizeText?: string;
  mode?: string;
  modified?: string;
}

export interface LinkItem {
  url: string;
  label?: string;
  host: string;
  kind: "pr" | "issue" | "commit" | "repo" | "doc" | "other";
  /** e.g. `#482` or `acme/web#482` for PR/issue links, short sha for commits. */
  ref?: string;
}

/** Shell commands (`$ …` lines, or a fence of plain commands) — each copyable on its own. */
export interface CommandLine {
  cmd: string;
  comment?: string;
}

/** `label: before → after` or a two-column before/after table. */
export interface Comparison {
  label: string;
  before: string;
  after: string;
  beforeNum?: number;
  afterNum?: number;
  unit?: string;
  /** Which direction is an improvement, when the label makes it obvious (latency ↓, throughput ↑). */
  betterWhen?: "lower" | "higher";
}

export interface CronSpec {
  expr: string;
  description: string;
  fields: { label: string; value: string; meaning: string }[];
}

export interface UrlParts {
  href: string;
  protocol: string;
  host: string;
  path: string;
  query: { key: string; value: string }[];
  hash?: string;
}

export interface JwtDecoded {
  raw: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  iat?: number;
  exp?: number;
  expired?: boolean;
}

/** `Term — detail` / `**Term**: detail` list items. */
export interface Definition {
  term: string;
  detail: string;
}

/** List items that each start with a status glyph or word (✓ ✗ ⚠ ⏳ ✅ ❌ PASS FAIL …). */
export interface StatusItem {
  state: "ok" | "fail" | "warn" | "pending" | "info";
  text: string;
}

/** INI / TOML sections of key = value rows. */
export interface IniSection {
  name?: string;
  rows: { key: string; value: string }[];
}

/** Fixed-width column output (`ps`, `docker ps`, `kubectl get`, `df -h`) or an ASCII-boxed table. */
export interface Columns {
  head: string[];
  rows: string[][];
}

export interface SemverRow {
  name: string;
  from: string;
  to: string;
  jump: "major" | "minor" | "patch" | "other";
}

/** What a bare fence turned out to be. Existing blocks reuse their own parsed types. */
export type AutoBlock =
  | { kind: "table"; table: Columns; title?: string }
  | { kind: "json"; value: unknown }
  | { kind: "kv"; rows: { key: string; value: string }[] }
  | { kind: "ini"; sections: IniSection[] }
  | { kind: "env"; vars: EnvVar[] }
  | { kind: "stack"; trace: StackTrace }
  | { kind: "files"; entries: FileEntry[] }
  | { kind: "links"; links: LinkItem[] }
  | { kind: "commands"; commands: CommandLine[] }
  | { kind: "comparison"; rows: Comparison[] }
  | { kind: "cron"; specs: CronSpec[] }
  | { kind: "url"; url: UrlParts }
  | { kind: "jwt"; jwt: JwtDecoded }
  | { kind: "semver"; rows: SemverRow[] }
  | { kind: "dag"; dag: Dag }
  | { kind: "sequence"; sequence: Sequence }
  | { kind: "progress"; rows: { label: string; value: number; max: number }[] }
  | { kind: "badges"; badges: { label: string; state: string }[] }
  | { kind: "http"; lines: string }
  | { kind: "log"; lines: string }
  | { kind: "tests"; lines: string }
  | { kind: "timeline"; lines: string }
  | { kind: "steps"; lines: string }
  | { kind: "deps"; lines: string }
  | { kind: "diffstat"; lines: string }
  | { kind: "commits"; lines: string }
  | { kind: "tree"; lines: string }
  | { kind: "csv"; delimiter: "," | "\t" | "|" };
