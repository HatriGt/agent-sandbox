import * as React from "react";
import { resolvedReduced } from "@/lib/motion-pref";
import { ArrowUp, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { completeVersions, EMPTY_REGISTRY, rewriteLiveBlocks, type LiveRegistry, type LiveSlot } from "@/lib/viz-identity";
import { useNow } from "@/hooks/useNow";

/**
 * React side of live blocks (lib/viz-identity.ts). Thread builds the registry once per trace and
 * provides it; each say item gets its key; StreamingMarkdown rewrites its markdown through
 * {@link useLiveRewrite}; the markdown code renderer wraps a slot's visual in {@link LiveSlotContext}
 * (always the same provider element, so becoming live never remounts the block) and renders a
 * collapsed copy as {@link LiveCopyRow}.
 */

export const LiveRegistryContext = React.createContext<{ registry: LiveRegistry; working: boolean }>({ registry: EMPTY_REGISTRY, working: false });
export const SayKeyContext = React.createContext<string | null>(null);
/** Set around a live slot's visual; VizFrame reads it for the header's live dot and "updated" age. */
export const LiveSlotContext = React.createContext<number | null>(null);

/** Rewrite a say's markdown for the thread's live slots (identity when outside a Thread). */
export function useLiveRewrite(md: string): string {
  const { registry } = React.useContext(LiveRegistryContext);
  const key = React.useContext(SayKeyContext);
  return React.useMemo(() => (key === null ? md : rewriteLiveBlocks(md, key, registry)), [md, key, registry]);
}

/** When the client first saw each version — the fallback age for a log without timestamps. */
const firstSeen = new Map<string, number>();
function versionTime(slot: LiveSlot, i: number): number {
  const v = slot.versions[i];
  if (v.at !== undefined) return v.at;
  const k = `${slot.id}|${v.say}|${v.fence}`;
  if (!firstSeen.has(k)) firstSeen.set(k, Date.now());
  return firstSeen.get(k)!;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Header badge of a live slot that has been updated: live dot while the run works, then the age. */
export function LiveSlotBadge() {
  const n = React.useContext(LiveSlotContext);
  const { registry, working } = React.useContext(LiveRegistryContext);
  const slot = n === null ? undefined : registry.slots[n];
  const now = useNow(true, 5000);
  if (!slot || completeVersions(slot) < 2) return null;
  const live = working && slot.run === registry.lastRun;
  const at = versionTime(slot, slot.latest);
  return (
    <span className="text-faint flex shrink-0 items-center gap-1.5 text-micro tabular-nums" data-live-badge title={`Updated ${completeVersions(slot) - 1}× · last ${clock(at)}`}>
      {live && <span aria-hidden className="bg-live breathe size-1.5 rounded-full" />}
      <span>{live ? "live · " : ""}updated {ago(now - at)}</span>
    </span>
  );
}

/** Title a slot's frame falls back to when the block draws none of its own (`title=` / heading). */
export function useLiveSlotTitle(): string | undefined {
  const n = React.useContext(LiveSlotContext);
  const { registry } = React.useContext(LiveRegistryContext);
  const slot = n === null ? undefined : registry.slots[n];
  return slot && slot.title.length <= 60 ? slot.title : undefined;
}

/**
 * A later copy of a live block, collapsed: one quiet line where the agent re-emitted it. The block
 * itself updated in place above; the row jumps there, and expands to this version's raw text.
 */
export function LiveCopyRow({ spec }: { spec: string }) {
  const [slotN, version] = spec.trim().split(/\s+/).map(Number);
  const { registry, working } = React.useContext(LiveRegistryContext);
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const slot = registry.slots[slotN];
  const v = slot?.versions[version];
  if (!slot || !v) return null;
  const isLast = version === slot.versions.length - 1;
  const writing = !v.closed;
  const at = versionTime(slot, version);
  const jump = () => {
    const thread = ref.current?.closest("[aria-label='Conversation']") ?? document;
    const target = thread.querySelector<HTMLElement>(`[data-live-slot='${slot.n}']`);
    target?.scrollIntoView({ behavior: resolvedReduced() ? "auto" : "smooth", block: "center" });
  };
  return (
    <div ref={ref} className="not-prose my-2" data-live-copy={slot.n}>
      <div className="text-muted-foreground flex min-h-7 items-center gap-1 text-micro">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="hover:text-foreground flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1 py-0.5"
        >
          <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-150", open && "rotate-90")} aria-hidden />
          {isLast && working && slot.run === registry.lastRun && <span aria-hidden className="bg-live breathe size-1.5 shrink-0 rounded-full" />}
          <span className="truncate">
            <span className="text-foreground/80 font-medium">{slot.title}</span>
            {writing ? " · updating…" : isLast ? ` · updated ${completeVersions(slot) - 1}×` : " · earlier update"}
            {!writing && <span className="text-faint tabular-nums"> · {isLast ? "last " : ""}{clock(at)}</span>}
          </span>
        </button>
        <button type="button" onClick={jump} className="hover:text-foreground flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1 py-0.5">
          <ArrowUp className="size-3" aria-hidden /> view
        </button>
      </div>
      {open && (
        <pre className="enter bg-muted/40 text-muted-foreground mt-1 overflow-x-auto rounded-md border px-3 py-2 font-mono text-code whitespace-pre">{v.body}</pre>
      )}
    </div>
  );
}
