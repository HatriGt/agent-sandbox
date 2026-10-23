import * as React from "react";
import { ChevronRight, Download, FileCode2, FileDiff, Loader2 } from "lucide-react";
import { DropdownMenu as DM } from "radix-ui";
import { toast } from "sonner";
import { api, ApiError, type ChangedFile } from "@/lib/api";
import { parseUnifiedDiff, diffForNewFile, type ParsedDiff } from "@/lib/diff";
import { FileIcon, FolderIcon } from "@/lib/iconTheme";
import { CodeEditor, type CodeEditorHandle, type EditorStatus } from "@/components/CodeEditor";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DiffView, useHunkReview } from "./FilePane";
import { cn } from "@/lib/utils";
import { baseOf, childrenOf, parentOf, type Doc, type Node, type Tab } from "@/lib/workspace-model";
import { MENU_CONTENT, MENU_ITEM, type Open } from "./workspace-chrome";

/**
 * One open file: a 26px toolbar (the folder trail, the diff stat, Diff / File, download) over the
 * diff or the editor. The file's name is the tab's; the caret and save state go up through
 * `onStatus` to the pane's one status bar.
 */

export function FileView({ session, tab, doc, tree, change, wrap, onMode, onDoc, onPin, onOpen, onSaved, onSaver, onEditor, onStatus }: { session: string; tab: Tab; doc: Doc; tree: Node | null; change?: ChangedFile; wrap: boolean; onMode: (m: Tab["mode"]) => void; onDoc: (p: Partial<Doc>) => void; onPin: () => void; onOpen: Open; onSaved: () => void; onSaver: (fn: (() => Promise<string | null>) | null) => void; onEditor: (h: CodeEditorHandle | null) => void; onStatus: (s: EditorStatus | null) => void }) {
  const [diff, setDiff] = React.useState<ParsedDiff | null>(null);
  const [content, setContent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const mode = tab.mode;
  // Accept / reject per hunk, as in Review all; a reject refreshes the changes list.
  const review = useHunkReview(session, tab.path, diff, { onDiscarded: onSaved });

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        if (mode === "diff") {
          if (diff) return;
          const d = await api.diff(session, tab.path);
          if (cancelled) return;
          if (d.untracked) {
            const text = content ?? (await api.artifactText(session, tab.path));
            if (cancelled) return;
            setContent(text);
            setDiff(diffForNewFile(text));
          } else {
            setDiff(parseUnifiedDiff(d.diff));
            if (typeof d.original === "string") {
              // Prefetch the working copy so the switch to Edit is instant.
              if (content === null) {
                const text = await api.artifactText(session, tab.path);
                if (!cancelled) setContent(text);
              }
            }
          }
        } else if (content === null) {
          const text = await api.artifactText(session, tab.path);
          if (!cancelled) setContent(text);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError && e.status === 404 ? "This file is not in the sandbox (anymore)." : e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, tab.path, mode]);

  const draft = doc.draft ?? content ?? "";
  const saving = doc.saving === "saving";
  const latest = React.useRef({ draft, dirty: doc.dirty, saving });
  latest.current = { draft, dirty: doc.dirty, saving };
  const save = React.useCallback(async (): Promise<string | null> => {
    const cur = latest.current;
    if (!cur.dirty || cur.saving) return null;
    latest.current.saving = true;
    onDoc({ saving: "saving" });
    try {
      await api.writeFile(session, tab.path, cur.draft);
      setContent(cur.draft);
      setDiff(null);
      onDoc({ draft: cur.draft, dirty: false, saving: "saved" });
      onSaved();
      return null;
    } catch (e) {
      onDoc({ saving: undefined });
      return e instanceof Error ? e.message : String(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, tab.path]);
  React.useEffect(() => {
    if (!doc.dirty) return;
    const t = window.setTimeout(() => void save().then((err) => err && toast.error("Could not save", { description: err })), 900);
    return () => window.clearTimeout(t);
  }, [draft, doc.dirty, save]);
  const saverRef = React.useRef(onSaver);
  saverRef.current = onSaver;
  React.useEffect(() => {
    saverRef.current(save);
    return () => {
      saverRef.current(null);
      void save();
    };
  }, [save]);
  const download = async () => {
    try {
      const blob = await api.artifactBlob(session, tab.path);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = baseOf(tab.path);
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const statusRef = React.useRef(onStatus);
  statusRef.current = onStatus;
  React.useEffect(() => () => statusRef.current(null), []);
  const edgeRef = useScrollEdge();

  const base = baseOf(tab.path);
  const deleted = change?.status === "deleted";

  return (
    <>
      <div data-ws-toolbar className="@container flex h-[26px] shrink-0 items-center gap-1.5 overflow-hidden border-b pr-1.5 pl-2 [&_.lucide]:[stroke-width:1.5]">
        <Breadcrumb path={tab.path} tree={tree} onOpen={onOpen} />
        {change && (
          <span className="stamp tabular hidden shrink-0 items-center gap-1.5 pr-1 @min-[300px]:flex">
            {change.additions > 0 && <span className="text-ok">+{change.additions}</span>}
            {change.deletions > 0 && <span className="text-destructive">−{change.deletions}</span>}
          </span>
        )}
        {change && (
          <Segmented
            ariaLabel="View mode"
            size="xs"
            value={mode === "diff" ? "diff" : "edit"}
            onChange={(v) => onMode(v)}
            options={[
              { value: "diff", icon: <FileDiff className="size-3" />, label: "Diff" },
              { value: "edit", icon: <FileCode2 className="size-3" />, label: "File", disabled: deleted },
            ]}
          />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={download} aria-label="Download" disabled={deleted} className="text-muted-foreground hover:text-foreground hover:bg-muted relative grid size-6 shrink-0 cursor-pointer place-items-center rounded before:absolute before:-inset-x-2 before:-inset-y-1 before:content-[''] disabled:cursor-default disabled:opacity-40">
              <Download className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Download</TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {error ? (
          <p className="text-muted-foreground px-4 py-6 text-meta">{error}</p>
        ) : loading && ((mode === "diff" && !diff) || (mode !== "diff" && content === null)) ? (
          <p className="text-muted-foreground flex items-center gap-2 px-4 py-6 text-meta">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading {mode === "diff" ? "diff" : "file"}…
          </p>
        ) : mode === "diff" && diff ? (
          <div ref={edgeRef} className="relative h-full">
            <div className="h-full overflow-auto">
              <DiffView diff={diff} path={tab.path} review={review} />
            </div>
            {/* Long lines scroll; a soft edge says so instead of a hard clip (as viz/DataTable). */}
            <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[color-mix(in_oklab,var(--foreground)_7%,transparent)] to-transparent opacity-0 transition-opacity duration-150 in-data-scrolled-end:opacity-100" />
          </div>
        ) : mode === "edit" && content !== null ? (
          deleted ? (
            <p className="text-muted-foreground px-4 py-6 text-meta">This file was deleted in the working tree; see the diff.</p>
          ) : (
            <CodeEditor
              ref={onEditor}
              value={draft}
              onChange={(v) => {
                onDoc({ draft: v, dirty: v !== content });
                if (tab.preview) onPin();
              }}
              onSave={() => void save().then((err) => err && toast.error("Could not save", { description: err }))}
              onStatus={onStatus}
              path={tab.path}
              ariaLabel={`Edit ${base}`}
              autoFocus
              reveal={tab.reveal}
              wrap={wrap}
            />
          )
        ) : null}
      </div>
    </>
  );
}

/** Marks the wrapper `data-scrolled-end` while its scroll box has content hidden to the right. */
function useScrollEdge() {
  const [wrap, setWrap] = React.useState<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const el = wrap?.firstElementChild as HTMLElement | null;
    if (!wrap || !el) return;
    const update = () => wrap.toggleAttribute("data-scrolled-end", el.scrollLeft < el.scrollWidth - el.clientWidth - 0.5);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [wrap]);
  return setWrap;
}

/** The folder trail only: the file is named once, on its tab. Each folder opens its siblings. */
function Breadcrumb({ path, tree, onOpen }: { path: string; tree: Node | null; onOpen: Open }) {
  const segs = path.split("/");
  const dirs = segs.slice(0, -1).map((name, i) => ({ name, path: segs.slice(0, i + 1).join("/") }));
  const shown: { name: string; path: string | null }[] = dirs.length > 4 ? [dirs[0], { name: "…", path: null }, ...dirs.slice(-2)] : dirs;
  return (
    <nav aria-label="Breadcrumb" className="@container flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-meta" title={path}>
      {/* Folders show only when the row is wide enough to show them whole; below that the trail is
          empty and the full path stays in the tooltip. Never a row of chopped words. */}
      {shown.map((d, i) => (
        <React.Fragment key={d.path ?? i}>
          {i > 0 && <ChevronRight className={cn("text-faint hidden size-3 shrink-0 @min-[140px]:inline", i < shown.length - 1 && "@min-[140px]:hidden @min-[300px]:inline")} aria-hidden />}
          <Segment seg={d} current={d.path ?? ""} tree={tree} onOpen={onOpen} className={cn("text-muted-foreground hidden shrink-0 @min-[140px]:inline", d.path === null && "tracking-widest", i < shown.length - 1 && "@min-[140px]:hidden @min-[300px]:inline")}>
            {d.name}
          </Segment>
        </React.Fragment>
      ))}
    </nav>
  );
}

function Segment({ seg, current, tree, onOpen, className, children }: { seg: { name: string; path: string | null }; current: string; tree: Node | null; onOpen: Open; className: string; children: React.ReactNode }) {
  if (!tree || !seg.path) return <span className={className}>{children}</span>;
  const siblings = childrenOf(tree, parentOf(seg.path));
  return (
    <DM.Root>
      <DM.Trigger className={cn(className, "hover:text-foreground data-[state=open]:text-foreground cursor-pointer rounded px-0.5 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring")} aria-label={`${seg.name}: siblings`}>
        {children}
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="start" sideOffset={6} collisionPadding={8} className={cn(MENU_CONTENT, "max-h-80 overflow-auto")}>
          {siblings.map((n) => (
            <DirItem key={n.path} node={n} current={current} onOpen={onOpen} />
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function DirItem({ node, current, onOpen }: { node: Node; current: string; onOpen: Open }) {
  const on = node.path === current || current.startsWith(node.path + "/");
  if (!node.children) {
    return (
      <DM.Item onSelect={() => onOpen(node.path, { preview: true })} className={cn(MENU_ITEM, on && "bg-accent/60")} aria-current={on || undefined}>
        <FileIcon path={node.path} size={15} />
        <span className="truncate">{node.name}</span>
      </DM.Item>
    );
  }
  return (
    <DM.Sub>
      <DM.SubTrigger className={cn(MENU_ITEM, on && "bg-accent/60")}>
        <FolderIcon open={on} />
        <span className="truncate">{node.name}</span>
        <ChevronRight className="ml-auto size-3.5" aria-hidden />
      </DM.SubTrigger>
      <DM.Portal>
        <DM.SubContent sideOffset={4} collisionPadding={8} className={cn(MENU_CONTENT, "max-h-80 overflow-auto")}>
          {childrenOf(node, "").map((n) => (
            <DirItem key={n.path} node={n} current={current} onOpen={onOpen} />
          ))}
        </DM.SubContent>
      </DM.Portal>
    </DM.Sub>
  );
}
