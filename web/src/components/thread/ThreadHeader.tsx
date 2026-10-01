import * as React from "react";
import { ArrowLeft, Check, FileText, FolderTree, HardDrive, Link2, Loader2, MemoryStick, Moon, MoreHorizontal, Pencil, Pin, PinOff, Plus, RotateCw, Trash2 } from "lucide-react";
import { Swap } from "@/components/ui/swap";
import { toast } from "sonner";
import type { BoxView } from "@/lib/api";
import { fmtAgo, friendlyName, roleLabel, shortName } from "@/lib/format";
import { deadlineLabel, deadlineShort, fmtDuration, fmtUsage, type Deadline, type DisplayState } from "@/lib/lifecycle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, MenuHint } from "@/components/ui/dropdown-menu";
import { StatePill } from "@/components/ui/stamp";
import { UsageMeter } from "@/components/ui/usage-meter";
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
  pulls,
  activity,
  showWorkspace,
  removing,
  sleepNow,
  sleepBusy,
  memoryTiers,
  memoryTier,
  memoryBusy,
  onSetMemory,
  diskTiers,
  diskTier,
  diskBusy,
  onSetDisk,
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
  pulls?: { url: string; repo: string; number: number }[];
  /** What the agent is doing right now, while running. */
  activity?: string | null;
  showWorkspace: boolean;
  removing: boolean;
  /** Put the machine to sleep now (msb stop, nothing removed). Hidden while already asleep. */
  sleepNow?: () => void;
  sleepBusy?: boolean;
  /** Memory tiers the machine may be resized to (server-supplied). Omit to hide the control. */
  memoryTiers?: string[];
  /** The tier the machine is on now, for marking the active row. */
  memoryTier?: string;
  memoryBusy?: boolean;
  onSetMemory?: (tier: string) => Promise<void>;
  /** Root-disk tiers the machine may GROW to — already filtered, since a shrink is impossible. */
  diskTiers?: string[];
  diskTier?: string;
  diskBusy?: boolean;
  onSetDisk?: (tier: string) => Promise<void>;
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
  // The tier the user picked, awaiting confirmation. A resize is a reboot, so it gets the same
  // confirm-dialog treatment as Destroy rather than firing straight off the menu.
  const [resizeTo, setResizeTo] = React.useState<{ kind: "memory" | "disk"; tier: string } | null>(null);
  const [addRepo, setAddRepo] = React.useState(false);
  const pickerRef = React.useRef<HTMLSpanElement>(null);
  const openFromMenu = React.useRef(false);
  React.useEffect(() => {
    if (!addRepo) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setAddRepo(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [addRepo]);
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
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied");
    } catch (e) {
      toast.error("Could not copy the link", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  // The copy item's icon flips to a check for a beat — the menu may already be closed, but a
  // reopen within the window still shows the confirmation in place.
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const copyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(await onCopyTranscript());
      setCopied(true);
      toast.success("Transcript copied as Markdown");
    } catch (e) {
      toast.error("Could not copy", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const short = deadlineShort(deadline);
  const when = sleeping
    ? box.asleepSec != null && box.asleepSec >= 60
      ? `asleep ${fmtDuration(box.asleepSec)}`
      : null
    : (state === "done" || state === "waiting") && box.lastOutputAt
      ? `${state === "done" ? "finished" : "asked"} ${fmtAgo(box.lastOutputAt)}`
      : box.runState === "running" && box.lastOutputAt
        ? `last action ${fmtAgo(box.lastOutputAt)}`
        : null;
  // Budget line: tokens always; dollars only when the model has a known price (never guessed).
  const bud = box.budget;
  const budgetLine = bud
    ? `budget ${bud.tokens.toLocaleString("en-US")}${bud.maxTokens ? `/${bud.maxTokens.toLocaleString("en-US")}` : ""} tok` +
      (bud.usd !== undefined ? ` · $${bud.usd.toFixed(2)}${bud.maxUsd ? `/$${bud.maxUsd.toFixed(2)}` : ""}` : bud.maxUsd ? " · $ n/a (unpriced model)" : "") +
      ` · ${bud.maxMinutes} min cap`
    : null;
  const long = deadlineLabel(deadline);
  // Which resource's request is in flight — the confirm dialog is shared between the two.
  const busyFor = resizeTo?.kind === "disk" ? diskBusy : memoryBusy;
  // The harness this thread started on ("Harness: Bug fixer · asks before guessing · verify on done"):
  // its rules live in the agent's system prompt, so this line is where the operator sees them applied.
  const vitals = [box.harness && `Harness: ${box.harness.line}`, box.agent && box.agent !== "claude" && `agent ${({ omp: "oh-my-pi", codex: "Codex CLI", opencode: "OpenCode" } as Record<string, string>)[box.agent] ?? box.agent}`, box.uptime && `${sleeping ? "ran for" : "up"} ${box.uptime}`, box.cpu && `cpu ${box.cpu}`, box.memUsage && `memory ${fmtUsage(box.memUsage)}`, box.disk && `disk ${fmtUsage(box.disk)}`, roleLabel(box.role), budgetLine].filter(Boolean).join(" · ");

  // The conversation scroller is a sibling rendered by Thread, not a child, so there is nothing to
  // ref. Scroll events don't bubble but they DO capture, so one capture-phase listener on the
  // header's parent hears every scroller below it; we keep only the conversation's (aria-label),
  // and flip data-scrolled so the hairline underneath becomes a shadow while content is under it.
  const headerRef = React.useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const parent = headerRef.current?.parentElement;
    if (!parent) return;
    const onScroll = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || !t.closest('[aria-label="Conversation"]')) return;
      setScrolled(t.scrollTop > 2);
    };
    parent.addEventListener("scroll", onScroll, true);
    return () => parent.removeEventListener("scroll", onScroll, true);
  }, [box.name]);

  return (
    <header
      ref={headerRef}
      data-scrolled={scrolled || undefined}
      className={cn("relative z-10 shrink-0 border-b px-3 py-2.5 transition-[box-shadow,border-color] duration-200 md:px-5", scrolled ? "border-transparent shadow-e2" : "border-border")}
    >
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
            className="pop-in text-foreground bg-muted ring-ring/30 h-8 min-w-0 flex-1 rounded-md px-2 text-h3 font-semibold tracking-[-0.01em] ring-2 outline-none"
          />
        ) : (
          <h1 className="flex min-w-0 flex-1 items-center">
            {/* The pencil lives INSIDE the button: the visible edit affordance must be clickable,
                not just the text beside it. */}
            <button
              type="button"
              onClick={startRename}
              title="Rename"
              className="group/title flex min-w-0 cursor-text items-center gap-1.5 text-left no-press"
            >
              {/* A rename crossfades: the old title lifts out, the new one rises in. min-w-0 all the
                  way down, so on a phone the title truncates instead of shoving the controls off. */}
              <Swap state={title} className="min-w-0 flex-1 overflow-hidden">
                <span className="text-foreground block min-w-0 truncate text-h3 font-semibold tracking-[-0.01em]" title={title}>
                  {title}
                </span>
              </Swap>
              <Pencil className="text-faint size-3 shrink-0 -translate-x-0.5 opacity-0 transition-[opacity,translate] duration-150 group-hover/title:translate-x-0 group-hover/title:opacity-100 group-focus-visible/title:opacity-100" aria-hidden />
            </button>
          </h1>
        )}

        {/* Under md the secondary actions (new task, files) fold into the ⋯ menu — one control beside
            the title, so the title keeps the width. */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              {/* A disabled button emits no pointer events; the span carries the tooltip while asleep. */}
              <span tabIndex={sleeping ? 0 : -1} className="hidden rounded-md outline-none md:inline-flex">
                <Button variant="ghost" size="sm" onClick={onToggleWorkspace} aria-pressed={showWorkspace} className={cn("text-muted-foreground", showWorkspace && "bg-accent text-foreground")} disabled={sleeping}>
                  <FolderTree />
                  <span className="hidden sm:inline">Files</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{sleeping ? "Files — available once the sandbox is awake" : "Browse, diff and edit the workspace"}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions" className="text-muted-foreground">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(e) => {
                // Opening the repo picker from the menu: the picker owns focus, not the ⋯ trigger.
                if (openFromMenu.current) {
                  e.preventDefault();
                  openFromMenu.current = false;
                }
              }}
            >
              <DropdownMenuItem onSelect={onNew} className="md:hidden">
                <Plus />
                New task
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onToggleWorkspace} disabled={sleeping} className="md:hidden" aria-pressed={showWorkspace}>
                <FolderTree />
                {showWorkspace ? "Hide files" : "Files"}
                <MenuHint>{sleeping ? "asleep" : "browse, diff, edit"}</MenuHint>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="md:hidden" />
              {box.role !== "pool-free" && (
                <DropdownMenuItem onSelect={onToggleKeep} disabled={keeping}>
                  {kept ? <PinOff /> : <Pin />}
                  {kept ? "Release" : "Keep"}
                  <MenuHint>{kept ? "kept" : "sleeps · auto-destroyed"}</MenuHint>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={startRename} disabled={!box.task}>
                <Pencil />
                Rename
              </DropdownMenuItem>
              {!sleeping && (
                <DropdownMenuItem
                  onSelect={() => {
                    openFromMenu.current = true;
                    setAddRepo(true);
                  }}
                  disabled={!!attaching}
                >
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
                {copied ? <Check className="text-ok" /> : <FileText />}
                Copy transcript
                <MenuHint>Markdown</MenuHint>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onNewFromThis} disabled={!box.task}>
                <RotateCw />
                Run again
                <MenuHint>new machine, same brief</MenuHint>
              </DropdownMenuItem>
              {onSetMemory && !!memoryTiers?.length && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Memory</DropdownMenuLabel>
                  {memoryTiers.map((t) => (
                    <DropdownMenuItem
                      key={t}
                      onSelect={() => setResizeTo({ kind: "memory", tier: t })}
                      disabled={t === memoryTier || memoryBusy || state === "running"}
                    >
                      <MemoryStick />
                      {t}
                      <MenuHint>
                        {t === memoryTier ? "current" : state === "running" ? "busy — finish first" : "reboots the machine"}
                      </MenuHint>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {onSetDisk && !!diskTiers?.length && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Storage</DropdownMenuLabel>
                  {diskTiers.map((t) => (
                    <DropdownMenuItem
                      key={t}
                      onSelect={() => setResizeTo({ kind: "disk", tier: t })}
                      disabled={t === diskTier || diskBusy || state === "running"}
                    >
                      <HardDrive />
                      {t}
                      <MenuHint>
                        {t === diskTier ? "current" : state === "running" ? "busy — finish first" : "reboots the machine"}
                      </MenuHint>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              <DropdownMenuSeparator />
              {!sleeping && sleepNow && (
                <DropdownMenuItem onSelect={sleepNow} disabled={sleepBusy || state === "running"}>
                  <Moon />
                  Sleep now
                  <MenuHint>{state === "running" ? "busy — finish first" : "a reply wakes it"}</MenuHint>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
                <Trash2 />
                Destroy machine…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Line 2: context as a sentence. The state is the pill — it anchors the whole view, and its
          crossfade makes the working → needs-you → done transition an event rather than a blink. */}
      {/* One line at every width. On a phone the sentence is trimmed to what matters there (state,
          machine, repos — the meters and lifecycle live in the machine's tooltip and the ⋯ menu),
          and the repo chips scroll sideways rather than stacking into a third and fourth row. */}
      <div className="text-muted-foreground mt-1 flex min-h-6 min-w-0 flex-nowrap items-center gap-x-2 text-meta">
        <span className="shrink-0">
          <StatePill state={state} exitCode={exitCode} stalled={box.stalled} />
        </span>
        <Dot />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="stamp inline-flex shrink-0 items-center gap-1" title={shortName(box.name)}>
              {kept && <Pin className="text-live size-3 fill-current" aria-label="Kept" />}
              {friendlyName(box.name)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{vitals || shortName(box.name)}</TooltipContent>
        </Tooltip>

        {!sleeping && (
          <>
            <Dot />
            <span className="scrollbar-none flex min-w-20 shrink items-center gap-1.5 overflow-x-auto">
              {repos.map((r) => (
                <Tooltip key={r.name}>
                  <TooltipTrigger asChild>
                    <span className="bg-muted text-foreground stamp inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 whitespace-nowrap">
                      {r.name}
                      {r.branch && <span className="text-muted-foreground hidden sm:inline">@{r.branch}</span>}
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
            </span>
            <span ref={pickerRef} className="relative shrink-0">
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
          </>
        )}

        {!!pulls?.length && (
          <>
            <Dot />
            <PullRequestFloat key={pulls[pulls.length - 1].url} session={box.name} pulls={pulls} />
          </>
        )}

        {/* Live vitals as meters. They only render while awake — a frozen meter reads as live and
            lies, so mergeWithMemory drops the numbers when a box sleeps. */}
        {/* Meters are a desktop luxury; on a phone the numbers live in the machine's tooltip. Above
            xl the meters keep their readouts; between md and xl they are bars only, so the line
            holds with a PR chip and the live activity beside them. */}
        {!sleeping && (box.memUsage || box.disk) && (
          <span className="hidden shrink-0 items-center gap-2 xl:flex">
            <Dot />
            <span className="flex shrink-0 items-center gap-2.5 [&_span]:whitespace-nowrap">
              <UsageMeter kind="memory" usage={box.memUsage} />
              {/* Disk is the slower story; it joins the line only where there is room. */}
              <UsageMeter kind="disk" usage={box.disk} className="hidden 2xl:inline-flex" />
            </span>
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-2 pl-3 whitespace-nowrap">
          {activity && (
            <span className="text-live hidden items-center gap-1.5 text-micro font-medium sm:inline-flex">
              <span className="bg-live breathe size-1.5 rounded-full" aria-hidden />
              <span className="max-w-[10rem] truncate lg:max-w-[16rem]">{activity}</span>
            </span>
          )}
          {/* "finished 2m ago" → "asked just now": the meta changes with the state, so it crossfades with it. */}
          <Swap state={when ?? ""} className="hidden items-center sm:flex">
            {when && <span className={`${box.stalled ? "text-destructive" : "text-faint"} text-micro`}>{when}</span>}
          </Swap>
          {when && short && <span className="hidden sm:inline"><Dot /></span>}
          {short && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn("text-faint text-micro", deadline.remainingSec != null && deadline.remainingSec < 300 ? "text-attention-text" : "hidden sm:inline")}>{short}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{long}</TooltipContent>
            </Tooltip>
          )}
          {bud && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-faint hidden text-micro tabular-nums sm:inline">
                  <Dot /> {bud.usd !== undefined ? `$${bud.usd.toFixed(2)}${bud.maxUsd ? ` of $${bud.maxUsd}` : ""}` : `${Math.round(bud.tokens / 1000)}k tok`}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{budgetLine} — a cap pauses the run with a question</TooltipContent>
            </Tooltip>
          )}
        </span>
      </div>

      <Dialog open={!!resizeTo} onOpenChange={(o) => !o && setResizeTo(null)}>
        <DialogContent
          title={`Restart ${friendlyName(box.name)} with ${resizeTo?.tier} of ${resizeTo?.kind === "disk" ? "storage" : "memory"}?`}
          description={
            resizeTo?.kind === "disk"
              ? "The disk grows on the next boot, so the machine reboots. The workspace, checkouts and the agent's session are kept — and a disk can only ever grow, never shrink back."
              : "This runtime cannot resize memory live, so the machine reboots. The workspace, checkouts and the agent's session are kept — expect it back in about half a minute."
          }
        >
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setResizeTo(null)} disabled={busyFor}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busyFor}
              onClick={async () => {
                const r = resizeTo;
                if (!r) return;
                await (r.kind === "disk" ? onSetDisk?.(r.tier) : onSetMemory?.(r.tier));
                setResizeTo(null);
              }}
            >
              {busyFor ? <Loader2 className="animate-spin" /> : resizeTo?.kind === "disk" ? <HardDrive /> : <MemoryStick />}
              {busyFor ? "Restarting…" : `Restart with ${resizeTo?.tier}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent onOpenAutoFocus={(e) => (e.preventDefault(), cancelRef.current?.focus())} title={`Destroy ${friendlyName(box.name)}?`} description="Stops the sandbox and discards its workspace — files, checkouts and uncommitted work. The conversation is not recoverable afterwards.">
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
