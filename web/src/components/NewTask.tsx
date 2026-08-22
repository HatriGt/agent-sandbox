import * as React from "react";
import { ArrowUp, GitBranch } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Composer } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * The empty thread: a centred prompt, the way a chat app opens. This is the primary act of the
 * product, so it gets the whole pane rather than a control in a corner.
 *
 * Repo and ref stay folded away — most runs are task-only, and opening with three empty fields
 * makes the simple case look like paperwork.
 */
export function NewTask({ onStarted, onPending, onSettled }: {
  onStarted: (box: string) => void;
  onPending: (p: { id: string; task: string }) => void;
  onSettled: (id: string) => void;
}) {
  const [task, setTask] = React.useState("");
  const [repo, setRepo] = React.useState("");
  const [ref, setRef] = React.useState("");
  const [showRepo, setShowRepo] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => inputRef.current?.focus(), []);

  const submit = async () => {
    const t = task.trim();
    if (!t || busy) return;
    const id = `pending-${Date.now()}`;
    setBusy(true);
    setError(null);
    setTask("");
    onPending({ id, task: t });
    try {
      const res = await api.delegate({ task: t, repo: repo.trim() || undefined, ref: ref.trim() || undefined });
      if (res.ok) onStarted(res.box);
      else {
        // A validation gap is a question, not a failure: hand the text back so it can be fixed.
        setError(res.question);
        setTask(t);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTask(t);
    } finally {
      onSettled(id);
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-2xl">
        <p className="stamp text-ink-faint pb-2">new machine</p>
        <h1 className="text-ink text-[26px] font-semibold leading-tight tracking-tight">
          What should it build?
        </h1>
        <p className="text-ink-dim mt-2 max-w-[60ch] text-[14px] leading-relaxed">
          A fresh microVM boots, runs an autonomous agent against the task, and stops itself when
          idle. It will pause and ask if it needs a decision from you.
        </p>

        <div
          className={cn(
            "mt-6 rounded-md border bg-[var(--surface)] transition-colors",
            "border-[var(--line-strong)] focus-within:border-[var(--signal)]"
          )}
        >
          <label htmlFor="new-task" className="sr-only">
            Describe the task for a new sandbox
          </label>
          <Composer
            id="new-task"
            ref={inputRef}
            value={task}
            disabled={busy}
            onChange={(e) => setTask(e.target.value)}
            onSend={submit}
            placeholder="Refactor the auth service and open a PR…"
            className="min-h-24"
          />

          {showRepo && (
            <div className="grid gap-2 px-3 pb-3 sm:grid-cols-[2fr_1fr]">
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/repo"
                aria-label="Repository, owner slash name"
                className="text-ink placeholder:text-ink-faint rounded-sm border border-[var(--line-strong)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-[12.5px] outline-none focus:border-[var(--signal)]"
              />
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="branch"
                aria-label="Git ref"
                className="text-ink placeholder:text-ink-faint rounded-sm border border-[var(--line-strong)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-[12.5px] outline-none focus:border-[var(--signal)]"
              />
            </div>
          )}

          <div className="flex items-center gap-2 px-2 pb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowRepo((v) => !v)}
              aria-expanded={showRepo}
              className="stamp"
            >
              <GitBranch className="size-3" />
              {repo.trim() ? repo.trim() : "attach a repo"}
            </Button>
            <Button
              variant="signal"
              size="md"
              onClick={submit}
              disabled={busy || !task.trim()}
              className="ml-auto"
            >
              {busy ? "booting" : "Boot machine"}
              <ArrowUp className="size-3.5" />
            </Button>
          </div>
        </div>

        <p className="text-ink-faint mt-2 min-h-4 text-[11.5px]">
          {error ? (
            <span className="text-[var(--danger)]" role="alert">
              {error}
            </span>
          ) : (
            "Enter boots · no repo runs a task-only machine"
          )}
        </p>
      </div>
    </div>
  );
}
