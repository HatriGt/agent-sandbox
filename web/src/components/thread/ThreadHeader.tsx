import * as React from "react";
import { ArrowLeft, Check, Copy, FileText, FolderTree, HardDrive, Info, Link2, ListTree, Loader2, MemoryStick, MessageCircleQuestion, MessageSquareText, Moon, MoreHorizontal, PanelRight, Pencil, Pin, PinOff, Plus, RotateCw, Square, Trash2 } from "lucide-react";
import { Swap } from "@/components/ui/swap";
import { IconSwap } from "@/components/ui/icon-swap";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { menuMotion } from "./MentionMenu";
import { toast } from "sonner";
import type { BoxView } from "@/lib/api";
import type { TraceEvent } from "@/lib/trace";
import { liveActivity } from "./live-activity";
import { fmtAgo, friendlyName, isFailedExit, roleLabel } from "@/lib/format";
import { deadlineLabel, deadlineShort, fmtDuration, fmtUsage, type Deadline, type DisplayState } from "@/lib/lifecycle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, MenuHint } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RepoPicker } from "@/components/RepoPicker";
import { PullRequestFloat } from "./PullRequestFloat";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/useNow";

/**
 * The thread's masthead: one line, 48px.
 *
 *   [back · phones] [state pill, "Working · Editing retry.ts" at xl+] [title, takes the slack]
 *   [PR · elapsed at xl, first repo +N from 2xl] [Details] [Stop · Files · Inspector · Side chat · Chat/Trace · ⋯]
 *
 * Details is a popover with everything that is not the identity: machine name, id and vitals, kept,
 * every repo and the attach flow, PR, Started/elapsed, agent/harness, lifecycle, size. Below lg it is
 * the only place for meta. The loud red button lives inside the confirm dialog, where destroying
 * genuinely is the primary action.
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
  startedAt,
  endedAt,
  onStop,
  stopping,
  showWorkspace,
  showInspector,
  onToggleInspector,
  showSideChat,
  sideUnread = 0,
  onToggleSideChat,
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
  density = "chat",
  onToggleDensity,
  onToggleKeep,
  onRename,
  onAttach,
  onDestroy,
  onCopyTranscript,
  onNewFromThis,
  events,
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
  /** Epoch ms of the run's first stamped event (or the digest's start). Omitted → no Started/elapsed. */
  startedAt?: number;
  /** Epoch ms of the last stamped event — where the elapsed timer freezes once the run is not running. */
  endedAt?: number;
  /** Stop the running turn (session kept). Present only while a turn runs. */
  onStop?: () => void;
  stopping?: boolean;
  showWorkspace: boolean;
  showInspector: boolean;
  onToggleInspector: () => void;
  showSideChat: boolean;
  /** Side-chat answers that landed while the pane was closed. */
  sideUnread?: number;
  onToggleSideChat: () => void;
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
  /** Chat (prose first) or trace (every step) — see TraceItems Density. */
  density?: "chat" | "trace";
  onToggleDensity?: () => void;
  onToggleKeep: () => void;
  onRename: (title: string) => Promise<void>;
  onAttach: (fullName: string) => void;
  onDestroy: () => Promise<void>;
  onCopyTranscript: () => Promise<string>;
  onNewFromThis: () => void;
  /** The trace, for the pill's live activity label ("Working · Editing retry.ts"). */
  events?: TraceEvent[];
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(title);
  const [confirm, setConfirm] = React.useState(false);
  // The tier the user picked, awaiting confirmation. A resize is a reboot, so it gets the same
  // confirm-dialog treatment as Destroy rather than firing straight off the menu.
  const [resizeTo, setResizeTo] = React.useState<{ kind: "memory" | "disk"; tier: string } | null>(null);
  const [addRepo, setAddRepo] = React.useState(false);
  const [details, setDetails] = React.useState(false);
  // Details is a popover off the Info button on a desk and a bottom sheet off the ⋯ menu on a phone,
  // where a 32px button would cost the title a third of its width.
  const phone = useMediaQuery("(max-width: 639px)");
  const [idCopied, setIdCopied] = React.useState(false);
  React.useEffect(() => {
    if (!idCopied) return;
    const t = setTimeout(() => setIdCopied(false), 1500);
    return () => clearTimeout(t);
  }, [idCopied]);
  const pickerRef = React.useRef<HTMLSpanElement>(null);
  const still = useReducedMotion();
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
  const long = deadlineLabel(deadline);
  const running = state === "running";
  const elapsed = useElapsed(startedAt, running ? undefined : endedAt, running);
  const activity = running && events ? liveActivity(events) : null;
  const agentName = box.harness?.name ?? (box.agent ? (({ omp: "oh-my-pi", codex: "Codex CLI", opencode: "OpenCode", claude: "Claude Code" } as Record<string, string>)[box.agent] ?? box.agent) : null);
  // Which resource's request is in flight — the confirm dialog is shared between the two.
  const busyFor = resizeTo?.kind === "disk" ? diskBusy : memoryBusy;

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

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(box.name);
      setIdCopied(true);
      toast.success("Machine id copied");
    } catch (e) {
      toast.error("Could not copy", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const openPicker = () => {
    setDetails(false);
    setAddRepo(true);
  };
  const startedLabel = startedAt !== undefined ? new Date(startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : null;
  const urgent = deadline.remainingSec != null && deadline.remainingSec < 300 ? short : null;
  const machineLine = [box.uptime && `${sleeping ? "ran for" : "up"} ${box.uptime}`, box.cpu && `cpu ${box.cpu}`, box.memUsage && `memory ${fmtUsage(box.memUsage)}`, box.disk && `disk ${fmtUsage(box.disk)}`, roleLabel(box.role)].filter(Boolean).join(" · ");
  const tiers = [memoryTier && `${memoryTier} memory`, diskTier && `${diskTier} disk`].filter(Boolean).join(" · ");

  const repoChip = (r: { name: string; branch?: string }) => (
    <Tooltip key={r.name}>
      <TooltipTrigger asChild>
        <span className="bg-muted text-foreground stamp inline-flex h-6 max-w-56 shrink-0 items-center gap-1 rounded-md px-2 whitespace-nowrap">
          <span className="shrink-0">{r.name}</span>
          {r.branch && <span className="text-muted-foreground min-w-0 truncate">@{r.branch}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        /workspace/{r.name}{r.branch ? ` on ${r.branch}` : ""} — @ mentions search here
      </TooltipContent>
    </Tooltip>
  );

  const detailsBody = (
    <>
      <div className="flex items-center gap-2">
        {kept && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Pin className="text-live size-3.5 fill-current" aria-label="Kept" />
            </TooltipTrigger>
            <TooltipContent side="bottom">Kept — never sleeps or auto-destroys</TooltipContent>
          </Tooltip>
        )}
        <span className="text-foreground min-w-0 truncate text-body font-medium">{friendlyName(box.name)}</span>
        <button type="button" onClick={copyId} title="Copy the machine id" className="bg-muted text-muted-foreground hover:text-foreground stamp inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded px-1.5 transition-colors">
          {box.name.slice(-6)}
          <IconSwap state={idCopied} className="size-3">
            {idCopied ? <Check className="text-ok size-3" /> : <Copy className="size-3" />}
          </IconSwap>
        </button>
      </div>
      {machineLine && <p className="stamp text-muted-foreground mt-1.5 text-micro leading-relaxed">{machineLine}</p>}

      <dl className="mt-3 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-meta">
        <dt className="text-muted-foreground pt-0.5">Repos</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
          {repos.map(repoChip)}
          {!sleeping && (
            <button
              type="button"
              onClick={openPicker}
              disabled={!!attaching}
              className={cn("hover:text-foreground hover:bg-muted inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-micro font-medium transition-colors disabled:opacity-60", repos.length ? "text-faint" : "text-muted-foreground")}
            >
              <Plus className="size-3" aria-hidden />
              {repos.length ? "Attach another" : "Attach a repository"}
            </button>
          )}
          {sleeping && !repos.length && <span className="text-faint">none</span>}
        </dd>

        {!!pulls?.length && (
          <>
            <dt className="text-muted-foreground pt-0.5">PR</dt>
            <dd className="flex min-w-0 flex-col gap-1">
              {pulls.map((p) => (
                <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="text-foreground hover:text-live stamp min-w-0 truncate transition-colors">
                  #{p.number} <span className="text-muted-foreground">{p.repo}</span>
                </a>
              ))}
            </dd>
          </>
        )}

        {startedLabel && (
          <>
            <dt className="text-muted-foreground">Started</dt>
            <dd className="flex items-center gap-2 tabular-nums">
              {startedLabel}
              {elapsed && (
                <>
                  <Dot />
                  <span className={cn("stamp", running ? "text-live" : "text-muted-foreground")}>{running ? `${elapsed} so far` : elapsed}</span>
                </>
              )}
            </dd>
          </>
        )}

        {(agentName || box.harness || box.workflow) && (
          <>
            <dt className="text-muted-foreground">Agent</dt>
            <dd className="min-w-0">
              {agentName}
              {box.harness && <div className="text-muted-foreground text-micro">Harness: {box.harness.line}</div>}
              {box.workflow && <div className="text-muted-foreground text-micro">Playbook: {box.workflow.line}</div>}
            </dd>
          </>
        )}

        {(when || long) && (
          <>
            <dt className="text-muted-foreground">Lifecycle</dt>
            <dd className="min-w-0">
              {when && <div className={box.stalled ? "text-destructive" : undefined}>{when}</div>}
              {long && <div className={cn("text-micro", urgent ? "text-attention-text" : "text-muted-foreground")}>{long}</div>}
            </dd>
          </>
        )}

        {tiers && (
          <>
            <dt className="text-muted-foreground">Size</dt>
            <dd className="stamp text-muted-foreground">
              {tiers}
              {(onSetMemory || onSetDisk) && <span className="text-faint"> · resize from ⋯</span>}
            </dd>
          </>
        )}
      </dl>
    </>
  );

  return (
    <header
      ref={headerRef}
      data-scrolled={scrolled || undefined}
      className={cn("relative z-10 flex h-12 shrink-0 items-center gap-2 border-b px-3 transition-[box-shadow,border-color] duration-200 md:px-5", scrolled ? "border-transparent shadow-e2" : "border-border")}
    >
      <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to machines" className="-ml-1 md:hidden">
        <ArrowLeft />
      </Button>
      <LiveStatePill state={state} exitCode={exitCode} stalled={box.stalled} activity={activity} />
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
        <h1 className="flex min-w-0 flex-1 items-center lg:min-w-48">
          {/* The pencil lives INSIDE the button: the visible edit affordance must be clickable,
              not just the text beside it. */}
          <button type="button" onClick={startRename} title="Rename" className="group/title flex min-w-0 cursor-text items-center gap-1.5 text-left no-press">
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

      {/* The compact meta cluster (xl+): the PR and the clock, and from 2xl the first repo too. At
          1280 the row has 1008px inside its padding; pill 121 + title floor 192 + controls 399 + gaps
          32 leave 264, which fits PR + clock (222) but not the chip as well (305). Nothing here
          shrinks: the title takes the slack. Everything else is in Details, which is also the only
          place for meta below xl. */}
      <div className="text-muted-foreground hidden shrink-0 items-center gap-2 text-meta xl:flex">
        {!sleeping && repos.length > 0 && (
          <span className="hidden items-center gap-1.5 2xl:flex">
            {repoChip(repos[0])}
            {repos.length > 1 && (
              <span className="stamp text-muted-foreground" aria-label={`${repos.length - 1} more ${repos.length - 1 === 1 ? "repository" : "repositories"}`}>
                +{repos.length - 1}
              </span>
            )}
          </span>
        )}
        <AnimatePresence initial={false}>
          {attaching && (
            <motion.span key="attaching" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }} className="stamp text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              cloning {attaching.split("/")[1]}…
            </motion.span>
          )}
        </AnimatePresence>
        {!!pulls?.length && (
          <>
            <Dot />
            <PullRequestFloat key={pulls[pulls.length - 1].url} session={box.name} pulls={pulls} />
          </>
        )}
        {elapsed && (
          <>
            <Dot />
            <span className={cn("stamp inline-flex h-6 shrink-0 items-center tabular-nums", running ? "text-live" : "text-faint")} aria-label={`Elapsed ${elapsed}`}>
              {elapsed}
            </span>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {/* A deadline inside five minutes is the one fact that stays inline at every width. */}
        {urgent && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-attention-text px-1 text-micro font-medium whitespace-nowrap">{urgent}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{long}</TooltipContent>
          </Tooltip>
        )}

        {/* Details: the machine, every repo, PR, timing, agent, lifecycle, size. The repo picker is
            anchored here too, whether it opens from Details or from the ⋯ menu. */}
        <span ref={pickerRef} className="relative">
          <Popover open={details && !phone} onOpenChange={setDetails}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Details" className={cn("text-muted-foreground hidden sm:inline-flex", details && "bg-accent text-foreground")}>
                    <Info />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Details — machine, repositories, timing</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-[22rem]">{detailsBody}</PopoverContent>
          </Popover>
          <Sheet open={details && phone} onOpenChange={setDetails}>
            <SheetContent side="bottom" title="Details">
              {detailsBody}
            </SheetContent>
          </Sheet>
          <AnimatePresence>
            {addRepo && (
              <motion.div key="repo-picker" {...menuMotion(still, "bottom")} className="absolute top-full right-0 z-20 mt-1 max-sm:fixed max-sm:inset-x-4 max-sm:top-24 max-sm:mt-0">
                <RepoPicker multi={false} selected={repos.map((r) => ({ repo: r.name }))} onToggle={(r) => (onAttach(r.fullName), setAddRepo(false))} onClose={() => setAddRepo(false)} />
              </motion.div>
            )}
          </AnimatePresence>
        </span>

        {onStop && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={onStop} disabled={stopping} className="text-muted-foreground">
                {stopping ? <Loader2 className="animate-spin" /> : <Square className="fill-current" />}
                <span className="hidden sm:inline">{stopping ? "Stopping…" : "Stop"}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Stop this turn — the session is kept; a message resumes it</TooltipContent>
          </Tooltip>
        )}
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

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onToggleInspector} aria-pressed={showInspector} aria-label="Inspector" className={cn("text-muted-foreground hidden md:inline-flex", showInspector && "bg-accent text-foreground")}>
              <PanelRight />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Run facts and the rest of the fleet · Ctrl+I</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size={sideUnread > 0 ? "sm" : "icon-sm"} onClick={onToggleSideChat} aria-pressed={showSideChat} aria-label="Side chat" className={cn("text-muted-foreground relative", showSideChat && "bg-accent text-foreground")}>
              <MessageCircleQuestion />
              {sideUnread > 0 && (
                <span className="bg-primary text-primary-foreground stamp rounded-full px-1.5 text-micro leading-4" aria-label={`${sideUnread} unread`}>
                  {sideUnread}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Ask the sandbox about this run without interrupting the agent</TooltipContent>
        </Tooltip>

        {onToggleDensity && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleDensity}
                aria-pressed={density === "trace"}
                data-density={density}
                className={cn("text-muted-foreground", density === "trace" && "bg-accent text-foreground")}
              >
                {density === "trace" ? <ListTree /> : <MessageSquareText />}
                <span className="hidden sm:inline">{density === "trace" ? "Trace" : "Chat"}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{density === "trace" ? "Every step shown — switch to chat to fold the work" : "Conversation first — switch to trace to see every step"}</TooltipContent>
          </Tooltip>
        )}

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
            <DropdownMenuItem onSelect={() => setDetails(true)} className="sm:hidden">
              <Info />
              Details
              <MenuHint>machine, repos, timing</MenuHint>
            </DropdownMenuItem>
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
                  <DropdownMenuItem key={t} onSelect={() => setResizeTo({ kind: "memory", tier: t })} disabled={t === memoryTier || memoryBusy || state === "running"}>
                    <MemoryStick />
                    {t}
                    <MenuHint>{t === memoryTier ? "current" : state === "running" ? "busy — finish first" : "reboots the machine"}</MenuHint>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {onSetDisk && !!diskTiers?.length && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Storage</DropdownMenuLabel>
                {diskTiers.map((t) => (
                  <DropdownMenuItem key={t} onSelect={() => setResizeTo({ kind: "disk", tier: t })} disabled={t === diskTier || diskBusy || state === "running"}>
                    <HardDrive />
                    {t}
                    <MenuHint>{t === diskTier ? "current" : state === "running" ? "busy — finish first" : "reboots the machine"}</MenuHint>
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

/** Hairline meta separator. */
function Dot() {
  return <span className="bg-border inline-block h-3 w-px shrink-0 self-center" aria-hidden />;
}

/** `mm:ss` (or `h:mm:ss`) from start to end — ticking each second while `live`, frozen otherwise. */
function useElapsed(start: number | undefined, end: number | undefined, live: boolean): string | null {
  const now = useNow(live && start !== undefined);
  if (start === undefined) return null;
  const stop = live ? now : end;
  if (stop === undefined) return null;
  const s = Math.max(0, Math.floor((stop - start) / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * The Orbit state pill, in the shared live vocabulary: Working (text shimmer + pinging dot) ·
 * Action needed · Asleep · Done · Failed · Idle. Colours are the existing state tokens. While working,
 * the activity ("Editing retry.ts") joins the label at lg+, full text in the tooltip.
 */
function LiveStatePill({ state, exitCode, stalled, activity }: { state: DisplayState; exitCode?: number; stalled?: boolean; activity?: string | null }) {
  const failed = state === "done" && isFailedExit(exitCode);
  const working = state === "running" && !stalled;
  const [word, tone] =
    state === "running"
      ? stalled
        ? ["Stalled", "text-destructive bg-destructive/10"]
        : ["Working", "text-live bg-live/10"]
      : state === "waiting"
        ? ["Action needed", "text-attention-text bg-attention/15"]
        : state === "sleeping"
          ? ["Asleep", "text-sleep bg-sleep/10"]
          : state === "done"
            ? failed
              ? ["Failed", "text-destructive bg-destructive/10"]
              : ["Done", "text-ok bg-ok/10"]
            : ["Idle", "text-muted-foreground bg-muted"];
  const doing = working ? activity : null;
  const pill = (
    <span key={word} className={cn("pop-in inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-micro font-medium transition-colors duration-200", tone)}>
      <span className={cn("size-1.5 rounded-full bg-current", working && "dt-ping")} aria-hidden />
      <span className={cn(working && "shimmer-text")}>{word}</span>
      {/* What the agent is doing rides inside the pill at lg+; the one-line masthead has no room for a
          separate live tail, and the pill is already the thing that says "alive". */}
      {doing && (
        <Swap state={doing} className="hidden min-w-0 xl:block">
          <span className="block max-w-[28ch] truncate font-normal opacity-80">· {doing}</span>
        </Swap>
      )}
    </span>
  );
  if (!doing) return pill;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side="bottom">{doing}</TooltipContent>
    </Tooltip>
  );
}
