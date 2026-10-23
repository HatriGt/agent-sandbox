export type Node = { name: string; path: string; children?: Map<string, Node> };

export function buildTree(paths: string[]): Node {
  const root: Node = { name: "", path: "", children: new Map() };
  for (const p of paths) {
    const parts = p.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      let next = cur.children!.get(part);
      if (!next) {
        next = isFile ? { name: part, path } : { name: part, path, children: new Map() };
        cur.children!.set(part, next);
      }
      cur = next;
    });
  }
  return root;
}

export const sortedChildren = (m: Map<string, Node> | undefined): Node[] => (m ? [...m.values()].sort((a, b) => (a.children ? 0 : 1) - (b.children ? 0 : 1) || a.name.localeCompare(b.name)) : []);

export const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));
export const baseOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export function nodeAt(tree: Node, path: string): Node | null {
  if (!path) return tree;
  let cur: Node | undefined = tree;
  for (const part of path.split("/")) {
    cur = cur?.children?.get(part);
    if (!cur) return null;
  }
  return cur;
}

export function childrenOf(tree: Node, dir: string): Node[] {
  return sortedChildren(nodeAt(tree, dir)?.children);
}

export type Row =
  | { kind: "dir"; path: string; name: string; depth: number; expanded: boolean }
  | { kind: "file"; path: string; name: string; depth: number }
  | { kind: "edit"; path: string; depth: number; edit: RowEdit };
export type RowEdit = { what: "newFile" | "newDir"; parent: string } | { what: "rename"; target: string };

/** Pre-order, dirs first then files per level, expanded dirs descended. The edit row is spliced in. */
export function visibleRows(tree: Node, expanded: ReadonlySet<string>, edit: RowEdit | null): Row[] {
  const rows: Row[] = [];
  const walk = (node: Node, depth: number) => {
    if (edit && edit.what !== "rename" && edit.parent === node.path) rows.push({ kind: "edit", path: node.path, depth, edit });
    for (const child of sortedChildren(node.children)) {
      if (edit && edit.what === "rename" && edit.target === child.path) {
        rows.push({ kind: "edit", path: child.path, depth, edit });
        continue;
      }
      if (child.children) {
        const open = expanded.has(child.path);
        rows.push({ kind: "dir", path: child.path, name: child.name, depth, expanded: open });
        if (open) walk(child, depth + 1);
      } else {
        rows.push({ kind: "file", path: child.path, name: child.name, depth });
      }
    }
  };
  walk(tree, 0);
  return rows;
}

export type TreeKey = "ArrowUp" | "ArrowDown" | "Home" | "End" | "ArrowLeft" | "ArrowRight";
/**
 * The row index a key moves focus to; null when the key does not move focus. ← on an expanded dir
 * and → on a collapsed one return null: the caller toggles the dir instead.
 */
export function treeKeyTarget(rows: Row[], index: number, key: TreeKey): number | null {
  const last = rows.length - 1;
  if (last < 0) return null;
  const row = rows[index];
  switch (key) {
    case "ArrowUp":
      return index < 0 ? last : Math.max(0, index - 1);
    case "ArrowDown":
      return index < 0 ? 0 : Math.min(last, index + 1);
    case "Home":
      return 0;
    case "End":
      return last;
    case "ArrowRight":
      if (row?.kind !== "dir" || !row.expanded) return null;
      return index < last ? index + 1 : null;
    case "ArrowLeft": {
      if (!row) return null;
      if (row.kind === "dir" && row.expanded) return null;
      for (let i = index - 1; i >= 0; i--) if (rows[i].depth < row.depth) return i;
      return null;
    }
  }
}

/** Type-ahead: next row after `from` whose name starts with `prefix` (case-insensitive), wrapping. */
export function typeAheadTarget(rows: Row[], from: number, prefix: string): number | null {
  const p = prefix.toLowerCase();
  if (!p || rows.length === 0) return null;
  for (let step = 1; step <= rows.length; step++) {
    const i = (from + step + rows.length) % rows.length;
    const r = rows[i];
    if (r.kind !== "edit" && r.name.toLowerCase().startsWith(p)) return i;
  }
  return null;
}

/** Why a proposed file name is refused, or null when it is fine. */
export function invalidName(name: string, siblings: ReadonlySet<string>): string | null {
  if (!name.trim()) return "A name is required";
  if (name !== name.trim()) return "No leading or trailing spaces";
  if (name === "." || name === "..") return "That name is reserved";
  if (/[/\\:*?"<>|]/.test(name)) return 'A name cannot contain / \\ : * ? " < > |';
  if (siblings.has(name)) return "A file or folder with that name already exists";
  return null;
}

export type Reveal = { from: number; to: number; nonce: number };
export type Tab = { path: string; mode: "diff" | "edit"; preview: boolean; reveal?: Reveal };
export type TabGroup = { tabs: Tab[]; active: string | null };
export type TabState = { groups: [TabGroup] | [TabGroup, TabGroup]; focus: 0 | 1 };
export type OpenOpts = { mode?: Tab["mode"]; reveal?: Reveal; preview?: boolean; side?: boolean };

export type TabAction =
  | { type: "open"; path: string; opts: OpenOpts }
  | { type: "activate"; group: 0 | 1; path: string }
  | { type: "pin"; path: string }
  | { type: "setMode"; path: string; mode: Tab["mode"] }
  | { type: "close"; group: 0 | 1; path: string }
  | { type: "closeMany"; group: 0 | 1; which: "others" | "right" | "all" | "saved"; path?: string; dirty: ReadonlySet<string> }
  | { type: "move"; from: { group: 0 | 1; path: string }; to: { group: 0 | 1; index: number } }
  | { type: "split" }
  | { type: "focus"; group: 0 | 1 }
  | { type: "rename"; from: string; to: string };

export const EMPTY_TABS: TabState = { groups: [{ tabs: [], active: null }], focus: 0 };

const withGroup = (state: TabState, i: 0 | 1, g: TabGroup): TabState["groups"] => (state.groups.length === 2 ? (i === 0 ? [g, state.groups[1]] : [state.groups[0], g]) : [g]);

function settle(groups: TabState["groups"], focus: 0 | 1): TabState {
  if (groups.length === 2) {
    if (groups[1].tabs.length === 0) return { groups: [groups[0]], focus: 0 };
    if (groups[0].tabs.length === 0) return { groups: [groups[1]], focus: 0 };
  }
  return { groups, focus: groups.length === 2 ? focus : 0 };
}

function removeFrom(g: TabGroup, keep: (t: Tab, i: number) => boolean, nextActive?: string | null): TabGroup {
  const tabs = g.tabs.filter(keep);
  if (nextActive !== undefined) return { tabs, active: tabs.some((t) => t.path === nextActive) ? nextActive : (tabs[tabs.length - 1]?.path ?? null) };
  if (g.active && tabs.some((t) => t.path === g.active)) return { tabs, active: g.active };
  const i = g.tabs.findIndex((t) => t.path === g.active);
  return { tabs, active: tabs[Math.min(Math.max(0, i - 1), tabs.length - 1)]?.path ?? null };
}

const renamePath = (path: string, from: string, to: string) => (path === from ? to : path.startsWith(from + "/") ? to + path.slice(from.length) : path);

/**
 * Invariants: ≤ 1 preview tab per group (open with preview replaces it, unless the path is already
 * open); a path at most once per group; group 1 exists only while non-empty and `focus` is always a
 * real group; `close` activates the neighbour to the left; `split` copies the focused group's active
 * tab into a new group 1 (pinned) and focuses it; `rename` rewrites every tab, dirs included.
 */
export function tabsReducer(state: TabState, action: TabAction): TabState {
  switch (action.type) {
    case "open": {
      const { path, opts } = action;
      let groups = state.groups;
      let gi: 0 | 1 = state.focus;
      if (opts.side) {
        if (groups.length === 1) groups = [groups[0], { tabs: [], active: null }];
        gi = state.focus === 0 ? 1 : 0;
      }
      const g = groups[gi]!;
      const mode: Tab["mode"] = opts.reveal ? "edit" : (opts.mode ?? "edit");
      const existing = g.tabs.find((t) => t.path === path);
      let tabs: Tab[];
      if (existing) {
        tabs = g.tabs.map((t) => (t.path === path ? { ...t, mode: opts.reveal || opts.mode ? mode : t.mode, reveal: opts.reveal ?? t.reveal, preview: opts.preview === false ? false : t.preview } : t));
      } else {
        const tab: Tab = { path, mode, preview: !!opts.preview, reveal: opts.reveal };
        const pi = tab.preview ? g.tabs.findIndex((t) => t.preview) : -1;
        tabs = pi >= 0 ? g.tabs.map((t, i) => (i === pi ? tab : t)) : [...g.tabs, tab];
      }
      return { groups: withGroup({ ...state, groups }, gi, { tabs, active: path }), focus: gi };
    }
    case "activate": {
      const g = state.groups[action.group];
      if (!g || !g.tabs.some((t) => t.path === action.path)) return state;
      return { groups: withGroup(state, action.group, { ...g, active: action.path }), focus: action.group };
    }
    case "pin":
      return { ...state, groups: state.groups.map((g) => ({ ...g, tabs: g.tabs.map((t) => (t.path === action.path ? { ...t, preview: false } : t)) })) as TabState["groups"] };
    case "setMode":
      return { ...state, groups: state.groups.map((g) => ({ ...g, tabs: g.tabs.map((t) => (t.path === action.path ? { ...t, mode: action.mode } : t)) })) as TabState["groups"] };
    case "close": {
      const g = state.groups[action.group];
      if (!g) return state;
      return settle(withGroup(state, action.group, removeFrom(g, (t) => t.path !== action.path)), state.focus);
    }
    case "closeMany": {
      const g = state.groups[action.group];
      if (!g) return state;
      const at = action.path ? g.tabs.findIndex((t) => t.path === action.path) : -1;
      const keep: (t: Tab, i: number) => boolean =
        action.which === "others" ? (t) => t.path === action.path : action.which === "right" ? (_t, i) => i <= at : action.which === "saved" ? (t) => action.dirty.has(t.path) : () => false;
      return settle(withGroup(state, action.group, removeFrom(g, keep, action.which === "others" ? action.path : undefined)), state.focus);
    }
    case "move": {
      const src = state.groups[action.from.group];
      const tab = src?.tabs.find((t) => t.path === action.from.path);
      if (!src || !tab) return state;
      let groups = state.groups;
      if (action.to.group === 1 && groups.length === 1) groups = [groups[0], { tabs: [], active: null }];
      const dst = groups[action.to.group];
      if (!dst) return state;
      const fromIndex = src.tabs.indexOf(tab);
      const moved: Tab = { ...tab, preview: false };
      if (action.from.group === action.to.group) {
        const rest = src.tabs.filter((t) => t !== tab);
        const at = Math.min(Math.max(0, action.to.index > fromIndex ? action.to.index - 1 : action.to.index), rest.length);
        rest.splice(at, 0, moved);
        return { groups: withGroup({ ...state, groups }, action.to.group, { tabs: rest, active: tab.path }), focus: action.to.group };
      }
      const srcAfter = removeFrom(src, (t) => t !== tab);
      const already = dst.tabs.some((t) => t.path === tab.path);
      const dstTabs = already ? dst.tabs : [...dst.tabs];
      if (!already) dstTabs.splice(Math.min(Math.max(0, action.to.index), dstTabs.length), 0, moved);
      const next: TabState["groups"] = action.from.group === 0 ? [srcAfter, { tabs: dstTabs, active: tab.path }] : [{ tabs: dstTabs, active: tab.path }, srcAfter];
      return settle(next, action.to.group);
    }
    case "split": {
      if (state.groups.length === 2) return { ...state, focus: state.focus === 0 ? 1 : 0 };
      const g = state.groups[0];
      const active = g.tabs.find((t) => t.path === g.active);
      if (!active) return state;
      return { groups: [g, { tabs: [{ ...active, preview: false }], active: active.path }], focus: 1 };
    }
    case "focus":
      return state.groups[action.group] ? { ...state, focus: action.group } : state;
    case "rename": {
      const { from, to } = action;
      return {
        ...state,
        groups: state.groups.map((g) => ({ tabs: g.tabs.map((t) => ({ ...t, path: renamePath(t.path, from, to) })), active: g.active && renamePath(g.active, from, to) })) as TabState["groups"],
      };
    }
  }
}

/** One draft per path, shared by both groups. `saving` is the lock that stops the second autosave. */
export type Doc = { draft?: string; dirty: boolean; saving?: "saving" | "saved" };

export type PaneCommands = {
  closeActive(): void;
  quickOpen(prefill?: string): void;
  toggleSidebar(): void;
  searchInFiles(): void;
  /** Find in the active file; with no file open, the files Search view. */
  find(): void;
  save(): void;
  split(): void;
  toggleWrap(): void;
  focusGroup(g: 0 | 1): void;
};
export type ShortcutId = "quickOpen" | "goToLine" | "goToSymbol" | "find" | "searchInFiles" | "save" | "close" | "sidebar" | "split" | "wrap" | "group1" | "group2";
/** `keys` is one cap per key for the platform (`["⌘", "⇧", "O"]` or `["Ctrl", "Shift", "O"]`); `label` joins them. */
export type Shortcut = { id: ShortcutId; key: string; mod?: boolean; shift?: boolean; alt?: boolean; keys: string[]; label: string; what: string; run: (c: PaneCommands) => void };

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const chord = (s: Omit<Shortcut, "keys" | "label">): Shortcut => {
  const keys = [...(s.mod ? [IS_MAC ? "⌘" : "Ctrl"] : []), ...(s.shift ? [IS_MAC ? "⇧" : "Shift"] : []), ...(s.alt ? [IS_MAC ? "⌥" : "Alt"] : []), s.key.toUpperCase()];
  return { ...s, keys, label: keys.join(IS_MAC ? "" : "+") };
};

/** The pane's chords, in the order the shortcuts dialog lists them. */
export const SHORTCUTS: Shortcut[] = [
  chord({ id: "quickOpen", key: "p", mod: true, what: "Go to file", run: (c) => c.quickOpen() }),
  chord({ id: "goToLine", key: "g", mod: true, what: "Go to line", run: (c) => c.quickOpen(":") }),
  chord({ id: "goToSymbol", key: "o", mod: true, shift: true, what: "Go to symbol", run: (c) => c.quickOpen("@") }),
  chord({ id: "find", key: "f", mod: true, what: "Find in file", run: (c) => c.find() }),
  chord({ id: "searchInFiles", key: "f", mod: true, shift: true, what: "Search in files", run: (c) => c.searchInFiles() }),
  chord({ id: "save", key: "s", mod: true, what: "Save file", run: (c) => c.save() }),
  chord({ id: "close", key: "w", mod: true, what: "Close tab", run: (c) => c.closeActive() }),
  chord({ id: "sidebar", key: "b", mod: true, what: "Toggle the files panel", run: (c) => c.toggleSidebar() }),
  chord({ id: "split", key: "\\", mod: true, what: "Split the editor", run: (c) => c.split() }),
  chord({ id: "wrap", key: "z", alt: true, what: "Toggle word wrap", run: (c) => c.toggleWrap() }),
  chord({ id: "group1", key: "1", mod: true, what: "Focus the first group", run: (c) => c.focusGroup(0) }),
  chord({ id: "group2", key: "2", mod: true, what: "Focus the second group", run: (c) => c.focusGroup(1) }),
];

/**
 * An overlay that owns the keyboard: a Radix dialog, menu, popover or listbox, or the command
 * palette's native `<dialog>`. Pane chords stay quiet while one is open.
 */
export const OVERLAY_OPEN = 'dialog[open], [data-state="open"]:is([role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"])';

// ⌥ on macOS turns the key into a symbol (⌥Z is "Ω"), so the physical code is matched as well.
const codeOf = (key: string) => (key === "\\" ? "Backslash" : /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : null);

export function matchShortcut(e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, table: Shortcut[]): Shortcut | null {
  const mod = e.metaKey || e.ctrlKey;
  return table.find((s) => !!s.mod === mod && !!s.shift === e.shiftKey && !!s.alt === e.altKey && (e.key.toLowerCase() === s.key || e.code === codeOf(s.key))) ?? null;
}

export type DragKind = "asb/path" | "asb/tab";
type DragPayload<K extends DragKind> = K extends "asb/path" ? { path: string } : { group: 0 | 1; path: string };
type DragLike = { dataTransfer: DataTransfer | null };

export function setDrag<K extends DragKind>(e: DragLike, kind: K, payload: DragPayload<K>): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(kind, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "move";
}
/** The payload on drop. During dragover the browser hides it; use `hasDrag` there. */
export function readDrag<K extends DragKind>(e: DragLike, kind: K): DragPayload<K> | null {
  const raw = e.dataTransfer?.getData(kind);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload<K>;
  } catch {
    return null;
  }
}
export const hasDrag = (e: DragLike, kind: DragKind): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(kind);

export function parseLineQuery(q: string): { from: number; to: number } | null {
  const m = /^:\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(q);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  return from > 0 ? { from, to: Math.max(from, to) } : null;
}

export function matchPaths(paths: string[], query: string, limit = 80): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return paths.slice(0, Math.min(limit, 60));
  const score = (p: string) => {
    const base = baseOf(p).toLowerCase();
    if (base.startsWith(needle)) return 0;
    if (base.includes(needle)) return 1;
    if (p.toLowerCase().includes(needle)) return 2;
    return 9;
  };
  return paths
    .map((p) => [score(p), p] as const)
    .filter(([s]) => s < 9)
    .sort((a, b) => a[0] - b[0] || a[1].length - b[1].length)
    .slice(0, limit)
    .map(([, p]) => p);
}

/* ───────────── Resizable widths: the pane inside its container, the files panel inside the pane ───────────── */

export type Range = { min: number; max: number };
export const PANE_MIN = 480;
/** The conversation beside the pane keeps at least this much of the container. */
export const CONVERSATION_MIN = 480;
export const SIDEBAR_MIN = 192;
export const SIDEBAR_DEFAULT = 256;

export const clampTo = (v: number, r: Range): number => Math.min(r.max, Math.max(r.min, Math.round(v)));
export const paneRange = (container: number): Range => {
  const max = Math.max(0, Math.round(container) - CONVERSATION_MIN);
  return { min: Math.min(PANE_MIN, max), max };
};
export const defaultPaneWidth = (container: number): number => clampTo(container * 0.58, paneRange(container));
export const sidebarRange = (pane: number): Range => ({ min: SIDEBAR_MIN, max: Math.max(SIDEBAR_MIN, Math.floor(pane / 2)) });
