import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import type { CommandLine, Comparison, CronSpec, EnvVar, FileEntry, IniSection, JwtDecoded, LinkItem, StackTrace, UrlParts } from "@/lib/viz";
import { T } from "../ui/AppText";
import { Icon, type IconName } from "../ui/Icon";
import { MiniAction } from "./VizFrame";
import { PressScale } from "@/components/motion";

/**
 * RN bodies for the automatic visualizers (lib/viz-auto.ts), mirroring web/src/components/viz/AutoBlocks.tsx.
 * The parent wraps each in VizFrame. State is carried by a glyph or word as well as a colour.
 */

const CAP = 40;

function useCapped<X>(items: X[]): { shown: X[]; more: React.ReactNode } {
  const [all, setAll] = React.useState(false);
  const shown = all ? items : items.slice(0, CAP);
  const more =
    !all && items.length > CAP ? (
      <View style={{ alignItems: "flex-start", paddingTop: 6 }}>
        <MiniAction label={`Show all ${items.length}`} icon="chevron-down" onPress={() => setAll(true)} />
      </View>
    ) : null;
  return { shown, more };
}

function useCopied(): [boolean, (text: string) => void] {
  const [done, setDone] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (text: string) => {
    Clipboard.setStringAsync(text)
      .then(() => {
        setDone(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1500) as unknown as number;
      })
      .catch(() => {});
  };
  return [done, copy];
}

function CopyIcon({ text, label = "Copy", color }: { text: string; label?: string; color?: string }) {
  const { palette } = useTheme();
  const [done, copy] = useCopied();
  return (
    <PressScale onPress={() => copy(text)} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
      <Icon name={done ? "check" : "copy"} size={14} color={done ? palette.ok : color} />
    </PressScale>
  );
}

const rowBorder = (i: number, color: string) => ({ borderTopWidth: i ? 1 : 0, borderTopColor: color });

// ---------------------------------------------------------------- ini

export function IniBlock({ sections }: { sections: IniSection[] }) {
  const { palette } = useTheme();
  return (
    <View>
      {sections.map((s, i) => (
        <View key={s.name ?? i} style={{ ...rowBorder(i, palette.border), paddingTop: i ? 8 : 0, paddingBottom: 6 }}>
          {s.name ? (
            <T variant="code" mono weight="semibold" style={{ marginBottom: 4 }}>
              [{s.name}]
            </T>
          ) : null}
          {s.rows.map((r, k) => (
            <View key={`${r.key}-${k}`} style={{ flexDirection: "row", gap: 16, paddingVertical: 2 }}>
              <T variant="code" mono tone="muted" style={{ maxWidth: "45%" }}>
                {r.key}
              </T>
              <T variant="code" mono selectable style={{ flex: 1 }}>
                {r.value}
              </T>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- env

export function EnvBlock({ vars }: { vars: EnvVar[] }) {
  const { palette } = useTheme();
  const [revealed, setRevealed] = React.useState<Set<string>>(() => new Set());
  const secrets = vars.filter((v) => v.secret);
  const allShown = secrets.length > 0 && secrets.every((v) => revealed.has(v.key));
  const toggle = (key: string) =>
    setRevealed((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const { shown, more } = useCapped(vars);
  return (
    <View>
      {secrets.length > 0 ? (
        <View style={{ alignItems: "flex-start", paddingBottom: 6 }}>
          <MiniAction
            label={allShown ? "Hide secrets" : `${secrets.length} ${secrets.length === 1 ? "secret" : "secrets"} masked · reveal`}
            icon={allShown ? "eye-off" : "eye"}
            onPress={() => setRevealed(allShown ? new Set() : new Set(secrets.map((v) => v.key)))}
          />
        </View>
      ) : null}
      {shown.map((v, i) => {
        const visible = !v.secret || revealed.has(v.key);
        return (
          <PressScale
            key={`${v.key}-${i}`}
            onPress={v.secret ? () => toggle(v.key) : undefined}
            disabled={!v.secret}
            accessibilityLabel={v.secret ? (visible ? `Hide ${v.key}` : `Reveal ${v.key}`) : undefined}
            style={{ ...rowBorder(i, palette.border), paddingVertical: 5, gap: 2 }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <T variant="code" mono weight="medium" numberOfLines={1} style={{ maxWidth: "45%" }}>
                {v.key}
              </T>
              <T
                variant="code"
                mono
                tone={visible ? "muted" : "faint"}
                numberOfLines={1}
                style={{ flex: 1, letterSpacing: visible ? 0 : 2 }}
              >
                {visible ? v.value || "∅" : "••••••••"}
              </T>
              {v.secret ? <Icon name={visible ? "eye-off" : "eye"} size={14} /> : null}
              <CopyIcon text={v.value} label={`Copy ${v.key}`} />
            </View>
            {v.comment ? (
              <T variant="micro" tone="faint" numberOfLines={1}>
                {v.comment}
              </T>
            ) : null}
          </PressScale>
        );
      })}
      {more}
    </View>
  );
}

// ---------------------------------------------------------------- stack trace

export function StackTraceBlock({ trace }: { trace: StackTrace }) {
  const { palette } = useTheme();
  const [vendors, setVendors] = React.useState(false);
  const firstApp = trace.frames.findIndex((f) => !f.vendor);
  // Runs of vendor frames fold into one disclosure row each, so the app's own frames stand out.
  const rows: ({ kind: "frame"; i: number } | { kind: "fold"; n: number; at: number })[] = [];
  for (let i = 0; i < trace.frames.length; i++) {
    if (trace.frames[i].vendor && !vendors) {
      let j = i;
      while (j < trace.frames.length && trace.frames[j].vendor) j++;
      rows.push({ kind: "fold", n: j - i, at: i });
      i = j - 1;
    } else rows.push({ kind: "frame", i });
  }
  const folded = trace.frames.filter((f) => f.vendor).length;
  const { shown, more } = useCapped(rows);
  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          gap: 8,
          borderLeftWidth: 2,
          borderLeftColor: palette.destructive,
          backgroundColor: palette.muted,
          borderRadius: radius.sm,
          paddingHorizontal: 10,
          paddingVertical: 8,
          marginBottom: 6,
        }}
      >
        <Icon name="alert-triangle" size={14} color={palette.destructive} style={{ marginTop: 2 }} />
        <T variant="meta" weight="medium" tone="destructive" selectable style={{ flex: 1 }}>
          {trace.message}
        </T>
      </View>
      {shown.map((r, k) => {
        if (r.kind === "fold") {
          return (
            <PressScale key={`f${r.at}`} onPress={() => setVendors(true)} accessibilityRole="button" style={{ ...rowBorder(k, palette.border), paddingVertical: 5, flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Icon name="more-horizontal" size={12} color={palette.faint} />
              <T variant="micro" tone="faint">
                {r.n} framework {r.n === 1 ? "frame" : "frames"}
              </T>
            </PressScale>
          );
        }
        const f = trace.frames[r.i];
        const loc = f.file ? `${f.file}${f.line != null ? `:${f.line}` : ""}${f.col != null ? `:${f.col}` : ""}` : null;
        return (
          <View
            key={`r${r.i}`}
            style={{
              ...rowBorder(k, palette.border),
              flexDirection: "row",
              gap: 8,
              paddingVertical: 4,
              paddingHorizontal: 4,
              backgroundColor: r.i === firstApp ? palette.muted : undefined,
              borderRadius: r.i === firstApp ? radius.sm : 0,
            }}
          >
            <T variant="code" mono tone="faint" style={{ width: 22, textAlign: "right", fontVariant: ["tabular-nums"] }}>
              {r.i + 1}
            </T>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="code" mono tone={f.vendor ? "faint" : "default"} weight={f.vendor ? "regular" : "medium"} numberOfLines={1}>
                {f.fn ?? "<anonymous>"}
              </T>
              {loc ? (
                <T variant="micro" mono tone={f.vendor ? "faint" : "muted"} numberOfLines={1} ellipsizeMode="head" selectable>
                  {loc}
                </T>
              ) : null}
            </View>
          </View>
        );
      })}
      {more}
      {vendors && folded > 0 ? (
        <View style={{ alignItems: "flex-start", paddingTop: 6 }}>
          <MiniAction label="Hide framework frames" icon="chevron-up" onPress={() => setVendors(false)} />
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- files

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

const FILE_ICON: Record<FileEntry["kind"], IconName> = { dir: "folder", link: "link-2", file: "file" };

export function FileListBlock({ entries }: { entries: FileEntry[] }) {
  const { palette } = useTheme();
  const sorted = React.useMemo(() => [...entries].sort((a, b) => (a.kind === "dir" ? 0 : 1) - (b.kind === "dir" ? 0 : 1)), [entries]);
  const max = Math.max(1, ...entries.map((e) => e.bytes ?? 0));
  const total = entries.reduce((n, e) => n + (e.kind === "file" ? e.bytes ?? 0 : 0), 0);
  const { shown, more } = useCapped(sorted);
  return (
    <View>
      {shown.map((e, i) => (
        <View key={`${e.name}-${i}`} style={{ ...rowBorder(i, palette.border), flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
          <Icon name={FILE_ICON[e.kind]} size={14} color={e.kind === "dir" ? palette.live : palette.mutedForeground} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="code" mono weight={e.kind === "dir" ? "medium" : "regular"} numberOfLines={1} selectable>
              {e.name}
              {e.kind === "dir" ? "/" : ""}
            </T>
            {e.modified ? (
              <T variant="micro" tone="faint" numberOfLines={1}>
                {e.modified}
              </T>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, width: 104, justifyContent: "flex-end" }}>
            {e.bytes != null && e.kind !== "dir" ? (
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: palette.muted, overflow: "hidden" }}>
                <View style={{ width: `${Math.max(4, (e.bytes / max) * 100)}%`, height: "100%", borderRadius: 2, backgroundColor: palette.live }} />
              </View>
            ) : null}
            <T variant="micro" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
              {e.bytes != null ? humanBytes(e.bytes) : e.sizeText ?? ""}
            </T>
          </View>
        </View>
      ))}
      {more}
      {total > 0 ? (
        <T variant="micro" tone="faint" style={{ textAlign: "right", paddingTop: 6, borderTopWidth: 1, borderTopColor: palette.border, fontVariant: ["tabular-nums"] }}>
          {humanBytes(total)} in files
        </T>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- links

const LINK_ICON: Record<LinkItem["kind"], IconName> = {
  pr: "git-pull-request",
  issue: "circle",
  commit: "git-commit",
  repo: "book",
  doc: "book-open",
  other: "link",
};

export function LinksBlock({ links }: { links: LinkItem[] }) {
  const { palette } = useTheme();
  const { shown, more } = useCapped(links);
  const tint = (k: LinkItem["kind"]) => (k === "pr" ? palette.ok : k === "issue" ? palette.attentionText : k === "commit" ? palette.live : palette.mutedForeground);
  return (
    <View style={{ gap: 6 }}>
      {shown.map((l, i) => (
        <PressScale
          key={`${l.url}-${i}`}
          onPress={() => {
            WebBrowser.openBrowserAsync(l.url).catch(() => {});
          }}
          accessibilityRole="link"
          accessibilityLabel={`Open ${l.label ?? l.ref ?? l.url}`}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderWidth: 1,
            borderColor: pressed ? palette.lineStrong : palette.border,
            backgroundColor: pressed ? palette.muted : "transparent",
            borderRadius: radius.lg,
            paddingHorizontal: 10,
            paddingVertical: 8,
          })}
        >
          <View style={{ width: 28, height: 28, borderRadius: radius.md, backgroundColor: palette.muted, alignItems: "center", justifyContent: "center" }}>
            <Icon name={LINK_ICON[l.kind]} size={14} color={tint(l.kind)} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="meta" weight="medium" numberOfLines={1}>
              {l.label ?? l.ref ?? l.url.replace(/^https?:\/\//, "")}
            </T>
            <T variant="micro" tone="faint" numberOfLines={1}>
              {l.ref && l.label ? `${l.ref} · ` : ""}
              {l.host}
            </T>
          </View>
          <Icon name="arrow-up-right" size={14} />
        </PressScale>
      ))}
      {more}
    </View>
  );
}

// ---------------------------------------------------------------- commands

export function CommandBlock({ commands }: { commands: CommandLine[] }) {
  const { palette } = useTheme();
  const [allDone, copyAll] = useCopied();
  const { shown, more } = useCapped(commands);
  return (
    <View style={{ gap: 6 }}>
      {commands.length > 1 ? (
        <View style={{ alignItems: "flex-start" }}>
          <MiniAction label={allDone ? "Copied" : "Copy all"} icon={allDone ? "check" : "copy"} onPress={() => copyAll(commands.map((c) => c.cmd).join("\n"))} />
        </View>
      ) : null}
      <View style={{ backgroundColor: palette.trace, borderRadius: radius.md, paddingVertical: 4 }}>
        {shown.map((c, i) => (
          <View key={i} style={{ paddingHorizontal: 10 }}>
            {c.comment ? (
              <T variant="micro" mono style={{ color: palette.traceFg, opacity: 0.55, paddingTop: 6 }}>
                # {c.comment}
              </T>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 5 }}>
              <T variant="code" mono style={{ color: palette.ok }}>
                $
              </T>
              <T variant="code" mono selectable style={{ flex: 1, color: palette.traceFg }}>
                {c.cmd}
              </T>
              <CopyIcon text={c.cmd} label={`Copy ${c.cmd}`} color={palette.traceFg} />
            </View>
          </View>
        ))}
      </View>
      {more}
    </View>
  );
}

// ---------------------------------------------------------------- comparison

function fmt(n: number, unit?: string): string {
  const s = Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : Number.isInteger(n) ? String(n) : n.toFixed(n < 1 ? 2 : 1);
  return unit ? `${s}${unit.length <= 2 ? "" : " "}${unit}` : s;
}

export function ComparisonBlock({ rows }: { rows: Comparison[] }) {
  const { palette } = useTheme();
  const { shown, more } = useCapped(rows);
  return (
    <View>
      {shown.map((r, i) => {
        const numeric = r.beforeNum != null && r.afterNum != null;
        const b = r.beforeNum ?? 0;
        const a = r.afterNum ?? 0;
        const delta = numeric ? a - b : 0;
        const pct = numeric && b ? (delta / Math.abs(b)) * 100 : null;
        const improved = r.betterWhen ? (r.betterWhen === "lower" ? delta < 0 : delta > 0) : null;
        const tone = !numeric || delta === 0 ? palette.mutedForeground : improved === null ? palette.live : improved ? palette.ok : palette.destructive;
        const glyph: IconName = numeric && delta !== 0 ? (delta < 0 ? "trending-down" : "trending-up") : "minus";
        const max = numeric ? Math.max(Math.abs(b), Math.abs(a), 1e-9) : 1;
        return (
          <View key={i} style={{ ...rowBorder(i, palette.border), paddingVertical: 8, gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <T variant="meta" weight="medium" numberOfLines={1} style={{ flex: 1 }}>
                {r.label}
              </T>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.sm, backgroundColor: palette.muted, paddingHorizontal: 6, paddingVertical: 2 }}
                accessibilityLabel={improved === null ? "change" : improved ? "better" : "worse"}
              >
                <Icon name={glyph} size={12} color={tone} />
                <T variant="micro" weight="medium" style={{ color: tone, fontVariant: ["tabular-nums"] }}>
                  {pct != null ? `${pct > 0 ? "+" : ""}${Math.round(pct)}%` : numeric ? fmt(delta, r.unit) : "—"}
                </T>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <T variant="meta" tone="muted" selectable style={{ fontVariant: ["tabular-nums"] }}>
                {numeric ? fmt(b, r.unit) : r.before}
              </T>
              <Icon name="arrow-right" size={13} color={palette.faint} />
              <T variant="meta" weight="semibold" selectable style={{ fontVariant: ["tabular-nums"] }}>
                {numeric ? fmt(a, r.unit) : r.after}
              </T>
            </View>
            {numeric ? (
              <View style={{ gap: 2 }}>
                <View style={{ height: 3, borderRadius: 2, backgroundColor: palette.muted, overflow: "hidden" }}>
                  <View style={{ width: `${(Math.abs(b) / max) * 100}%`, height: "100%", backgroundColor: palette.faint }} />
                </View>
                <View style={{ height: 3, borderRadius: 2, backgroundColor: palette.muted, overflow: "hidden" }}>
                  <View style={{ width: `${(Math.abs(a) / max) * 100}%`, height: "100%", backgroundColor: improved === false ? palette.destructive : palette.live }} />
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
      {more}
    </View>
  );
}

// ---------------------------------------------------------------- cron

export function CronBlock({ specs }: { specs: CronSpec[] }) {
  const { palette } = useTheme();
  return (
    <View>
      {specs.map((s, i) => (
        <View key={i} style={{ ...rowBorder(i, palette.border), paddingVertical: 8, gap: 8 }}>
          <T variant="body" weight="medium">
            {s.description}
          </T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {s.expr.startsWith("@") ? (
              <View style={{ backgroundColor: palette.muted, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 4 }}>
                <T variant="code" mono>
                  {s.expr}
                </T>
              </View>
            ) : (
              s.fields.map((f) => (
                <View key={f.label} accessibilityLabel={`${f.label}: ${f.meaning}`} style={{ backgroundColor: palette.muted, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 4, alignItems: "center" }}>
                  <T variant="code" mono>
                    {f.value}
                  </T>
                  <T variant="micro" tone="faint" style={{ fontSize: 10, lineHeight: 12 }}>
                    {f.label}
                  </T>
                </View>
              ))
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- url

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function UrlBlock({ url }: { url: UrlParts }) {
  const { palette } = useTheme();
  const segs = url.path.split("/").filter(Boolean);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
        <T variant="code" mono tone="faint">
          {url.protocol}://
        </T>
        <T variant="code" mono weight="medium" selectable>
          {url.host}
        </T>
        {segs.map((s, i) => (
          <React.Fragment key={i}>
            <T variant="code" mono tone="faint">
              /
            </T>
            <View style={{ backgroundColor: palette.muted, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 }}>
              <T variant="code" mono>
                {safeDecode(s)}
              </T>
            </View>
          </React.Fragment>
        ))}
        {url.hash ? (
          <T variant="code" mono tone="live">
            #{url.hash}
          </T>
        ) : null}
      </View>
      {url.query.length > 0 ? (
        <View style={{ borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 4 }}>
          {url.query.map((q, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 2 }}>
              <T variant="code" mono tone="muted" style={{ maxWidth: "40%" }} numberOfLines={1}>
                {q.key}
              </T>
              <T variant="code" mono selectable numberOfLines={2} style={{ flex: 1 }}>
                {q.value || "∅"}
              </T>
              <CopyIcon text={q.value} label={`Copy ${q.key}`} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- jwt

function claimText(k: string, v: unknown): string {
  if ((k === "exp" || k === "iat" || k === "nbf") && typeof v === "number") return `${v} · ${new Date(v * 1000).toLocaleString()}`;
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 2) ?? String(v);
}

function rel(sec: number): string {
  const d = Math.abs(sec);
  return d < 60 ? `${Math.round(d)}s` : d < 3600 ? `${Math.round(d / 60)}m` : d < 86400 ? `${Math.round(d / 3600)}h` : `${Math.round(d / 86400)}d`;
}

export function JwtBlock({ jwt }: { jwt: JwtDecoded }) {
  const { palette } = useTheme();
  const left = jwt.exp != null ? jwt.exp - Date.now() / 1000 : null;
  const sections: [string, Record<string, unknown>][] = [
    ["header", jwt.header],
    ["payload", jwt.payload],
  ];
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name="alert-circle" size={12} color={palette.attentionText} />
          <T variant="micro" style={{ color: palette.attentionText }}>
            Decoded, not verified
          </T>
        </View>
        {left != null ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.muted, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Icon name={jwt.expired ? "x-circle" : "clock"} size={12} color={jwt.expired ? palette.destructive : palette.ok} />
            <T variant="micro" weight="medium" tone={jwt.expired ? "destructive" : "ok"}>
              {jwt.expired ? `expired ${rel(left)} ago` : `expires in ${rel(left)}`}
            </T>
          </View>
        ) : null}
      </View>
      {sections.map(([name, obj], si) => (
        <View key={name} style={{ ...rowBorder(si, palette.border), paddingTop: si ? 6 : 0 }}>
          <T variant="micro" tone="faint" weight="medium" style={{ textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 }}>
            {name}
          </T>
          {Object.entries(obj).map(([k, v]) => {
            const text = claimText(k, v);
            const multiline = text.includes("\n");
            return (
              <View key={k} style={{ flexDirection: multiline ? "column" : "row", gap: multiline ? 2 : 12, paddingVertical: 2 }}>
                <T variant="code" mono tone="muted" style={multiline ? undefined : { maxWidth: "40%" }}>
                  {k}
                </T>
                {multiline ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <T variant="code" mono selectable>
                      {text}
                    </T>
                  </ScrollView>
                ) : (
                  <T variant="code" mono selectable style={{ flex: 1 }}>
                    {text}
                  </T>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
