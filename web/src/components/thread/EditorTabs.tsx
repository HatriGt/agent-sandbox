import * as React from "react";
import { Columns2, Copy, Pin, X } from "lucide-react";
import { motion } from "motion/react";
import { ContextMenu as CM } from "radix-ui";
import { useReducedMotion } from "@/lib/motion-pref";
import { FileIcon } from "@/lib/vscodeIcons";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { SHORTCUTS, baseOf, hasDrag, readDrag, setDrag, type ShortcutId, type TabAction, type TabGroup } from "@/lib/workspace-model";
import { MENU_CONTENT, MENU_ITEM, MENU_SEP, MenuHint, SPRING, copyText, shortcutLabel } from "./workspace-chrome";

/**
 * One editor group's tabs, flush like VS Code's: the active tab is the card colour with a 2px line
 * on top (ink, dimmed when the group is not focused) and that backdrop glides between tabs. A
 * preview tab is italic; a dirty tab shows a dot that turns into the close × under the pointer.
 */
export function TabStrip({ group, state, focused, dirty, dispatch, onClose }: { group: 0 | 1; state: TabGroup; focused: boolean; dirty: ReadonlySet<string>; dispatch: (a: TabAction) => void; onClose: (path: string) => void }) {
  const still = useReducedMotion();
  const [menuPath, setMenuPath] = React.useState<string | null>(null);
  const [dropAt, setDropAt] = React.useState<number | null>(null);
  const tabFrom = (el: Element | null) => (el?.closest("[data-tab]") as HTMLElement | null)?.dataset.tab;
  const indexFor = (e: React.DragEvent) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-tab]");
    if (!el) return state.tabs.length;
    const i = state.tabs.findIndex((t) => t.path === el.dataset.tab);
    const r = el.getBoundingClientRect();
    return i + (e.clientX > r.left + r.width / 2 ? 1 : 0);
  };
  const menuTab = state.tabs.find((t) => t.path === menuPath) ?? null;
  const item = (label: string, onSelect: () => void, opts: { disabled?: boolean; hint?: string } = {}) => (
    <CM.Item disabled={opts.disabled} onSelect={onSelect} className={MENU_ITEM}>
      {label}
      {opts.hint && <MenuHint>{opts.hint}</MenuHint>}
    </CM.Item>
  );
  const many = (which: "others" | "right" | "all" | "saved") => menuPath !== null && dispatch({ type: "closeMany", group, which, path: menuPath, dirty });
  return (
    <CM.Root onOpenChange={(o) => !o && setMenuPath(null)}>
      <CM.Trigger asChild>
        <div
          role="tablist"
          aria-label={`Editor group ${group + 1}`}
          className="scrollbar-none relative flex min-w-0 flex-1 items-stretch overflow-x-auto"
          onContextMenuCapture={(e) => setMenuPath(tabFrom(e.target as Element) ?? null)}
          onDragOver={(e) => {
            if (!hasDrag(e, "asb/tab")) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropAt(indexFor(e));
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as globalThis.Node | null) && setDropAt(null)}
          onDrop={(e) => {
            const from = readDrag(e, "asb/tab");
            setDropAt(null);
            if (!from) return;
            e.preventDefault();
            dispatch({ type: "move", from, to: { group, index: indexFor(e) } });
          }}
        >
          {state.tabs.map((t, i) => {
            const on = t.path === state.active;
            const base = baseOf(t.path);
            const isDirty = dirty.has(t.path);
            return (
              <div
                key={t.path}
                role="tab"
                aria-selected={on}
                data-tab={t.path}
                data-preview={t.preview || undefined}
                draggable
                onDragStart={(e) => setDrag(e, "asb/tab", { group, path: t.path })}
                onClick={() => dispatch({ type: "activate", group, path: t.path })}
                onDoubleClick={() => dispatch({ type: "pin", path: t.path })}
                onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                onAuxClick={(e) => e.button === 1 && onClose(t.path)}
                className={cn("group relative flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-r pr-1 pl-3 text-meta transition-colors select-none", on ? (focused ? "text-foreground" : "text-foreground/75") : "text-muted-foreground hover:text-foreground hover:bg-muted/50")}
                title={t.path}
              >
                {dropAt === i && <span className="bg-live absolute inset-y-1.5 -left-px z-10 w-0.5 rounded-full" aria-hidden />}
                {on && (
                  <motion.span layoutId={`ws-active-tab-${group}`} className="bg-card absolute inset-0 -z-10" transition={still ? { duration: 0 } : SPRING} aria-hidden>
                    <span className={cn("absolute inset-x-0 top-0 h-0.5 transition-colors", focused ? "bg-foreground" : "bg-foreground/30")} />
                  </motion.span>
                )}
                <FileIcon path={t.path} size={14} />
                <span className={cn("max-w-[14rem] truncate", t.preview && "italic")}>{base}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(t.path);
                  }}
                  aria-label={isDirty ? `Close ${base} (unsaved)` : `Close ${base}`}
                  className={cn("text-muted-foreground hover:text-foreground hover:bg-muted ml-0.5 grid size-5 cursor-pointer place-items-center rounded", !isDirty && !on && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                >
                  {isDirty && <span className="bg-foreground block size-2 rounded-full group-hover:hidden" aria-hidden />}
                  <X className={cn("size-3", isDirty && "hidden group-hover:block")} aria-hidden />
                </button>
              </div>
            );
          })}
          {dropAt === state.tabs.length && state.tabs.length > 0 && <span className="bg-live my-2 w-0.5 shrink-0 rounded-full" aria-hidden />}
          {state.tabs.length === 0 && <span className="text-muted-foreground flex items-center px-3 text-micro">No file open</span>}
        </div>
      </CM.Trigger>
      <CM.Portal>
        <CM.Content collisionPadding={8} className={MENU_CONTENT} aria-label="Tab actions">
          {item("Close", () => menuPath && onClose(menuPath), { disabled: !menuTab, hint: shortcutLabel("close") })}
          {item("Close others", () => many("others"), { disabled: !menuTab || state.tabs.length < 2 })}
          {item("Close to the right", () => many("right"), { disabled: !menuTab || state.tabs[state.tabs.length - 1]?.path === menuPath })}
          {item("Close saved", () => many("saved"), { disabled: state.tabs.length === 0 })}
          {item("Close all", () => many("all"), { disabled: state.tabs.length === 0 })}
          <CM.Separator className={MENU_SEP} />
          <CM.Item disabled={!menuTab?.preview} onSelect={() => menuPath && dispatch({ type: "pin", path: menuPath })} className={MENU_ITEM}>
            <Pin />
            Keep open
          </CM.Item>
          <CM.Item disabled={!menuTab} onSelect={() => menuPath && dispatch({ type: "open", path: menuPath, opts: { side: true, mode: menuTab?.mode } })} className={MENU_ITEM}>
            <Columns2 />
            Open to the side
            <MenuHint>{shortcutLabel("split")}</MenuHint>
          </CM.Item>
          <CM.Item disabled={!menuTab} onSelect={() => menuPath && void copyText(`/workspace/${menuPath}`)} className={MENU_ITEM}>
            <Copy />
            Copy path
          </CM.Item>
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

const WELCOME: ShortcutId[] = ["quickOpen", "searchInFiles", "find", "sidebar", "split"];

/** An empty group: the chords that get someone into a file, as VS Code's empty editor lists them. */
export function EmptyEditor() {
  return (
    <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-6 px-6 text-meta">
      <div className="grid grid-cols-3 gap-1.5 opacity-60" aria-hidden>
        {["src/index.ts", "README.md", "package.json", "app.tsx", "styles.css", "Dockerfile"].map((p) => (
          <span key={p} className="bg-muted grid size-8 place-items-center rounded-md">
            <FileIcon path={p} size={16} />
          </span>
        ))}
      </div>
      <dl className="grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-2">
        {WELCOME.map((id) => {
          const s = SHORTCUTS.find((x) => x.id === id)!;
          return (
            <React.Fragment key={id}>
              <dt className="text-right">{s.what}</dt>
              <dd>
                <Kbd keys={[...s.label]} />
              </dd>
            </React.Fragment>
          );
        })}
      </dl>
    </div>
  );
}
