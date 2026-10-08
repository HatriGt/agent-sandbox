// Harness page pieces ported from web/src/components/harness/{ImportHarness,Compare}.tsx and
// HarnessesPage.tsx (ReviewPanel, DriverBadges).
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { PressScale } from "@/components/motion";
import { useRouter } from "expo-router";
import { api, type AgentChoice, type AttemptGroupRow, type AttemptGroupView, type CompareDetail, type CompareFacts, type CompareSummary, type HarnessImportPreview, type HarnessView, type SkillView } from "@/lib/api";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { AttemptGroupPanel } from "@/components/AttemptGroupCard";
import { PickerSheet } from "./PickerSheet";
import { Segmented } from "./Segmented";
import { useNow } from "@/hooks/useNow";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function rulesLine(r: HarnessView["rules"]): string {
  const on = [r.askBeforeGuess && "ask before guessing", r.planFirst && "plan first", r.verifyOnDone && "verify on done"].filter(Boolean);
  return on.length ? on.join(", ") : "no rules";
}

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "ok" | "attention" }) {
  const { palette } = useTheme();
  const color = tone === "ok" ? palette.ok : tone === "attention" ? palette.attentionText : palette.mutedForeground;
  const border = tone === "ok" ? `${palette.ok}66` : tone === "attention" ? `${palette.attention}80` : palette.lineStrong;
  return (
    <View style={{ borderWidth: 1, borderColor: border, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 }}>
      <T variant="micro" style={{ color }}>
        {children}
      </T>
    </View>
  );
}

const SOURCE_LABEL: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", "openai-compatible": "OpenAI-compatible", local: "Local" };

/** What a driver can do (web: DriverPicker › DriverBadges). */
export function DriverBadges({ choice }: { choice: AgentChoice }) {
  const c = choice.capabilities;
  if (!c) return null;
  const supervised = choice.supervised !== false;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
      <Badge tone={supervised ? "ok" : "attention"}>{supervised ? "supervised" : "supervised: partial"}</Badge>
      <Badge>{c.gate === "hook" ? "pre-action gate" : c.gate === "wrapper" ? "stop-and-resume gate" : "no gate"}</Badge>
      {c.planEvents ? <Badge>plan card</Badge> : null}
      {c.sideQuestion ? <Badge>side questions</Badge> : null}
      <Badge>{c.modelSources.map((s) => SOURCE_LABEL[s] ?? s).join(" · ")}</Badge>
    </View>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <T variant="micro" weight="medium" tone="muted">
      {children}
    </T>
  );
}
function Pre({ children }: { children: React.ReactNode }) {
  const { palette } = useTheme();
  return (
    <T variant="micro" mono style={{ backgroundColor: palette.muted, borderRadius: radius.sm, padding: 8 }}>
      {children}
    </T>
  );
}

/** What an imported harness would do, verbatim, before it may run. */
export function ReviewPanel({ h, skills, onApprove, onEdit }: { h: HarnessView; skills: SkillView[]; onApprove: () => Promise<void>; onEdit: () => void }) {
  const { palette } = useTheme();
  const known = new Set(skills.map((s) => s.name));
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ gap: 10, marginTop: 10, padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg }}>
      <T variant="micro" tone="muted">
        Imported harnesses cannot run until approved. Read what it will do:
      </T>
      <Label>verify.sh — runs inside the sandbox after each run</Label>
      {h.verifyCommand ? <Pre>{h.verifyCommand}</Pre> : <T variant="micro" tone="faint">none</T>}
      <Label>Egress — extra hosts the sandbox may reach</Label>
      {h.egress?.length ? <T variant="micro" mono>{h.egress.join(", ")}</T> : <T variant="micro" tone="faint">none beyond the defaults</T>}
      <Label>Rules given to the agent (system prompt, every turn)</Label>
      <T variant="micro">{rulesLine(h.rules)}</T>
      {h.rulesMd ? <Pre>{h.rulesMd}</Pre> : null}
      <Label>Skills installed into the sandbox</Label>
      {h.skills?.length ? <T variant="micro">{h.skills.map((s) => (known.has(s) ? s : `${s} (missing)`)).join(", ")}</T> : <T variant="micro" tone="faint">none</T>}
      {h.unresolvedProvider ? (
        <T variant="micro" tone="attention">
          {`Expects a ${h.unresolvedProvider.kind} provider ("${h.unresolvedProvider.label}"). Connect one on Integrations, then pick it in the editor.`}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button
          small
          title="Approve and enable"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await onApprove();
            } finally {
              setBusy(false);
            }
          }}
        />
        <Button small variant="ghost" title="Edit first" onPress={onEdit} />
      </View>
    </View>
  );
}

type Source = { bundle: unknown } | { github: { owner: string; repo: string; branch?: string; path?: string } };

/**
 * Import a bundle: pasted JSON of an exported .harness.json (no file picker on mobile) or a GitHub
 * folder. Preview first; the stored harness is still "needs review" until approved.
 */
export function ImportHarness({ onCancel, onImported }: { onCancel: () => void; onImported: (r: { harnesses: HarnessView[] }) => void }) {
  const { palette } = useTheme();
  const [mode, setMode] = useState<"file" | "github">("file");
  const [gh, setGh] = useState("");
  const [json, setJson] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState<HarnessImportPreview["preview"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (src: Source) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.harnessImport<HarnessImportPreview>({ action: "preview", ...src });
      setSource(src);
      setPreview(r.preview);
    } catch (e) {
      setError(msg(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  const checkFile = () => {
    if (json.length > 3_500_000) return setError("That file is over the 3 MB bundle limit.");
    let bundle: unknown;
    try {
      bundle = JSON.parse(json);
    } catch {
      return setError("That file is not a harness bundle (JSON).");
    }
    void run({ bundle });
  };
  const fetchGh = () => {
    const s = gh.trim().replace(/^https?:\/\/github\.com\//, "");
    const url = s.match(/^([\w.-]+)\/([\w.-]+)\/tree\/([^/]+)\/?(.*)$/);
    const m = s.match(/^([\w.-]+)\/([\w.-]+)(\/[^@]*)?(?:@(.+))?$/);
    const src: Source | null = url
      ? { github: { owner: url[1], repo: url[2], branch: url[3], path: url[4] } }
      : m
        ? { github: { owner: m[1], repo: m[2].replace(/\.git$/, ""), ...(m[3] ? { path: m[3].replace(/^\/|\/$/g, "") } : {}), ...(m[4] ? { branch: m[4] } : {}) } }
        : null;
    if (!src) return setError("Use owner/repo/path, optionally @branch.");
    void run(src);
  };
  const confirm = async () => {
    if (!source) return;
    setBusy(true);
    try {
      onImported(await api.harnessImport<{ harnesses: HarnessView[]; notes: string[] }>({ action: "import", ...source }));
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };
  const h = preview?.harness;
  return (
    <Card style={{ gap: 12 }}>
      <T variant="h3" weight="semibold">
        Import a harness
      </T>
      <Segmented
        small
        value={mode}
        onChange={(v) => {
          setMode(v);
          setPreview(null);
          setError(null);
        }}
        options={[
          { value: "file", label: "File" },
          { value: "github", label: "GitHub" },
        ]}
      />
      {mode === "file" ? (
        <>
          <Field
            label="Exported .harness.json"
            hint="Checked for version, size and anything shaped like a secret."
            mono
            multiline
            value={json}
            onChangeText={setJson}
            placeholder="Paste the bundle JSON"
            autoCapitalize="none"
            autoCorrect={false}
            style={{ minHeight: 120, textAlignVertical: "top" }}
          />
          <View style={{ flexDirection: "row" }}>
            <Button small variant="outline" title="Check" disabled={busy || !json.trim()} onPress={checkFile} />
          </View>
        </>
      ) : (
        <>
          <Field label="Folder" hint="A folder with harness.json, RULES.md, verify.sh and skills/." mono value={gh} onChangeText={setGh} placeholder="acme/harnesses/careful@main" autoCapitalize="none" autoCorrect={false} />
          <View style={{ flexDirection: "row" }}>
            <Button small variant="outline" title="Fetch" disabled={busy || !gh.trim()} onPress={fetchGh} />
          </View>
        </>
      )}
      {error ? (
        <T variant="meta" tone="destructive">
          {error}
        </T>
      ) : null}
      {h && preview ? (
        <View style={{ gap: 8, padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg }}>
          <T variant="body" weight="medium">
            {h.name}
          </T>
          <T variant="micro" tone="muted">
            {[h.driver, h.model, rulesLine(h.rules)].filter(Boolean).join(" · ")}
          </T>
          <Label>verify.sh</Label>
          {h.verifyCommand ? <Pre>{h.verifyCommand}</Pre> : <T variant="micro" tone="faint">none</T>}
          <Label>Egress</Label>
          <T variant="micro" mono>
            {h.egress?.length ? h.egress.join(", ") : "defaults only"}
          </T>
          {h.rulesMd ? (
            <>
              <Label>RULES.md</Label>
              <Pre>{h.rulesMd}</Pre>
            </>
          ) : null}
          <Label>Skills added (disabled in your library)</Label>
          <T variant="micro">{preview.skills.length ? preview.skills.map((s) => s.name).join(", ") : "none"}</T>
          {preview.notes.map((n) => (
            <T key={n} variant="micro" tone="attention">
              {`• ${n}`}
            </T>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Button small variant="ghost" title="Cancel" onPress={onCancel} />
        <Button small title="Import for review" disabled={!preview || busy} loading={busy && !!preview} onPress={() => void confirm()} />
      </View>
    </Card>
  );
}

/** Start one task on two harnesses: a compare row, then two ordinary delegations linked to it. */
export function CompareLauncher({ harnesses, onCancel, onStarted }: { harnesses: HarnessView[]; onCancel: () => void; onStarted: (note: string) => void }) {
  const [task, setTask] = useState("");
  const [a, setA] = useState(harnesses[0]?.id ?? "");
  const [b, setB] = useState(harnesses[1]?.id ?? "");
  const [picking, setPicking] = useState<"a" | "b" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = (id: string) => harnesses.find((h) => h.id === id)?.name ?? "Pick…";
  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { id } = await api.compareCreate({ task: task.trim(), harnessA: a, harnessB: b });
      const sides = await Promise.allSettled((["a", "b"] as const).map((side) => api.delegate({ task: task.trim(), harness: side === "a" ? a : b, compareId: id, compareSide: side })));
      const failed = sides.filter((s) => s.status === "rejected" || (s.status === "fulfilled" && !s.value.ok));
      onStarted(
        failed.length
          ? `${failed.length === 2 ? "Neither side" : "One side"} started: ${failed.map((f) => (f.status === "rejected" ? msg(f.reason) : !f.value.ok ? f.value.question : "")).join(" · ")}`
          : "Compare started: two runs",
      );
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: 12 }}>
      <Field label="Task" multiline value={task} onChangeText={setTask} placeholder="Add input validation to the signup form" style={{ minHeight: 80, textAlignVertical: "top" }} />
      <Field label="Harness A" value={name(a)} editable={false} onPressIn={() => setPicking("a")} />
      <Field label="Harness B" value={name(b)} editable={false} onPressIn={() => setPicking("b")} />
      {a === b ? (
        <T variant="micro" tone="destructive">
          Pick two different harnesses.
        </T>
      ) : null}
      {err ? (
        <T variant="micro" tone="destructive">
          {err}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Button small variant="ghost" title="Cancel" onPress={onCancel} />
        <Button small title="Start both" loading={busy} disabled={busy || !task.trim() || a === b} onPress={() => void start()} />
      </View>
      <PickerSheet
        visible={picking !== null}
        title={picking === "a" ? "Harness A" : "Harness B"}
        options={harnesses.map((h) => ({ value: h.id, label: h.name }))}
        value={picking === "a" ? a : b}
        onPick={(v) => {
          if (v) (picking === "a" ? setA : setB)(v);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </Card>
  );
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const COMPARE_ROWS: Array<{ label: string; cell: (f: CompareFacts) => string }> = [
  { label: "State", cell: (f) => f.state },
  { label: "Verified", cell: (f) => (f.verified === null ? "not checked" : f.verified ? "passed" : "failed") },
  { label: "Questions", cell: (f) => String(f.questions) },
  { label: "Tokens", cell: (f) => (f.tokens ? `${f.tokens.input.toLocaleString()} in · ${f.tokens.output.toLocaleString()} out` : "not reported") },
  { label: "Cost", cell: (f) => (f.costUsd !== null ? `$${f.costUsd.toFixed(f.costUsd < 1 ? 3 : 2)}` : "unknown") },
  { label: "Duration", cell: (f) => (f.durationMs !== null ? fmtDuration(f.durationMs) : "—") },
  { label: "Files", cell: (f) => (f.files.length ? `${f.files.length} changed` : "none") },
];

/** Disclosure row shared by the compare and attempt lists. */
function Disclosure({ open, onPress, title, trailing, children }: { open: boolean; onPress: () => void; title: string; trailing: React.ReactNode; children: React.ReactNode }) {
  const { palette } = useTheme();
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: palette.border }}>
      <PressScale onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={15} color={palette.mutedForeground} />
        <T variant="meta" numberOfLines={1} style={{ flex: 1 }}>
          {title}
        </T>
        {trailing}
      </PressScale>
      {open ? <View style={{ paddingBottom: 12 }}>{children}</View> : null}
    </View>
  );
}

export function CompareList({ refresh, canStart }: { refresh: number; canStart: boolean }) {
  const [rows, setRows] = useState<CompareSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    api.compares().then((r) => setRows(r.compares)).catch(() => setRows([]));
  }, [refresh]);
  if (!rows) return null;
  if (!rows.length)
    return (
      <T variant="meta" tone="muted">
        {canStart ? "No compares yet." : "Save two harnesses to compare them."}
      </T>
    );
  return (
    <Card style={{ paddingVertical: 0 }}>
      {rows.map((c) => (
        <Disclosure
          key={c.id}
          open={open === c.id}
          onPress={() => setOpen(open === c.id ? null : c.id)}
          title={c.task}
          trailing={
            <T variant="micro" tone="faint">
              {`${c.sides.length}/2 · ${ago(c.createdAt)}`}
            </T>
          }
        >
          <CompareView id={c.id} />
        </Disclosure>
      ))}
    </Card>
  );
}

/** Both receipts, row by row. Every cell is a fact the run reported; unknown stays unknown. */
function CompareView({ id }: { id: string }) {
  const router = useRouter();
  const [d, setD] = useState<CompareDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const tick = useNow(10_000);
  useEffect(() => {
    let live = true;
    api.compare(id).then((r) => live && setD(r)).catch((e) => live && setErr(msg(e)));
    return () => {
      live = false;
    };
  }, [id, tick]);
  if (err) return <T variant="micro" tone="destructive">{err}</T>;
  if (!d) return <T variant="micro" tone="faint">Loading…</T>;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ width: 76 }} />
        {d.sides.map((s) => (
          <View key={s.side} style={{ flex: 1, minWidth: 0 }}>
            <T variant="micro" weight="medium" numberOfLines={1}>
              {`${s.side.toUpperCase()} ${s.harnessName}`}
            </T>
            {s.box ? (
              <T variant="micro" mono tone="muted" numberOfLines={1} onPress={() => router.push({ pathname: "/box/[name]", params: { name: s.box! } })} style={{ textDecorationLine: "underline" }}>
                {s.box}
              </T>
            ) : null}
          </View>
        ))}
      </View>
      {COMPARE_ROWS.map((r) => (
        <View key={r.label} style={{ flexDirection: "row", gap: 8 }}>
          <T variant="micro" tone="muted" style={{ width: 76 }}>
            {r.label}
          </T>
          {d.sides.map((s) => (
            <T key={s.side} variant="micro" tone={s.facts ? "default" : "faint"} style={{ flex: 1 }}>
              {s.facts ? r.cell(s.facts) : s.source === "not-started" ? "did not start" : "run gone"}
            </T>
          ))}
        </View>
      ))}
    </View>
  );
}

const STATUS_LABEL: Record<AttemptGroupView["status"], string> = {
  running: "running",
  deciding: "picking the best",
  "needs-pick": "needs your pick",
  decided: "decided",
  "no-winner": "no winner",
  failed: "failed",
};

/** Tasks run several ways at once; expand one for the attempts side by side and the pick. */
export function AttemptGroupList() {
  const [rows, setRows] = useState<AttemptGroupRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    api.attemptGroups().then((r) => setRows(r.groups)).catch(() => setRows([]));
  }, []);
  if (!rows) return null;
  if (!rows.length)
    return (
      <T variant="meta" tone="muted">
        No multi-attempt runs yet. Set Attempts to 2 or 3 in the composer.
      </T>
    );
  return (
    <Card style={{ paddingVertical: 0 }}>
      {rows.map((g) => (
        <Disclosure
          key={g.id}
          open={open === g.id}
          onPress={() => setOpen(open === g.id ? null : g.id)}
          title={g.task}
          trailing={
            <T variant="micro" tone={g.status === "needs-pick" ? "default" : "faint"} weight={g.status === "needs-pick" ? "medium" : undefined}>
              {`${STATUS_LABEL[g.status] ?? g.status} · ${g.attempts.length} · ${ago(g.createdAt)}`}
            </T>
          }
        >
          <AttemptGroupDetail id={g.id} />
        </Disclosure>
      ))}
    </Card>
  );
}

function AttemptGroupDetail({ id }: { id: string }) {
  const [d, setD] = useState<AttemptGroupView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const active = !d || d.status === "running" || d.status === "deciding";
  const tick = useNow(10_000, active);
  useEffect(() => {
    let live = true;
    api.attemptGroup(id).then((r) => live && setD(r)).catch((e) => live && setErr(msg(e)));
    return () => {
      live = false;
    };
  }, [id, tick]);
  if (err) return <T variant="micro" tone="destructive">{err}</T>;
  if (!d) return <T variant="micro" tone="faint">Loading…</T>;
  return <AttemptGroupPanel group={d} onChange={setD} />;
}
