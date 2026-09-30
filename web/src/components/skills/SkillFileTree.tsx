import * as React from "react";
import { ChevronRight, FilePlus2, MoreHorizontal, PenLine, Trash2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { SkillFile } from "@/lib/skillImport";
import { FileIcon, FolderIcon } from "@/lib/vscodeIcons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fileNameError } from "./model";

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

/**
 * The skill's own explorer — the same glyphs and folding folders as the box workspace, scoped to the
 * files this skill ships. SKILL.md is pinned as the entry point. A file's hover menu renames or
 * removes it; the footer adds one inline (folders come from slashes in the path). A dot marks what
 * differs from the saved skill. Everything here is a draft until the skill is saved.
 */
export function SkillFileTree({
  files,
  active,
  dirty,
  onSelect,
  actions,
  className,
  compact,
}: {
  files: SkillFile[];
  active: string;
  /** Paths whose content differs from the saved skill. */
  dirty: Record<string, true>;
  onSelect: (path: string) => void;
  actions?: TreeActions;
  className?: string;
  /** Larger hit targets (a sheet on a phone). */
  compact?: boolean;
}) {
  const tree = React.useMemo(() => buildFileTree(files.map((f) => f.path)), [files]);
  const [adding, setAdding] = React.useState(false);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const taken = React.useMemo(() => files.map((f) => f.path), [files]);
  const row = compact ? "h-10" : "h-7";

  return (
    <nav aria-label="Skill files" className={cn("flex min-h-0 flex-col", className)}>
      <div className={cn("flex items-center justify-between px-3 pb-1.5", compact ? "pt-1" : "pt-3")}>
        <span className="label text-muted-foreground">{compact ? `${files.length + 1} file${files.length ? "s" : ""}` : "Files"}</span>
        <span className="flex items-center gap-2">
          {!compact && <span className="text-faint tabular text-micro">{files.length + 1}</span>}
          {actions && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Add a file"
                  className="text-muted-foreground -mr-1.5 size-6"
                  onClick={() => {
                    setRenaming(null);
                    setAdding(true);
                  }}
                >
                  <FilePlus2 className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Add a file — scripts, checklists, templates</TooltipContent>
            </Tooltip>
          )}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        <TreeRow name="SKILL.md" path="SKILL.md" depth={0} active={active} dirty={!!dirty["SKILL.md"]} onSelect={onSelect} entry rowClass={row} />
        <AnimatePresence initial={false}>
          {tree.map((n) => (
            <TreeNodeRow
              key={n.path}
              node={n}
              depth={0}
              active={active}
              dirty={dirty}
              onSelect={onSelect}
              actions={actions}
              renaming={renaming}
              setRenaming={setRenaming}
              taken={taken}
              rowClass={row}
            />
          ))}
        </AnimatePresence>
        {adding && actions && (
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
        )}
        {files.length === 0 && !adding && (
          <p className="text-faint px-2.5 pt-2 text-micro leading-snug">
            Only SKILL.md so far.{" "}
            {actions && (
              <button type="button" onClick={() => setAdding(true)} className="text-muted-foreground hover:text-foreground cursor-pointer underline-offset-2 hover:underline">
                Add a supporting file
              </button>
            )}
          </p>
        )}
      </div>
    </nav>
  );
}

function TreeNodeRow({
  node,
  depth,
  active,
  dirty,
  onSelect,
  actions,
  renaming,
  setRenaming,
  taken,
  rowClass,
}: {
  node: FileNode;
  depth: number;
  active: string;
  dirty: Record<string, true>;
  onSelect: (p: string) => void;
  actions?: TreeActions;
  renaming: string | null;
  setRenaming: (p: string | null) => void;
  taken: string[];
  rowClass: string;
}) {
  const [open, setOpen] = React.useState(true);
  const still = useReducedMotion();
  if (!node.children) {
    if (renaming === node.path && actions) {
      return (
        <InlineName
          depth={depth}
          initial={node.path}
          taken={taken.filter((t) => t !== node.path)}
          onCancel={() => setRenaming(null)}
          onCommit={(p) => {
            actions.onRename(node.path, p);
            setRenaming(null);
            onSelect(p);
          }}
        />
      );
    }
    return (
      <motion.div
        layout={still ? false : "position"}
        initial={still ? { opacity: 0 } : { opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, height: 0, transition: { duration: 0.14 } }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden"
      >
        <TreeRow
          name={node.name}
          path={node.path}
          depth={depth}
          active={active}
          dirty={!!dirty[node.path]}
          onSelect={onSelect}
          rowClass={rowClass}
          menu={
            actions && (
              <RowMenu
                onRename={() => setRenaming(node.path)}
                onRemove={() => {
                  actions.onRemove(node.path);
                }}
              />
            )
          }
        />
      </motion.div>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn("hover:bg-muted/70 flex w-full cursor-pointer items-center gap-1.5 rounded-md pr-2 text-left transition-colors duration-100", rowClass)}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
      >
        <ChevronRight className={cn("text-muted-foreground size-3 shrink-0 transition-transform duration-150 ease-out", open && "rotate-90")} aria-hidden />
        <FolderIcon name={node.name} open={open} size={14} />
        <span className="text-muted-foreground min-w-0 truncate text-meta">{node.name}</span>
      </button>
      <Collapse open={open}>
        {node.children.map((c) => (
          <TreeNodeRow key={c.path} node={c} depth={depth + 1} active={active} dirty={dirty} onSelect={onSelect} actions={actions} renaming={renaming} setRenaming={setRenaming} taken={taken} rowClass={rowClass} />
        ))}
      </Collapse>
    </div>
  );
}

function TreeRow({
  name,
  path,
  depth,
  active,
  dirty,
  entry,
  onSelect,
  menu,
  rowClass,
}: {
  name: string;
  path: string;
  depth: number;
  active: string;
  dirty: boolean;
  entry?: boolean;
  onSelect: (p: string) => void;
  menu?: React.ReactNode;
  rowClass: string;
}) {
  const on = active === path;
  return (
    <div className={cn("group relative flex items-center rounded-md transition-colors duration-100", on ? "bg-live/10" : "hover:bg-muted/70", rowClass)}>
      <button
        type="button"
        onClick={() => onSelect(path)}
        aria-current={on || undefined}
        title={path}
        className="focus-visible:ring-ring/40 flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md pr-1 text-left outline-none focus-visible:ring-2"
        style={{ paddingLeft: `${21 + depth * 14}px` }}
      >
        <FileIcon path={path} size={14} />
        <span className={cn("min-w-0 truncate text-meta", on ? "text-foreground font-medium" : "text-foreground/85")}>{name}</span>
        {entry && <span className="text-faint ml-auto shrink-0 pr-1 text-micro">entry</span>}
        {dirty && <span className={cn("bg-attention size-1.5 shrink-0 rounded-full", !entry && "ml-auto", "mr-1")} aria-label="Unsaved changes" />}
      </button>
      {menu && <span className={cn("shrink-0 pr-1 transition-opacity duration-100", "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100")}>{menu}</span>}
    </div>
  );
}

function RowMenu({ onRename, onRemove }: { onRename: () => void; onRemove: () => void }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label="File actions" className="text-muted-foreground size-6 data-[state=open]:opacity-100">
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        <DropdownMenuItem onSelect={onRename}>
          <PenLine />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={onRemove}>
          <Trash2 />
          Remove from skill
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The inline path field for add / rename: Enter commits, Esc cancels, an error shows beneath. */
function InlineName({ depth, initial = "", placeholder, taken, onCommit, onCancel }: { depth: number; initial?: string; placeholder?: string; taken: string[]; onCommit: (p: string) => void; onCancel: () => void }) {
  const [v, setV] = React.useState(initial);
  const [touched, setTouched] = React.useState(false);
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Select the basename only, so a rename keeps the extension unless the person wants otherwise.
    const dot = initial.lastIndexOf(".");
    const slash = initial.lastIndexOf("/") + 1;
    el.setSelectionRange(slash, dot > slash ? dot : initial.length);
  }, [initial]);
  const err = fileNameError(v, taken);
  return (
    <div className="py-0.5" style={{ paddingLeft: `${6 + depth * 14}px` }}>
      <div className="bg-background border-ring ring-ring/40 flex h-7 items-center gap-1.5 rounded-md border pl-2 ring-2">
        <FileIcon path={v || "file.txt"} size={14} />
        <input
          ref={ref}
          value={v}
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholder}
          aria-label={initial ? "New file name" : "File path"}
          aria-invalid={touched && !!err ? true : undefined}
          onChange={(e) => {
            setV(e.target.value.replace(/\s+/g, "-"));
            setTouched(true);
          }}
          onBlur={() => (v.trim() && !err ? onCommit(v.trim()) : onCancel())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setTouched(true);
              if (!err) onCommit(v.trim());
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
          className="stamp text-foreground placeholder:text-muted-foreground h-full w-full min-w-0 bg-transparent pr-2 text-meta outline-none"
        />
      </div>
      {touched && err && <p className="text-destructive px-1 pt-1 text-micro">{err}</p>}
    </div>
  );
}
