// Harnesses (web: components/HarnessesPage.tsx). Tabs Drivers · Skills · Saved. Skills embeds the
// full library (SkillsBody); Saved: Import / New harness in the header, Saved harnesses (edit,
// duplicate, export, delete, review → approve), the rules note, Compare and Attempts. The editor
// itself is /harness/[id].
import React, { useCallback, useEffect, useState } from "react";
import { Share, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { api, type HarnessView, type SkillView } from "@/lib/api";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Segmented } from "@/components/settings/Segmented";
import { AttemptGroupList, CompareLauncher, CompareList, ImportHarness, ReviewPanel, rulesLine } from "@/components/settings/HarnessParts";
import { AcctAgentSection } from "@/components/settings/AcctSections";
import { SkillsBody } from "@/components/skills/SkillsBody";
import { animateLayout, FadeIn, FadeInUp, stagger } from "@/components/motion";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Tab = "drivers" | "skills" | "saved";

export default function Harnesses() {
  const router = useRouter();
  const { palette } = useTheme();
  const [tab, setTab] = useState<Tab>("saved");
  const [list, setList] = useState<HarnessView[] | null>(null);
  const [builtins, setBuiltins] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [importing, setImporting] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compareRefresh, setCompareRefresh] = useState(0);

  const reload = useCallback(() => {
    api
      .harnesses()
      .then((r) => {
        setList(r.harnesses);
        setBuiltins(r.builtins ?? 0);
        setError(null);
      })
      .catch((e) => setError(msg(e)));
  }, []);
  useFocusEffect(reload);
  useEffect(() => {
    api.skills().then((s) => setSkills(s.skills ?? [])).catch(() => {});
  }, []);

  const mutate = async (body: Record<string, unknown>, ok?: string) => {
    setError(null);
    try {
      setList((await api.harnessMutate(body)).harnesses);
      if (ok) setInfo(ok);
    } catch (e) {
      setError(msg(e));
    }
  };

  const exportOne = async (h: HarnessView) => {
    try {
      const r = await api.harnessExport(h.id);
      const notes = [r.redacted ? `${r.redacted} secret-shaped value${r.redacted === 1 ? "" : "s"} redacted` : "", r.skipped.length ? `${r.skipped.length} secret file${r.skipped.length === 1 ? "" : "s"} left out` : ""].filter(Boolean);
      await Share.share({ message: JSON.stringify(r.bundle, null, 2), title: r.filename });
      setInfo(`Exported ${h.name} — ${notes.join(" · ") || "No keys or tokens are ever included."}`);
    } catch (e) {
      setError(msg(e));
    }
  };

  const all = list ?? [];
  const runnable = all.filter((h) => !h.needsReview);
  const reviewCount = all.length - runnable.length;
  const edit = (h: HarnessView) => router.push(`/harness/${encodeURIComponent(h.id)}`);

  return (
    <SettingsScreen
      title="Harnesses"
      right={
        tab === "saved" ? (
          <FadeIn key="saved-actions" style={{ flexDirection: "row", gap: 8 }}>
            <Button small variant="outline" title="Import" onPress={() => setImporting(true)} />
            <Button small title="New harness" onPress={() => router.push("/harness/new")} />
          </FadeIn>
        ) : null
      }
    >
      <T variant="body" tone="muted">
        How your agents work: driver, model, skills, rules and egress, saved as one pick.
      </T>
      <Segmented
        value={tab}
        onChange={(t) => {
          animateLayout();
          setTab(t);
        }}
        options={[
          { value: "drivers", label: "Drivers" },
          { value: "skills", label: "Skills" },
          { value: "saved", label: "Saved", badge: reviewCount },
        ]}
      />
      {error ? (
        <FadeIn>
          <T variant="meta" tone="destructive">
            {error}
          </T>
        </FadeIn>
      ) : null}
      {info ? (
        <T variant="meta" tone="muted">
          {info}
        </T>
      ) : null}

      {tab === "drivers" ? <AcctAgentSection title="Drivers" harnesses={all} /> : null}

      {tab === "skills" ? <SkillsBody /> : null}

      {tab === "saved" && importing ? (
        <ImportHarness
          onCancel={() => setImporting(false)}
          onImported={(r) => {
            setList(r.harnesses);
            setImporting(false);
            setInfo("Imported — review it before it can run");
            api.skills().then((s) => setSkills(s.skills)).catch(() => {});
          }}
        />
      ) : null}

      {tab === "saved" && !importing ? (
        <>
          <Section
            title="Saved harnesses"
            meta={list ? String(all.length) : undefined}
            purpose="Built-ins are best-practice starting points: edit them, duplicate them, or delete the ones you don't use."
            action={list && all.filter((h) => h.builtin).length < builtins ? <Button small variant="ghost" title="Restore built-ins" onPress={() => void mutate({ action: "restore-defaults" }, "Built-in harnesses restored")} /> : null}
          >
            {error && !list ? (
              <Card style={{ gap: 8 }}>
                <T variant="body" weight="medium">
                  Couldn't load harnesses
                </T>
                <View style={{ flexDirection: "row" }}>
                  <Button small variant="outline" title="Retry" onPress={reload} />
                </View>
              </Card>
            ) : !list ? (
              <T tone="muted">Loading…</T>
            ) : !all.length ? (
              <Card style={{ gap: 8 }}>
                <T variant="body" weight="medium">
                  No saved harnesses yet
                </T>
                <T variant="meta" tone="muted">
                  Save a driver, model, skills, rules and egress together, then pick it in the composer.
                </T>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button small title="New harness" onPress={() => router.push("/harness/new")} />
                  <Button small variant="outline" title="Import a bundle" onPress={() => setImporting(true)} />
                </View>
              </Card>
            ) : (
              all.map((h, i) => (
                <FadeInUp key={h.id} delay={stagger(i)}>
                  <HarnessRow
                    h={h}
                    skills={skills}
                    onEdit={() => edit(h)}
                    onDuplicate={() => void mutate({ action: "duplicate", id: h.id }, "Duplicated")}
                    onExport={() => void exportOne(h)}
                    onDelete={() => mutate({ action: "delete", id: h.id }, "Deleted")}
                    onApprove={() => mutate({ action: "approve", id: h.id }, `${h.name} can run now`)}
                  />
                </FadeInUp>
              ))
            )}
          </Section>
          <Card>
            <T variant="micro" tone="muted">
              Rules and RULES.md go to the agent as system-prompt instructions for the whole thread — your task text stays as you typed it. Verify on done is enforced: the controller runs the check. Executable hooks are never installed from a bundle (an imported <T variant="micro" mono>hooks/</T> folder is ignored); the PR-only push guard and the supervision gate are built in and apply to every harness.
            </T>
          </Card>
          <Section
            title="Compare"
            purpose="Run one task on two harnesses: two ordinary runs, side by side. Only what the runs reported is shown."
            action={runnable.length >= 2 && !comparing ? <Button small variant="outline" title="New compare" onPress={() => setComparing(true)} /> : null}
          >
            {comparing ? (
              <CompareLauncher
                harnesses={runnable}
                onCancel={() => setComparing(false)}
                onStarted={(note) => {
                  setInfo(note);
                  setComparing(false);
                  setCompareRefresh((n) => n + 1);
                }}
              />
            ) : null}
            <CompareList refresh={compareRefresh} canStart={runnable.length >= 2} />
          </Section>
          <Section title="Attempts" purpose="Tasks run several ways in parallel. The best attempt gets the PR; you can pick another one instead.">
            <AttemptGroupList />
          </Section>
        </>
      ) : null}
    </SettingsScreen>
  );
}

function Section({ title, meta, purpose, action, children }: { title: string; meta?: string; purpose: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <T variant="h3" weight="semibold">
          {title}
        </T>
        {meta ? (
          <T variant="micro" tone="faint">
            {meta}
          </T>
        ) : null}
        <View style={{ flex: 1 }} />
        {action}
      </View>
      <T variant="meta" tone="muted">
        {purpose}
      </T>
      {children}
    </View>
  );
}

function HarnessRow({
  h,
  skills,
  onEdit,
  onDuplicate,
  onExport,
  onDelete,
  onApprove,
}: {
  h: HarnessView;
  skills: SkillView[];
  onEdit: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => Promise<void>;
  onApprove: () => Promise<void>;
}) {
  const { palette } = useTheme();
  const [reviewOpen, setReviewOpen] = useState(false);
  const facts = [
    h.driver ?? "default driver",
    h.provider ? `${h.provider.label}${h.model ? ` · ${h.model}` : ""}` : (h.model ?? null),
    h.skills?.length ? `${h.skills.length} skill${h.skills.length === 1 ? "" : "s"}` : null,
    rulesLine(h.rules),
    h.rulesMd ? "RULES.md" : null,
    h.verifyCommand ? `verify: ${h.verifyCommand}` : null,
    h.egress?.length ? `egress: ${h.egress.join(", ")}` : null,
  ].filter(Boolean);
  const when =
    h.origin?.kind === "duplicate"
      ? `Copied from ${h.origin.source ?? "a harness"} `
      : h.origin
        ? `Imported ${h.origin.source ? `from ${h.origin.source} ` : "from a file "}`
        : h.builtin && h.updatedAt === h.createdAt
          ? "Added "
          : "Updated ";
  return (
    <Card style={h.needsReview ? { borderColor: palette.attention } : undefined}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <T variant="body" weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
          {h.name}
        </T>
        {h.builtin ? (
          <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, paddingHorizontal: 6 }}>
            <T variant="micro" tone="muted">
              built-in
            </T>
          </View>
        ) : null}
        {h.needsReview ? (
          <View style={{ backgroundColor: palette.attention, borderRadius: radius.sm, paddingHorizontal: 6 }}>
            <T variant="micro" weight="medium" style={{ color: palette.attentionInk }}>
              needs review
            </T>
          </View>
        ) : null}
        {h.providerMissing ? (
          <T variant="micro" tone="destructive">
            provider removed
          </T>
        ) : null}
      </View>
      {h.description ? (
        <T variant="micro" tone="muted" numberOfLines={1}>
          {h.description}
        </T>
      ) : null}
      <T variant="micro" tone="muted" numberOfLines={2}>
        {facts.join(" · ")}
      </T>
      <T variant="micro" tone="faint">
        {`${when}${ago(h.origin?.at ?? h.updatedAt)}`}
      </T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {h.needsReview ? (
          <Button small variant="attention" title={reviewOpen ? "Hide review" : "Review"} onPress={() => (animateLayout(), setReviewOpen((v) => !v))} />
        ) : (
          <Button small variant="ghost" title="Edit" onPress={onEdit} />
        )}
        <Button small variant="ghost" title="Duplicate" onPress={onDuplicate} />
        <Button small variant="ghost" title="Export" onPress={onExport} />
        <ArmButton small variant="ghost" title="Delete" armedTitle="Delete" onConfirm={onDelete} />
      </View>
      {h.needsReview && reviewOpen ? <ReviewPanel h={h} skills={skills} onApprove={onApprove} onEdit={onEdit} /> : null}
    </Card>
  );
}
