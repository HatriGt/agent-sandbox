import * as React from "react";
import { CornerDownLeft, PauseCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ChatInput } from "@/components/chat/chat-input";

/**
 * The one state that needs a human. A box in `waiting` has genuinely halted — its ask-gate hook
 * denies every further tool call until an answer arrives — so this is not a notification, it is the
 * blocking control, and it leads the detail pane rather than sitting in a status column.
 *
 * `resume` is the only path that steers the driver; the co-pilot below cannot.
 */
export function WaitingBanner({
  session,
  question,
  onAnswered,
}: {
  session: string;
  question: string;
  onAnswered: () => void;
}) {
  const [value, setValue] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const send = async () => {
    const message = value.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      await api.resume(session, message);
      setValue("");
      onAnswered();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      aria-labelledby="waiting-heading"
      className="border-attention/40 bg-attention/8 rounded-lg border p-3.5"
    >
      <h2
        id="waiting-heading"
        className="text-attention flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider"
      >
        <PauseCircle className="size-3.5" aria-hidden />
        Waiting for you
      </h2>

      <p className="text-foreground mt-2 text-sm leading-relaxed whitespace-pre-wrap">{question}</p>

      <div className="border-input bg-card focus-within:border-ring focus-within:ring-ring/40 mt-3 flex items-end gap-1 rounded-md border transition-shadow focus-within:ring-[3px]">
        <label htmlFor="resume-answer" className="sr-only">
          Your answer to the agent
        </label>
        <ChatInput
          id="resume-answer"
          value={value}
          disabled={sending}
          onChange={(e) => setValue(e.target.value)}
          onSubmitMessage={send}
          placeholder="Answer to continue the run…"
        />
        <Button
          size="icon-touch"
          variant="attention"
          onClick={send}
          disabled={sending || !value.trim()}
          aria-label="Send answer and resume the run"
          className="m-1 shrink-0"
        >
          <CornerDownLeft />
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {error}
        </p>
      ) : (
        <p className="text-muted-foreground mt-2 text-xs">
          Enter sends · Shift+Enter for a new line. This is the only way to steer the agent.
        </p>
      )}
    </section>
  );
}
