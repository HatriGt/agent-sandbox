import * as React from "react";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { VIZ_ICON_BUTTON, VizEmpty, VizFrame, VizSearch } from "./VizFrame";
import { IconSwap } from "./motion";
import { FullscreenOnly } from "./viz-fullscreen";

/**
 * ```json fence (parseable, multi-line, object/array root) → a collapsible explorer. Objects and
 * arrays fold; long strings truncate with expand-on-click; the raw toggle in the frame gets you
 * back to the exact highlighted text. Depth ≥ 2 starts collapsed so a big payload reads as shape
 * first. Values are typed by color: strings ok-green, numbers live-blue, booleans/null violet —
 * always alongside the literal text, never color alone. The header offers expand-all /
 * collapse-all; a filter (always in the sheet, in the card once the payload is big) keeps the
 * keys and values that match plus the path down to them.
 */
type Fold = { base: "auto" | "all" | "none"; epoch: number };
type Keep = { set: Set<string>; hits: number };
const JsonCtx = React.createContext<{ fold: Fold; keep: Keep | null }>({ fold: { base: "auto", epoch: 0 }, keep: null });

const isContainer = (v: unknown): v is object => typeof v === "object" && v !== null;
const entriesOf = (v: object): (readonly [string, unknown])[] => (Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v as Record<string, unknown>));

export function JsonBlock({ value, source }: { value: unknown; source: string }) {
  const [fold, setFold] = React.useState<Fold>({ base: "auto", epoch: 0 });
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const { leaves, foldable } = React.useMemo(() => {
    let leaves = 0;
    let foldable = false;
    const walk = (v: unknown, depth: number) => {
      if (!isContainer(v)) return leaves++;
      if (depth > 0) foldable = true;
      for (const [, x] of entriesOf(v)) walk(x, depth + 1);
    };
    walk(value, 0);
    return { leaves, foldable };
  }, [value]);
  // Paths that match the filter, or lead to a match — everything else hides while filtering.
  const keep = React.useMemo<Keep | null>(() => {
    if (!q) return null;
    const set = new Set<string>();
    let hits = 0;
    const walk = (v: unknown, path: string, name: string | undefined): boolean => {
      const keyHit = name !== undefined && name.toLowerCase().includes(q);
      if (!isContainer(v)) {
        const hit = keyHit || String(v).toLowerCase().includes(q);
        if (hit) {
          set.add(path);
          hits++;
        }
        return hit;
      }
      let any = false;
      for (const [k, x] of entriesOf(v)) if (walk(x, `${path}.${k}`, Array.isArray(v) ? undefined : k)) any = true;
      if (any || keyHit) set.add(path);
      if (keyHit && !any) hits++;
      return any || keyHit;
    };
    walk(value, "$", undefined);
    return { set, hits };
  }, [value, q]);
  const title = Array.isArray(value)
    ? `JSON · ${value.length} ${value.length === 1 ? "item" : "items"}`
    : isContainer(value)
      ? `JSON · ${Object.keys(value).length} ${Object.keys(value).length === 1 ? "key" : "keys"}`
      : "JSON";
  const allOpen = fold.base === "all";
  const ctx = React.useMemo(() => ({ fold, keep }), [fold, keep]);
  const search = <VizSearch className="border-b" value={query} onChange={setQuery} placeholder="Filter keys and values" count={keep ? `${keep.hits} of ${leaves}` : undefined} />;
  return (
    <VizFrame
      title={title}
      source={source}
      rawLanguage="json"
      actions={
        foldable && (
          <button
            type="button"
            onClick={() => setFold((f) => ({ base: allOpen ? "none" : "all", epoch: f.epoch + 1 }))}
            aria-label={allOpen ? "Collapse all" : "Expand all"}
            title={allOpen ? "Collapse all" : "Expand all"}
            className={VIZ_ICON_BUTTON}
          >
            <IconSwap on={allOpen} offIcon={<ChevronsUpDown className="size-3.5" strokeWidth={1.75} />} onIcon={<ChevronsDownUp className="size-3.5" strokeWidth={1.75} />} />
          </button>
        )
      }
    >
      {leaves > 24 ? search : <FullscreenOnly>{search}</FullscreenOnly>}
      <JsonCtx.Provider value={ctx}>
        <div className={cn("max-h-96 overflow-auto px-3 py-2 font-mono text-code in-data-viz-fullscreen:max-h-(--viz-full)", keep && keep.hits === 0 && "hidden")}>
          <JsonNode value={value} depth={0} path="$" />
        </div>
        {keep && keep.hits === 0 && <VizEmpty onClear={() => setQuery("")}>Nothing matches “{query}”</VizEmpty>}
      </JsonCtx.Provider>
    </VizFrame>
  );
}

function JsonNode({ value, depth, name, path }: { value: unknown; depth: number; name?: string; path: string }) {
  const { fold, keep } = React.useContext(JsonCtx);
  const [open, setOpen] = React.useState(depth < 2);
  // Only a fold the reader opened unfolds; the default-open levels are part of the card's entrance.
  const [touched, setTouched] = React.useState(false);
  // Expand-all / collapse-all bump the epoch; each node follows once, then folds on its own again.
  const seen = React.useRef(fold.epoch);
  if (seen.current !== fold.epoch) {
    seen.current = fold.epoch;
    const want = fold.base === "all" ? true : fold.base === "none" ? false : depth < 2;
    if (want !== open) setOpen(want);
    if (!touched) setTouched(true);
  }
  if (keep && !keep.set.has(path)) return null;
  const key = name !== undefined && (
    <>
      <span className="text-foreground">{JSON.stringify(name)}</span>
      <span className="text-muted-foreground">: </span>
    </>
  );

  if (isContainer(value)) {
    const entries = entriesOf(value);
    const isArr = Array.isArray(value);
    const braces = isArr ? "[]" : "{}";
    // While filtering, the path to a match stays open so the match is visible.
    const shown = keep ? true : open;
    if (entries.length === 0)
      return (
        <div style={{ paddingLeft: depth * 14 }}>
          {key}
          <span className="text-muted-foreground">{braces}</span>
        </div>
      );
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setTouched(true);
            setOpen((o) => !o);
          }}
          aria-expanded={shown}
          className="no-press hover:bg-muted/60 active:bg-muted flex w-full cursor-pointer items-center rounded text-left outline-none transition-[background-color] duration-150 ease-(--viz-ease) focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
          style={{ paddingLeft: depth * 14 }}
        >
          <ChevronRight className={cn("text-muted-foreground mr-0.5 size-3 shrink-0 transition-[rotate] duration-150 ease-(--viz-ease)", shown && "rotate-90")} aria-hidden />
          {key}
          <span className="text-muted-foreground">
            {braces[0]}
            {!shown && (
              <span className="viz-fade text-faint tabular-nums">
                {" "}
                {entries.length} {isArr ? (entries.length === 1 ? "item" : "items") : entries.length === 1 ? "key" : "keys"} {braces[1]}
              </span>
            )}
          </span>
        </button>
        {shown && (
          <div className="viz-fold" data-open data-fresh={(touched && !keep) || undefined}>
            <div>
              {entries.map(([k, v]) => (
                <JsonNode key={k} name={isArr ? undefined : k} value={v} depth={depth + 1} path={`${path}.${k}`} />
              ))}
              <div className="text-muted-foreground" style={{ paddingLeft: depth * 14 + 14 }}>
                {braces[1]}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex" style={{ paddingLeft: depth * 14 + 14 }}>
      <span className="min-w-0 break-all">
        {key}
        <Leaf value={value} />
      </span>
    </div>
  );
}

function Leaf({ value }: { value: unknown }) {
  const [full, setFull] = React.useState(false);
  if (typeof value === "string") {
    const long = value.length > 120 && !full;
    const shown = long ? value.slice(0, 120) : value;
    return (
      <span className="text-ok">
        {JSON.stringify(shown).slice(0, long ? -1 : undefined)}
        {long && (
          <button type="button" onClick={() => setFull(true)} className="text-live cursor-pointer">
            …+{value.length - 120}"
          </button>
        )}
      </span>
    );
  }
  if (typeof value === "number") return <span className="text-live tabular-nums">{String(value)}</span>;
  return <span className="text-sleep">{String(value)}</span>;
}
