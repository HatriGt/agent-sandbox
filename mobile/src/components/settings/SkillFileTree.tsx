// The skill's own files, ported from web/src/components/skills/SkillFileTree.tsx: SKILL.md pinned as
// the entry point, supporting files folded into folders, add / rename / remove inline. Everything
// here is a draft until the skill is saved.
import React, { useMemo, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Icon } from "@/components/ui/Icon";
import type { SkillFile } from "./skillImport";
import { fileNameError } from "./SkillModel";

type FileNode = { name: string; path: string; children?: FileNode[] };

/** Fold flat paths into a tree: folders first, then files, both alphabetical. */
function buildFileTree(paths: string[]): FileNode[] {
  const root: FileNode[] = [];
  for (const path of [...paths].sort()) {
    let level = root;
    const parts = path.split("/");
    parts.forEach((part, i) => {
      const sub = parts.slice(0, i + 1).join("/");
      let node = level.find((n) => n.name === part);
      if (!node) {
        node = i === parts.length - 1 ? { name: part, path: sub } : { name: part, path: sub, children: [] };
        level.push(node);
      }
      level = node.children ?? level;
    });
  }
  const sort = (nodes: FileNode[]): FileNode[] => {
    nodes.sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name));
    nodes.forEach((n) => n.children && sort(n.children));
    return nodes;
  };
  return sort(root);
}

export type TreeActions = {
  onAdd: (path: string) => void;
  onRename: (from: string, to: string) => void;
  onRemove: (path: string) => void;
};

export function SkillFileTree({ files, active, dirty, onSelect, actions }: { files: SkillFile[]; active: string; dirty: Record<string, true>; onSelect: (path: string) => void; actions: TreeActions }) {
  const tree = useMemo(() => buildFileTree(files.map((f) => f.path)), [files]);
  const taken = useMemo(() => files.map((f) => f.path), [files]);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  const renderNode = (n: FileNode, depth: number): React.ReactNode => {
    if (n.children) return <Folder key={n.path} node={n} depth={depth} render={renderNode} />;
    if (renaming === n.path)
      return (
        <InlineName
          key={n.path}
          depth={depth}
          initial={n.path}
          taken={taken.filter((t) => t !== n.path)}
          onCancel={() => setRenaming(null)}
          onCommit={(p) => {
            actions.onRename(n.path, p);
            setRenaming(null);
            onSelect(p);
          }}
        />
      );
    return (
      <Row
        key={n.path}
        name={n.name}
        path={n.path}
        depth={depth}
        active={active}
        dirty={!!dirty[n.path]}
        onSelect={onSelect}
        onMenu={() =>
          Alert.alert(n.path, undefined, [
            {
              text: "Rename",
              onPress: () => {
                setAdding(false);
                setRenaming(n.path);
              },
            },
            { text: "Remove from skill", style: "destructive", onPress: () => actions.onRemove(n.path) },
            { text: "Cancel", style: "cancel" },
          ])
        }
      />
    );
  };

  return (
    <View accessibilityLabel="Skill files" style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 6 }}>
        <T variant="micro" weight="medium" tone="muted">
          {`${files.length + 1} file${files.length ? "s" : ""}`}
        </T>
        <Pressable
          onPress={() => {
            setRenaming(null);
            setAdding(true);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Add a file"
          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
        >
          <Icon name="file-plus" size={15} />
          <T variant="meta" tone="muted">
            Add a file
          </T>
        </Pressable>
      </View>
      <Row name="SKILL.md" path="SKILL.md" depth={0} active={active} dirty={!!dirty["SKILL.md"]} onSelect={onSelect} entry />
      {tree.map((n) => renderNode(n, 0))}
      {adding ? (
        <InlineName
          depth={0}
          placeholder="scripts/check.sh"
          taken={taken}
          onCancel={() => setAdding(false)}
          onCommit={(p) => {
            actions.onAdd(p);
            setAdding(false);
            onSelect(p);
          }}
        />
      ) : null}
      {files.length === 0 && !adding ? (
        <T variant="micro" tone="faint" style={{ paddingTop: 6 }}>
          Only SKILL.md so far.{" "}
          <T variant="micro" tone="muted" onPress={() => setAdding(true)} style={{ textDecorationLine: "underline" }}>
            Add a supporting file
          </T>
        </T>
      ) : null}
    </View>
  );
}

function Folder({ node, depth, render }: { node: FileNode; depth: number; render: (n: FileNode, depth: number) => React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <View>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingLeft: 6 + depth * 14 }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={13} />
        <Icon name="folder" size={14} />
        <T variant="meta" tone="muted" numberOfLines={1}>
          {node.name}
        </T>
      </Pressable>
      {open ? node.children?.map((c) => render(c, depth + 1)) : null}
    </View>
  );
}

function Row({ name, path, depth, active, dirty, entry, onSelect, onMenu }: { name: string; path: string; depth: number; active: string; dirty: boolean; entry?: boolean; onSelect: (p: string) => void; onMenu?: () => void }) {
  const { palette } = useTheme();
  const on = active === path;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", height: 40, borderRadius: radius.md, backgroundColor: on ? palette.accent : "transparent" }}>
      <Pressable
        onPress={() => onSelect(path)}
        onLongPress={onMenu}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, height: "100%", paddingLeft: 21 + depth * 14, paddingRight: 6 }}
      >
        <Icon name="file-text" size={14} />
        <T variant="meta" weight={on ? "medium" : undefined} numberOfLines={1} style={{ flexShrink: 1 }}>
          {name}
        </T>
        <View style={{ flex: 1 }} />
        {entry ? (
          <T variant="micro" tone="faint">
            entry
          </T>
        ) : null}
        {dirty ? <View accessibilityLabel="Unsaved changes" style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.attention }} /> : null}
      </Pressable>
      {onMenu ? (
        <Pressable onPress={onMenu} hitSlop={8} accessibilityRole="button" accessibilityLabel="File actions" style={{ paddingHorizontal: 8, height: "100%", justifyContent: "center" }}>
          <Icon name="more-horizontal" size={16} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The inline path field for add / rename: submit commits, blur with an invalid value cancels. */
function InlineName({ depth, initial = "", placeholder, taken, onCommit, onCancel }: { depth: number; initial?: string; placeholder?: string; taken: string[]; onCommit: (p: string) => void; onCancel: () => void }) {
  const { palette } = useTheme();
  const [v, setV] = useState(initial);
  const [touched, setTouched] = useState(false);
  const err = fileNameError(v, taken);
  const dot = initial.lastIndexOf(".");
  const slash = initial.lastIndexOf("/") + 1;
  return (
    <View style={{ paddingVertical: 2, paddingLeft: 6 + depth * 14 }}>
      <TextInput
        autoFocus
        value={v}
        selection={touched ? undefined : { start: slash, end: dot > slash ? dot : initial.length }}
        placeholder={placeholder}
        placeholderTextColor={palette.faint}
        accessibilityLabel={initial ? "New file name" : "File path"}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="done"
        onChangeText={(t) => {
          setV(t.replace(/\s+/g, "-"));
          setTouched(true);
        }}
        onSubmitEditing={() => {
          setTouched(true);
          if (!err) onCommit(v.trim());
        }}
        onBlur={() => (v.trim() && !err ? onCommit(v.trim()) : onCancel())}
        style={{ height: 40, borderWidth: 1, borderColor: palette.ring, borderRadius: radius.md, paddingHorizontal: 10, color: palette.foreground, fontFamily: fonts.mono, fontSize: type.code.fontSize }}
      />
      {touched && err ? (
        <T variant="micro" tone="destructive" style={{ paddingTop: 4 }}>
          {err}
        </T>
      ) : null}
    </View>
  );
}
