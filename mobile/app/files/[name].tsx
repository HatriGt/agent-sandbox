// Workspace browser + editor for one box (web: the explorer + code editor). Folders are derived from
// /tree.json's flat paths; a text file opens in a plain monospace editor and saves via PUT /file.json.
// Commit and push stay where they already live: the thread's Changes sheet.
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { api } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const MAX_EDIT = 400_000;

export default function Files() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const session = decodeURIComponent(name ?? "");
  const { palette } = useTheme();
  const [files, setFiles] = useState<string[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [dir, setDir] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ path: string; text: string; original: string } | null>(null);
  const [loadingFile, setLoadingFile] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .tree(session)
      .then((r) => {
        setFiles(r.files);
        setTruncated(r.truncated);
      })
      .catch((e) => setError(msg(e)));
  }, [session]);

  const entries = useMemo(() => {
    if (!files) return [];
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      return files.filter((f) => f.toLowerCase().includes(n)).slice(0, 200).map((f) => ({ name: f, path: f, folder: false }));
    }
    const prefix = dir ? `${dir}/` : "";
    const folders = new Set<string>();
    const out: { name: string; path: string; folder: boolean }[] = [];
    for (const f of files) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash >= 0) folders.add(rest.slice(0, slash));
      else out.push({ name: rest, path: f, folder: false });
    }
    return [...[...folders].sort().map((d) => ({ name: d, path: prefix + d, folder: true })), ...out.sort((a, b) => a.name.localeCompare(b.name))];
  }, [files, dir, q]);

  const openFile = async (path: string) => {
    setLoadingFile(path);
    setError(null);
    setSaved(false);
    try {
      const text = await api.fileText(session, path);
      if (text.length > MAX_EDIT || text.includes("\u0000")) {
        setError("That file is too large or not text — open it on the web.");
        return;
      }
      setOpen({ path, text, original: text });
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoadingFile(null);
    }
  };

  const save = async () => {
    if (!open) return;
    setSaving(true);
    setError(null);
    try {
      await api.writeFile(session, open.path, open.text);
      setOpen({ ...open, original: open.text });
      setSaved(true);
    } catch (e) {
      setError(msg(e));
    } finally {
      setSaving(false);
    }
  };

  if (open) {
    const dirty = open.text !== open.original;
    return (
      <SettingsScreen title={open.path.split("/").pop() ?? open.path}>
        <T variant="micro" mono tone="faint" numberOfLines={2}>
          {open.path}
        </T>
        <Field mono value={open.text} onChangeText={(t) => setOpen({ ...open, text: t })} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} style={{ minHeight: 360, textAlignVertical: "top", fontSize: 12 }} />
        {error ? (
          <T variant="meta" tone="destructive">
            {error}
          </T>
        ) : null}
        {saved && !dirty ? (
          <T variant="micro" tone="ok">
            Saved to the workspace. Commit it from the thread's Changes sheet.
          </T>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="Save" loading={saving} disabled={!dirty} onPress={() => void save()} />
          <Button variant="ghost" title={dirty ? "Discard" : "Close"} onPress={() => setOpen(null)} />
        </View>
      </SettingsScreen>
    );
  }

  return (
    <SettingsScreen title="Files">
      <Field value={q} onChangeText={setQ} placeholder="Find a file" autoCapitalize="none" autoCorrect={false} />
      {!q.trim() && dir ? (
        <Pressable onPress={() => setDir(dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "")} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}>
          <Icon name="corner-left-up" size={14} color={palette.mutedForeground} />
          <T variant="meta" mono tone="muted" numberOfLines={1}>
            /{dir}
          </T>
        </Pressable>
      ) : null}
      {error ? (
        <T variant="meta" tone="destructive">
          {error}
        </T>
      ) : null}
      {files === null && !error ? <T tone="muted">Loading…</T> : null}
      {files && entries.length === 0 ? <T tone="muted">{q.trim() ? "No matches." : "Empty."}</T> : null}
      <View>
        {entries.map((e) => (
          <Pressable
            key={e.path}
            onPress={() => (e.folder ? setDir(e.path) : void openFile(e.path))}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: palette.border, opacity: pressed || loadingFile === e.path ? 0.5 : 1 })}
          >
            <Icon name={e.folder ? "folder" : "file-text"} size={15} color={e.folder ? palette.foreground : palette.mutedForeground} />
            <T variant="body" mono={!e.folder} numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
              {e.name}
            </T>
            {e.folder ? <Icon name="chevron-right" size={14} color={palette.faint} /> : null}
          </Pressable>
        ))}
      </View>
      {truncated ? (
        <T variant="micro" tone="faint">
          Large workspace — not every file is listed. Use Find.
        </T>
      ) : null}
    </SettingsScreen>
  );
}
