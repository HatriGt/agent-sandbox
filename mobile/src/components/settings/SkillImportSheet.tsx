// Import a skill — ported from web/src/components/skills/ImportDialog.tsx: GitHub (browse a repo,
// pick, preview, import) and Paste markdown. One pick opens in the editor for review; several save
// straight in, enabled. Upload is not offered: picking files needs a native document picker.
import React, { useEffect, useMemo, useState } from "react";
import { Alert, TextInput, View } from "react-native";
import { PressScale } from "@/components/motion";
import { api } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { Segmented } from "./Segmented";
import { fetchRepoFile, fetchRepoSkill, listRepoSkills, parseRepoInput, parseSkillMd, type RepoRef, type RepoSkillEntry } from "./skillImport";
import { type Draft, fmtBundle } from "./SkillModel";
import { Skeleton } from "@/components/motion";

/** Public repos that actually carry skills in the SKILL.md format — a starting point, not a store. */
const FEATURED_REPOS = [
  { repo: "anthropics/skills", blurb: "Anthropic's own collection — documents, design, research" },
  { repo: "anthropics/claude-code", blurb: "Skills shipped with Claude Code" },
];

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SkillImportSheet({
  visible,
  presetRepo,
  existing,
  onClose,
  onImported,
  onEditOne,
}: {
  visible: boolean;
  /** Open straight onto a repository's listing (the library's curated teaser). */
  presetRepo?: string;
  existing: Record<string, true>;
  onClose: () => void;
  onImported: (count: number) => void | Promise<void>;
  onEditOne: (d: Draft) => void;
}) {
  const [source, setSource] = useState<"github" | "paste">("github");
  useEffect(() => {
    if (!visible) setSource("github");
  }, [visible]);
  return (
    <Sheet visible={visible} onClose={onClose} title="Import a skill">
      <View style={{ gap: 12, paddingBottom: 8 }}>
        <T variant="meta" tone="muted">
          Skill folders come in whole — SKILL.md plus scripts and docs. You review before anything goes live.
        </T>
        <Segmented
          value={source}
          onChange={setSource}
          options={[
            { value: "github", label: "GitHub" },
            { value: "paste", label: "Paste markdown" },
          ]}
        />
        {visible && source === "github" ? <GitHubStep existing={existing} onClose={onClose} onImported={onImported} onEditOne={onEditOne} preset={presetRepo} /> : null}
        {visible && source === "paste" ? <PasteStep onEditOne={onEditOne} /> : null}
      </View>
    </Sheet>
  );
}

/** What the import will become — name, description, files, the first lines. */
function SkillPreview({ draft, files, existing, loading }: { draft: Draft | null; files?: number; existing?: boolean; loading?: boolean }) {
  const { palette } = useTheme();
  if (!draft && !loading) return null;
  const lines = draft ? draft.content.split("\n").filter((l) => l.trim()) : [];
  return (
    <View style={{ backgroundColor: palette.muted, borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          {loading || !draft ? (
            <>
              <Skeleton width={110} height={12} />
              <Skeleton width={200} height={10} />
            </>
          ) : (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <T variant="meta" weight="medium" mono numberOfLines={1} style={{ flexShrink: 1 }}>
                  /{draft.name}
                </T>
                {existing ? (
                  <T variant="micro" weight="medium" tone="attention">
                    replaces yours
                  </T>
                ) : null}
              </View>
              <T variant="meta" tone="muted" numberOfLines={1}>
                {draft.description}
              </T>
            </>
          )}
        </View>
        {!loading && (files ?? 0) > 0 ? (
          <T variant="micro" tone="faint">
            {(files ?? 0) + 1} files
          </T>
        ) : null}
      </View>
      {!loading && lines.length > 0 ? (
        <T variant="micro" mono tone="muted" style={{ borderTopWidth: 1, borderTopColor: palette.border, paddingHorizontal: 12, paddingVertical: 8 }}>
          {lines.slice(0, 4).join("\n")}
          {lines.length > 4 ? "\n…" : ""}
        </T>
      ) : null}
    </View>
  );
}

function PasteStep({ onEditOne }: { onEditOne: (d: Draft) => void }) {
  const { palette } = useTheme();
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseSkillMd(text, "pasted-skill") : null;
  return (
    <View style={{ gap: 10 }}>
      <TextInput
        multiline
        autoFocus
        value={text}
        onChangeText={setText}
        accessibilityLabel="Markdown"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        textAlignVertical="top"
        placeholder={"---\nname: review-pr\ndescription: Use when asked to review a pull request.\n---\n\n1. Read every changed file…"}
        placeholderTextColor={palette.faint}
        style={{ minHeight: parsed ? 150 : 210, borderWidth: 1, borderColor: palette.input, borderRadius: radius.lg, padding: 12, backgroundColor: palette.card, color: palette.foreground, fontFamily: fonts.mono, fontSize: type.code.fontSize, lineHeight: type.code.lineHeight }}
      />
      <T variant="micro" tone="faint">
        Frontmatter (name, description) is read when present; otherwise the first heading and paragraph are used. You can fix anything in the editor.
      </T>
      <SkillPreview draft={parsed} />
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Button small title="Review in editor" disabled={!parsed} onPress={() => parsed && onEditOne(parsed)} />
      </View>
    </View>
  );
}

type Found = { ref: RepoRef; branch: string; entries: RepoSkillEntry[]; authed: boolean };

/**
 * Browse a GitHub repository for skills and pull them in. The controller does the fetching — with a
 * saved GitHub token when one covers the repo, so private repositories work too.
 */
function GitHubStep({ existing, onClose, onImported, onEditOne, preset }: { existing: Record<string, true>; onClose: () => void; onImported: (count: number) => void | Promise<void>; onEditOne: (d: Draft) => void; preset?: string }) {
  const { palette } = useTheme();
  const [input, setInput] = useState(preset ?? "");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [picked, setPicked] = useState<Record<string, true>>({});
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{ path: string; draft: Draft | null; loading: boolean } | null>(null);
  const pickedPaths = useMemo(() => Object.keys(picked), [picked]);
  const pickedCount = pickedPaths.length;

  const loadDraft = async (f: RepoSkillEntry, at: Found): Promise<Draft> => {
    if (f.kind === "dir") {
      const r = await fetchRepoSkill(at.ref, at.branch, f.path);
      if (r.skipped.length) Alert.alert(`/${f.name}: ${r.skipped.length} file${r.skipped.length === 1 ? "" : "s"} skipped`, r.skipped.slice(0, 5).join(", "));
      return { ...parseSkillMd(r.skillMd, f.name), files: r.files };
    }
    return parseSkillMd(await fetchRepoFile(at.ref, at.branch, f.path), f.name);
  };

  const browse = async (raw: string) => {
    setErr(null);
    setFound(null);
    setPicked({});
    setLoading(true);
    try {
      const ref = parseRepoInput(raw);
      const r = await listRepoSkills(ref);
      if (!r.entries.length) setErr("No skills here — the repo has no SKILL.md folders or skills/ markdown.");
      else setFound({ ref, ...r });
    } catch (e) {
      setErr(msg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (preset) void browse(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Exactly one picked → fetch and show what it will become.
  useEffect(() => {
    if (!found || pickedCount !== 1) {
      setPreview(null);
      return;
    }
    const path = pickedPaths[0];
    const entry = found.entries.find((e) => e.path === path);
    if (!entry) return;
    let alive = true;
    setPreview({ path, draft: null, loading: true });
    loadDraft(entry, found)
      .then((d) => alive && setPreview({ path, draft: d, loading: false }))
      .catch((e: unknown) => {
        if (!alive) return;
        setPreview(null);
        setErr(msg(e));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, pickedCount, pickedPaths[0]]);

  const doImport = async () => {
    if (!found || !pickedCount) return;
    setImporting(true);
    try {
      if (pickedCount === 1 && preview?.draft) return onEditOne(preview.draft);
      const entries = found.entries.filter((f) => picked[f.path]);
      const drafts = await Promise.all(entries.map((f) => loadDraft(f, found)));
      if (drafts.length === 1) return onEditOne(drafts[0]);
      let saved = 0;
      const failed: string[] = [];
      for (const d of drafts) {
        try {
          await api.skillMutate({ action: "upsert", skill: { ...d, enabled: true } });
          saved++;
        } catch (e) {
          failed.push(`Could not import /${d.name}: ${msg(e)}`);
        }
      }
      if (failed.length) Alert.alert("Some skills did not import", failed.join("\n"));
      if (saved) await onImported(saved);
      onClose();
    } catch (e) {
      setErr(msg(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field
            mono
            value={input}
            onChangeText={setInput}
            placeholder="owner/repo, or paste a github.com URL to a skill folder"
            accessibilityLabel="Repository"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            autoFocus={!preset}
            returnKeyType="search"
            onSubmitEditing={() => input.trim() && void browse(input)}
          />
        </View>
        <Button variant="outline" title="Browse" loading={loading} disabled={!input.trim() || loading} onPress={() => void browse(input)} />
      </View>

      {!found && !loading && !err ? (
        <View style={{ gap: 8 }}>
          <T variant="micro" weight="medium" tone="muted" style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
            Curated
          </T>
          {FEATURED_REPOS.map((f) => (
            <PressScale
              key={f.repo}
              onPress={() => {
                setInput(f.repo);
                void browse(f.repo);
              }}
              accessibilityRole="button"
              style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, padding: 12 }}
            >
              <Icon name="github" size={16} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="meta" weight="medium" mono numberOfLines={1}>
                  {f.repo}
                </T>
                <T variant="micro" tone="muted">
                  {f.blurb}
                </T>
              </View>
            </PressScale>
          ))}
          <T variant="micro" tone="faint">
            Private repositories work through a connected GitHub account (Integrations).
          </T>
        </View>
      ) : null}

      {loading ? (
        <View style={{ gap: 10 }} accessibilityState={{ busy: true }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ gap: 6 }}>
              <Skeleton width={120} height={12} />
              <Skeleton width={180} height={10} />
            </View>
          ))}
        </View>
      ) : null}

      {err ? (
        <T variant="meta" tone="destructive" accessibilityRole="alert">
          {err}
        </T>
      ) : null}

      {found ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <T variant="micro" tone="muted" numberOfLines={2} style={{ flex: 1 }}>
              <T variant="micro" mono>
                {found.ref.owner}/{found.ref.repo}
              </T>{" "}
              @ {found.branch} · {found.entries.length} found
              {found.authed ? " · via your saved GitHub token" : ""}
            </T>
            <PressScale haptic="selection" onPress={() => setPicked(pickedCount === found.entries.length ? {} : Object.fromEntries(found.entries.map((f) => [f.path, true as const])))} hitSlop={8} accessibilityRole="button">
              <T variant="meta" weight="medium" tone="live">
                {pickedCount === found.entries.length ? "Clear" : "Select all"}
              </T>
            </PressScale>
          </View>
          <View accessibilityLabel="Skills found" style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, overflow: "hidden" }}>
            {found.entries.map((f, i) => {
              const on = !!picked[f.path];
              return (
                <PressScale
                  key={f.path}
                  haptic="selection"
                  onPress={() =>
                    setPicked((p) => {
                      const n = { ...p };
                      if (n[f.path]) delete n[f.path];
                      else n[f.path] = true;
                      return n;
                    })
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: palette.border, backgroundColor: on ? palette.accent : "transparent" }}
                >
                  <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: on ? palette.live : palette.lineStrong, backgroundColor: on ? palette.live : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {on ? <Icon name="check" size={12} color={palette.primaryForeground} /> : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T variant="meta" weight="medium" mono numberOfLines={1}>
                      /{f.name}
                    </T>
                    <T variant="micro" tone="faint" numberOfLines={1}>
                      {f.path || "(repository root)"}
                    </T>
                  </View>
                  {f.kind === "dir" && f.fileCount > 1 ? (
                    <T variant="micro" tone="muted">
                      {fmtBundle(f.fileCount, f.totalBytes)}
                    </T>
                  ) : null}
                  {existing[f.name] ? (
                    <T variant="micro" tone="attention">
                      replaces yours
                    </T>
                  ) : null}
                </PressScale>
              );
            })}
          </View>
          {pickedCount === 1 && preview ? <SkillPreview draft={preview.draft} loading={preview.loading} files={preview.draft?.files?.length} existing={!!preview.draft && !!existing[preview.draft.name]} /> : null}
          <T variant="micro" tone="faint">
            {pickedCount === 1 ? "Opens in the editor for review before it goes live." : pickedCount > 1 ? "Saved straight in, enabled." : "Pick one to preview it, or several to import at once."}
          </T>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Button small variant="ghost" title="Cancel" onPress={onClose} />
            <Button
              small
              title={pickedCount === 1 ? "Review in editor" : pickedCount ? `Import ${pickedCount}` : "Import"}
              loading={importing}
              disabled={!pickedCount || importing || (pickedCount === 1 && !!preview?.loading)}
              onPress={() => void doImport()}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}
