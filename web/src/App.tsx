import * as React from "react";
import { Boxes, LayoutGrid, MessageSquare, Moon, PauseCircle, Plus, Search, Sun, TriangleAlert } from "lucide-react";
import { api, type BoxView } from "@/lib/api";
import { POLL_MS, isUp } from "@/lib/format";
import { usePoll } from "@/hooks/usePoll";
import { useStableBoxes } from "@/hooks/useStableBoxes";
import { useSessionRuns } from "@/hooks/useSessionRuns";
import { Button } from "@/components/ui/button";
import { MachineList } from "@/components/MachineList";
import { Hub } from "@/components/Hub";
import { Sandboxes } from "@/components/Sandboxes";
import { CommandPalette } from "@/components/CommandPalette";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
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

/** Light by default (blue-on-white product theme); persisted, toggling the `.dark` class on <html>. */
function useTheme() {
  const [dark, setDark] = React.useState(() => {
    try {
      return localStorage.getItem("asb-theme") === "dark";
    } catch {
      return false;
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

type View = "chat" | "sandboxes";

export default function App() {
  const { dark, toggle } = useTheme();
  const { data, error, live, updatedAt } = usePoll<BoxView[]>((signal) => api.monitor(signal), POLL_MS);
  const freshness = useFreshness(updatedAt);
  const { runs, remember } = useSessionRuns();

  const [view, setView] = React.useState<View>("chat");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<{ id: string; task: string }[]>([]);
  const [asides, setAsides] = React.useState<Record<string, Aside[]>>({});
  // Replies this browser sent, per machine: the server keeps no transcript of them.
  const [replies, setReplies] = React.useState<Record<string, string[]>>({});

  // Filter to running, then hold a machine briefly after it stops being reported: a box being
  // reaped at its max-duration makes the host disagree with itself for a few seconds, and without
  // this its card blinked in and out once a second.
  const reported = React.useMemo(() => (data ? data.filter(isUp) : null), [data]);
  const boxes = useStableBoxes(reported);
  const selectedBox = boxes.find((b) => b.name === selected) ?? null;
  const waiting = boxes.filter((b) => b.runState === "waiting");
  const working = boxes.filter((b) => b.runState === "running").length;

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
    <TooltipProvider delayDuration={400}>
      <Toaster position="bottom-center" />
      {/* Floating shell: the canvas breathes around two detached, elevated cards (rail + workspace). */}
      <div className="grid h-full grid-cols-1 gap-0 p-0 md:grid-cols-[clamp(17rem,23vw,20rem)_minmax(0,1fr)] md:gap-3 md:p-3">
      {/* ───────────── machines (floating rail) ───────────── */}
      <aside
        className={cn(
          "bg-card flex min-h-0 flex-col overflow-hidden border-r md:rounded-2xl md:border md:elevate",
          threadOpen && "hidden md:flex"
        )}
      >
        <header className="flex items-center gap-2 px-4 pt-4 pb-3">
          <span className="bg-azure grid size-6 shrink-0 place-items-center rounded-md text-[var(--accent-fg)]">
            <Boxes className="size-3.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-ink text-meta leading-tight font-semibold tracking-tight">agent-sandbox</p>
            <p className="stamp text-ash mt-0.5 flex items-center gap-1.5">
              <span
                className={cn("size-1.5 rounded-full", live ? "bg-azure breathe" : "bg-[var(--danger)]")}
                aria-hidden
              />
              {live
                ? `${boxes.length} up${working ? ` · ${working} working` : ""} · ${freshness}`
                : "offline"}
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
          <Button variant="primary" size="default" onClick={newTask} className="w-full justify-start">
            <Plus />
            New task
          </Button>
          <button
            type="button"
            onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
            className="text-ash hover:text-ink flex w-full cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-left text-meta transition-colors hover:bg-[var(--surface)]"
          >
            <Search className="size-3.5 shrink-0" aria-hidden />
            Search machines
            <kbd className="stamp ml-auto rounded border px-1.5 py-0.5">⌘K</kbd>
          </button>
        </div>

        {/* Sections. "Sandboxes" is its own destination: the chat answers "what am I building",
            this answers "what is running on my VPS, and does any of it need me". */}
        <div className="flex flex-col gap-0.5 px-3 pb-2">
          <NavItem
            active={view === "chat"}
            onClick={() => setView("chat")}
            icon={<MessageSquare />}
            label="Chat"
          />
          <NavItem
            active={view === "sandboxes"}
            onClick={() => {
              setView("sandboxes");
              setSelected(null);
            }}
            icon={<LayoutGrid />}
            label="Sandboxes"
            badge={boxes.length || undefined}
          />
        </div>

        {/* A halted machine blocks on a person — the only thing here with a deadline. */}
        {waiting.length > 0 && (
          <button
            type="button"
            onClick={() => open(waiting[0].name)}
            className="mx-3 mb-3 flex cursor-pointer items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--attention)_45%,transparent)] bg-[color-mix(in_srgb,var(--attention)_12%,transparent)] px-3 py-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--attention)_18%,transparent)]"
          >
            <PauseCircle className="size-3.5 shrink-0 text-[var(--attention-text)]" aria-hidden />
            <span className="text-ink text-meta font-medium">{waiting.length} waiting on you</span>
            <span className="stamp ml-auto text-[var(--attention-text)]">answer →</span>
          </button>
        )}

        <p className="stamp text-ash px-4 pt-2 pb-1.5">machines</p>

        {error && (
          <p role="alert" className="mx-4 mb-2 flex items-start gap-1.5 text-micro text-[var(--danger)]">
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

      {/* ───────────── main (floating workspace) ───────────── */}
      <main
        className={cn(
          "bg-card flex min-h-0 min-w-0 flex-col overflow-hidden md:rounded-2xl md:border md:elevate",
          !threadOpen && "hidden md:flex"
        )}
      >
        <div className="min-h-0 flex-1">
          {view === "sandboxes" ? (
            <Sandboxes
              boxes={boxes}
              onOpen={open}
              onDestroyed={(name) => {
                if (selected === name) setSelected(null);
              }}
            />
          ) : selectedBox ? (
            <Thread
              box={selectedBox}
              asides={asides[selectedBox.name] ?? []}
              replies={replies[selectedBox.name] ?? []}
              onAsk={(q) => void ask(selectedBox.name, q)}
              onReplied={(text) =>
                setReplies((prev) => ({ ...prev, [selectedBox.name]: [...(prev[selectedBox.name] ?? []), text] }))
              }
              onBack={() => setSelected(null)}
              onNew={newTask}
              onTornDown={(name) => {
                setSelected(null);
                setAsides((prev) => {
                  const { [name]: _gone, ...rest } = prev;
                  return rest;
                });
                setReplies((prev) => {
                  const { [name]: _dropped, ...rest } = prev;
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
    </TooltipProvider>
  );
}

function NavItem({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-meta transition-colors",
        "[&_svg]:size-4",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-ash hover:text-ink hover:bg-[var(--surface)]"
      )}
    >
      {icon}
      {label}
      {badge != null && <span className="stamp text-ash tabular ml-auto">{badge}</span>}
    </button>
  );
}
