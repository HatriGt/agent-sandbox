import * as React from "react";
import { ArrowUp, Eye, Terminal } from "lucide-react";
import { toast } from "sonner";
import { api, type RunState } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PromptInput, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Mode = "reply" | "ask";

/**
 * The composer, and the one piece of real product logic in this UI.
 *
 * A chat box implies one destination, but this thread has two, and sending to the wrong one is not
 * cosmetic:
 *
 *  · AGENT (`resume`) steers the run. While the agent is mid-turn there is no safe way to inject a
 *    message — a second `claude -c` on the same session would race the one already working — so it
 *    is unavailable then and says why.
 *  · CO-PILOT (`ask`) is a read-only observer. Always available on a running microVM, never touches
 *    the run. A sleeping (stopped) microVM cannot be observed — only woken by a reply.
 *
 * The destination lives INSIDE the composer, on its bottom rail, so the choice and the text are one
 * object. The whole surface changes with it: solid border and ink send for the agent, dashed border
 * and outline send for the co-pilot, and an amber halo when the agent is paused on a question.
 */
export function SendBar({
  boxName,
  runState,
  sleeping = false,
  onAsk,
  onReplied,
  onFocusRequest,
}: {
  boxName: string;
  runState: RunState;
  /** The microVM is idle-stopped; a reply restarts it with its workspace and session intact. */
  sleeping?: boolean;
  onAsk: (question: string) => void;
  onReplied: (text: string) => void;
  /** Lets the parent hand focus to the textarea (the `/` shortcut). */
  onFocusRequest?: (focus: () => void) => void;
}) {
  const canReply = runState !== "running" || sleeping;
  const canAsk = !sleeping;
  const waiting = runState === "waiting";
  const preferred: Mode = !canReply ? "ask" : "reply";

  const [mode, setMode] = React.useState<Mode>(preferred);
  const [value, setValue] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!value.trim()) setMode(preferred);
  }, [preferred, value]);

  React.useEffect(() => {
    onFocusRequest?.(() => document.getElementById("send-input")?.focus());
  }, [onFocusRequest]);

  const effective: Mode = !canReply ? "ask" : !canAsk ? "reply" : mode;
  const toAgent = effective === "reply";

  const send = async () => {
    const text = value.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      if (!toAgent) {
        setValue("");
        onAsk(text);
      } else {
        onReplied(text);
        setValue("");
        await api.resume(boxName, text);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("The agent did not get your message", { description: msg });
    } finally {
      setSending(false);
    }
  };

  const hint = error
    ? null
    : sleeping
      ? "This microVM is asleep. Your reply restarts it — workspace and session intact — in a few seconds."
      : !canReply
        ? "The agent is mid-turn and cannot be interrupted. The co-pilot reads the box without disturbing it."
        : toAgent
          ? waiting
            ? "Enter sends · your answer releases the paused run."
            : "Enter sends · continues the same agent session."
          : "Read-only. The agent never sees this and keeps working.";

  return (
    <div className="px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
      <div className="mx-auto min-w-0 max-w-3xl">
        <PromptInput
          value={value}
          onValueChange={setValue}
          onSubmit={send}
          isLoading={sending}
          className={cn(
            "bg-card rounded-2xl p-2 shadow-xs transition-[border-color,box-shadow] duration-300",
            toAgent ? "border-line-strong" : "border-border border-dashed",
            toAgent && waiting && "border-attention/70 attention-glow",
            sleeping && "border-sleep/50"
          )}
        >
          <label htmlFor="send-input" className="sr-only">
            {toAgent ? "Message the agent" : "Ask the read-only co-pilot"}
          </label>
          <PromptInputTextarea
            id="send-input"
            className="px-2.5 pt-2 text-body"
            placeholder={
              sleeping
                ? waiting
                  ? "Answer its question — this wakes the machine and continues the run…"
                  : "Send a follow-up — this wakes the machine…"
                : toAgent
                  ? waiting
                    ? "Answer its question to continue the run…"
                    : "Send a follow-up instruction…"
                  : "Ask what it is doing, what changed, why it is stuck…"
            }
          />
          <PromptInputActions className="justify-between gap-2 pt-1">
            <div
              role="radiogroup"
              aria-label="Send to"
              className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <ModeChip
                active={toAgent}
                disabled={!canReply}
                onClick={() => setMode("reply")}
                icon={<Terminal className="size-3.5" />}
                label="Agent"
                disabledReason="Unavailable while the agent is working"
              />
              <ModeChip
                active={!toAgent}
                disabled={!canAsk}
                onClick={() => setMode("ask")}
                icon={<Eye className="size-3.5" />}
                label="Co-pilot"
                disabledReason="A sleeping machine cannot be observed — wake it with a reply first"
              />
            </div>

            <p
              className={cn(
                "hidden min-w-0 flex-1 truncate text-micro sm:block",
                error ? "text-destructive" : "text-muted-foreground"
              )}
              role={error ? "alert" : undefined}
            >
              {error ?? hint}
            </p>

            <Button
              variant={toAgent ? (waiting ? "attention" : "primary") : "outline"}
              size="icon"
              onClick={send}
              disabled={sending || !value.trim()}
              aria-label={toAgent ? "Send to the agent" : "Ask the co-pilot"}
              className="rounded-full"
            >
              <ArrowUp />
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
