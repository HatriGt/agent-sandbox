import * as React from "react";
import { Boxes, LayoutGrid, MessageSquare, Moon, PauseCircle, Plus, Search, Sun, TriangleAlert } from "lucide-react";
import { api, type BoxView } from "@/lib/api";
import { POLL_MS, isUp } from "@/lib/format";
import { usePoll } from "@/hooks/usePoll";
import { useSessionRuns } from "@/hooks/useSessionRuns";
import { Button } from "@/components/ui/button";
import { MachineList } from "@/components/MachineList";
import { Hub } from "@/components/Hub";
import { Overview } from "@/components/Overview";
import { CommandPalette } from "@/components/CommandPalette";
import { Thread, type Aside } from "@/components/thread/Thread";
import { cn } from "@/lib/utils";

/**
 * "updated 3s ago" — recomputed on a 1s timer so it stays true between polls. Honest freshness beats
 * a claimed interval: this endpoint's latency grows with the number of machines.
 */
function useFreshness(updatedAt: number | null) {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (!updatedAt) return "connecting";
  const secs = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  return secs < 2 ? "just now" : `${secs}s ago`;
}

/** Dark by default (a desk, often at night); persisted, and both themes are fully derived. */
function useTheme() {
  const [dark, setDark] = React.useState(() => {
    try {
      return localStorage.getItem("asb-theme") !== "light";
    } catch {
      return true;
    }
  });
  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.classList.toggle("light", !dark);
    try {
      localStorage.setItem("asb-theme", dark ? "dark" : "light");
    } catch {
      /* private mode: the toggle still works for this session */
    }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

type View = "chat" | "overview";

export default function App() {
  const { dark, toggle } = useTheme();
  const { data, error, live, updatedAt } = usePoll<BoxView[]>((signal) => api.monitor(signal), POLL_MS);
  const freshness = useFreshness(updatedAt);
  const { runs, remember } = useSessionRuns();

  const [view, setView] = React.useState<View>("chat");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<{ id: string; task: string }[]>([]);
  const [asides, setAsides] = React.useState<Record<string, Aside[]>>({});

  const boxes = React.useMemo(() => (data ?? []).filter(isUp), [data]);
  const selectedBox = boxes.find((b) => b.name === selected) ?? null;
  const waiting = boxes.filter((b) => b.runState === "waiting");
  const workingCount = boxes.filter((b) => b.runState === "running").length;

  // A machine that vanished (destroyed, auto-stopped) must not leave a dead pane behind.
  React.useEffect(() => {
    if (selected && data && !boxes.some((b) => b.name === selected)) setSelected(null);
  }, [selected, data, boxes]);

  const open = (name: string) => {
    setSelected(name);
    setView("chat");
  };
  const newTask = () => {
    setSelected(null);
    setView("chat");
  };

  /** Ask the co-pilot; the pending note renders immediately so the thread never looks frozen. */
  const ask = async (name: string, question: string) => {
    let index = 0;
    setAsides((prev) => {
      const list = [...(prev[name] ?? []), { question }];
      index = list.length - 1;
      return { ...prev, [name]: list };
    });
    try {
      const res = await api.ask(name, question);
      setAsides((prev) => {
        const list = [...(prev[name] ?? [])];
        list[index] = {
          question,
          answer: res.timedOut ? `${res.answer}\n\n(time cap reached — this answer may be partial)` : res.answer,
        };
        return { ...prev, [name]: list };
      });
    } catch (e) {
      setAsides((prev) => {
        const list = [...(prev[name] ?? [])];
        list[index] = { question, error: e instanceof Error ? e.message : String(e) };
        return { ...prev, [name]: list };
      });
    }
  };

  const threadOpen = view === "chat" && !!selectedBox;

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[clamp(17rem,23vw,20rem)_minmax(0,1fr)]">
      {/* ───────────── machines ───────────── */}
      <aside className={cn("flex min-h-0 flex-col border-r", threadOpen && "hidden md:flex")}>
        <header className="flex items-center gap-2 px-4 pt-4 pb-3">
          <span className="bg-signal grid size-6 shrink-0 place-items-center rounded text-[var(--signal-ink)]">
            <Boxes className="size-3.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-ink text-[13.5px] leading-tight font-semibold tracking-tight">agent-sandbox</p>
            <p className="stamp text-ink-faint mt-0.5 flex items-center gap-1.5">
              <span
                className={cn("size-1.5 rounded-full", live ? "bg-live breathe" : "bg-[var(--danger)]")}
                aria-hidden
              />
              {live ? `${boxes.length} up · ${freshness}` : "offline"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            className="ml-auto"
          >
            {dark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
          </Button>
        </header>

        <div className="flex flex-col gap-1.5 px-3 pb-3">
          <Button variant="signal" size="sm" onClick={newTask} className="w-full justify-start">
            <Plus className="size-3.5" />
            New task
          </Button>
          <button
            type="button"
            onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
            className="text-ink-faint hover:text-ink-dim flex w-full cursor-pointer items-center gap-2 rounded border px-2.5 py-1.5 text-left text-[12.5px] transition-colors"
          >
            <Search className="size-3.5 shrink-0" aria-hidden />
            Search machines
            <kbd className="stamp ml-auto rounded border px-1 py-0.5">⌘K</kbd>
          </button>
        </div>

        {/* The queue: a halted machine is blocking on a person, so it gets its own affordance above
            the list — it is the only thing here with a deadline. */}
        {waiting.length > 0 && (
          <button
            type="button"
            onClick={() => open(waiting[0].name)}
            className="border-signal/40 mx-3 mb-3 flex cursor-pointer items-center gap-2 rounded border bg-[color-mix(in_oklch,var(--signal)_10%,transparent)] px-2.5 py-2 text-left"
          >
            <PauseCircle className="text-signal size-3.5 shrink-0" aria-hidden />
            <span className="text-ink text-[12.5px] font-medium">{waiting.length} waiting on you</span>
            <span className="stamp text-signal ml-auto">answer →</span>
          </button>
        )}

        {error && (
          <p role="alert" className="mx-4 mb-2 flex items-start gap-1.5 text-[12px] text-[var(--danger)]">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <MachineList
          boxes={boxes}
          pending={pending}
          selected={view === "chat" ? selected : null}
          loading={!data && !error}
          onSelect={open}
        />
      </aside>

      {/* ───────────── main ───────────── */}
      <main className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden", !threadOpen && "hidden md:flex")}>
        {/* Two tabs for the two questions this surface answers: what am I building, and what is the
            fleet doing. */}
        <div className="flex items-center gap-1 border-b px-3 py-2 md:px-6">
          <Tab active={view === "chat"} onClick={() => setView("chat")} icon={<MessageSquare />} label="Chat" />
          <Tab
            active={view === "overview"}
            onClick={() => {
              setView("overview");
              setSelected(null);
            }}
            icon={<LayoutGrid />}
            label="Overview"
          />
          <span className="stamp text-ink-faint ml-auto flex items-center gap-1.5">
            <span
              className={cn("size-1.5 rounded-full", workingCount ? "bg-live breathe" : "bg-[var(--line-strong)]")}
              aria-hidden
            />
            {workingCount} working
          </span>
        </div>

        <div className="min-h-0 flex-1">
          {view === "overview" ? (
            <Overview boxes={boxes} onOpen={open} />
          ) : selectedBox ? (
            <Thread
              box={selectedBox}
              asides={asides[selectedBox.name] ?? []}
              onAsk={(q) => void ask(selectedBox.name, q)}
              onBack={() => setSelected(null)}
              onNew={newTask}
              onTornDown={(name) => {
                setSelected(null);
                setAsides((prev) => {
                  const { [name]: _gone, ...rest } = prev;
                  return rest;
                });
              }}
            />
          ) : (
            <Hub
              boxes={boxes}
              sessionRuns={runs}
              onStarted={(box, task) => {
                remember(box, task);
                open(box);
              }}
              onPending={(p) => setPending((prev) => [...prev, p])}
              onSettled={(id) => setPending((prev) => prev.filter((p) => p.id !== id))}
              onOpen={open}
            />
          )}
        </div>
      </main>

      <CommandPalette boxes={boxes} onOpen={open} onNew={newTask} />
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] transition-colors [&_svg]:size-3.5",
        active ? "text-ink bg-[var(--surface)] font-medium" : "text-ink-faint hover:text-ink-dim"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
