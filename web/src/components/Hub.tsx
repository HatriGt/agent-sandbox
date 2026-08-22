import * as React from "react";
import { ArrowRight, ArrowUp, Bug, ClipboardCheck, FileSearch, FlaskConical, GitBranch, Layers, Loader2, Sparkles } from "lucide-react";
import { api, type BoxView } from "@/lib/api";
import { shortName, threadTitle } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { StateStamp } from "@/components/ui/stamp";
import { PromptInput, PromptInputTextarea } from "@/components/ui/prompt-input";
import { cn } from "@/lib/utils";
import type { SessionRun } from "@/hooks/useSessionRuns";

/**
 * The hub: what you see with no machine selected.
 *
 * Starting a run is the primary act of this product, so it gets the centre of the screen rather than
 * a control in a corner. The starters below are the real jobs this system is used for — each one
 * prefills the composer with a working task, because a chip that only inserts a category name makes
 * you do the writing anyway.
 *
 * "This session" is deliberately honest: nothing about a run survives its machine being destroyed,
 * so this lists what THIS browser started, and marks the ones whose machines are gone. Inventing a
 * run history would be inventing data the product does not keep.
 */

interface Starter {
  icon: React.ReactNode;
  label: string;
  /** Prefill — a real task, not a category. */
  task: string;
  needsRepo?: boolean;
}

/** Time-of-day greeting, in the reference's warm register. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const STARTERS: Starter[] = [
  {
    icon: <FileSearch />,
    label: "Explain a codebase",
    task: "Read this repository and write a concise architecture overview: the entry points, the main modules and how they depend on each other, and anything surprising. Do not change any files.",
    needsRepo: true,
  },
  {
    icon: <Bug />,
    label: "Fix a bug, open a PR",
    task: "Find and fix the following bug, add a regression test, and open a pull request:\n\n",
    needsRepo: true,
  },
  {
    icon: <FlaskConical />,
    label: "Run the tests",
    task: "Install dependencies, run the full test suite, and report exactly what fails with the command and the key error lines. Do not fix anything yet — stop and tell me what you found.",
    needsRepo: true,
  },
  {
    icon: <ClipboardCheck />,
    label: "Review a diff",
    task: "Review the changes on the current branch against main. Report correctness bugs first, then anything that could be simpler. Do not change files.",
    needsRepo: true,
  },
  {
    icon: <Layers />,
    label: "Research, no repo",
    task: "Write a thorough, well-sourced report on the following, into /workspace/report.md:\n\n",
  },
];

export function Hub({
  boxes,
  sessionRuns,
  onStarted,
  onPending,
  onSettled,
  onOpen,
}: {
  boxes: BoxView[];
  sessionRuns: SessionRun[];
  onStarted: (box: string, task: string) => void;
  onPending: (p: { id: string; task: string }) => void;
  onSettled: (id: string) => void;
  onOpen: (name: string) => void;
}) {
  const [task, setTask] = React.useState("");
  const [repo, setRepo] = React.useState("");
  const [ref, setRef] = React.useState("");
  const [showRepo, setShowRepo] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const applyStarter = (s: Starter) => {
    setTask(s.task);
    if (s.needsRepo) setShowRepo(true);
    // Put the caret at the end so a template that expects detail can be finished by typing.
    // prompt-kit's PromptInputTextarea owns its own ref via context, so we reach it by id.
    requestAnimationFrame(() => {
      const el = document.getElementById("new-task") as HTMLTextAreaElement | null;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

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
      if (res.ok) onStarted(res.box, t);
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

  const live = new Set(boxes.map((b) => b.name));
  // Center the composer only on a truly empty hub; once there's session history, anchor to the top so
  // the composer doesn't jump downward as the list grows under it.
  const hasHistory = sessionRuns.length > 0;

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div
        className={cn(
          "mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-5 py-10",
          hasHistory ? "justify-start pt-[8vh]" : "justify-center"
        )}
      >
        <div className="text-center">
          <span className="text-ash mb-3 inline-flex items-center gap-1.5 text-meta">
            <Sparkles className="text-azure-text size-4" aria-hidden />
            agent-sandbox
          </span>
          <h1 className="text-ink text-h1 leading-[1.05] font-semibold tracking-[-0.03em] sm:text-display">
            {greeting()}
          </h1>
          <p className="text-ash mx-auto mt-3 max-w-[52ch] text-h3 leading-snug">
            Where should we start? Describe a task and a fresh microVM will pick it up.
          </p>
        </div>

        {/* starters — each prefills a real task, as reference-style quick-action chips */}
        <div className="flex flex-wrap justify-center gap-2">
          {STARTERS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => applyStarter(s)}
              className="text-ash hover:text-ink flex cursor-pointer items-center gap-2 rounded-full border bg-[var(--card)] px-3.5 py-2 text-meta transition-colors hover:bg-[var(--surface)] hover:border-[var(--line-strong)] [&_svg]:size-3.5"
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </div>

        {/* composer */}
        {/* ChatGPT composer geometry: one deeply-rounded surface, controls inside on the bottom
            row, hint text below it. */}
        <PromptInput
          value={task}
          onValueChange={setTask}
          onSubmit={submit}
          isLoading={busy}
          className="bg-card rounded-2xl border-[var(--line)] elevate-sm"
        >
          <label htmlFor="new-task" className="sr-only">
            Describe the task for a new machine
          </label>
          <PromptInputTextarea id="new-task" placeholder="Message a new sandbox…" className="min-h-14" />

          {showRepo && (
            <div className="grid gap-2 px-1 pt-2 sm:grid-cols-[2fr_1fr]">
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/repo"
                aria-label="Repository, owner slash name"
                className="text-foreground placeholder:text-muted-foreground border-border bg-background focus:border-ring rounded-md border px-3 py-2 font-mono text-meta outline-none"
              />
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="branch"
                aria-label="Git ref"
                className="text-foreground placeholder:text-muted-foreground border-border bg-background focus:border-ring rounded-md border px-3 py-2 font-mono text-meta outline-none"
              />
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setShowRepo((v) => !v)} aria-expanded={showRepo}>
              <GitBranch className="size-3.5" />
              <span className="stamp">{repo.trim() || "attach a repo"}</span>
            </Button>
            <Button
              size="icon"
              onClick={submit}
              disabled={busy || !task.trim()}
              aria-label="Boot a machine with this task"
              className="ml-auto rounded-full"
            >
              {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          </div>
        </PromptInput>

        <p className="text-ash -mt-5 min-h-4 text-center text-micro">
          {error ? (
            <span className="text-[var(--danger)]" role="alert">
              {error}
            </span>
          ) : (
            "Enter boots a machine · no repo runs a task-only machine"
          )}
        </p>

        {/* this session — real, and honest about what does not persist */}
        {sessionRuns.length > 0 && (
          <div className="border-t pt-6">
            <div className="flex items-center gap-2 pb-3">
              <p className="stamp text-ash">previous runs</p>
              <span className="stamp text-ash tabular ml-auto">this session</span>
            </div>
            <ul className="flex flex-col">
              {sessionRuns.slice(0, 6).map((r) => {
                const box = boxes.find((b) => b.name === r.box);
                const gone = !live.has(r.box);
                return (
                  <li key={r.box}>
                    <button
                      type="button"
                      disabled={gone}
                      onClick={() => onOpen(r.box)}
                      className={cn(
                        "group flex w-full items-center gap-3 border-b py-2.5 text-left last:border-b-0",
                        gone ? "cursor-default opacity-45" : "cursor-pointer"
                      )}
                    >
                      {box ? (
                        <StateStamp state={box.runState} exitCode={box.exitCode} className="shrink-0" />
                      ) : (
                        <span className="stamp text-ash shrink-0">destroyed</span>
                      )}
                      <span className="text-ink min-w-0 flex-1 truncate text-meta">
                        {box ? threadTitle(box) : r.task}
                      </span>
                      <span className="text-ash shrink-0 font-mono text-micro">{shortName(r.box)}</span>
                      {!gone && (
                        <ArrowRight className="text-ash size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="text-ash mt-3 text-micro">
              A machine's history dies with it — nothing here is stored on the server.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
