// Skills library body — mirrors web/src/components/SkillsPage.tsx. Search, filter chips, template
// strip, how skills reach the agent, recently edited, and the editor over it; import is a sheet.
// Rendered by /settings/skills and embedded in the Harnesses → Skills tab (as web embeds SkillsPage).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import { api, type SkillView } from "@/lib/api";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Toggle } from "@/components/ui/Toggle";
import { SkillEditor, StarterBadge } from "@/components/settings/SkillEditor";
import { SkillImportSheet } from "@/components/settings/SkillImportSheet";
import { byteLength, type Draft, fmtKb, type Mutate, sourceOf, TEMPLATES } from "@/components/settings/SkillModel";
import { FadeIn, FadeInUp, PressScale, Skeleton, stagger } from "@/components/motion";

type Filter = "all" | "on" | "off" | "starter" | "custom";
type Editing = { initial?: SkillView; draft?: Draft };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SkillsBody() {
  const { palette } = useTheme();
  const [skills, setSkills] = useState<SkillView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [importing, setImporting] = useState<{ repo?: string } | null>(null);

  const load = useCallback(() => {
    api
      .skills()
      .then((r) => setSkills(r.skills))
      .catch((e) => setError(msg(e)));
  }, []);
  useEffect(load, [load]);

  const mutate = useCallback<Mutate>(async (body, ok) => {
    const r = await api.skillMutate(body);
    setSkills(r.skills);
    setInfo(ok ?? null);
    return r;
  }, []);

  const newSkill = () => setEditing({ draft: { name: "", description: "", content: "" } });

  const q = query.trim().toLowerCase();
  const counts = useMemo(() => {
    const c = { all: 0, on: 0, off: 0, starter: 0, custom: 0 };
    for (const s of skills ?? []) {
      c.all++;
      c[s.enabled ? "on" : "off"]++;
      c[sourceOf(s.name)]++;
    }
    return c;
  }, [skills]);
  const visible = (skills ?? []).filter((s) => {
    if (filter === "on" && !s.enabled) return false;
    if (filter === "off" && s.enabled) return false;
    if ((filter === "starter" || filter === "custom") && sourceOf(s.name) !== filter) return false;
    return !q || `${s.name} ${s.description}`.toLowerCase().includes(q);
  });
  const existing = useMemo(() => Object.fromEntries((skills ?? []).map((s) => [s.name, true as const])), [skills]);
  const filtered = !!q || filter !== "all";
  const lastEdited = skills?.length ? Math.max(...skills.map((s) => s.updatedAt)) : 0;
  const recent = useMemo(() => [...(skills ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4), [skills]);
  const chips: { value: Filter; label: string; count: number }[] = [
    { value: "all", label: "All", count: counts.all },
    { value: "on", label: "On", count: counts.on },
    { value: "off", label: "Off", count: counts.off },
    ...(counts.starter > 0 && counts.custom > 0
      ? [
          { value: "starter" as const, label: "Starter", count: counts.starter },
          { value: "custom" as const, label: "Yours", count: counts.custom },
        ]
      : []),
  ];

  return (
    <>
      <T variant="meta" tone="muted">
        {skills && skills.length > 0 ? (
          `${skills.length} skill${skills.length === 1 ? "" : "s"} · ${counts.on} on${lastEdited > 0 ? ` · edited ${ago(lastEdited)}` : ""}`
        ) : (
          <>
            Playbooks every sandbox follows — invoke one with{" "}
            <T variant="meta" mono>
              /name
            </T>{" "}
            in chat, or the agent picks it up when it fits.
          </>
        )}
      </T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button small variant="outline" title="Import" onPress={() => setImporting({})} />
        <Button small title="New skill" onPress={newSkill} />
      </View>
      {error ? (
        <FadeIn>
          <T variant="meta" tone="destructive" accessibilityRole="alert">
            {error}
          </T>
        </FadeIn>
      ) : null}
      {info ? (
        <T variant="meta" tone="ok">
          {info}
        </T>
      ) : null}

      {skills && skills.length > 0 ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 40, borderWidth: 1, borderColor: palette.input, borderRadius: radius.lg, backgroundColor: palette.card, paddingHorizontal: 12 }}>
            <Icon name="search" size={14} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search skills"
              placeholderTextColor={palette.faint}
              accessibilityLabel="Search skills"
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex: 1, color: palette.foreground, fontFamily: fonts.sans, fontSize: type.meta.fontSize, padding: 0 }}
            />
            {query ? (
              <PressScale scaleTo={0.9} onPress={() => setQuery("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                <Icon name="x" size={14} />
              </PressScale>
            ) : null}
          </View>
          <View accessibilityRole="radiogroup" accessibilityLabel="Filter skills" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {chips.map((c) => {
              const on = filter === c.value;
              return (
                <PressScale
                  haptic="selection"
                  key={c.value}
                  onPress={() => setFilter(c.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? palette.foreground : palette.border, backgroundColor: on ? palette.foreground : palette.card }}
                >
                  <T variant="meta" weight="medium" style={{ color: on ? palette.background : palette.foreground }}>
                    {c.label}
                  </T>
                  <T variant="micro" style={{ color: on ? palette.background : palette.mutedForeground }}>
                    {c.count}
                  </T>
                </PressScale>
              );
            })}
          </View>
        </>
      ) : null}

      {skills === null && !error ? (
        <View style={{ gap: 10 }} accessibilityLabel="Loading skills">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <View style={{ gap: 6 }}>
                <Skeleton width={130} height={12} />
                <Skeleton width="60%" height={10} />
              </View>
            </Card>
          ))}
        </View>
      ) : skills?.length === 0 ? (
        <EmptyState onPick={(d) => setEditing({ draft: d })} onNew={newSkill} onImport={() => setImporting({})} />
      ) : skills && visible.length === 0 ? (
        <Card>
          <View style={{ alignItems: "center", gap: 4, paddingVertical: 16 }}>
            <T variant="lead" weight="medium">
              Nothing matches
            </T>
            <T variant="meta" tone="muted">
              {q ? `No skill matches “${query.trim()}”` : "No skill in this filter"}.
            </T>
            <Button
              small
              variant="ghost"
              title="Clear filters"
              onPress={() => {
                setQuery("");
                setFilter("all");
              }}
            />
          </View>
        </Card>
      ) : (
        visible.map((s, i) => (
          <FadeInUp key={s.name} delay={stagger(i)}>
            <SkillRow skill={s} onOpen={() => setEditing({ initial: s })} onMutate={mutate} onError={setError} />
          </FadeInUp>
        ))
      )}

      {skills && skills.length > 0 && skills.length <= 6 && !filtered ? <TemplateStrip existing={existing} onPick={(d) => setEditing({ draft: d })} onNew={newSkill} /> : null}

      {skills && skills.length > 0 ? (
        <View style={{ gap: 18, marginTop: 12 }}>
          <RailSection title="How skills reach the agent">
            <Fact icon="terminal" title="Typed as /name" line="In any chat, the way you would run a command." />
            <Fact icon="star" title="Matched on its own" line="When a task fits the description, the agent picks it up unprompted." />
            <Fact icon="refresh-cw" title="Synced on the next turn" line="Every sandbox gets the current version — turn one off to hold it back." />
          </RailSection>
          <RailSection title="Curated">
            <Card onPress={() => setImporting({ repo: "anthropics/skills" })}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <Icon name="github" size={16} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T variant="meta" weight="medium" mono>
                    anthropics/skills
                  </T>
                  <T variant="micro" tone="muted">
                    Anthropic's own collection — documents, design, research. Browse and pull one in.
                  </T>
                </View>
              </View>
            </Card>
          </RailSection>
          <RailSection title="Recently edited">
            {recent.map((s) => (
              <PressScale key={s.name} onPress={() => setEditing({ initial: s })} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, opacity: s.enabled ? 1 : 0.6 }}>
                <T variant="meta" weight="medium" mono numberOfLines={1} style={{ flex: 1 }}>
                  /{s.name}
                </T>
                <Icon name="clock" size={11} />
                <T variant="micro" tone="faint">
                  {ago(s.updatedAt)}
                </T>
              </PressScale>
            ))}
          </RailSection>
        </View>
      ) : null}

      <SkillEditor
        visible={!!editing}
        initial={editing?.initial}
        draft={editing?.draft}
        onMutate={mutate}
        onSaved={(s) => setEditing((e) => (e ? { initial: s } : e))}
        onClose={() => setEditing(null)}
      />
      <SkillImportSheet
        visible={!!importing}
        presetRepo={importing?.repo}
        existing={existing}
        onClose={() => setImporting(null)}
        onImported={async (count) => {
          setSkills((await api.skills()).skills);
          setInfo(`Imported ${count} skill${count === 1 ? "" : "s"} — every sandbox gets them on its next turn`);
        }}
        onEditOne={(d) => {
          setImporting(null);
          setEditing({ draft: d });
        }}
      />
    </>
  );
}

/** One skill: `/name` · starter badge · the "when" line · files + weight · last edit · on/off. */
function SkillRow({ skill: s, onOpen, onMutate, onError }: { skill: SkillView; onOpen: () => void; onMutate: Mutate; onError: (e: string) => void }) {
  const { palette } = useTheme();
  const [busy, setBusy] = useState(false);
  const files = s.files?.length ?? 0;
  const bytes = byteLength(s.content) + (s.files ?? []).reduce((n, f) => n + byteLength(f.content), 0);
  const toggle = (next: boolean) => {
    setBusy(true);
    onMutate({ action: "toggle", name: s.name, enabled: next })
      .catch((e: unknown) => onError(`Could not update: ${msg(e)}`))
      .finally(() => setBusy(false));
  };
  return (
    <Card onPress={busy ? undefined : onOpen}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, opacity: s.enabled ? 1 : 0.55 }} accessibilityLabel={`Edit skill ${s.name}`}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <T variant="body" weight="semibold" mono numberOfLines={1} style={{ flexShrink: 1 }}>
              /{s.name}
            </T>
            {sourceOf(s.name) === "starter" ? <StarterBadge /> : null}
          </View>
          <T variant="meta" tone="muted" numberOfLines={2} style={{ marginTop: 2 }}>
            {s.description}
          </T>
          <T variant="micro" tone="faint" style={{ marginTop: 4 }}>
            {files + 1} file{files ? "s" : ""} · {fmtKb(bytes)} · {ago(s.updatedAt)}
          </T>
        </View>
        <Toggle value={s.enabled} disabled={busy} onValueChange={toggle} accessibilityLabel={s.enabled ? `Disable ${s.name}` : `Enable ${s.name}`} />
      </View>
    </Card>
  );
}

function TemplateCard({ t, onPick }: { t: (typeof TEMPLATES)[number]; onPick: (d: Draft) => void }) {
  const firstLine = t.content.split("\n")[0].replace(/^\d+\.\s*/, "");
  return (
    <Card onPress={() => onPick({ name: t.name, description: t.description, content: t.content })}>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T variant="meta" weight="medium" mono style={{ flex: 1 }}>
            /{t.name}
          </T>
          <T variant="micro" weight="medium" tone="live">
            Use ↗
          </T>
        </View>
        <T variant="meta" weight="medium">
          {t.blurb}
        </T>
        <T variant="micro" tone="muted" numberOfLines={2}>
          “{firstLine}”
        </T>
        <T variant="micro" tone="faint" style={{ marginTop: 4 }}>
          {t.steps} steps · edit before it goes live
        </T>
      </View>
    </Card>
  );
}

function TemplateStrip({ existing, onPick, onNew }: { existing: Record<string, true>; onPick: (d: Draft) => void; onNew: () => void }) {
  const open = TEMPLATES.filter((t) => !existing[t.name]);
  if (!open.length) return null;
  return (
    <View style={{ gap: 10, marginTop: 16 }}>
      <T variant="h3" weight="semibold">
        Start from a template
      </T>
      <T variant="meta" tone="muted">
        Opens in the editor — edit before it goes live
      </T>
      {open.map((t) => (
        <TemplateCard key={t.name} t={t} onPick={onPick} />
      ))}
      {open.length < 3 ? <Button variant="outline" title="Blank skill" onPress={onNew} /> : null}
    </View>
  );
}

/** No skills yet: say what one is in one breath, show how it fires, then three ways in. */
function EmptyState({ onPick, onNew, onImport }: { onPick: (d: Draft) => void; onNew: () => void; onImport: () => void }) {
  return (
    <View style={{ gap: 12 }}>
      <Card>
        <View style={{ gap: 10 }}>
          <Icon name="zap" size={22} />
          <T variant="h2" weight="semibold">
            Teach the agent how you work
          </T>
          <T variant="body" tone="muted">
            A skill is a playbook — how you review PRs, cut a release, fix CI — written once as markdown and followed in every sandbox. It fires when you type{" "}
            <T variant="body" mono>
              /name
            </T>{" "}
            in chat, or on its own when a task matches its description.
          </T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Button small title="Write your own" onPress={onNew} />
            <Button small variant="outline" title="Import from GitHub" onPress={onImport} />
          </View>
          {[
            ["1", "Write the steps in markdown", "Headings, lists, fenced code — anything the agent can read."],
            ["2", "Give it a name and a “when”", "The name is the /command; the description is what it auto-matches on."],
            ["3", "Save — it is in every sandbox", "Synced on the next turn. Turn it off any time without deleting."],
          ].map(([n, t, d]) => (
            <View key={n} style={{ flexDirection: "row", gap: 10 }}>
              <T variant="meta" mono tone="muted">
                {n}
              </T>
              <View style={{ flex: 1 }}>
                <T variant="meta" weight="medium">
                  {t}
                </T>
                <T variant="micro" tone="muted">
                  {d}
                </T>
              </View>
            </View>
          ))}
        </View>
      </Card>
      <T variant="h3" weight="semibold" style={{ marginTop: 8 }}>
        Or start from a template
      </T>
      <T variant="meta" tone="muted">
        Three playbooks most teams want first
      </T>
      {TEMPLATES.map((t) => (
        <TemplateCard key={t.name} t={t} onPick={onPick} />
      ))}
    </View>
  );
}

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <T variant="micro" weight="medium" tone="muted" style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
        {title}
      </T>
      {children}
    </View>
  );
}

function Fact({ icon, title, line }: { icon: IconName; title: string; line: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <Icon name={icon} size={14} style={{ marginTop: 3 }} />
      <View style={{ flex: 1 }}>
        <T variant="meta" weight="medium">
          {title}
        </T>
        <T variant="micro" tone="muted">
          {line}
        </T>
      </View>
    </View>
  );
}
