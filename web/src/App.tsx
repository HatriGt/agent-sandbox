import * as React from "react";
import { Boxes, Moon, Sun, TriangleAlert } from "lucide-react";
import { api, type BoxView } from "@/lib/api";
import { POLL_MS, isUp } from "@/lib/format";
import { usePoll } from "@/hooks/usePoll";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FleetList } from "@/components/FleetList";
import { BoxDetail } from "@/components/BoxDetail";
import { Composer } from "@/components/Composer";
import type { AskMessage } from "@/components/AskPanel";
import { cn } from "@/lib/utils";

/** Dark by default — the desk case — but the choice persists and both themes are fully derived. */
function useTheme() {
  const [dark, setDark] = React.useState(() => {
    try {
      return localStorage.getItem("asb-theme") !== "light";
    } catch {
      return true;
    }
  });
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("asb-theme", dark ? "dark" : "light");
    } catch {
      /* private mode: the toggle still works for this session */
    }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

function StatPill({ label, value, tone }: { label: string; value: number; tone?: "live" | "attention" }) {
  return (
    <div className="bg-card flex-1 rounded-md border px-2 py-1.5 text-center">
      <div
        className={cn(
          "tabular text-base font-semibold leading-none",
          tone === "live" && value > 0 && "text-live",
          tone === "attention" && value > 0 && "text-attention"
        )}
      >
        {value}
      </div>
      <div className="text-muted-foreground mt-1 text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  );
}

export default function App() {
  const { dark, toggle } = useTheme();
  const { data, error, live } = usePoll<BoxView[]>((signal) => api.monitor(signal), POLL_MS);

  const [selected, setSelected] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<{ id: string; task: string }[]>([]);
  // Ask transcripts live here, keyed by box, so switching boxes and returning keeps the thread.
  const [askBySession, setAskBySession] = React.useState<Record<string, AskMessage[]>>({});
  const [refreshKey, setRefreshKey] = React.useState(0);

  const boxes = React.useMemo(() => (data ?? []).filter(isUp), [data]);
  const selectedBox = boxes.find((b) => b.name === selected) ?? null;

  // A box that was selected and then vanished (torn down, auto-stopped) must not leave a dead pane.
  React.useEffect(() => {
    if (selected && data && !boxes.some((b) => b.name === selected)) setSelected(null);
  }, [selected, data, boxes]);

  const waiting = boxes.filter((b) => b.runState === "waiting").length;
  const running = boxes.filter((b) => b.runState === "running").length;
  const pool = boxes.filter((b) => b.role === "pool-free").length;

  return (
    <TooltipProvider>
      <div className="grid h-full grid-cols-1 md:grid-cols-[clamp(20rem,26vw,24rem)_1fr]">
        {/* ---------------- fleet pane ---------------- */}
        <aside
          className={cn(
            "bg-sidebar flex min-h-0 flex-col border-r",
            // Mobile: one pane at a time. The detail view takes over rather than cramming both.
            selected && "hidden md:flex"
          )}
        >
          <header className="flex flex-col gap-3 px-3 pt-3.5 pb-2.5">
            <div className="flex items-center gap-2.5">
              <span className="bg-accent text-accent-foreground grid size-7 shrink-0 place-items-center rounded-md">
                <Boxes className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">agent-sandbox</p>
                <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      live ? "bg-live animate-pulse" : "bg-destructive"
                    )}
                    aria-hidden
                  />
                  {live ? `live · ${POLL_MS / 1000}s` : "disconnected"}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={toggle}
                aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
                className="ml-auto shrink-0"
              >
                {dark ? <Moon /> : <Sun />}
              </Button>
            </div>

            <div className="flex gap-1.5">
              <StatPill label="up" value={boxes.length} />
              <StatPill label="running" value={running} tone="live" />
              <StatPill label="waiting" value={waiting} tone="attention" />
              <StatPill label="pool" value={pool} />
            </div>

            {error && (
              <p role="alert" className="text-destructive flex items-start gap-1.5 text-xs leading-relaxed">
                <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                {error}
              </p>
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <FleetList
              boxes={boxes}
              pending={pending}
              selected={selected}
              loading={!data && !error}
              onSelect={setSelected}
            />
          </div>

          <Composer
            onStarted={(box) => setSelected(box)}
            onPending={(p) => setPending((prev) => [...prev, p])}
            onSettled={(id) => setPending((prev) => prev.filter((p) => p.id !== id))}
          />
        </aside>

        {/* ---------------- detail pane ---------------- */}
        <main className={cn("bg-background min-h-0", !selected && "hidden md:block")}>
          {selectedBox ? (
            <BoxDetail
              key={`${selectedBox.name}-${refreshKey}`}
              box={selectedBox}
              askMessages={askBySession[selectedBox.name] ?? []}
              setAskMessages={(next) => setAskBySession((prev) => ({ ...prev, [selectedBox.name]: next }))}
              onBack={() => setSelected(null)}
              onTornDown={(name) => {
                setSelected(null);
                setAskBySession((prev) => {
                  const { [name]: _gone, ...rest } = prev;
                  return rest;
                });
              }}
              onRefresh={() => setRefreshKey((k) => k + 1)}
            />
          ) : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
              <Boxes className="size-7 opacity-40" aria-hidden />
              <p className="text-foreground text-sm font-medium">Select a sandbox</p>
              <p className="max-w-[38ch] text-xs leading-relaxed">
                Pick a box to watch its log, ask the co-pilot about it, or answer a question it is blocked on.
              </p>
            </div>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
