import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { api, type ChangedFile, type FileDiff } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { DiffText } from "../DiffText";
import { T } from "../ui/AppText";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Sheet } from "../ui/Sheet";

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

  useEffect(() => {
    if (!visible) return;
    setDiff(null);
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
    <Sheet visible={visible} onClose={diff ? () => setDiff(null) : onClose} title={diff ? diff.path.split("/").pop()! : "Changes"}>
      {diff ? (
        <View style={{ gap: 10, paddingBottom: 12 }}>
          <T variant="micro" mono tone="faint">
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
            files.map((f) => (
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
                <T variant="code" mono numberOfLines={1} style={{ flex: 1 }}>
                  {f.path}
                </T>
                <T variant="micro" mono tone="ok">
                  +{f.additions}
                </T>
                <T variant="micro" mono tone="destructive">
                  −{f.deletions}
                </T>
              </Pressable>
            ))
          )}
          {files && files.length > 0 && (
            <View style={{ gap: 8, marginTop: 8 }}>
              <Field placeholder="Commit message" value={message} onChangeText={setMessage} />
              {repos.map((r) => (
                <View key={r.name} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <T variant="meta" mono tone="muted" style={{ flex: 1 }} numberOfLines={1}>
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
