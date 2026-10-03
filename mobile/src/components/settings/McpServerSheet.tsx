// Add / edit one MCP server. The upsert body mirrors web/src/components/mcp/ServerSheet.tsx exactly:
// { action: "upsert", previousName?, server: { name, type, command?, args?, url?, env, headers?, enabled } }.
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { api, type McpProbe, type McpServerView, type McpServersResponse, type McpTransport } from "@/lib/api";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Segmented } from "./Segmented";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** "KEY=value" per line → record; blank lines and lines without "=" are skipped. */
function parseKv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
const toKv = (r?: Record<string, string>) => Object.entries(r ?? {}).map(([k, v]) => `${k}=${v}`).join("\n");

/** Split "npx -y @foo/bar --flag" into command + args, honouring simple quotes. */
function splitCommand(s: string): { command: string; args: string[] } {
  const parts = s.match(/"[^"]*"|'[^']*'|\S+/g)?.map((p) => p.replace(/^(["'])(.*)\1$/, "$2")) ?? [];
  return { command: parts[0] ?? "", args: parts.slice(1) };
}

export function McpServerSheet({
  visible,
  initial,
  onClose,
  onSaved,
}: {
  visible: boolean;
  /** Editing an existing server; undefined = add. */
  initial?: McpServerView;
  onClose: () => void;
  onSaved: (r: McpServersResponse) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<McpTransport>("http");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [headers, setHeaders] = useState("");
  const [env, setEnv] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<McpProbe | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(initial?.name ?? "");
    setType(initial?.type ?? "http");
    setUrl(initial?.url ?? "");
    setCommand(initial ? [initial.command ?? "", ...(initial.args ?? [])].filter(Boolean).join(" ") : "");
    setHeaders(toKv(initial?.headers));
    setEnv(toKv(initial?.env));
    setProbe(null);
    setErr(null);
    setTouched(false);
  }, [visible, initial]);

  const problems: string[] = [];
  const nm = name.trim();
  if (!nm) problems.push("Name it.");
  else if (!NAME_RE.test(nm)) problems.push("Name: letters, digits, . - and _ only.");
  if (type === "stdio" && !splitCommand(command).command) problems.push("Command is required.");
  if (type !== "stdio" && !/^https?:\/\//i.test(url.trim())) problems.push("URL must start with http:// or https://.");

  const serverBody = () => {
    const cmd = splitCommand(command);
    return {
      name: nm,
      type,
      command: type === "stdio" ? cmd.command : undefined,
      args: type === "stdio" ? cmd.args : undefined,
      url: type !== "stdio" ? url.trim() : undefined,
      env: parseKv(env),
      headers: type !== "stdio" ? parseKv(headers) : undefined,
      enabled: initial?.enabled ?? true,
    };
  };

  const save = async () => {
    setTouched(true);
    if (problems.length) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.mcpMutate({ action: "upsert", previousName: initial?.name, server: serverBody() });
      onSaved(r);
      onClose();
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };

  /** Test saves first (the probe runs server-side against the stored config), then probes by name. */
  const test = async () => {
    setTouched(true);
    if (problems.length) return;
    setTesting(true);
    setErr(null);
    setProbe(null);
    try {
      const r = await api.mcpMutate({ action: "upsert", previousName: initial?.name, server: serverBody() });
      onSaved(r);
      setProbe(await api.mcpTest(nm));
    } catch (e) {
      setErr(msg(e));
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    setBusy(true);
    setErr(null);
    try {
      onSaved(await api.mcpMutate({ action: "remove", name: initial.name }));
      onClose();
    } catch (e) {
      setErr(msg(e));
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={initial ? `Edit ${initial.name}` : "Add MCP server"}>
      <View style={{ gap: 12, paddingBottom: 8 }}>
        <Field label="Name" value={name} onChangeText={setName} placeholder="github" autoCapitalize="none" autoCorrect={false} mono />
        <View style={{ gap: 6 }}>
          <T variant="meta" weight="medium" tone="muted">
            Transport
          </T>
          <Segmented
            small
            value={type}
            onChange={setType}
            options={[
              { value: "http", label: "HTTP" },
              { value: "sse", label: "SSE" },
              { value: "stdio", label: "Command" },
            ]}
          />
        </View>
        {type === "stdio" ? (
          <>
            <Field mono label="Command" value={command} onChangeText={setCommand} placeholder="npx -y @modelcontextprotocol/server-filesystem /work" autoCapitalize="none" autoCorrect={false} hint="Runs inside each sandbox. First word is the command, the rest are arguments." />
            <Field mono label="Environment" value={env} onChangeText={setEnv} placeholder={"API_KEY=…\nREGION=eu"} multiline style={{ minHeight: 72, textAlignVertical: "top" }} autoCapitalize="none" autoCorrect={false} hint="One KEY=value per line." />
          </>
        ) : (
          <>
            <Field mono label="URL" value={url} onChangeText={setUrl} placeholder="https://mcp.example.com/mcp" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Field mono label="Headers" value={headers} onChangeText={setHeaders} placeholder={"Authorization=Bearer …"} multiline style={{ minHeight: 72, textAlignVertical: "top" }} autoCapitalize="none" autoCorrect={false} hint="One Header=value per line." />
            <Field mono label="Environment" value={env} onChangeText={setEnv} placeholder={"TOKEN=…"} multiline style={{ minHeight: 56, textAlignVertical: "top" }} autoCapitalize="none" autoCorrect={false} hint="Optional. One KEY=value per line." />
          </>
        )}
        {touched && problems.length ? (
          <T variant="micro" tone="muted">
            {problems.join(" ")}
          </T>
        ) : null}
        {probe ? (
          <T variant="meta" tone={probe.ok ? "ok" : "destructive"}>
            {probe.ok ? `✓ Answered the MCP handshake${probe.tools?.length ? ` · ${probe.tools.length} ${probe.tools.length === 1 ? "tool" : "tools"}` : ""}` : `✕ ${probe.detail || "failed"}${probe.status ? ` (HTTP ${probe.status})` : ""}`}
            {probe.ok && probe.detail ? ` — ${probe.detail}` : ""}
          </T>
        ) : null}
        {probe?.ok && probe.tools?.length ? (
          <T variant="micro" mono tone="faint" numberOfLines={4}>
            {probe.tools.join(", ")}
          </T>
        ) : null}
        {err ? (
          <T variant="meta" tone="destructive">
            {err}
          </T>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Button title={initial ? "Save" : "Add"} loading={busy} onPress={() => void save()} />
          <Button title="Save & test" variant="secondary" loading={testing} onPress={() => void test()} />
          <View style={{ flex: 1 }} />
          {initial ? <ArmButton small title="Remove" armedTitle="Tap again to remove" variant="ghost" onConfirm={remove} /> : null}
        </View>
      </View>
    </Sheet>
  );
}
