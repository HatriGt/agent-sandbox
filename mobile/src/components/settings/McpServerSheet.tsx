// Add / edit one MCP server — mirrors web/src/components/mcp/ServerSheet.tsx: Fields | JSON editor,
// transport picker with a sentence each, command tokens, secret-aware key·value rows, "What the agent
// sees" preview, connection test for saved remote servers. Same upsert body as the web.
import React, { useEffect, useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import { animateLayout, FadeIn, PressScale } from "@/components/motion";
import type { McpServerView } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type as typeScale } from "@/theme/tokens";
import { ago } from "@/lib/format";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Chevron } from "@/components/ui/Chevron";
import { Sheet } from "@/components/ui/Sheet";
import { Segmented } from "./Segmented";
import {
  TRANSPORTS,
  commandOf,
  draftOf,
  errMsg,
  fromDef,
  hintFor,
  jsonErrorLine,
  packageOf,
  previewJson,
  shellSplit,
  statusOf,
  toDef,
  validate,
  type Draft,
  type Health,
  type KV,
  type Status,
} from "./McpModel";

export type Mutate = (b: Record<string, unknown>, ok?: string) => Promise<unknown>;
const SECRET_KEY = /token|secret|key|password|passwd|auth|credential|cookie/i;

/* ───────────────────────────── status pill + verdict (shared with the list) ───────────────────────────── */

export function StatusPill({ status }: { status: Status }) {
  const { palette } = useTheme();
  const color = status.kind === "off" ? palette.mutedForeground : status.kind === "connected" ? palette.ok : status.kind === "failed" || status.kind === "expired" ? palette.destructive : palette.live;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, height: 20, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <T variant="micro" weight="medium" style={{ color }}>
        {status.word}
      </T>
    </View>
  );
}

export function Verdict({ health, onDismiss, onRetry, retrying }: { health: Health; onDismiss?: () => void; onRetry?: () => void; retrying?: boolean }) {
  const { palette } = useTheme();
  const [all, setAll] = useState(false);
  const tools = health.tools ?? [];
  const shown = all ? tools : tools.slice(0, 8);
  const hint = health.ok ? null : hintFor(health.detail);
  const title = health.ok ? (health.tools ? `${tools.length} ${tools.length === 1 ? "tool" : "tools"} available` : "Connected") : "Could not connect";
  const detail = health.ok && /^connected\b/i.test(health.detail) && health.tools ? null : health.detail;
  return (
    <View accessibilityRole="summary" style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: health.ok ? palette.ok : palette.destructive, padding: 10, gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <T variant="meta" style={{ flex: 1 }} tone={health.ok ? "default" : "destructive"}>
          <T variant="meta" weight="medium" tone={health.ok ? "default" : "destructive"}>
            {health.ok ? "✓ " : "✕ "}
            {title}
          </T>
          <T variant="meta" tone="muted"> · {ago(health.at)}</T>
        </T>
        {onRetry ? <Button small variant="ghost" title="Test again" loading={retrying} onPress={onRetry} /> : null}
        {onDismiss ? (
          <PressScale scaleTo={0.9} onPress={onDismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss result">
            <Icon name="x" size={15} />
          </PressScale>
        ) : null}
      </View>
      {detail ? (
        <T variant="micro" tone={health.ok ? "muted" : "destructive"}>
          {detail}
        </T>
      ) : null}
      {hint ? (
        <T variant="micro" tone="muted">
          {hint}
        </T>
      ) : null}
      {tools.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }} accessibilityLabel="Tools advertised">
          {shown.map((t) => (
            <T key={t} variant="micro" mono style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
              {t}
            </T>
          ))}
          {tools.length > 8 ? (
            <T variant="micro" mono tone="muted" onPress={() => setAll((a) => !a)} style={{ paddingHorizontal: 6, paddingVertical: 2 }}>
              {all ? "show fewer" : `+${tools.length - 8} more`}
            </T>
          ) : null}
        </View>
      ) : null}
      {health.ok && health.tools && health.tools.length === 0 ? (
        <T variant="micro" tone="muted">
          The server answered but advertised no tools.
        </T>
      ) : null}
    </View>
  );
}

/* ───────────────────────────── pieces ───────────────────────────── */

function Tokens({ line }: { line: string }) {
  const { palette } = useTheme();
  const parts = shellSplit(line);
  if (parts.length < 2) return null;
  const pkg = packageOf(parts[0], parts.slice(1));
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }} accessibilityLabel="Parsed command">
      {parts.map((p, i) => {
        const isPkg = p === pkg || p.replace(/@(latest|next|\d[\w.-]*)$/, "") === pkg;
        return (
          <T
            key={i}
            variant="micro"
            mono
            numberOfLines={1}
            tone={i === 0 ? "default" : isPkg ? "live" : "muted"}
            style={{ borderWidth: 1, borderColor: isPkg ? palette.live : palette.border, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: i === 0 ? palette.muted : "transparent" }}
          >
            {p}
          </T>
        );
      })}
    </View>
  );
}

function KVRows({ label, rows, onChange, keyPlaceholder, valuePlaceholder, addLabel, hint }: { label: string; rows: KV[]; onChange: (r: KV[]) => void; keyPlaceholder: string; valuePlaceholder: string; addLabel: string; hint: string }) {
  const { palette } = useTheme();
  const [shown, setShown] = useState<Record<number, boolean>>({});
  const update = (i: number, patch: Partial<KV>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const cell = { borderWidth: 1, borderColor: palette.input, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8, color: palette.foreground, backgroundColor: palette.card, fontFamily: fonts.mono, fontSize: typeScale.code.fontSize } as const;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <T variant="meta" weight="medium" tone="muted">
          {label}
          {rows.length > 0 ? <T variant="meta" tone="faint">{`  ${rows.length}`}</T> : null}
        </T>
        <T variant="micro" tone="faint">
          {hint}
        </T>
      </View>
      {rows.map((r, i) => {
        const sensitive = r.secret || SECRET_KEY.test(r.k);
        const hidden = sensitive && !shown[i] && !r.secret;
        return (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <TextInput value={r.k} onChangeText={(k) => update(i, { k })} placeholder={keyPlaceholder} placeholderTextColor={palette.faint} accessibilityLabel={`${label} name ${i + 1}`} autoCapitalize="none" autoCorrect={false} style={[cell, { flex: 5 }]} />
            <View style={{ flex: 7, justifyContent: "center" }}>
              <TextInput
                value={r.v}
                onChangeText={(v) => update(i, { v, secret: false })}
                placeholder={r.secret ? "" : valuePlaceholder}
                placeholderTextColor={palette.faint}
                secureTextEntry={hidden}
                selectTextOnFocus={r.secret}
                accessibilityLabel={`${label} value ${i + 1}`}
                autoCapitalize="none"
                autoCorrect={false}
                style={[cell, r.secret ? { color: palette.mutedForeground, paddingRight: 64 } : sensitive ? { paddingRight: 34 } : null]}
              />
              {r.secret ? (
                <T variant="micro" weight="medium" tone="muted" accessibilityHint="Saved on the server and never sent back. Type to replace it; leave it to keep it." style={{ position: "absolute", right: 8 }}>
                  🔑 stored
                </T>
              ) : sensitive ? (
                <PressScale scaleTo={0.9} haptic="selection" onPress={() => setShown((s) => ({ ...s, [i]: !s[i] }))} hitSlop={8} accessibilityRole="button" accessibilityLabel={hidden ? "Show value" : "Hide value"} style={{ position: "absolute", right: 8 }}>
                  <Icon name={hidden ? "eye" : "eye-off"} size={14} />
                </PressScale>
              ) : null}
            </View>
            <PressScale scaleTo={0.9} onPress={() => onChange(rows.filter((_, j) => j !== i))} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Remove ${r.k || "row"}`}>
              <Icon name="x" size={15} />
            </PressScale>
          </View>
        );
      })}
      <View style={{ flexDirection: "row" }}>
        <Button small variant="ghost" title={`+ ${addLabel}`} onPress={() => onChange([...rows, { k: "", v: "", secret: false }])} />
      </View>
    </View>
  );
}

function Preview({ name, def }: { name: string; def: Record<string, unknown> }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, backgroundColor: palette.muted }}>
      <PressScale
        onPress={() => {
          animateLayout();
          setOpen((o) => !o);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10 }}
      >
        <Icon name="code" size={14} />
        <T variant="meta" weight="medium">
          What the agent sees
        </T>
        <T variant="micro" tone="faint" numberOfLines={1} style={{ flex: 1 }}>
          ~/.agent-sandbox/mcp.json
        </T>
        <Chevron open={open} from="down" size={15} />
      </PressScale>
      {open ? (
        <T variant="micro" mono tone="muted" selectable style={{ borderTopWidth: 1, borderColor: palette.border, padding: 10 }}>
          {previewJson(name, def)}
        </T>
      ) : null}
    </View>
  );
}

/* ───────────────────────────── the sheet ───────────────────────────── */

export function McpServerSheet({
  visible,
  initial,
  health,
  testing,
  onTest,
  onMutate,
  onClose,
}: {
  visible: boolean;
  /** Editing an existing server; undefined = add. */
  initial?: McpServerView;
  health?: Health;
  testing: boolean;
  onTest: (name: string) => void;
  onMutate: Mutate;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  const [d, setD] = useState<Draft>(() => draftOf(initial));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"fields" | "json">("fields");
  const [jsonText, setJsonText] = useState("");
  const [jsonErr, setJsonErr] = useState<{ msg: string; line: number | null } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setD(draftOf(initial));
    setTouched({});
    setSubmitted(false);
    setBusy(false);
    setErr(null);
    setMode("fields");
    setJsonErr(null);
  }, [visible, initial]);

  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const errors = validate(d);
  const show = (k: keyof typeof errors) => (submitted || touched[k] ? errors[k] : undefined);
  const valid = Object.keys(errors).length === 0;
  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(initial));
  const def = useMemo(() => toDef(d), [d]);
  const { command, args } = commandOf(d);
  const current = TRANSPORTS.find((t) => t.value === d.type) ?? TRANSPORTS[0];

  const switchMode = (m: "fields" | "json") => {
    if (m === mode) return;
    animateLayout();
    if (m === "json") {
      setJsonText(JSON.stringify(def, null, 2));
      setJsonErr(null);
      setMode("json");
      return;
    }
    try {
      setD(fromDef(jsonText, d));
      setMode("fields");
    } catch (e) {
      const msg = errMsg(e);
      setJsonErr({ msg, line: jsonErrorLine(jsonText, msg) });
    }
  };

  const save = async () => {
    if (busy) return;
    let draft = d;
    if (mode === "json") {
      try {
        draft = fromDef(jsonText, d);
        setD(draft);
      } catch (e) {
        const msg = errMsg(e);
        setJsonErr({ msg, line: jsonErrorLine(jsonText, msg) });
        return;
      }
    }
    setSubmitted(true);
    if (Object.keys(validate(draft)).length) {
      if (mode === "json") setMode("fields");
      return;
    }
    setBusy(true);
    setErr(null);
    const name = draft.name.trim();
    const cmd = commandOf(draft);
    try {
      await onMutate(
        {
          action: "upsert",
          previousName: initial?.name,
          server: {
            name,
            type: draft.type,
            command: draft.type === "stdio" ? cmd.command : undefined,
            args: draft.type === "stdio" ? cmd.args : undefined,
            url: draft.type !== "stdio" ? draft.url.trim() : undefined,
            env: Object.fromEntries(draft.env.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v])),
            headers: draft.type !== "stdio" ? Object.fromEntries(draft.headers.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v])) : undefined,
            enabled: initial?.enabled ?? true,
          },
        },
        initial ? (initial.name !== name ? `Renamed to ${name}` : `Saved ${name}`) : `Added ${name} — every sandbox gets it on its next run`
      );
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!initial) return;
    setBusy(true);
    try {
      await onMutate({ action: "remove", name: initial.name }, `Removed ${initial.name}`);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={initial ? initial.name : "Add MCP server"}>
      <View style={{ gap: 18, paddingBottom: 8 }}>
        <T variant="meta" tone="muted">
          {initial ? "Changes reach every sandbox on its next run or turn." : "A set of tools every sandbox agent gets, from its next run."}
        </T>
        <View style={{ gap: 6 }}>
          <Segmented
            small
            value={mode}
            onChange={switchMode}
            options={[
              { value: "fields", label: "Fields" },
              { value: "json", label: "JSON" },
            ]}
          />
          {mode === "fields" && !initial ? (
            <T variant="micro" tone="faint">
              Copying from a README?{" "}
              <T variant="micro" tone="muted" style={{ textDecorationLine: "underline" }} onPress={() => switchMode("json")}>
                Paste its JSON
              </T>
            </T>
          ) : null}
        </View>

        {initial && initial.type !== "stdio" && mode === "fields" ? (
          <View style={{ gap: 8, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, padding: 10, backgroundColor: palette.muted }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <T variant="meta" weight="medium">
                    Connection
                  </T>
                  <StatusPill status={statusOf(initial, health, testing)} />
                </View>
                <T variant="micro" tone="muted">
                  {dirty ? "Tests what is saved — save first to test these edits." : health ? "Re-run the handshake to refresh the verdict." : "Not checked yet — run the handshake the agent does at startup."}
                </T>
              </View>
              <Button small variant="outline" title="Test" loading={testing} onPress={() => onTest(initial.name)} />
            </View>
            {health ? <Verdict health={health} /> : null}
          </View>
        ) : null}

        {mode === "json" ? (
          <View style={{ gap: 6 }}>
            <Field
              mono
              multiline
              value={jsonText}
              onChangeText={(v) => {
                setJsonText(v);
                setJsonErr(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Server JSON"
              style={{ minHeight: 260, textAlignVertical: "top" }}
            />
            <T variant="micro" tone={jsonErr ? "destructive" : "faint"}>
              {jsonErr ? `${jsonErr.msg}${jsonErr.line ? ` (line ${jsonErr.line})` : ""}` : "One server: the object under its name in an mcpServers file. A whole file with a single entry works too."}
            </T>
          </View>
        ) : (
          <>
            <View style={{ gap: 6 }}>
              <Segmented
                small
                value={d.type}
                onChange={(type) => {
                  animateLayout();
                  patch({ type });
                }}
                options={TRANSPORTS.map((t) => ({ value: t.value, label: `${t.label} · ${t.short}` }))}
              />
              <T variant="micro" tone="muted">
                {current.blurb}
              </T>
            </View>
            <View style={{ gap: 4 }}>
              <Field label="Name" mono autoFocus={!initial} value={d.name} onChangeText={(name) => patch({ name })} onBlur={() => setTouched((t) => ({ ...t, name: true }))} placeholder="postgres" autoCapitalize="none" autoCorrect={false} />
              <T variant="micro" tone={show("name") ? "destructive" : "faint"}>
                {show("name") ?? "Short and lowercase; tools appear to the agent as name__tool."}
              </T>
            </View>
            {d.type === "stdio" ? (
              <View style={{ gap: 6 }}>
                <Field label="Command" mono value={d.commandLine} onChangeText={(commandLine) => patch({ commandLine })} onBlur={() => setTouched((t) => ({ ...t, commandLine: true }))} placeholder="npx -y @modelcontextprotocol/server-postgres" autoCapitalize="none" autoCorrect={false} />
                <Tokens line={d.commandLine} />
                <T variant="micro" tone={show("commandLine") ? "destructive" : "faint"}>
                  {show("commandLine") ?? (args.length ? `${command} with ${args.length} argument${args.length === 1 ? "" : "s"}` : "The full line from the README — quotes are respected, arguments split for you.")}
                </T>
              </View>
            ) : (
              <View style={{ gap: 4 }}>
                <Field label="Endpoint URL" mono value={d.url} onChangeText={(url) => patch({ url })} onBlur={() => setTouched((t) => ({ ...t, url: true }))} placeholder={d.type === "sse" ? "https://mcp.example.com/sse" : "https://mcp.example.com/mcp"} keyboardType="url" autoCapitalize="none" autoCorrect={false} />
                <T variant="micro" tone={show("url") ? "destructive" : "faint"}>
                  {show("url") ?? (d.type === "sse" ? "Usually ends in /sse." : "Usually ends in /mcp.")}
                </T>
              </View>
            )}
            {d.type !== "stdio" ? <KVRows label="Headers" rows={d.headers} onChange={(headers) => patch({ headers })} keyPlaceholder="Authorization" valuePlaceholder="Bearer …" addLabel="Add header" hint="Sent with every request" /> : null}
            <KVRows label="Environment" rows={d.env} onChange={(env) => patch({ env })} keyPlaceholder={d.type === "stdio" ? "DATABASE_URL" : "API_KEY"} valuePlaceholder="value" addLabel="Add variable" hint={d.type === "stdio" ? "Set for the process in the sandbox" : "Available to the agent's run"} />
            <Preview name={d.name.trim()} def={def} />
          </>
        )}

        {err ? (
          <FadeIn>
            <T variant="meta" tone="destructive">
              {err}
            </T>
          </FadeIn>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {initial ? <ArmButton small variant="ghost" title="Remove" armedTitle={`Remove ${initial.name}?`} disabled={busy} onConfirm={remove} /> : null}
          <View style={{ flex: 1 }} />
          <Button small variant="ghost" title="Cancel" onPress={onClose} />
          <Button small title={initial ? "Save" : "Add server"} loading={busy} disabled={mode === "fields" && submitted && !valid} onPress={() => void save()} />
        </View>
      </View>
    </Sheet>
  );
}
