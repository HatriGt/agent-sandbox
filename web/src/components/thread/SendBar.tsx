import * as React from "react";
import { ArrowUp, Eye, Terminal } from "lucide-react";
import { api, type RunState } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Composer } from "@/components/ui/composer";
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
}: {
  boxName: string;
  runState: RunState;
  onAsk: (question: string) => void;
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
        await api.resume(boxName, text);
        setValue("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-[var(--line)] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:px-6">
      <div className="min-w-0 max-w-3xl">
        {/* mode switch — two destinations, named, never ambiguous */}
        <div className="mb-2 flex items-center gap-1">
          <ModeTab
            active={effective === "reply"}
            disabled={!canReply}
            onClick={() => setMode("reply")}
            icon={<Terminal className="size-3" />}
            label={runState === "waiting" ? "Answer the agent" : "Reply to the agent"}
            tone="signal"
          />
          <ModeTab
            active={effective === "ask"}
            onClick={() => setMode("ask")}
            icon={<Eye className="size-3" />}
            label="Ask the co-pilot"
            tone="observer"
          />
        </div>

        <div
          className={cn(
            "flex items-end rounded-md border bg-[var(--surface)] transition-colors",
            effective === "reply"
              ? "border-[var(--line-strong)] focus-within:border-[var(--signal)]"
              : "border-[var(--line-strong)] focus-within:border-[var(--observer)]"
          )}
        >
          <label htmlFor="send-input" className="sr-only">
            {effective === "reply" ? "Message the agent" : "Ask the read-only co-pilot"}
          </label>
          <Composer
            id="send-input"
            value={value}
            disabled={sending}
            onChange={(e) => setValue(e.target.value)}
            onSend={send}
            placeholder={
              effective === "reply"
                ? runState === "waiting"
                  ? "Answer its question to continue the run…"
                  : "Send a follow-up instruction…"
                : "Ask what it is doing, what changed, why it is stuck…"
            }
          />
          <Button
            variant={effective === "reply" ? "signal" : "outline"}
            size="icon"
            onClick={send}
            disabled={sending || !value.trim()}
            aria-label={effective === "reply" ? "Send to the agent" : "Ask the co-pilot"}
            className="m-1.5"
          >
            <ArrowUp />
          </Button>
        </div>

        <p className="text-ink-faint mt-1.5 min-h-4 text-[11.5px]">
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
  tone,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone: "signal" | "observer";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={disabled ? "Unavailable while the agent is working" : undefined}
      className={cn(
        "stamp flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-35",
        active
          ? tone === "signal"
            ? "bg-signal-wash text-signal"
            : "text-[var(--observer)] [background:color-mix(in_oklch,var(--observer)_12%,transparent)]"
          : "text-ink-faint hover:text-ink-dim"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
