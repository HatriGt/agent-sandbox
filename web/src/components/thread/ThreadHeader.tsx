import * as React from "react";
import { ArrowLeft, FileText, FolderTree, Link2, Loader2, MoreHorizontal, Pencil, Pin, PinOff, Plus, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { BoxView } from "@/lib/api";
import { friendlyName, roleLabel, shortName } from "@/lib/format";
import { deadlineLabel, deadlineShort, type Deadline, type DisplayState } from "@/lib/lifecycle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, MenuHint } from "@/components/ui/dropdown-menu";
import { StateStamp } from "@/components/ui/stamp";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RepoPicker } from "@/components/RepoPicker";
import { PullRequestFloat } from "./PullRequestFloat";
import { cn } from "@/lib/utils";

/**
 * The thread's masthead: one block, two lines.
 *
 *   line 1 — the title (the only bold thing) and two controls: Files, and a ⋯ menu holding everything
 *            else (keep, rename, copy link/transcript, new task from this, destroy).
 *   line 2 — context as a sentence in the secondary colour: state · machine · repos · PR · lifecycle,
 *            and while the agent works, what it is doing right now.
 *
 * Telemetry lives in the machine name's tooltip; the loud red button lives inside the confirm dialog,
 * where destroying genuinely is the primary action.
 */
export function ThreadHeader({
  box,
  title,
  state,
  exitCode,
  sleeping,
  kept,
  keeping,
  deadline,
  repos,
  attaching,
  pull,
  activity,
  showWorkspace,
  removing,
  onBack,
  onNew,
  onToggleWorkspace,
  onToggleKeep,
  onRename,
  onAttach,
  onDestroy,
  onCopyTranscript,
  onNewFromThis,
}: {
  box: BoxView;
  title: string;
  state: DisplayState;
  exitCode?: number;
  sleeping: boolean;
  kept: boolean;
  keeping: boolean;
  deadline: Deadline;
  repos: { name: string; branch?: string }[];
  attaching: string | null;
  pull?: { url: string; repo: string; number: number };
  /** What the agent is doing right now, while running. */
  activity?: string | null;
  showWorkspace: boolean;
  removing: boolean;
  onBack: () => void;
  onNew: () => void;
  onToggleWorkspace: () => void;
  onToggleKeep: () => void;
  onRename: (title: string) => Promise<void>;
  onAttach: (fullName: string) => void;
  onDestroy: () => Promise<void>;
  onCopyTranscript: () => Promise<string>;
  onNewFromThis: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(title);
  const [confirm, setConfirm] = React.useState(false);
  const [addRepo, setAddRepo] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => setEditing(false), [box.name]);

  const startRename = () => {
    setDraft(title);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };
  const commit = async () => {
    const t = draft.trim();
    setEditing(false);
    if (!t || t === title) return;
    try {
      await onRename(t);
    } catch (e) {
      toast.error("Could not rename", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    toast.success("Link copied");
  };
  const copyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(await onCopyTranscript());
      toast.success("Transcript copied as Markdown");
    } catch (e) {
      toast.error("Could not copy", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const short = deadlineShort(deadline);
  const long = deadlineLabel(deadline);
  const vitals = [box.uptime && `${sleeping ? "ran for" : "up"} ${box.uptime}`, box.cpu && `cpu ${box.cpu}`, box.mem && `memory ${box.mem}`, roleLabel(box.role)].filter(Boolean).join(" · ");

  return (
    <header className="shrink-0 border-b px-3 py-2.5 md:px-5">
      {/* Line 1: identity + controls */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to machines" className="-ml-1 md:hidden">
          <ArrowLeft />
        </Button>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") setEditing(false);
            }}
            aria-label="Run title"
            maxLength={80}
            className="text-foreground bg-muted h-8 min-w-0 flex-1 rounded-md px-2 text-h3 font-semibold tracking-[-0.01em] outline-none"
          />
        ) : (
          <h1 className="group/title flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              onClick={startRename}
              title="Rename"
              className="text-foreground min-w-0 cursor-text truncate text-left text-h3 font-semibold tracking-[-0.01em] no-press"
            >
              {title}
            </button>
            <Pencil className="text-faint size-3 shrink-0 opacity-0 transition-opacity group-hover/title:opacity-100" aria-hidden />
          </h1>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={onNew} aria-label="New task" className="md:hidden">
            <Plus />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={onToggleWorkspace} aria-pressed={showWorkspace} className={cn("text-muted-foreground", showWorkspace && "bg-accent text-foreground")} disabled={sleeping}>
                <FolderTree />
                <span className="hidden sm:inline">Files</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{sleeping ? "Files — available once the sandbox is awake" : "Browse, diff and edit the workspace"}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions" className="text-muted-foreground">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {box.role !== "pool-free" && (
                <DropdownMenuItem onSelect={onToggleKeep} disabled={keeping}>
                  {kept ? <PinOff /> : <Pin />}
                  {kept ? "Release" : "Keep"}
                  <MenuHint>{kept ? "kept" : "sleeps · auto-destroyed"}</MenuHint>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={startRename}>
                <Pencil />
                Rename
              </DropdownMenuItem>
              {!sleeping && (
                <DropdownMenuItem onSelect={() => setAddRepo(true)} disabled={!!attaching}>
                  <Plus />
                  Attach a repository
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={copyLink}>
                <Link2 />
                Copy link
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={copyTranscript}>
                <FileText />
                Copy transcript
                <MenuHint>Markdown</MenuHint>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onNewFromThis} disabled={!box.task}>
                <RotateCw />
                New task from this
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
                <Trash2 />
                Destroy machine…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Line 2: context as a sentence */}
      <div className="text-muted-foreground mt-1 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-meta">
        <StateStamp state={state} exitCode={exitCode} />
        <Dot />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="stamp inline-flex items-center gap-1" title={shortName(box.name)}>
              {kept && <Pin className="text-live size-3 fill-current" aria-label="Kept" />}
              {friendlyName(box.name)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{vitals || shortName(box.name)}</TooltipContent>
        </Tooltip>

        {!sleeping && (
          <>
            <Dot />
            <span className="scrollbar-none flex min-w-0 items-center gap-1.5 overflow-x-auto">
              {repos.map((r) => (
                <Tooltip key={r.name}>
                  <TooltipTrigger asChild>
                    <span className="bg-muted text-foreground stamp inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5">
                      {r.name}
                      {r.branch && <span className="text-muted-foreground">@{r.branch}</span>}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">/workspace/{r.name} — @ mentions search here</TooltipContent>
                </Tooltip>
              ))}
              {attaching && (
                <span className="stamp text-muted-foreground inline-flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  cloning {attaching.split("/")[1]}…
                </span>
              )}
              <span className="relative shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setAddRepo((v) => !v)}
                      aria-expanded={addRepo}
                      aria-label={repos.length ? "Attach another repository" : "Attach a repository"}
                      disabled={!!attaching}
                      className={cn("hover:text-foreground hover:bg-muted inline-flex h-6 cursor-pointer items-center gap-1 rounded-md text-micro font-medium transition-colors disabled:opacity-60", repos.length ? "text-faint w-6 justify-center" : "text-muted-foreground px-1.5")}
                    >
                      <Plus className="size-3" aria-hidden />
                      {!repos.length && "Attach a repo"}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{repos.length ? "Attach another repository" : "The agent clones it into /workspace"}</TooltipContent>
                </Tooltip>
                {addRepo && (
                  <RepoPicker className="absolute top-full left-0 z-20 mt-1" multi={false} selected={repos.map((r) => ({ repo: r.name }))} onToggle={(r) => (onAttach(r.fullName), setAddRepo(false))} onClose={() => setAddRepo(false)} />
                )}
              </span>
            </span>
          </>
        )}

        {pull && (
          <>
            <Dot />
            <PullRequestFloat key={pull.url} session={box.name} {...pull} />
          </>
        )}

        <span className="ml-auto flex items-center gap-2">
          {activity && (
            <span className="text-live inline-flex items-center gap-1.5 text-micro font-medium">
              <span className="bg-live breathe size-1.5 rounded-full" aria-hidden />
              <span className="max-w-[16rem] truncate">{activity}</span>
            </span>
          )}
          {short && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn("text-faint text-micro", deadline.remainingSec != null && deadline.remainingSec < 300 && "text-attention-text")}>{short}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{long}</TooltipContent>
            </Tooltip>
          )}
        </span>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent onOpenAutoFocus={(e) => (e.preventDefault(), cancelRef.current?.focus())} title={`Destroy ${friendlyName(box.name)}?`} description="Stops the microVM and discards its workspace — files, checkouts and uncommitted work. The conversation is not recoverable afterwards.">
          <div className="flex justify-end gap-2">
            <Button ref={cancelRef} variant="outline" size="sm" onClick={() => setConfirm(false)} disabled={removing}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={removing}
              onClick={async () => {
                await onDestroy();
                setConfirm(false);
              }}
            >
              {removing ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {removing ? "Destroying…" : "Destroy"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}

function Dot() {
  return (
    <span className="text-faint select-none" aria-hidden>
      ·
    </span>
  );
}
