import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { FadeIn, FadeInUp, PressScale, stagger } from "@/components/motion";
import * as Clipboard from "expo-clipboard";
import { api, type McpServersResponse, type McpServerView } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { Toggle } from "@/components/ui/Toggle";
import { Segmented } from "@/components/settings/Segmented";
import { McpServerSheet, StatusPill, Verdict, type Mutate } from "@/components/settings/McpServerSheet";
import { describe, errMsg, jsonErrorLine, statusOf, type Health } from "@/components/settings/McpModel";

type Filter = "all" | "on" | "off" | "stdio" | "remote";

/** MCP servers (web: McpServers.tsx) — list with filters/search, add/edit sheet, paste config, whole-file JSON. */
export function McpSection() {
  const { palette } = useTheme();
  const [data, setData] = useState<McpServersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "json">("list");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ open: boolean; server?: McpServerView }>({ open: false });
  const [pasting, setPasting] = useState(false);
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.mcpServers().then(setData).catch((e) => setError(errMsg(e)));
  }, []);

  const mutate = useCallback<Mutate>(async (body, ok) => {
    const r = await api.mcpMutate(body);
    setData(r);
    if (ok) setNote(ok);
    return r;
  }, []);

  const test = useCallback((name: string) => {
    setTesting((t) => ({ ...t, [name]: true }));
    api
      .mcpTest(name)
      .then((r) => setHealth((h) => ({ ...h, [name]: { ...r, at: Date.now() } })))
      .catch((e: unknown) => setHealth((h) => ({ ...h, [name]: { ok: false, detail: errMsg(e), at: Date.now() } })))
      .finally(() => setTesting((t) => ({ ...t, [name]: false })));
  }, []);
  const dismiss = (name: string) => setHealth((h) => Object.fromEntries(Object.entries(h).filter(([k]) => k !== name)));

  const servers = data?.servers ?? null;
  const all = servers ?? [];
  const q = query.trim().toLowerCase();
  const counts = {
    all: all.length,
    on: all.filter((s) => s.enabled).length,
    off: all.filter((s) => !s.enabled).length,
    stdio: all.filter((s) => s.type === "stdio").length,
    remote: all.filter((s) => s.type !== "stdio").length,
  };
  const visible = all.filter((s) => {
    if (filter === "on" && !s.enabled) return false;
    if (filter === "off" && s.enabled) return false;
    if (filter === "stdio" && s.type !== "stdio") return false;
    if (filter === "remote" && s.type === "stdio") return false;
    if (!q) return true;
    return [s.name, s.type, s.command, ...(s.args ?? []), s.url, ...Object.keys(s.env ?? {}), ...Object.keys(s.headers ?? {})].filter(Boolean).join(" ").toLowerCase().includes(q);
  });
  const noMatchLine = q ? `Nothing matches “${query.trim()}”.` : { all: "", on: "No servers are on.", off: "Every server is on.", stdio: "No command servers.", remote: "No remote servers." }[filter];
  const hasServers = !!servers && servers.length > 0;

  return (
    <SettingsSection title="MCP servers">
      {servers ? (
        <T variant="meta" tone="muted">
          {servers.length === 0 ? "none yet" : `${counts.on} of ${servers.length} on`}
        </T>
      ) : null}
      {hasServers ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Segmented
            small
            value={view}
            onChange={setView}
            options={[
              { value: "list", label: "List" },
              { value: "json", label: "JSON" },
            ]}
          />
          <View style={{ flex: 1 }} />
          {view === "list" ? (
            <>
              <Button small variant="outline" title="Paste" onPress={() => setPasting(true)} />
              <Button small title="+ Add server" onPress={() => setEditing({ open: true })} />
            </>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <FadeIn>
          <T variant="meta" tone="destructive">
            {error}
          </T>
        </FadeIn>
      ) : null}
      {note ? (
        <T variant="meta" tone="muted">
          {note}
        </T>
      ) : null}

      {view === "json" ? (
        <JsonView config={data?.config ?? null} onSave={(json) => mutate({ action: "replace", json }, "Configuration saved")} />
      ) : servers === null ? (
        error ? null : <T tone="muted">Loading…</T>
      ) : servers.length === 0 ? (
        <Card style={{ gap: 12 }}>
          <View style={{ alignItems: "center", gap: 4 }}>
            <Icon name="zap" size={20} color={palette.live} />
            <T variant="body" weight="medium">
              Give the agent more tools
            </T>
            <T variant="meta" tone="muted" style={{ textAlign: "center" }}>
              An MCP server hands the agent extra tools — Jira, a database, your own API. It already has shell, files, GitHub and the web; anything added here is available in every sandbox on its next run.
            </T>
          </View>
          <Card onPress={() => setEditing({ open: true })}>
            <T variant="meta" weight="medium">
              Add a server
            </T>
            <T variant="micro" tone="muted">
              A command the sandbox runs, or a URL it connects to — with its secrets.
            </T>
          </Card>
          <Card onPress={() => setPasting(true)}>
            <T variant="meta" weight="medium">
              Paste a config
            </T>
            <T variant="micro" tone="muted">
              The <T variant="micro" mono>mcpServers</T> JSON from Cursor, Claude Code or VS Code, imported as-is.
            </T>
          </Card>
        </Card>
      ) : (
        <>
          <Segmented
            small
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `All ${counts.all}` },
              { value: "on", label: `On ${counts.on}` },
              { value: "off", label: `Off ${counts.off}` },
              { value: "stdio", label: `Command ${counts.stdio}` },
              { value: "remote", label: `Remote ${counts.remote}` },
            ]}
          />
          <Field value={query} onChangeText={setQuery} placeholder="Search" accessibilityLabel="Search servers" autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" />
          {visible.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 24, gap: 4 }}>
              <T variant="body" weight="medium">
                Nothing here
              </T>
              <T variant="meta" tone="muted">
                {noMatchLine}
              </T>
              {q || filter !== "all" ? (
                <Button
                  small
                  variant="ghost"
                  title="Show all"
                  onPress={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                />
              ) : null}
            </View>
          ) : (
            visible.map((s, i) => (
              <FadeInUp key={s.name} delay={stagger(i)}>
                <ServerRow server={s} health={health[s.name]} testing={!!testing[s.name]} onTest={() => test(s.name)} onEdit={() => setEditing({ open: true, server: s })} onDismiss={() => dismiss(s.name)} onMutate={mutate} onError={setError} />
              </FadeInUp>
            ))
          )}
          <T variant="micro" tone="faint">
            Every sandbox gets the servers that are on, from its next run or turn.
          </T>
        </>
      )}

      <McpServerSheet
        visible={editing.open}
        initial={editing.server}
        health={editing.server ? health[editing.server.name] : undefined}
        testing={editing.server ? !!testing[editing.server.name] : false}
        onTest={test}
        onMutate={mutate}
        onClose={() => setEditing((e) => ({ ...e, open: false }))}
      />
      <PasteSheet visible={pasting} onMutate={mutate} onClose={() => setPasting(false)} />
    </SettingsSection>
  );
}

function ServerRow({ server: s, health, testing, onTest, onEdit, onDismiss, onMutate, onError }: { server: McpServerView; health?: Health; testing: boolean; onTest: () => void; onEdit: () => void; onDismiss: () => void; onMutate: Mutate; onError: (m: string) => void }) {
  const { palette } = useTheme();
  const [busy, setBusy] = useState(false);
  const secrets = Object.keys(s.env ?? {}).length + Object.keys(s.headers ?? {}).length;
  const remote = s.type !== "stdio";
  const toggle = () => {
    setBusy(true);
    onMutate({ action: "toggle", name: s.name, enabled: !s.enabled }, s.enabled ? `${s.name} is off` : `${s.name} is on — every sandbox gets it on its next run`)
      .catch((e: unknown) => onError(`Could not update — ${errMsg(e)}`))
      .finally(() => setBusy(false));
  };
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <PressScale onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Open ${s.name}`} style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <T variant="body" weight="medium" tone={s.enabled ? "default" : "muted"} numberOfLines={1}>
              {s.name}
            </T>
            <StatusPill status={statusOf(s, health, testing)} />
          </View>
          <T variant="meta" tone="muted" numberOfLines={1}>
            {describe(s)}
            {secrets > 0 ? <T variant="micro" tone="faint">{` · 🔑 ${secrets} ${secrets === 1 ? "secret" : "secrets"}`}</T> : null}
          </T>
        </PressScale>
        <Toggle value={s.enabled} onValueChange={toggle} disabled={busy} accessibilityLabel={s.enabled ? `Disable ${s.name}` : `Enable ${s.name}`} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
        {remote ? (
          <Button small variant="ghost" title="Test" loading={testing} disabled={!s.enabled && !health} onPress={onTest} />
        ) : (
          <T variant="micro" mono tone="faint" accessibilityHint="Starts inside each sandbox; tools are counted at run time" style={{ paddingHorizontal: 8 }}>
            stdio
          </T>
        )}
        <Button small variant="ghost" title="Edit" onPress={onEdit} />
        <ArmButton small variant="ghost" title="Remove" armedTitle="Remove?" onConfirm={() => onMutate({ action: "remove", name: s.name }, `Removed ${s.name}`).then(() => undefined, (e: unknown) => onError(`Could not remove — ${errMsg(e)}`))} />
      </View>
      {health && remote ? (
        <FadeIn style={{ marginTop: 8 }}>
          <Verdict health={health} onDismiss={onDismiss} onRetry={onTest} retrying={testing} />
        </FadeIn>
      ) : null}
    </Card>
  );
}

function PasteSheet({ visible, onMutate, onClose }: { visible: boolean; onMutate: Mutate; onClose: () => void }) {
  const { palette } = useTheme();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setText("");
      setErr(null);
      setBusy(false);
    }
  }, [visible]);
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      const v: unknown = JSON.parse(text);
      if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "Expected a JSON object.", line: 1 };
      const map = "mcpServers" in v && v.mcpServers && typeof v.mcpServers === "object" ? v.mcpServers : "name" in v ? { one: v } : v;
      return { names: Object.keys(map as object) };
    } catch (e) {
      const m = errMsg(e);
      return { error: m, line: jsonErrorLine(text, m) };
    }
  }, [text]);
  const names: string[] = parsed && "names" in parsed && parsed.names ? parsed.names : [];
  const count = names.length;
  const submit = async () => {
    if (count === 0 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onMutate({ action: "import", json: text }, `Imported ${count} server${count === 1 ? "" : "s"}`);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Paste config">
      <View style={{ gap: 10, paddingBottom: 8 }}>
        <T variant="meta" tone="muted">
          The mcpServers JSON from Cursor, Claude Code, VS Code or Claude Desktop. Servers with the same name are replaced.
        </T>
        <Field mono multiline value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} accessibilityLabel="mcpServers JSON" style={{ minHeight: 220, textAlignVertical: "top" }} />
        {parsed === null ? (
          <T variant="micro" mono tone="faint">
            {'{ "mcpServers": { "name": { "command": "npx", "args": ["…"] } } }'}
          </T>
        ) : "error" in parsed ? (
          <T variant="micro" tone="destructive">
            {parsed.error}
            {parsed.line ? ` (line ${parsed.line})` : ""}
          </T>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <T variant="micro" tone="muted">
              ✓ {count} server{count === 1 ? "" : "s"} found
            </T>
            {names.slice(0, 6).map((n) => (
              <T key={n} variant="micro" mono style={{ backgroundColor: palette.muted, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
                {n}
              </T>
            ))}
            {count > 6 ? (
              <T variant="micro" tone="faint">
                +{count - 6} more
              </T>
            ) : null}
          </View>
        )}
        {err ? (
          <T variant="meta" tone="destructive">
            {err}
          </T>
        ) : null}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button small variant="ghost" title="Cancel" onPress={onClose} />
          <Button small title={`Import${count > 0 ? ` ${count}` : ""}`} loading={busy} disabled={count === 0} onPress={() => void submit()} />
        </View>
      </View>
    </Sheet>
  );
}

function JsonView({ config, onSave }: { config: McpServersResponse["config"] | null; onSave: (json: string) => Promise<unknown> }) {
  const pristine = useMemo(() => (config ? JSON.stringify(config, null, 2) : ""), [config]);
  const [text, setText] = useState(pristine);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setText(pristine);
  }, [pristine]);
  const parsed = useMemo(() => {
    try {
      const v: unknown = JSON.parse(text);
      if (!v || typeof v !== "object" || !("mcpServers" in v) || !v.mcpServers || typeof v.mcpServers !== "object") return { error: 'Top level must be { "mcpServers": { … } }', line: 1 };
      return { value: v, count: Object.keys(v.mcpServers).length };
    } catch (e) {
      const m = errMsg(e);
      return { error: m, line: jsonErrorLine(text, m) };
    }
  }, [text]);
  const dirty = text !== pristine;
  const save = async () => {
    if (!dirty || "error" in parsed) return;
    setBusy(true);
    setStatus(null);
    try {
      await onSave(text);
      touched.current = false;
    } catch (e) {
      setStatus(`Could not save — ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  };
  if (!config) return <T tone="muted">Loading…</T>;
  return (
    <Card style={{ gap: 8 }}>
      <T variant="micro" mono tone="muted">
        ~/.agent-sandbox/mcp.json · Claude Code / Cursor format
      </T>
      <T variant="micro" tone="faint">
        The same file Cursor and Claude Code read. "disabled": true keeps a server off.
      </T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Button small variant="ghost" title="Format" disabled={"error" in parsed} onPress={() => "value" in parsed && setText(JSON.stringify(parsed.value, null, 2))} />
        <Button small variant="ghost" title="Copy" onPress={() => void Clipboard.setStringAsync(text).then(() => setStatus("Copied"), (e: unknown) => setStatus(`Could not copy — ${errMsg(e)}`))} />
        <Button
          small
          variant="ghost"
          title="Reset"
          disabled={!dirty}
          onPress={() => {
            setText(pristine);
            touched.current = false;
          }}
        />
        <Button small title="Save" loading={busy} disabled={!dirty || "error" in parsed} onPress={() => void save()} />
      </View>
      <Field
        mono
        multiline
        value={text}
        onChangeText={(v) => {
          touched.current = true;
          setText(v);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="mcp.json"
        style={{ minHeight: 320, textAlignVertical: "top" }}
      />
      {"error" in parsed ? (
        <T variant="micro" tone="destructive">
          ✕ {parsed.error}
          {parsed.line ? ` (line ${parsed.line})` : ""}
        </T>
      ) : (
        <T variant="micro" tone="muted">
          {parsed.count} server{parsed.count === 1 ? "" : "s"}
          {dirty ? " · unsaved" : ""} · Masked secrets left untouched stay as stored.
        </T>
      )}
      {status ? (
        <T variant="micro" tone="muted">
          {status}
        </T>
      ) : null}
    </Card>
  );
}
