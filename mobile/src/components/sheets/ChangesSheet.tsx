import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { api, type ChangedFile, type FileDiff } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { DiffText, splitUnifiedDiff, type DiffSection } from "../DiffText";
import { T } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

type Review = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; files: DiffSection[] };

/** Changed files → tap for the unified diff; commit + push per repo. */
export function ChangesSheet({
  session,
  repos,
  visible,
  onClose,
}: {
  session: string;
  repos: { name: string }[];
  visible: boolean;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // "Review all": the whole run's patch against HEAD, split per file. null = not open.
  const [review, setReview] = useState<Review | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDiff(null);
    setReview(null);
    setNote(null);
    api
      .changes(session)
      .then((r) => setFiles(r.files))
      .catch((e) => setNote(String(e.message ?? e)));
  }, [visible, session]);

  const openDiff = async (path: string) => {
    setBusy(path);
    try {
      setDiff(await api.diff(session, path));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const openReview = async () => {
    setReview({ state: "loading" });
    try {
      const r = await api.runDiff(session);
      setReview({ state: "ready", files: splitUnifiedDiff(r.diff) });
    } catch (e) {
      setReview({ state: "error", message: e instanceof Error ? e.message : "Could not load the diff." });
    }
  };

  const run = async (action: "commit" | "push", repo: string) => {
    setBusy(action);
    setNote(null);
    try {
      if (action === "commit") {
        const r = await api.gitCommit(session, repo, message.trim() || "Changes from Agent Sandbox");
        setNote(`Committed ${r.sha.slice(0, 7)} — ${r.summary}`);
        setMessage("");
      } else {
        await api.gitPush(session, repo);
        setNote(`Pushed ${repo}.`);
      }
      const refreshed = await api.changes(session);
      setFiles(refreshed.files);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={diff ? () => setDiff(null) : review ? () => setReview(null) : onClose}
      title={diff ? diff.path.split("/").pop()! : review ? "Review changes" : "Changes"}
    >
      {review ? (
        <View style={{ gap: 10, paddingBottom: 12 }}>
          {review.state === "loading" ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}>
              <ActivityIndicator size="small" color={palette.mutedForeground} />
              <T tone="muted">Loading the diff…</T>
            </View>
          ) : review.state === "error" ? (
            <T tone="destructive">{review.message}</T>
          ) : review.files.length === 0 ? (
            <T tone="muted">No changes against HEAD.</T>
          ) : (
            <>
              <T variant="micro" tone="faint" mono>
                {review.files.length} {review.files.length === 1 ? "file" : "files"}
              </T>
              {review.files.map((f) => (
                <ReviewFile key={f.path} section={f} defaultOpen={review.files.length <= 3} />
              ))}
            </>
          )}
          <Button title="Back to files" variant="secondary" onPress={() => setReview(null)} />
        </View>
      ) : diff ? (
        <View style={{ gap: 10, paddingBottom: 12 }}>
          <T variant="micro" mono tone="faint" numberOfLines={2}>
            {diff.path}
            {diff.untracked ? " · untracked" : ""}
          </T>
          {diff.binary ? <T tone="muted">Binary file.</T> : <DiffText diff={diff.diff} />}
          <Button title="Back to files" variant="secondary" onPress={() => setDiff(null)} />
        </View>
      ) : (
        <View style={{ gap: 8, paddingBottom: 12 }}>
          {note ? <T variant="meta" tone="muted">{note}</T> : null}
          {files === null ? (
            <T tone="muted">Loading…</T>
          ) : files.length === 0 ? (
            <T tone="muted">No uncommitted changes.</T>
          ) : (
            <>
              <Pressable
                onPress={openReview}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderColor: palette.border,
                  borderRadius: radius.lg,
                  backgroundColor: palette.card,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Icon name="git-pull-request" size={14} color={palette.mutedForeground} />
                <T variant="meta" weight="medium" style={{ flex: 1 }}>
                  Review all
                </T>
                <T variant="micro" tone="faint">
                  whole run · {files.length} {files.length === 1 ? "file" : "files"}
                </T>
                <Icon name="chevron-right" size={14} color={palette.faint} />
              </Pressable>
              {files.map((f) => (
              <Pressable
                key={f.path}
                onPress={() => openDiff(f.path)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: palette.border,
                  opacity: busy === f.path ? 0.5 : 1,
                }}
              >
                {/* Deep paths are long; the file name is the useful end, so clip the head. */}
                <T variant="code" mono numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, minWidth: 0 }}>
                  {f.path}
                </T>
                <T variant="micro" mono tone="ok" style={{ flexShrink: 0 }}>
                  +{f.additions}
                </T>
                <T variant="micro" mono tone="destructive" style={{ flexShrink: 0 }}>
                  −{f.deletions}
                </T>
              </Pressable>
              ))}
            </>
          )}
          {files && files.length > 0 && (
            <View style={{ gap: 8, marginTop: 8 }}>
              <Field placeholder="Commit message" value={message} onChangeText={setMessage} />
              {repos.map((r) => (
                <View key={r.name} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <T variant="meta" mono tone="muted" style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
                    {r.name}
                  </T>
                  <Button title="Commit" small variant="secondary" loading={busy === "commit"} onPress={() => run("commit", r.name)} />
                  <Button title="Push" small loading={busy === "push"} onPress={() => run("push", r.name)} />
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </Sheet>
  );
}

/** One file of the whole-run patch: a tappable header (path, +/−) over a folded DiffText. */
function ReviewFile({ section, defaultOpen }: { section: DiffSection; defaultOpen: boolean }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  const lines = section.diff.split("\n");
  const adds = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const dels = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  const binary = /^Binary files/m.test(section.diff);
  return (
    <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, backgroundColor: palette.card, overflow: "hidden" }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, paddingHorizontal: 10, opacity: pressed ? 0.7 : 1 })}
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={13} color={palette.faint} />
        <T variant="code" mono numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, minWidth: 0 }}>
          {section.path}
        </T>
        <T variant="micro" mono tone="ok" style={{ flexShrink: 0 }}>
          +{adds}
        </T>
        <T variant="micro" mono tone="destructive" style={{ flexShrink: 0 }}>
          −{dels}
        </T>
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 6, paddingBottom: 6 }}>
          {binary ? <T variant="meta" tone="muted" style={{ padding: 6 }}>Binary file.</T> : <DiffText diff={section.diff} maxLines={300} />}
        </View>
      ) : null}
    </View>
  );
}
