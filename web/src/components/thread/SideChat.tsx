import * as React from "react";
import { ArrowUp, Eraser, MessageCircleQuestion, PanelRightClose, RotateCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { SettledTurn, SideChatHandle } from "@/lib/sidechat";
import { Markdown } from "@/components/ui/markdown";
import { Button } from "@/components/ui/button";
import { PromptInput, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const PANE_WIDTH = "22rem";
export const SIDE_INPUT_ID = "sidechat-input";

/**
 * The side chat: a second, small conversation attached to the box, answered from inside the sandbox
 * without touching the agent. A 22rem aside beside the conversation at md and up, a bottom sheet
 * below. The store lives outside React, so this only renders and dispatches.
 */
export function SideChat({ side, sleeping, onClose }: { side: SideChatHandle; sleeping: boolean; onClose: () => void }) {
  const phone = !useMediaQuery("(min-width: 48rem)");
  const still = useReducedMotion();
  const { chat, markRead } = side;

  React.useEffect(() => {
    if (chat.open) markRead();
  }, [chat.open, chat.turns, markRead]);

  React.useEffect(() => {
    if (!chat.open) return;
    const t = window.setTimeout(() => document.getElementById(SIDE_INPUT_ID)?.focus(), phone ? 260 : 40);
    return () => window.clearTimeout(t);
  }, [chat.open, phone]);

  const body = <Body side={side} sleeping={sleeping} onClose={onClose} phone={phone} />;

  if (phone) {
    return (
      <Sheet open={chat.open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="bottom" title="Side chat" description="Answered from the sandbox, not by the agent" aria-label="Side chat">
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <AnimatePresence>
      {chat.open && (
        <motion.aside
          key="sidechat"
          aria-label="Side chat"
          initial={still ? { opacity: 0 } : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={still ? { opacity: 0 } : { opacity: 0, x: 16 }}
          transition={{ duration: still ? 0.12 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          style={{ width: PANE_WIDTH }}
          className="bg-card hidden shrink-0 flex-col border-l md:flex"
        >
          <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
            <MessageCircleQuestion className="text-muted-foreground size-4" aria-hidden />
            <span className="text-foreground text-meta font-medium">Side chat</span>
            <StartFresh side={side} className="ml-auto" />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the side chat"
              title="Close · Esc"
              className="text-muted-foreground hover:text-foreground grid size-7 cursor-pointer place-items-center rounded-md transition-colors"
            >
              <PanelRightClose className="size-4" aria-hidden />
            </button>
          </div>
          {body}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function StartFresh({ side, className }: { side: SideChatHandle; className?: string }) {
  const empty = side.chat.turns.length === 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={empty ? 0 : -1} className={cn("inline-flex rounded-md outline-none", className)}>
          <Button variant="ghost" size="xs" onClick={side.startFresh} disabled={empty} className="text-muted-foreground">
            <Eraser />
            Start fresh
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{empty ? "Nothing to clear yet" : "Clear these turns from this view"}</TooltipContent>
    </Tooltip>
  );
}

function Body({ side, sleeping, onClose, phone }: { side: SideChatHandle; sleeping: boolean; onClose: () => void; phone: boolean }) {
  const { chat } = side;
  const listRef = React.useRef<HTMLDivElement>(null);
  const pending = chat.pending !== null;

  React.useLayoutEffect(() => {
    // A long answer reads from its question, not from its tail: the newest turn's top comes into view.
    listRef.current?.querySelector("ol > li:last-child")?.scrollIntoView({ block: "start" });
  }, [chat.turns.length, pending]);

  const send = () => {
    if (sleeping || pending || !chat.draft.trim()) return;
    side.ask(chat.draft);
  };

  const composer = (
    <div className={cn("shrink-0 border-t px-3 py-3", phone && "bg-popover sticky bottom-0 -mx-4 px-4 pb-0")}>
      <PromptInput
        value={chat.draft}
        onValueChange={side.setDraft}
        onSubmit={send}
        disabled={sleeping}
        className="bg-background rounded-xl p-1.5"
      >
        <label htmlFor={SIDE_INPUT_ID} className="sr-only">
          Ask the sandbox about this run
        </label>
        <PromptInputTextarea
          id={SIDE_INPUT_ID}
          className="min-h-9 px-2 pt-1.5 text-meta"
          placeholder={sleeping ? "Wake the sandbox to ask about it" : pending ? "Reading the box… type the next one" : "What changed? Why is it stuck?"}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !chat.draft.trim()) {
              e.preventDefault();
              e.stopPropagation();
              onClose();
              document.getElementById("send-input")?.focus();
            }
          }}
        />
        <PromptInputActions className="flex items-center justify-between px-1 pt-0">
          {phone ? (
            <StartFresh side={side} className="-ml-1" />
          ) : (
            <span className="text-faint text-micro">{sleeping ? "Asleep" : "Enter to ask · the agent is not interrupted"}</span>
          )}
          <Button
            variant="primary"
            size="icon-xs"
            onClick={send}
            disabled={sleeping || pending || !chat.draft.trim()}
            aria-label="Ask the sandbox"
            className="rounded-full disabled:opacity-35"
          >
            <ArrowUp />
          </Button>
        </PromptInputActions>
      </PromptInput>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className={cn("@container min-h-0 flex-1 overflow-y-auto px-3 py-3", phone && "flex-none overflow-visible px-0 pt-0")}>
        {chat.turns.length === 0 && !pending ? (
          <p className="text-muted-foreground px-1 py-6 text-center text-meta text-balance">
            Ask what the agent has changed, why it is stuck, or whether the tests pass. A read-only helper answers from inside the sandbox.
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {chat.turns.map((t, i) => (
              <React.Fragment key={t.id}>
                {i > 0 && t.kind === "answered" && !t.continued && <NewThreadRule />}
                <TurnRow turn={t} onRetry={() => side.retry(t.id)} />
              </React.Fragment>
            ))}
            {chat.pending && (
              <li className="flex scroll-mt-3 flex-col gap-1.5">
                <Question text={chat.pending.question} />
                <p className="text-muted-foreground flex items-center gap-2 px-1 text-meta">
                  <span className="flex items-center gap-1" aria-hidden>
                    <span className="dot dot-1 bg-current size-1.5 rounded-full" />
                    <span className="dot dot-2 bg-current size-1.5 rounded-full" />
                    <span className="dot dot-3 bg-current size-1.5 rounded-full" />
                  </span>
                  Reading the box…
                </p>
              </li>
            )}
          </ol>
        )}
      </div>
      {composer}
    </div>
  );
}

function NewThreadRule() {
  return (
    <li aria-label="New thread" className="text-faint flex items-center gap-2 text-micro">
      <span className="bg-border h-px flex-1" aria-hidden />
      New thread
      <span className="bg-border h-px flex-1" aria-hidden />
    </li>
  );
}

function TurnRow({ turn, onRetry }: { turn: SettledTurn; onRetry: () => void }) {
  return (
    <li className="flex scroll-mt-3 flex-col gap-1.5">
      <Question text={turn.question} />
      {turn.kind === "answered" ? (
        <div className="px-1">
          <div className="text-foreground prose-agent text-meta">
            <Markdown>{turn.answer}</Markdown>
          </div>
          {turn.partial && <p className="text-faint mt-1.5 text-micro">Time cap reached · this answer may be partial</p>}
        </div>
      ) : (
        <div className="flex items-start gap-2 px-1">
          <p className="text-destructive min-w-0 flex-1 text-meta [overflow-wrap:anywhere]">{turn.error}</p>
          <Button variant="outline" size="xs" onClick={onRetry} className="shrink-0">
            <RotateCw />
            Retry
          </Button>
        </div>
      )}
    </li>
  );
}

function Question({ text }: { text: string }) {
  const [full, setFull] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => setFull((v) => !v)}
      title={full ? "Show less" : "Show the whole question"}
      className="bg-muted text-foreground max-w-full cursor-pointer self-end rounded-xl rounded-br-sm border px-3 py-1.5 text-left text-meta"
    >
      <span className={cn("block whitespace-pre-wrap [overflow-wrap:anywhere]", !full && "line-clamp-2")}>{text}</span>
    </button>
  );
}
