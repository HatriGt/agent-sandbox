import * as React from "react";
import { ChevronDown, GitBranch, Loader2, Send } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatInput } from "@/components/chat/chat-input";
import { cn } from "@/lib/utils";

/**
 * Start a sandbox by describing the task. Always on screen rather than behind a "+ New" button:
 * starting a run is the primary act of this product, not a secondary setting.
 *
 * Repo and ref are progressive disclosure — collapsed by default because the common case is a
 * task-only sandbox, and a form that opens with three empty fields makes the simple case look hard.
 */
export function Composer({
  onStarted,
  onPending,
  onSettled,
}: {
  onStarted: (box: string) => void;
  onPending: (p: { id: string; task: string }) => void;
  onSettled: (id: string) => void;
}) {
  const [task, setTask] = React.useState("");
  const [repo, setRepo] = React.useState("");
  const [ref, setRef] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
      // A validation gap comes back as a question, not an error: put the task back so it can be fixed.
      else {
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
    <div className="bg-sidebar border-t p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
      <div
        className={cn(
          "bg-card rounded-lg border transition-shadow",
          "focus-within:border-ring focus-within:ring-ring/40 focus-within:ring-[3px]"
        )}
      >
        <label htmlFor="new-task" className="sr-only">
          Describe a task to run in a new sandbox
        </label>
        <ChatInput
          id="new-task"
          value={task}
          disabled={busy}
          onChange={(e) => setTask(e.target.value)}
          onSubmitMessage={submit}
          placeholder="Describe a task for a new sandbox…"
        />

        {open && (
          <div className="grid gap-2 px-2 pb-2 sm:grid-cols-2">
            <Input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repo (optional)"
              aria-label="Repository, owner/name"
              className="h-8 text-xs"
            />
            <Input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="branch or ref (optional)"
              aria-label="Git ref"
              className="h-8 text-xs"
            />
          </div>
        )}

        <div className="flex items-center gap-1 px-2 pb-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="gap-1.5 text-xs"
          >
            <GitBranch />
            {repo.trim() ? <span className="font-mono">{repo.trim()}</span> : "Repo"}
            <ChevronDown className={cn("transition-transform duration-150", open && "rotate-180")} />
          </Button>

          <Button
            size="icon-touch"
            onClick={submit}
            disabled={busy || !task.trim()}
            aria-label="Start a new sandbox with this task"
            className="ml-auto shrink-0"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-destructive mt-1.5 px-1 text-xs leading-relaxed">
          {error}
        </p>
      ) : (
        <p className="text-muted-foreground/80 mt-1.5 px-1 text-[11px]">
          Enter starts a run · no repo runs a task-only sandbox
        </p>
      )}
    </div>
  );
}
