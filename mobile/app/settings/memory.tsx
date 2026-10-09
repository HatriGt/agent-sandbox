// Memory across runs (web: components/Memory.tsx). Header: Add · Export · Import · On. Then the
// "Waiting for you" review strip, kind filters + search, the section rail (You, one per repo,
// Any repo, Earlier) and the open section. The overview graph stays on web.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Share, View } from "react-native";
import { useRouter } from "expo-router";
import { ApiError, api, type MemoryKind, type MemoryNote, type MemoryNotesResponse } from "@/lib/api";
import { plural } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Toggle } from "@/components/ui/Toggle";
import { EarlierNoteRow, MemoryChip, MemoryNoteRow, type NoteActions } from "@/components/settings/MemoryNoteRow";
import { Segmented } from "@/components/settings/Segmented";
import { KINDS, KIND_PLURAL, isOperatorKind } from "@/components/settings/memoryKinds";
import { animateLayout, FadeIn, FadeInUp, stagger } from "@/components/motion";
import { SettingsSection } from "@/components/ui/SettingsSection";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const REPO_KINDS: MemoryKind[] = ["domain", "decision", "lesson", "fact", "playbook"];
const repoOrder = (a: string, b: string) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b));

type AreaGroup = { area: string; notes: MemoryNote[]; paths: string[]; links: string[]; stale: number };
function areaGroups(list: MemoryNote[]): AreaGroup[] {
  const by = new Map<string, MemoryNote[]>();
  for (const n of list) by.set(n.area ?? "", [...(by.get(n.area ?? "") ?? []), n]);
  const uniq = (xs: string[]) => [...new Set(xs)];
  return [...by.entries()]
    .map(([area, notes]) => ({ area, notes, paths: uniq(notes.flatMap((n) => n.paths ?? [])), links: uniq(notes.flatMap((n) => n.links ?? [])).filter((l) => l !== area), stale: notes.filter((n) => n.stale).length }))
    .sort((a, b) => (a.area === "" ? 1 : b.area === "" ? -1 : b.notes.length - a.notes.length || a.area.localeCompare(b.area)));
}

export default function MemoryPage() {
  const router = useRouter();
  const { palette } = useTheme();
  const [data, setData] = useState<MemoryNotesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ text: string; skills?: boolean } | null>(null);
  const [composing, setComposing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [viewSel, setViewSel] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<MemoryKind | "all">("all");
  const [query, setQuery] = useState("");
  const [areaSel, setAreaSel] = useState<string | null>(null);
  const notes = data?.notes ?? null;

  const load = useCallback(async () => {
    try {
      setData(await api.memoryNotes());
      setError(null);
    } catch (e) {
      setError(msg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const apply = async (p: Promise<MemoryNotesResponse>, ok?: string) => {
    setData(await p);
    if (ok) setInfo({ text: ok });
  };

  const model = useMemo(() => {
    const all = notes ?? [];
    const byId = new Map(all.map((n) => [n.id, n]));
    const q = query.trim().toLowerCase();
    const matches = (n: MemoryNote) =>
      (kindFilter === "all" || n.kind === kindFilter) &&
      (!q || (q.startsWith("area:") ? (n.area ?? "").includes(q.slice(5).trim()) : `${n.text} ${n.why ?? ""} ${n.repo ?? ""} ${n.area ?? ""} ${(n.paths ?? []).join(" ")}`.toLowerCase().includes(q)));
    const liveAll = all.filter((n) => n.until == null);
    const counts = Object.fromEntries(KINDS.map((k) => [k, liveAll.filter((n) => n.kind === k).length])) as Record<MemoryKind, number>;
    const pending = liveAll.filter((n) => n.status === "pending").sort((a, b) => a.at - b.at);
    const live = liveAll.filter((n) => n.status !== "pending" && matches(n)).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at);
    const earlier = all.filter((n) => n.until != null && matches(n)).sort((a, b) => (b.until ?? 0) - (a.until ?? 0));
    const you = live.filter((n) => isOperatorKind(n.kind));
    const byRepo = new Map<string, MemoryNote[]>();
    for (const n of live) {
      if (isOperatorKind(n.kind)) continue;
      byRepo.set(n.repo ?? "", [...(byRepo.get(n.repo ?? "") ?? []), n]);
    }
    const replacedBy = new Map<string, MemoryNote>();
    for (const n of all) if (n.supersedes && byId.has(n.supersedes)) replacedBy.set(n.supersedes, n);
    const filtering = kindFilter !== "all" || !!q;
    const settled = liveAll.filter((n) => !isOperatorKind(n.kind) && n.status !== "pending");
    const allRepos = [...new Set(settled.map((n) => n.repo ?? ""))].sort(repoOrder);
    const youTotal = liveAll.filter((n) => isOperatorKind(n.kind) && n.status !== "pending").length;
    const earlierTotal = all.filter((n) => n.until != null).length;
    const views: { key: string; label: string; total: number; count: number; repo?: string; groups?: AreaGroup[] }[] = [
      { key: "you", label: "You", total: youTotal, count: you.length },
      ...allRepos.map((repo) => ({ key: `repo:${repo}`, label: repo || "Any repo", repo, total: settled.filter((n) => (n.repo ?? "") === repo).length, count: byRepo.get(repo)?.length ?? 0, groups: areaGroups(byRepo.get(repo) ?? []) })),
      ...(earlierTotal ? [{ key: "earlier", label: "Earlier", total: earlierTotal, count: earlier.length }] : []),
    ];
    const firstRepo = allRepos.find((r) => r !== "");
    return { liveAll, counts, pending, you, earlier, replacedBy, filtering, views, defaultView: firstRepo != null ? `repo:${firstRepo}` : "you" };
  }, [notes, kindFilter, query]);
  const view = viewSel && model.views.some((v) => v.key === viewSel) ? viewSel : model.defaultView;
  const current = model.views.find((v) => v.key === view);

  const reveal = (key: string, area?: string) => {
    setQuery("");
    setKindFilter("all");
    setViewSel(key);
    setAreaSel(area ?? null);
  };

  const actions: NoteActions = {
    onKeep: (n) => apply(api.memoryNoteUpdate({ id: n.id, status: "kept" }), "Kept"),
    onPin: (n, pinned) => apply(api.memoryNoteUpdate({ id: n.id, pinned })),
    onVerify: (n) => apply(api.memoryNoteUpdate({ id: n.id, verified: true }), "Marked verified"),
    onDelete: (n) => apply(api.memoryNoteDelete(n.id), "Forgotten"),
    onSave: (n, patch) => apply(api.memoryNoteUpdate({ id: n.id, ...patch }), patch.repo !== undefined ? (patch.repo ? `Filed under ${patch.repo}` : "Moved out of its repo") : "Note updated"),
    onArea: (n, area) => reveal(`repo:${n.repo ?? ""}`, area),
    onPromote: async (n) => {
      try {
        const r = await api.memoryPromote(n.id);
        setData({ enabled: r.enabled, notes: r.notes });
        setInfo({ text: `Skill "${r.skill.name}" drafted`, skills: true });
      } catch (e) {
        throw new Error(e instanceof ApiError && e.status === 409 ? "A skill with that name already exists" : msg(e));
      }
    },
  };

  const exportMd = async () => {
    try {
      await Share.share({ message: await api.memoryExport(), title: "memory.md" });
    } catch (e) {
      setError(`Could not export: ${msg(e)}`);
    }
  };

  const total = notes?.length ?? 0;
  const dim = !data?.enabled;

  return (
    <SettingsScreen title="Memory">
      <T variant="body" tone="muted">
        What your agents learned on earlier runs — your preferences, and a knowledge base per repo of how the product works, filed by area — handed to every new run as MEMORY.md.
      </T>
      {data ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Button small variant="outline" title="Add" onPress={() => setComposing((v) => !v)} />
          <Button small variant="ghost" title="Export" disabled={!total} onPress={() => void exportMd()} />
          <Button small variant="ghost" title="Import" onPress={() => setImporting(true)} />
          <View style={{ flex: 1 }} />
          <T variant="meta" tone={data.enabled ? "default" : "muted"}>
            On
          </T>
          <Toggle
            value={data.enabled}
            accessibilityLabel="Memory across runs"
            onValueChange={(on) => void apply(api.memoryNoteUpdate({ enabled: on }), on ? "Memory on" : "Memory off — runs start from scratch").catch((e) => setError(msg(e)))}
          />
        </View>
      ) : null}
      {error ? (
        <FadeIn>
          <T variant="meta" tone="destructive">
            {error}
          </T>
        </FadeIn>
      ) : null}
      {info ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T variant="meta" tone="muted" style={{ flex: 1 }}>
            {info.text}
          </T>
          {info.skills ? <Button small variant="ghost" title="Open" onPress={() => router.push("/settings/skills")} /> : null}
        </View>
      ) : null}

      {composing ? (
        <Composer
          onCancel={() => setComposing(false)}
          onAdd={async (add) => {
            await apply(api.memoryNoteAdd(add), "Added");
            setComposing(false);
          }}
        />
      ) : null}

      {notes === null ? (
        <T variant="meta" tone="faint">
          {error ? "Could not load memory" : "Loading…"}
        </T>
      ) : total === 0 ? (
        <T variant="meta" tone="muted">
          Nothing remembered yet. Runs propose notes as they work; add a preference or rule above.
        </T>
      ) : (
        <>
          {model.pending.length ? (
            <Card attention style={{ paddingTop: 10 }}>
              <T variant="body" weight="medium">
                Waiting for you <T tone="attention">· {model.pending.length}</T>
              </T>
              <T variant="micro" tone="muted">
                Proposed by runs — kept automatically unless you forget them.
              </T>
              {model.pending.map((n, i) => (
                <FadeInUp key={n.id} delay={stagger(i)}>
                  <MemoryNoteRow note={n} actions={actions} showRepo dim={dim} />
                </FadeInUp>
              ))}
            </Card>
          ) : null}

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} accessibilityLabel="Filter by kind">
            <MemoryChip label="All" count={model.liveAll.length} active={kindFilter === "all"} onPress={() => (animateLayout(), setKindFilter("all"))} />
            {KINDS.map((k) => (
              <MemoryChip key={k} label={KIND_PLURAL[k]} count={model.counts[k]} active={kindFilter === k} onPress={() => (animateLayout(), setKindFilter(kindFilter === k ? "all" : k))} />
            ))}
          </View>
          <Field value={query} onChangeText={setQuery} placeholder="Search notes · area:billing" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Search notes" clearButtonMode="while-editing" />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityLabel="Memory sections">
            {model.views.map((v) => (
              <MemoryChip key={v.key} label={v.label} count={model.filtering && v.count !== v.total ? `${v.count}/${v.total}` : v.total} active={v.key === view} onPress={() => (animateLayout(), setViewSel(v.key), setAreaSel(null))} />
            ))}
          </ScrollView>

          {view === "you" ? (
            <FadeIn key="you">
            <SettingsSection title="You" meta={plural(model.you.length, "note")} purpose="Preferences and rules — in every run's MEMORY.md, whatever the repo.">
              {model.you.length ? (
                <Card style={{ paddingTop: 0 }}>
                  {model.you.map((n, i) => (
                    <FadeInUp key={n.id} delay={stagger(i)}>
                      <MemoryNoteRow note={n} actions={actions} dim={dim} />
                    </FadeInUp>
                  ))}
                </Card>
              ) : (
                <T variant="meta" tone="muted">
                  {model.filtering ? "No preference or rule matches." : "No preferences yet — say how you like things done during a run, or add one above."}
                </T>
              )}
            </SettingsSection>
            </FadeIn>
          ) : null}

          {current?.groups ? (
            <FadeIn key={current.key}>
            <RepoSection
              repo={current.repo ?? ""}
              groups={current.groups}
              areaSel={areaSel}
              onArea={(a) => (animateLayout(), setAreaSel(areaSel === a ? null : a))}
              actions={actions}
              dim={dim}
            />
            </FadeIn>
          ) : null}

          {view === "earlier" ? (
            <FadeIn key="earlier">
            <SettingsSection title="Earlier" meta={plural(model.earlier.length, "replaced note")} purpose="Notes a newer one replaced — kept as history, out of MEMORY.md.">
              {model.earlier.length ? (
                <Card style={{ paddingTop: 0 }}>
                  {model.earlier.map((n, i) => (
                    <FadeInUp key={n.id} delay={stagger(i)}>
                      <EarlierNoteRow note={n} replacedBy={model.replacedBy.get(n.id)} onDelete={() => apply(api.memoryNoteDelete(n.id), "Forgotten").catch((e) => setError(msg(e)))} />
                    </FadeInUp>
                  ))}
                </Card>
              ) : (
                <T variant="meta" tone="muted">
                  No replaced note matches.
                </T>
              )}
            </SettingsSection>
            </FadeIn>
          ) : null}
        </>
      )}

      <ImportSheet
        visible={importing}
        onClose={() => setImporting(false)}
        onImport={async (markdown) => {
          const before = notes?.length ?? 0;
          const r = await api.memoryImport(markdown);
          setData(r);
          const added = Math.max(0, r.notes.length - before);
          setInfo({ text: added ? `Imported ${plural(added, "note")}` : "Nothing new to import" });
          setImporting(false);
        }}
      />
    </SettingsScreen>
  );
}


/** One repo's knowledge base: area chips, then each area page (header + notes by kind). */
function RepoSection({ repo, groups, areaSel, onArea, actions, dim }: { repo: string; groups: AreaGroup[]; areaSel: string | null; onArea: (a: string) => void; actions: NoteActions; dim: boolean }) {
  const { palette } = useTheme();
  const pages = groups.filter((g) => g.area);
  const list = groups.flatMap((g) => g.notes);
  const shown = areaSel && groups.some((g) => g.area === areaSel) ? groups.filter((g) => g.area === areaSel) : groups;
  return (
    <SettingsSection
      title={repo || "Any repo"}
      meta={pages.length ? `${plural(pages.length, "area")} · ${plural(list.length, "note")}` : plural(list.length, "note")}
      purpose={
        repo
          ? "Knowledge base — how this product works, by area. Runs read the areas a task is about and keep them current."
          : "Saved by runs that had no repo checked out, so they belong to no knowledge base. Edit a note and give it a repo to file it."
      }
    >
      {!list.length ? (
        <T variant="meta" tone="muted">
          No note here matches.
        </T>
      ) : (
        <>
          {pages.length > 1 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} accessibilityLabel={`Areas of ${repo || "any repo"}`}>
              {pages.map((g) => (
                <MemoryChip key={g.area} label={g.area} count={g.stale ? `${g.notes.length} · ${g.stale}?` : g.notes.length} active={areaSel === g.area} onPress={() => onArea(g.area)} />
              ))}
            </View>
          ) : null}
          {shown.map((g) => (
            <Card key={g.area || "unfiled"} style={{ paddingTop: 0, paddingHorizontal: 0, overflow: "hidden" }}>
              <View style={{ backgroundColor: palette.muted, paddingHorizontal: 16, paddingVertical: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: palette.border }}>
                <T variant="meta" weight="medium" tone={g.area ? "default" : "muted"}>
                  {g.area || "Not filed under an area"}
                  <T variant="micro" tone="faint">{`  ${plural(g.notes.length, "note")}`}</T>
                  {g.stale ? <T variant="micro" tone="muted">{` · ${g.stale} unverified`}</T> : null}
                </T>
                {g.paths.length ? (
                  <T variant="micro" tone="faint">
                    code <T variant="micro" mono tone="faint">{g.paths.slice(0, 5).join("  ")}</T>
                    {g.paths.length > 5 ? ` +${g.paths.length - 5}` : ""}
                  </T>
                ) : null}
                {g.links.length ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    <T variant="micro" tone="faint">
                      links
                    </T>
                    {g.links.map((l) => (
                      <T key={l} variant="micro" tone="faint" onPress={() => onArea(l)} style={{ textDecorationLine: "underline" }}>
                        {l}
                      </T>
                    ))}
                  </View>
                ) : null}
              </View>
              <View style={{ paddingHorizontal: 16 }}>
                {REPO_KINDS.map((kind) => {
                  const rows = g.notes.filter((n) => n.kind === kind);
                  if (!rows.length) return null;
                  return (
                    <View key={kind}>
                      {g.notes.length > 3 ? (
                        <T variant="micro" weight="medium" tone="faint" style={{ paddingTop: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          {`${KIND_PLURAL[kind]} · ${rows.length}`}
                        </T>
                      ) : null}
                      {rows.map((n, i) => (
                        <FadeInUp key={n.id} delay={stagger(i)}>
                          <MemoryNoteRow note={n} actions={actions} inArea={!!g.area} dim={dim} />
                        </FadeInUp>
                      ))}
                    </View>
                  );
                })}
              </View>
            </Card>
          ))}
        </>
      )}
    </SettingsSection>
  );
}

type AddBody = { kind: MemoryKind; text: string; repo?: string; area?: string; paths?: string; links?: string };

/** Add a preference, rule, or a piece of domain knowledge by hand (web: Memory.tsx › Composer). */
function Composer({ onAdd, onCancel }: { onAdd: (add: AddBody) => Promise<void>; onCancel: () => void }) {
  const [kind, setKind] = useState<"preference" | "rule" | "domain">("preference");
  const [text, setText] = useState("");
  const [repo, setRepo] = useState("");
  const [area, setArea] = useState("");
  const [paths, setPaths] = useState("");
  const [links, setLinks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const max = kind === "domain" ? 600 : 400;
  const ready = !!text.trim() && (kind !== "domain" || (!!repo.trim() && !!area.trim()));
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const t = text.trim();
      await onAdd(kind === "domain" ? { kind, text: t, repo: repo.trim(), area: area.trim(), paths: paths.trim() || undefined, links: links.trim() || undefined } : { kind, text: t });
      setText("");
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: 10 }}>
      <Segmented
        small
        value={kind}
        onChange={setKind}
        options={[
          { value: "preference", label: "Preference" },
          { value: "rule", label: "Rule" },
          { value: "domain", label: "Domain" },
        ]}
      />
      <T variant="micro" tone="muted">
        {kind === "preference"
          ? "Taste that follows you into every run — “reply short”, “always pnpm”."
          : kind === "rule"
            ? "A trigger and what to do — “when I say deploy, run the tests first”."
            : "An entity, a flow, a business rule — “annual plans are invoiced on the 1st”. Filed under an area so runs find it."}
      </T>
      {kind === "domain" ? (
        <>
          <Field value={repo} onChangeText={setRepo} placeholder="owner/repo" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Repo" />
          <Field value={area} onChangeText={setArea} placeholder="area · billing/invoicing" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Area" />
          <Field mono value={paths} onChangeText={setPaths} placeholder="code paths · src/billing/*, src/api/invoices.ts" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Code paths" />
          <Field value={links} onChangeText={setLinks} placeholder="related areas · orders/refunds" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Related areas" />
        </>
      ) : null}
      <Field
        value={text}
        onChangeText={setText}
        maxLength={max}
        multiline
        placeholder={kind === "preference" ? "Keep replies short; prefer pure SVG over chart libraries" : kind === "rule" ? "When I say “ship it”, run the tests and open a PR instead of pushing to main" : "A refund reopens the order for 24 hours; after that it needs a new order"}
        style={{ minHeight: 64, textAlignVertical: "top" }}
      />
      {err ? (
        <T variant="micro" tone="destructive">
          {err}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Button small title="Remember" loading={busy} disabled={!ready} onPress={() => void submit()} />
        <Button small variant="ghost" title="Cancel" onPress={onCancel} />
        <View style={{ flex: 1 }} />
        <T variant="micro" tone="faint">
          {text.length}/{max}
        </T>
      </View>
    </Card>
  );
}

/** Import: no file picker on mobile, so the Markdown export is pasted (same POST /memory-import.json). */
function ImportSheet({ visible, onClose, onImport }: { visible: boolean; onClose: () => void; onImport: (markdown: string) => Promise<void> }) {
  const [md, setMd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet visible={visible} onClose={onClose} title="Import">
      <View style={{ gap: 10 }}>
        <T variant="meta" tone="muted">
          Add notes from a Markdown export.
        </T>
        <Field mono value={md} onChangeText={setMd} multiline placeholder="Paste memory.md" autoCapitalize="none" autoCorrect={false} style={{ minHeight: 160, textAlignVertical: "top" }} />
        {err ? (
          <T variant="micro" tone="destructive">
            {`Could not import: ${err}`}
          </T>
        ) : null}
        <Button
          title="Import"
          loading={busy}
          disabled={!md.trim()}
          onPress={async () => {
            setBusy(true);
            setErr(null);
            try {
              await onImport(md);
              setMd("");
            } catch (e) {
              setErr(msg(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
    </Sheet>
  );
}
