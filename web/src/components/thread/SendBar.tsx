import * as React from "react";
import { ArrowUp, Eye, Terminal } from "lucide-react";
import { api, type RunState } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PromptInput, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { cn } from "@/lib/utils";

type Mode = "reply" | "ask";

/**
 * The send bar, and the one piece of real product logic in this UI.
 *
 * A chat box implies one destination, but this thread has two, and sending to the wrong one is not
 * a cosmetic mistake:
 *
 *  · REPLY goes to the agent (`resume`). It steers the run. While the agent is mid-turn there is no
 *    safe way to inject a message — a second `claude -c` against the same session would race the
 *    one already working — so reply is unavailable then, and says why instead of failing silently.
 *  · ASK goes to the read-only co-pilot (`ask`). Always available, never touches the run.
 *
 * The mode is preselected from the machine's state, because in practice there is one right answer:
 * blocked → reply; working → ask; finished → reply with a follow-up.
 */
export function SendBar({
  boxName,
  runState,
  onAsk,
  onReplied,
}: {
  boxName: string;
  runState: RunState;
  onAsk: (question: string) => void;
  onReplied: (text: string) => void;
}) {
  const canReply = runState !== "running";
  const preferred: Mode = runState === "waiting" ? "reply" : runState === "running" ? "ask" : "reply";

  const [mode, setMode] = React.useState<Mode>(preferred);
  const [value, setValue] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Follow the machine when its state changes under us, but never yank the mode out from under
  // someone who has deliberately switched and started typing.
  React.useEffect(() => {
    if (!value.trim()) setMode(preferred);
  }, [preferred, value]);

  const effective: Mode = canReply ? mode : "ask";

  const send = async () => {
    const text = value.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      if (effective === "ask") {
        setValue("");
        onAsk(text); // the parent owns the aside list, so it can render the pending state
      } else {
        // Show it in the thread immediately: a chat where your own message disappears on send is
        // broken, and the server does not echo replies back into the agent log.
        onReplied(text);
        setValue("");
        await api.resume(boxName, text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
      <div className="mx-auto min-w-0 max-w-3xl">
        {/* mode switch — a segmented control: two destinations in one container, never ambiguous */}
        <div className="mb-2 flex justify-center">
          <div
            role="tablist"
            aria-label="Message destination"
            className="inline-flex items-center gap-0.5 rounded-lg border bg-[var(--surface)] p-0.5"
          >
            <ModeTab
              active={effective === "reply"}
              disabled={!canReply}
              onClick={() => setMode("reply")}
              icon={<Terminal className="size-3" />}
              label={runState === "waiting" ? "Answer agent" : "Reply to agent"}
            />
            <ModeTab
              active={effective === "ask"}
              onClick={() => setMode("ask")}
              icon={<Eye className="size-3" />}
              label="Ask co-pilot"
            />
          </div>
        </div>

        {/* prompt-kit PromptInput: autosizing textarea + Enter-to-send, wrapping our two-destination send. */}
        <PromptInput
          value={value}
          onValueChange={setValue}
          onSubmit={send}
          isLoading={sending}
          className={cn("bg-card rounded-2xl elevate-sm", effective === "ask" && "border-dashed")}
        >
          <label htmlFor="send-input" className="sr-only">
            {effective === "reply" ? "Message the agent" : "Ask the read-only co-pilot"}
          </label>
          <PromptInputTextarea
            id="send-input"
            placeholder={
              effective === "reply"
                ? runState === "waiting"
                  ? "Answer its question to continue the run…"
                  : "Send a follow-up instruction…"
                : "Ask what it is doing, what changed, why it is stuck…"
            }
          />
          <PromptInputActions className="justify-end pt-1">
            <Button
              variant={effective === "reply" ? "primary" : "outline"}
              size="icon"
              onClick={send}
              disabled={sending || !value.trim()}
              aria-label={effective === "reply" ? "Send to the agent" : "Ask the co-pilot"}
              className="rounded-full"
            >
              <ArrowUp />
            </Button>
          </PromptInputActions>
        </PromptInput>

        <p className="text-ash mt-2 min-h-4 text-center text-micro">
          {error ? (
            <span className="text-[var(--danger)]" role="alert">
              {error}
            </span>
          ) : !canReply && effective === "ask" ? (
            "The agent is mid-turn, so it cannot be interrupted — the co-pilot reads the box without disturbing it."
          ) : effective === "ask" ? (
            "Read-only. The agent never sees this and keeps working."
          ) : runState === "waiting" ? (
            "Enter sends · this releases the halted run."
          ) : (
            "Enter sends · continues the same agent session."
          )}
        </p>
      </div>
    </div>
  );
}

function ModeTab({
  active,
  disabled,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      onClick={onClick}
      disabled={disabled}
      aria-selected={active}
      title={disabled ? "Unavailable while the agent is working" : undefined}
      className={cn(
        "stamp flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-35",
        active ? "text-ink bg-[var(--raised)] shadow-[0_1px_2px_rgba(0,0,0,0.15)]" : "text-ash hover:text-ink"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
