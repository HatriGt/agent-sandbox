import * as React from "react";
import { ArrowUp, AtSign, Clock, MessageCircleQuestion, Terminal } from "lucide-react";
import { toast } from "sonner";
import { api, type RunState } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PromptInput, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MentionMenu, expandMentions, mentionAt, type MentionState } from "./MentionMenu";
import { cn } from "@/lib/utils";

type Mode = "agent" | "side";

/**
 * The composer.
 *
 * One input, one primary destination: the AGENT doing the work. Sending to it is always allowed —
 * if the agent is mid-turn the controller queues the message and delivers it the moment the current
 * turn ends, and the thread shows it as "queued" until then. Answering a paused question goes through
 * the question card, so the composer never has to explain "this releases the run".
 *
 * The secondary destination is a SIDE QUESTION: a separate read-only helper inside the same sandbox
 * answers questions ABOUT the run (what changed, why is it stuck) without interrupting the agent. It
 * used to be called "Co-pilot", which suggested it steered; it does not. The label and copy now say
 * exactly what it is. A sleeping (stopped) sandbox has nothing to inspect, so side questions are off
 * there; a reply wakes it.
 *
 * `@` opens the workspace file picker (Cursor-style); mentions are expanded into explicit paths so
 * the agent reads the right files.
 */
export function SendBar({
  boxName,
  runState,
  sleeping = false,
  onAsk,
  onReplied,
  onQueued,
  onFocusRequest,
}: {
  boxName: string;
  runState: RunState;
  sleeping?: boolean;
  onAsk: (question: string) => void;
  onReplied: (text: string) => void;
  onQueued?: () => void;
  onFocusRequest?: (focus: () => void) => void;
}) {
  const busy = runState === "running" && !sleeping;
  const canSide = !sleeping;
  const [mode, setMode] = React.useState<Mode>("agent");
  const [value, setValue] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mention, setMention] = React.useState<MentionState | null>(null);

  const textarea = () => document.getElementById("send-input") as HTMLTextAreaElement | null;
  React.useEffect(() => {
    onFocusRequest?.(() => textarea()?.focus());
  }, [onFocusRequest]);
  React.useEffect(() => {
    if (!canSide && mode === "side") setMode("agent");
  }, [canSide, mode]);

  const effective: Mode = canSide ? mode : "agent";
  const toAgent = effective === "agent";

  const updateMention = (next: string) => {
    const el = textarea();
    const caret = el?.selectionStart ?? next.length;
    setMention(mentionAt(next, caret));
  };

  const pickFile = (path: string) => {
    if (!mention) return;
    const el = textarea();
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, mention.start);
    const after = value.slice(caret);
    const next = `${before}@${path} ${after}`;
    setValue(next);
    setMention(null);
    requestAnimationFrame(() => {
      const t = textarea();
      if (!t) return;
      const pos = before.length + path.length + 2;
      t.focus();
      t.setSelectionRange(pos, pos);
    });
  };

  const send = async () => {
    const text = value.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const message = expandMentions(text);
    try {
      if (!toAgent) {
        setValue("");
        onAsk(message);
      } else {
        setValue("");
        const res = await api.resume(boxName, message);
        if ("queued" in res && res.queued) {
          onQueued?.();
          toast("Queued for the agent", {
            description: "It is mid-turn. Your message is delivered the moment this turn finishes.",
            icon: <Clock className="size-4" />,
          });
        } else {
          onReplied(text);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setValue(text);
      toast.error("Could not send", { description: msg });
    } finally {
      setSending(false);
    }
  };

  const hint = error
    ? null
    : sleeping
      ? "Asleep. Your message restarts the sandbox — workspace and session intact — in a few seconds."
      : toAgent
        ? busy
          ? "The agent is mid-turn. Your message is queued and delivered when this turn finishes."
          : "Enter sends · continues the same agent session. Type @ to reference a file."
        : "Answered by a separate read-only helper inside the sandbox. The agent is not interrupted.";

  return (
    <div className="px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
      <div className="relative mx-auto min-w-0 max-w-3xl">
        {mention && <MentionMenu session={boxName} state={mention} onPick={pickFile} onClose={() => setMention(null)} />}
        <PromptInput
          value={value}
          onValueChange={(v) => {
            setValue(v);
            updateMention(v);
          }}
          onSubmit={() => {
            if (mention) return; // Enter inside the mention menu picks a file
            void send();
          }}
          isLoading={sending}
          className={cn(
            "bg-card rounded-2xl p-2 shadow-xs transition-[border-color,box-shadow] duration-300",
            toAgent ? "border-line-strong" : "border-border border-dashed",
            sleeping && "border-sleep/50"
          )}
        >
          <label htmlFor="send-input" className="sr-only">
            {toAgent ? "Message the agent" : "Ask a side question about this run"}
          </label>
          <PromptInputTextarea
            id="send-input"
            className="px-2.5 pt-2 text-body"
            onKeyDown={(e) => {
              if (!mention) return;
              if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
                e.preventDefault();
                e.stopPropagation();
                document.dispatchEvent(new CustomEvent("asb:mention-nav", { detail: e.key }));
              }
            }}
            onKeyUp={() => updateMention(value)}
            onClick={() => updateMention(value)}
            placeholder={
              sleeping
                ? "Send a follow-up — this wakes the sandbox…"
                : toAgent
                  ? busy
                    ? "Queue a follow-up for when this turn finishes…"
                    : "Send a follow-up instruction… (@ to mention a file)"
                  : "Ask about this run — what changed, what is it doing, why is it stuck…"
            }
          />
          <PromptInputActions className="justify-between gap-2 pt-1">
            <div className="flex items-center gap-1">
              <div
                role="radiogroup"
                aria-label="Send to"
                className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <ModeChip
                  active={toAgent}
                  onClick={() => setMode("agent")}
                  icon={busy ? <Clock className="size-3.5" /> : <Terminal className="size-3.5" />}
                  label={busy ? "Queue for agent" : "Agent"}
                />
                <ModeChip
                  active={!toAgent}
                  disabled={!canSide}
                  onClick={() => setMode("side")}
                  icon={<MessageCircleQuestion className="size-3.5" />}
                  label="Side question"
                  disabledReason="A sleeping sandbox has nothing to inspect — wake it with a message first"
                />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const t = textarea();
                      if (!t) return;
                      const caret = t.selectionStart ?? value.length;
                      const needsSpace = caret > 0 && !/\s/.test(value[caret - 1] ?? "");
                      const insert = `${needsSpace ? " " : ""}@`;
                      const next = value.slice(0, caret) + insert + value.slice(caret);
                      setValue(next);
                      requestAnimationFrame(() => {
                        t.focus();
                        const pos = caret + insert.length;
                        t.setSelectionRange(pos, pos);
                        setMention(mentionAt(next, pos));
                      });
                    }}
                    aria-label="Mention a file"
                    className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 cursor-pointer place-items-center rounded-md transition-colors"
                  >
                    <AtSign className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Mention a workspace file</TooltipContent>
              </Tooltip>
            </div>

            <p
              className={cn("hidden min-w-0 flex-1 truncate text-micro sm:block", error ? "text-destructive" : "text-muted-foreground")}
              role={error ? "alert" : undefined}
            >
              {error ?? hint}
            </p>

            <Button
              variant={toAgent ? "primary" : "outline"}
              size="icon"
              onClick={send}
              disabled={sending || !value.trim()}
              aria-label={toAgent ? (busy ? "Queue for the agent" : "Send to the agent") : "Ask a side question"}
              className="rounded-full"
            >
              {busy && toAgent ? <Clock /> : <ArrowUp />}
            </Button>
          </PromptInputActions>
        </PromptInput>

        <p className={cn("mt-1.5 min-h-4 px-1 text-center text-micro sm:hidden", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? hint}
        </p>
      </div>
    </div>
  );
}

function ModeChip({
  active,
  disabled,
  onClick,
  icon,
  label,
  disabledReason,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabledReason?: string;
}) {
  const chip = (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-micro font-medium transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-40",
        active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
  if (!disabled || !disabledReason) return chip;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          {chip}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
