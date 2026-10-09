import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, type AgentChoice, type AgentId, type AgentPrefs, type HarnessView, type ProviderView, type WorkflowView } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { T } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { PressScale } from "@/components/motion";
import { SettingsSection } from "@/components/ui/SettingsSection";

/**
 * Run options for the NEXT thread, at web parity (web/src/components/thread/RunSettings.tsx +
 * DriverPicker.tsx): which coding agent drives it, a saved harness, a saved playbook (workflow),
 * and how many parallel attempts to run. Web spreads these over toolbar menus; a phone gets one
 * sheet with four sections and the same removable chips once something is off its default.
 */

export type Attempts = 1 | 2 | 3;
export type RunSection = "agent" | "provider" | "harness" | "workflow" | "attempts" | "verify";

/** Optional post-run verification: a command run in the sandbox, or a criterion a read-only checker judges. */
export interface VerifySpec {
  mode: "command" | "criterion";
  text: string;
}

export interface RunOptions {
  /** null = the stored default agent (`AgentPrefs.defaultAgent`). */
  agent: AgentId | null;
  harness: string | null;
  workflow: string | null;
  attempts: Attempts;
  /** A saved model provider (Providers page); null = the built-in model choice. */
  provider?: string | null;
  /** A model from that provider's list; null = the provider's default. */
  providerModel?: string | null;
}

export const DEFAULT_RUN_OPTIONS: RunOptions = { agent: null, harness: null, workflow: null, attempts: 1 };

export interface RunSources {
  prefs: AgentPrefs | null;
  harnesses: HarnessView[];
  workflows: WorkflowView[];
  providers: ProviderView[];
}

const STICKY_KEY = "asb-run-options";
type Sticky = Pick<RunOptions, "agent" | "harness" | "workflow" | "provider" | "providerModel">;

function isAgentId(v: unknown): v is AgentId {
  return v === "claude" || v === "omp" || v === "codex" || v === "opencode";
}

async function readSticky(): Promise<Sticky> {
  try {
    const raw = await AsyncStorage.getItem(STICKY_KEY);
    if (!raw) return { agent: null, harness: null, workflow: null };
    const j: unknown = JSON.parse(raw);
    const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
    return {
      agent: isAgentId(o.agent) ? o.agent : null,
      harness: typeof o.harness === "string" ? o.harness : null,
      workflow: typeof o.workflow === "string" ? o.workflow : null,
      provider: typeof o.provider === "string" ? o.provider : null,
      providerModel: typeof o.providerModel === "string" ? o.providerModel : null,
    };
  } catch {
    return { agent: null, harness: null, workflow: null };
  }
}

function writeSticky(s: Sticky) {
  AsyncStorage.setItem(STICKY_KEY, JSON.stringify(s)).catch(() => {});
}

/**
 * The composer's run options plus their sources. Agent / harness / workflow stick across launches
 * (a stale sticky id that no longer exists on the server is dropped once the lists load); attempts
 * never stick — two or three machines is a per-task decision, not a preference.
 */
export function useRunOptions(initial?: RunOptions | null) {
  const [value, setValue] = useState<RunOptions>(initial ?? DEFAULT_RUN_OPTIONS);
  const skipSticky = useRef(!!initial);
  const [sources, setSources] = useState<RunSources>({ prefs: null, harnesses: [], workflows: [], providers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const stickyLoaded = useRef(false);
  const gen = useRef(0);

  const load = useCallback(() => {
    const g = ++gen.current;
    setLoading(true);
    setError(null);
    Promise.all([api.agentPrefs(), api.harnesses(), api.workflows(), api.providers().catch(() => ({ providers: [] as ProviderView[] }))])
      .then(([prefs, h, w, p]) => {
        if (g !== gen.current) return;
        setSources({ prefs, harnesses: h.harnesses, workflows: w.workflows, providers: p.providers });
        // Reconcile the sticky picks against what actually exists now.
        setValue((v) => ({
          ...v,
          agent: v.agent && v.agent !== prefs.defaultAgent && prefs.agents.some((a) => a.id === v.agent) ? v.agent : null,
          harness: v.harness && h.harnesses.some((x) => x.id === v.harness && !x.needsReview) ? v.harness : null,
          workflow: v.workflow && w.workflows.some((x) => x.id === v.workflow) ? v.workflow : null,
          ...(v.provider && !p.providers.some((x) => x.id === v.provider) ? { provider: null, providerModel: null } : {}),
        }));
      })
      .catch((e: unknown) => {
        if (g !== gen.current) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (g === gen.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    // A restored failed submit already knows its picks — do not let an older sticky read clobber it.
    // Sticky picks are read before the lists load so the reconcile in load() always sees them.
    if (skipSticky.current) {
      stickyLoaded.current = true;
      load();
    } else {
      readSticky()
        .then((s) => setValue((v) => ({ ...v, ...s })))
        .finally(() => {
          stickyLoaded.current = true;
          load();
        });
    }
    return () => {
      gen.current++;
    };
  }, [load]);

  const update = useCallback((patch: Partial<RunOptions>) => {
    setValue((v) => {
      const next = { ...v, ...patch };
      if (stickyLoaded.current) writeSticky({ agent: next.agent, harness: next.harness, workflow: next.workflow, provider: next.provider ?? null, providerModel: next.providerModel ?? null });
      return next;
    });
  }, []);

  return { value, update, sources, loading, error, reload: load };
}

/** The agent actually driving: the pick, else the stored default. */
export function currentAgent(value: RunOptions, prefs: AgentPrefs | null): AgentChoice | null {
  if (!prefs) return null;
  const id = value.agent ?? prefs.defaultAgent;
  return prefs.agents.find((a) => a.id === id) ?? null;
}

/** "claude · sonnet · ask before guessing · plan first · verify" — a harness in one line. */
export function harnessSummary(h: HarnessView): string {
  const parts: string[] = [];
  if (h.driver) parts.push(h.driver);
  if (h.model) parts.push(h.model);
  if (h.rules.askBeforeGuess) parts.push("ask before guessing");
  if (h.rules.planFirst) parts.push("plan first");
  if (h.rules.verifyOnDone) parts.push(h.verifyCommand ? `verify: ${h.verifyCommand}` : "verify");
  if (h.rules.autoRetry) parts.push(`retry ×${h.rules.autoRetry}`);
  if (h.skills?.length) parts.push(`${h.skills.length} skill${h.skills.length === 1 ? "" : "s"}`);
  return parts.join(" · ") || "deployment defaults";
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

/** What a driver can do — the words come straight from the server's capability record. */
function AgentBadges({ choice }: { choice: AgentChoice }) {
  const c = choice.capabilities;
  const supervised = choice.supervised !== false;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
      <Badge tone={supervised ? "ok" : "attention"}>{supervised ? "supervised" : "supervised: partial"}</Badge>
      {c?.sideQuestion ? <Badge>side questions</Badge> : null}
      {c?.planEvents ? <Badge>plan card</Badge> : null}
      {c?.resume ? <Badge>resume</Badge> : null}
    </View>
  );
}

/** One radio row: a check (or empty ring), a label, an optional second line, optional trailing content. */
function RadioRow({
  on,
  label,
  detail,
  trailing,
  disabled,
  onPress,
  children,
}: {
  on: boolean;
  label: string;
  detail?: string;
  trailing?: string;
  disabled?: boolean;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  const { palette } = useTheme();
  return (
    <PressScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        paddingVertical: 9,
        paddingHorizontal: 8,
        borderRadius: radius.lg,
        backgroundColor: on ? palette.accent : pressed ? palette.muted : "transparent",
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <View style={{ width: 16, height: 20, alignItems: "center", justifyContent: "center" }}>
        {on ? (
          <Icon name="check" size={14} color={palette.foreground} />
        ) : (
          <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: palette.lineStrong }} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <T variant="body" weight={on ? "semibold" : "regular"} numberOfLines={1} style={{ flexShrink: 1 }}>
            {label}
          </T>
          {trailing ? (
            <T variant="micro" tone="faint" numberOfLines={1}>
              {trailing}
            </T>
          ) : null}
        </View>
        {detail ? (
          <T variant="micro" tone="muted" numberOfLines={2}>
            {detail}
          </T>
        ) : null}
        {children}
      </View>
    </PressScale>
  );
}


// Agents whose "supervised: partial" caveat the person has already acknowledged this launch — the
// confirm line shows once per agent, not on every pick.
const acknowledged = new Set<AgentId>();

export function RunSettingsSheet({
  visible,
  onClose,
  value,
  onChange,
  sources,
  loading,
  error,
  onRetry,
  sections,
  title = "Run settings",
  verify,
}: {
  visible: boolean;
  onClose: () => void;
  value: RunOptions;
  onChange: (patch: Partial<RunOptions>) => void;
  sources: RunSources;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Only these sections (the web's toolbar menus open one at a time); default: all of them. */
  sections?: RunSection[];
  title?: string;
  /** Wire the verify row in (the "More" menu on web); absent = not shown. */
  verify?: { value: VerifySpec | null; onChange: (v: VerifySpec | null) => void };
}) {
  const { palette } = useTheme();
  const [confirming, setConfirming] = useState<AgentId | null>(null);
  useEffect(() => {
    if (!visible) setConfirming(null);
  }, [visible]);
  const show = (s: RunSection) => !sections || sections.includes(s);

  const prefs = sources.prefs;
  const defaultAgent = prefs?.defaultAgent ?? null;
  const activeAgent = value.agent ?? defaultAgent;

  const pickAgent = (a: AgentChoice) => {
    Haptics.selectionAsync().catch(() => {});
    if (a.supervised === false && !acknowledged.has(a.id) && confirming !== a.id) {
      setConfirming(a.id);
      return;
    }
    acknowledged.add(a.id);
    setConfirming(null);
    onChange({ agent: a.id === defaultAgent ? null : a.id });
  };

  // Built-ins first (curated defaults), then yours — the web's order.
  const orderedHarnesses = useMemo(
    () => [...sources.harnesses.filter((h) => h.builtin), ...sources.harnesses.filter((h) => !h.builtin)],
    [sources.harnesses],
  );
  const firstCustom = orderedHarnesses.findIndex((h) => !h.builtin);

  const empty = !loading && !error && !prefs && !sources.harnesses.length && !sources.workflows.length && !sources.providers.length;

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ paddingBottom: 12 }}>
        {error ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 6 }}>
            <T variant="meta" tone="destructive" style={{ flex: 1 }} numberOfLines={2}>
              ✕ {error}
            </T>
            <Button title="Retry" small variant="secondary" onPress={onRetry} loading={loading} />
          </View>
        ) : null}
        {loading && empty ? (
          <T variant="meta" tone="faint" style={{ paddingHorizontal: 8, paddingVertical: 10 }}>
            Loading agents, harnesses and playbooks…
          </T>
        ) : null}

        {/* ── Agent ── */}
        {show("agent") && prefs && prefs.agents.length > 0 ? (
          <>
            <SettingsSection title="Agent" purpose="Which coding agent drives this thread." />
            {prefs.agents.map((a) => {
              const on = a.id === activeAgent;
              const asking = confirming === a.id;
              return (
                <RadioRow
                  key={a.id}
                  on={on}
                  label={a.label}
                  trailing={a.id === defaultAgent ? "default" : undefined}
                  onPress={() => pickAgent(a)}
                >
                  <AgentBadges choice={a} />
                  {a.capabilities?.caveat && (on || asking) ? (
                    <T variant="micro" tone="faint" style={{ marginTop: 3 }}>
                      {a.capabilities.caveat}
                    </T>
                  ) : null}
                  {asking ? (
                    <View
                      style={{
                        marginTop: 8,
                        gap: 8,
                        borderLeftWidth: 2,
                        borderLeftColor: palette.attention,
                        paddingLeft: 10,
                      }}
                    >
                      <T variant="micro" tone="attention">
                        Partially supervised: a pending question cannot always stop this agent mid-action. It will
                        keep going until it reaches a boundary.
                      </T>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Button title="Use anyway" small variant="attention" onPress={() => pickAgent(a)} />
                        <Button title="Keep default" small variant="ghost" onPress={() => setConfirming(null)} />
                      </View>
                    </View>
                  ) : null}
                </RadioRow>
              );
            })}
          </>
        ) : null}

        {/* ── Model provider ── */}
        {show("provider") && sources.providers.length > 0 ? (
          <>
            <SettingsSection title="Model provider" purpose="Your own key or endpoint. Built-in uses the deployment's model." />
            <RadioRow
              on={!value.provider}
              label="Built-in"
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onChange({ provider: null, providerModel: null });
              }}
            />
            {sources.providers.map((p) => {
              const on = value.provider === p.id;
              const fits = !activeAgent || p.drivers.includes(activeAgent);
              return (
                <RadioRow
                  key={p.id}
                  on={on}
                  label={p.label}
                  trailing={p.kind}
                  detail={fits ? undefined : `Not usable with ${prefs?.agents.find((a) => a.id === activeAgent)?.label ?? activeAgent}`}
                  disabled={!fits}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    onChange({ provider: p.id, providerModel: null });
                  }}
                >
                  {on && p.models?.length ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {p.models.slice(0, 24).map((m) => {
                        const picked = value.providerModel === m;
                        return (
                          <PressScale
                            key={m}
                            onPress={() => onChange({ providerModel: picked ? null : m })}
                            style={{ borderWidth: 1, borderColor: picked ? palette.foreground : palette.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}
                          >
                            <T variant="micro" mono weight={picked ? "semibold" : "regular"}>
                              {m}
                            </T>
                          </PressScale>
                        );
                      })}
                    </View>
                  ) : null}
                </RadioRow>
              );
            })}
          </>
        ) : null}

        {/* ── Harness ── */}
        {show("harness") && sources.harnesses.length > 0 ? (
          <>
            <SettingsSection title="Harness" purpose="A saved bundle of agent, model and rules. Explicit picks here still win." />
            <RadioRow
              on={!value.harness}
              label="None"
              detail="Deployment defaults — agent, model and rules"
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onChange({ harness: null });
              }}
            />
            {orderedHarnesses.map((h, i) => {
              const disabled = !!h.needsReview || !!h.providerMissing;
              const header = h.builtin && i === 0 ? "Built-in" : !h.builtin && i === firstCustom && firstCustom > 0 ? "Yours" : null;
              const why = h.needsReview
                ? "Imported — review it on the Harnesses page before use"
                : h.providerMissing
                  ? "Its model provider is gone — fix it on the Harnesses page"
                  : h.description;
              return (
                <React.Fragment key={h.id}>
                  {header ? (
                    <T variant="micro" tone="faint" style={{ paddingHorizontal: 8, paddingTop: 6, paddingBottom: 2 }}>
                      {header}
                    </T>
                  ) : null}
                  <RadioRow
                    on={value.harness === h.id}
                    label={h.name}
                    trailing={h.needsReview ? "needs review" : h.providerMissing ? "provider missing" : undefined}
                    detail={why}
                    disabled={disabled}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      onChange({ harness: h.id });
                    }}
                  >
                    {value.harness === h.id ? (
                      <T variant="micro" tone="faint" numberOfLines={2} style={{ marginTop: 2 }}>
                        {harnessSummary(h)}
                      </T>
                    ) : null}
                  </RadioRow>
                </React.Fragment>
              );
            })}
          </>
        ) : null}

        {/* ── Playbook ── */}
        {show("workflow") && sources.workflows.length > 0 ? (
          <>
            <SettingsSection title="Playbook" purpose="The task becomes the first step of a saved workflow." />
            <RadioRow
              on={!value.workflow}
              label="None"
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onChange({ workflow: null });
              }}
            />
            {sources.workflows.map((w) => (
              <RadioRow
                key={w.id}
                on={value.workflow === w.id}
                label={w.name}
                trailing={`${w.steps.length} step${w.steps.length === 1 ? "" : "s"}`}
                detail={w.description}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  onChange({ workflow: w.id });
                }}
              />
            ))}
          </>
        ) : null}

        {/* ── Attempts ── */}
        {show("attempts") ? (
          <>
        <SettingsSection title="Attempts" />
        <View style={{ paddingHorizontal: 8, gap: 6 }}>
          <View
            style={{
              flexDirection: "row",
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: radius.lg,
              overflow: "hidden",
              alignSelf: "flex-start",
            }}
          >
            {([1, 2, 3] as const).map((n, i) => {
              const on = value.attempts === n;
              return (
                <PressScale
                  key={n}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    onChange({ attempts: n });
                  }}
                  style={({ pressed }) => ({
                    paddingVertical: 7,
                    paddingHorizontal: 18,
                    backgroundColor: on ? palette.primary : pressed ? palette.muted : "transparent",
                    borderLeftWidth: i === 0 ? 0 : 1,
                    borderLeftColor: palette.border,
                  })}
                >
                  <T variant="meta" weight={on ? "semibold" : "regular"} style={{ color: on ? palette.primaryForeground : palette.foreground }}>
                    {n}
                  </T>
                </PressScale>
              );
            })}
          </View>
          <T variant="micro" tone="faint">
            {value.attempts === 1
              ? "One machine, one run."
              : `Runs it ${value.attempts} ways on ${value.attempts} machines; the best attempt gets the PR.`}
          </T>
        </View>
          </>
        ) : null}

        {/* ── Verify ── */}
        {show("verify") && verify ? <VerifySection value={verify.value} onChange={verify.onChange} /> : null}
      </View>
    </Sheet>
  );
}

/** The web's VerifyRow: mode toggle + one field; empty text clears the spec. */
function VerifySection({ value, onChange }: { value: VerifySpec | null; onChange: (v: VerifySpec | null) => void }) {
  const { palette } = useTheme();
  // The mode survives an empty field so switching to "criterion" before typing is remembered.
  const [mode, setMode] = useState<VerifySpec["mode"]>(value?.mode ?? "command");
  const text = value?.text ?? "";
  return (
    <>
      <SettingsSection title="Verify" purpose="Checked after the agent finishes; shows as a chip once filled." />
      <View style={{ paddingHorizontal: 8, gap: 8 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {(["command", "criterion"] as const).map((m) => (
            <PressScale
              key={m}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setMode(m);
                if (text) onChange({ mode: m, text });
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: mode === m }}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: mode === m ? palette.accent : "transparent",
              }}
            >
              <T variant="meta" weight={mode === m ? "semibold" : "regular"}>
                {m === "command" ? "Command" : "Criterion"}
              </T>
            </PressScale>
          ))}
        </View>
        <TextInput
          value={text}
          onChangeText={(t) => onChange(t ? { mode, text: t } : null)}
          placeholder={mode === "command" ? "npm test" : "what must be true when it's done"}
          placeholderTextColor={palette.faint}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            borderWidth: 1,
            borderColor: palette.input,
            borderRadius: radius.lg,
            backgroundColor: palette.card,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: palette.foreground,
            fontFamily: mode === "command" ? fonts.mono : fonts.sans,
            fontSize: type.body.fontSize,
          }}
        />
        <T variant="micro" tone="faint">
          {mode === "command"
            ? "Runs in the sandbox after the agent finishes — exit 0 means verified."
            : "A read-only checker judges this — it can't edit anything."}
        </T>
      </View>
    </>
  );
}

/* ───────────────────────────── chips ───────────────────────────── */

/**
 * What is off its default, as removable chips (web's RunOptionChips). Tap the body to open the sheet
 * at that section; × resets that one option. Renders nothing when everything is default.
 */
export function RunOptionChips({
  value,
  sources,
  onOpen,
  onChange,
}: {
  value: RunOptions;
  sources: RunSources;
  onOpen: (section: RunSection) => void;
  onChange: (patch: Partial<RunOptions>) => void;
}) {
  const chips: { key: RunSection; icon?: IconName; label: string; remove: () => void }[] = [];
  const harness = sources.harnesses.find((h) => h.id === value.harness);
  if (value.harness) chips.push({ key: "harness", icon: "layers", label: harness?.name ?? value.harness, remove: () => onChange({ harness: null }) });
  const agent = currentAgent(value, sources.prefs);
  if (value.agent && agent && agent.id !== sources.prefs?.defaultAgent)
    chips.push({ key: "agent", icon: "cpu", label: agent.label, remove: () => onChange({ agent: null }) });
  const provider = sources.providers.find((p) => p.id === value.provider);
  if (value.provider)
    chips.push({ key: "provider", icon: "zap", label: [provider?.label ?? value.provider, value.providerModel].filter(Boolean).join(" · "), remove: () => onChange({ provider: null, providerModel: null }) });
  const workflow = sources.workflows.find((w) => w.id === value.workflow);
  if (value.workflow) chips.push({ key: "workflow", icon: "list", label: workflow?.name ?? value.workflow, remove: () => onChange({ workflow: null }) });
  if (value.attempts > 1) chips.push({ key: "attempts", icon: "copy", label: `${value.attempts} attempts`, remove: () => onChange({ attempts: 1 }) });
  if (!chips.length) return null;
  return (
    <>
      {chips.map((c) => (
        <Chip key={c.key} icon={c.icon} label={c.label} onPress={() => onOpen(c.key)} onRemove={c.remove} />
      ))}
    </>
  );
}

function Chip({ icon, label, onPress, onRemove }: { icon?: IconName; label: string; onPress: () => void; onRemove: () => void }) {
  const { palette } = useTheme();
  // Pop in like the composer's send button: scale 0.9 → 1 over a short spring.
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }),
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
    ]).start();
  }, [scale, opacity]);
  return (
    <Animated.View
      style={{
        transform: [{ scale }],
        opacity,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: radius.pill,
        backgroundColor: palette.accent,
        borderWidth: 1,
        borderColor: palette.lineStrong,
        maxWidth: "100%",
      }}
    >
      <PressScale
        onPress={onPress}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 10, paddingVertical: 6, opacity: pressed ? 0.7 : 1 })}
      >
        {icon ? <Icon name={icon} size={11} color={palette.mutedForeground} /> : null}
        <T variant="micro" weight="medium" numberOfLines={1} style={{ maxWidth: 160 }}>
          {label}
        </T>
      </PressScale>
      <PressScale
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onRemove();
        }}
        accessibilityLabel={`Remove ${label}`}
        hitSlop={8}
        style={({ pressed }) => ({ paddingHorizontal: 8, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}
      >
        <Icon name="x" size={11} color={palette.faint} />
      </PressScale>
    </Animated.View>
  );
}
