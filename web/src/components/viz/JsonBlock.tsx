import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { VizFrame } from "./VizFrame";

/**
 * ```json fence (parseable, multi-line, object/array root) → a collapsible explorer. Objects and
 * arrays fold; long strings truncate with expand-on-click; the raw toggle in the frame gets you
 * back to the exact highlighted text. Depth ≥ 2 starts collapsed so a big payload reads as shape
 * first. Values are typed by color: strings ok-green, numbers live-blue, booleans/null violet —
 * always alongside the literal text, never color alone.
 */
export function JsonBlock({ value, source }: { value: unknown; source: string }) {
  const title = Array.isArray(value)
    ? `JSON · ${value.length} ${value.length === 1 ? "item" : "items"}`
    : value && typeof value === "object"
      ? `JSON · ${Object.keys(value).length} ${Object.keys(value).length === 1 ? "key" : "keys"}`
      : "JSON";
  return (
    <VizFrame title={title} source={source} rawLanguage="json">
      <div className="max-h-96 overflow-auto px-3 py-2 font-mono text-code in-data-viz-fullscreen:max-h-(--viz-full)">
        <JsonNode value={value} depth={0} />
      </div>
    </VizFrame>
  );
}

function JsonNode({ value, depth, name }: { value: unknown; depth: number; name?: string }) {
  const [open, setOpen] = React.useState(depth < 2);
  // Only a fold the reader opened unfolds; the default-open levels are part of the card's entrance.
  const [touched, setTouched] = React.useState(false);
  const key = name !== undefined && (
    <>
      <span className="text-foreground">{JSON.stringify(name)}</span>
      <span className="text-muted-foreground">: </span>
    </>
  );

  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    const entries = Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);
    const isArr = Array.isArray(value);
    const braces = isArr ? "[]" : "{}";
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
          aria-expanded={open}
          className="no-press hover:bg-muted/60 active:bg-muted flex w-full cursor-pointer items-center rounded text-left outline-none transition-[background-color] duration-150 ease-(--viz-ease) focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
          style={{ paddingLeft: depth * 14 }}
        >
          <ChevronRight className={cn("text-muted-foreground mr-0.5 size-3 shrink-0 transition-[rotate] duration-150 ease-(--viz-ease)", open && "rotate-90")} aria-hidden />
          {key}
          <span className="text-muted-foreground">
            {braces[0]}
            {!open && (
              <span className="viz-fade text-faint tabular-nums">
                {" "}
                {entries.length} {isArr ? (entries.length === 1 ? "item" : "items") : entries.length === 1 ? "key" : "keys"} {braces[1]}
              </span>
            )}
          </span>
        </button>
        {open && (
          <div className="viz-fold" data-open data-fresh={touched || undefined}>
            <div>
              {entries.map(([k, v]) => (
                <JsonNode key={k} name={isArr ? undefined : k} value={v} depth={depth + 1} />
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
