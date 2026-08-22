import * as React from "react";
import { Moon, Sun, TriangleAlert } from "lucide-react";
import { api, type BoxView } from "@/lib/api";
import { POLL_MS, isUp } from "@/lib/format";
import { usePoll } from "@/hooks/usePoll";
import { Button } from "@/components/ui/button";
import { ThreadList } from "@/components/ThreadList";
import { Conversation, type Aside } from "@/components/Conversation";
import { NewTask } from "@/components/NewTask";
import { cn } from "@/lib/utils";

/** Dark by default (a desk, often at night); the choice persists and both themes are fully derived. */
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

export default function App() {
  const { dark, toggle } = useTheme();
  const { data, error, live } = usePoll<BoxView[]>((signal) => api.monitor(signal), POLL_MS);

  const [selected, setSelected] = React.useState<string | null>(null);
  const [isNew, setIsNew] = React.useState(true);
  const [pending, setPending] = React.useState<{ id: string; task: string }[]>([]);
  // Co-pilot exchanges per machine, so switching threads and returning keeps the margin notes.
  const [asides, setAsides] = React.useState<Record<string, Aside[]>>({});

  const boxes = React.useMemo(() => (data ?? []).filter(isUp), [data]);
  const selectedBox = boxes.find((b) => b.name === selected) ?? null;
  const waiting = boxes.filter((b) => b.runState === "waiting").length;

  // A machine that vanished (destroyed, auto-stopped) must not leave a dead pane behind.
  React.useEffect(() => {
    if (selected && data && !boxes.some((b) => b.name === selected)) {
      setSelected(null);
      setIsNew(true);
    }
  }, [selected, data, boxes]);

  const openThread = (name: string) => {
    setSelected(name);
    setIsNew(false);
  };

  /** Ask the co-pilot, rendering the pending note immediately so the thread never looks frozen. */
  const ask = async (name: string, question: string) => {
    setAsides((prev) => ({ ...prev, [name]: [...(prev[name] ?? []), { question }] }));
    const index = (asides[name] ?? []).length;
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

  const showConversation = !isNew && selectedBox;

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[clamp(17rem,22vw,20rem)_minmax(0,1fr)]">
      {/* ── threads ── */}
      <aside
        className={cn(
          "flex min-h-0 flex-col border-r border-[var(--line)] bg-[var(--bg)]",
          // Mobile: one surface at a time.
          showConversation && "hidden md:flex"
        )}
      >
        <header className="flex items-center gap-2 px-4 pb-3 pt-4">
          <div className="min-w-0">
            <p className="text-ink text-[13.5px] font-semibold tracking-tight">agent-sandbox</p>
            <p className="text-ink-faint stamp mt-0.5 flex items-center gap-1.5">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  live ? "bg-live breathe" : "bg-[var(--danger)]"
                )}
                aria-hidden
              />
              {live ? `${boxes.length} up` : "offline"}
              {waiting > 0 && <span className="text-signal ml-1">· {waiting} need you</span>}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            className="ml-auto"
          >
            {dark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
          </Button>
        </header>

        {error && (
          <p role="alert" className="mx-4 mb-2 flex items-start gap-1.5 text-[12px] text-[var(--danger)]">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <ThreadList
          boxes={boxes}
          pending={pending}
          selected={selected}
          isNew={isNew}
          loading={!data && !error}
          onSelect={openThread}
          onNew={() => {
            setIsNew(true);
            setSelected(null);
          }}
        />
      </aside>

      {/* ── thread ── */}
      <main className={cn("min-h-0 min-w-0 overflow-hidden bg-[var(--bg)]", !showConversation && "hidden md:block")}>
        {showConversation ? (
          <Conversation
            box={selectedBox}
            asides={asides[selectedBox.name] ?? []}
            onAsk={(q) => void ask(selectedBox.name, q)}
            onBack={() => {
              setSelected(null);
              setIsNew(true);
            }}
            onTornDown={(name) => {
              setSelected(null);
              setIsNew(true);
              setAsides((prev) => {
                const { [name]: _gone, ...rest } = prev;
                return rest;
              });
            }}
          />
        ) : (
          <NewTask
            onStarted={openThread}
            onPending={(p) => setPending((prev) => [...prev, p])}
            onSettled={(id) => setPending((prev) => prev.filter((p) => p.id !== id))}
          />
        )}
      </main>

      {/* Mobile: the new-task pane is reachable when a thread is open, since the sidebar is hidden. */}
      {showConversation && (
        <Button
          variant="signal"
          size="touch"
          onClick={() => {
            setIsNew(true);
            setSelected(null);
          }}
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] right-4 z-20 rounded-full shadow-[0_6px_20px_-6px_rgba(0,0,0,.7)] md:hidden"
          aria-label="Start a new task"
        >
          + New
        </Button>
      )}
    </div>
  );
}
