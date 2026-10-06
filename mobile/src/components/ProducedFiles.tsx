import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, View } from "react-native";
import { api, ApiError } from "@/lib/api";
import type { ProducedFile } from "@/lib/trace";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { MarkdownLite } from "./MarkdownLite";
import { T } from "./ui/AppText";
import { Button } from "./ui/Button";
import { Icon, type IconName } from "./ui/Icon";
import { Sheet } from "./ui/Sheet";
import { FadeInUp, PressScale } from "@/components/motion";

/**
 * The files the agent produced this run, as a row of artifact cards (mirrors
 * web/src/components/thread/ProducedFiles.tsx). Each card: extension glyph, name, View (a sheet
 * that fetches the text through /artifact — markdown rendered, everything else monospace) and Share
 * (the OS share sheet with the file's text; `expo-sharing` / `expo-file-system` are not in the app,
 * so binary files are not shareable from here). A torn-down box 404s and the sheet says so calmly.
 */
export function ProducedFiles({ session, files }: { session: string; files: ProducedFile[] }) {
  const { palette } = useTheme();
  const [viewing, setViewing] = useState<ProducedFile | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  if (files.length === 0) return null;

  const share = async (f: ProducedFile) => {
    if (!isTextLike(f.name)) {
      setShareNote(`${f.name} is not a text file — open it on the web console to download.`);
      return;
    }
    setSharing(f.relPath);
    setShareNote(null);
    try {
      const text = await api.fileText(session, f.relPath);
      await Share.share({ message: text, title: f.name });
    } catch (e) {
      setShareNote(errorText(e));
    } finally {
      setSharing(null);
    }
  };

  return (
    <FadeInUp>
      <View style={{ gap: 8, marginVertical: 10 }}>
        <T variant="micro" tone="muted" weight="semibold" style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
          {files.length === 1 ? "Produced file" : "Produced files"}
        </T>
        {files.map((f) => (
          <View
            key={f.relPath}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, backgroundColor: palette.card, paddingLeft: 12, paddingRight: 6, paddingVertical: 6 }}
          >
            <Icon name={fileGlyph(f.name)} size={16} color={palette.mutedForeground} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="meta" mono numberOfLines={1} ellipsizeMode="middle">
                {f.name}
              </T>
              {f.relPath !== f.name ? (
                <T variant="micro" mono tone="faint" numberOfLines={1} ellipsizeMode="head">
                  {f.relPath}
                </T>
              ) : null}
            </View>
            <Button title="View" small variant="ghost" onPress={() => setViewing(f)} />
            <Button title="Share" small variant="ghost" loading={sharing === f.relPath} onPress={() => share(f)} />
          </View>
        ))}
        {shareNote ? (
          <T variant="meta" tone="muted">
            {shareNote}
          </T>
        ) : null}
      </View>
      <ArtifactSheet session={session} file={viewing} onClose={() => setViewing(null)} />
    </FadeInUp>
  );
}

type Load = { state: "loading" } | { state: "ready"; text: string } | { state: "error"; message: string };

/** The file's text in a sheet. Fetched on open; a 404 means the machine is gone, a 413 means too big. */
function ArtifactSheet({ session, file, onClose }: { session: string; file: ProducedFile | null; onClose: () => void }) {
  const { palette } = useTheme();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [share, setShare] = useState<string | null>(null);
  const relPath = file?.relPath;

  useEffect(() => {
    if (!relPath) return;
    let cancelled = false;
    setLoad({ state: "loading" });
    setShare(null);
    api
      .fileText(session, relPath)
      .then((text) => {
        if (!cancelled) setLoad({ state: "ready", text });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoad({ state: "error", message: errorText(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [session, relPath]);

  const markdown = !!file && /\.(md|markdown)$/i.test(file.name);
  return (
    <Sheet visible={!!file} onClose={onClose} title={file?.name ?? ""}>
      <View style={{ gap: 10, paddingBottom: 12 }}>
        {file ? (
          <T variant="micro" mono tone="faint" numberOfLines={2}>
            {file.relPath}
          </T>
        ) : null}
        {load.state === "loading" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}>
            <ActivityIndicator size="small" color={palette.mutedForeground} />
            <T variant="meta" tone="muted">
              Loading…
            </T>
          </View>
        ) : load.state === "error" ? (
          <T variant="meta" tone="muted">
            {load.message}
          </T>
        ) : markdown ? (
          <MarkdownLite text={load.text} />
        ) : (
          <View style={{ backgroundColor: palette.trace, borderRadius: radius.lg, paddingVertical: 8 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <T variant="code" mono selectable style={{ color: palette.traceFg, paddingHorizontal: 10 }}>
                {load.text || "(empty file)"}
              </T>
            </ScrollView>
          </View>
        )}
        {load.state === "ready" ? (
          <PressScale
            onPress={() => {
              setShare(null);
              Share.share({ message: load.text, title: file?.name }).catch((e: unknown) => setShare(errorText(e)));
            }}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}
          >
            <Icon name="share" size={14} color={palette.mutedForeground} />
            <T variant="meta" tone="muted" weight="medium">
              Share
            </T>
          </PressScale>
        ) : null}
        {share ? (
          <T variant="meta" tone="muted">
            {share}
          </T>
        ) : null}
      </View>
    </Sheet>
  );
}

const TEXT_EXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|toml|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|sh|bash|zsh|ps1|sql|env|ini|cfg|conf|log|diff|patch|svg|tex|rst|lock|gitignore)$/i;

function isTextLike(name: string): boolean {
  return TEXT_EXT.test(name) || !name.includes(".");
}

/** Extension → glyph, in the same family the tool rows use. */
function fileGlyph(name: string): IconName {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (/^(md|markdown|txt|rst|tex)$/.test(ext)) return "file-text";
  if (/^(png|jpe?g|gif|webp|svg|bmp|heic)$/.test(ext)) return "image";
  if (/^(csv|tsv|xlsx?|json|ya?ml|toml|xml)$/.test(ext)) return "database";
  if (/^(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|sh|bash|zsh|ps1|sql|html?|css|scss)$/.test(ext)) return "code";
  if (/^(zip|tar|gz|tgz|7z|rar)$/.test(ext)) return "archive";
  if (/^(pdf|docx?|pptx?)$/.test(ext)) return "book";
  return "file";
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return "This file is no longer available (the machine was torn down).";
    if (e.status === 413) return "This file is too large to preview here — open it on the web console.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Could not load this file.";
}
