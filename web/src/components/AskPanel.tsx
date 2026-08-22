import * as React from "react";
import { Eye, RotateCcw, Send, User } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatBubble, ChatBubbleAvatar, ChatBubbleMessage } from "@/components/chat/chat-bubble";
import { ChatMessageList } from "@/components/chat/chat-message-list";

interface Msg {
  role: "you" | "copilot" | "error";
  text: string;
}

/**
 * The co-pilot lane: a chat with a READ-ONLY observer running inside the same box. It can read the
 * workspace, the diff, and the driver's live log; it cannot change anything and cannot talk to the
 * driver. The agent keeps working throughout and never sees this conversation.
 *
 * That distinction is load-bearing, so it is stated in the UI and carried in the bubble styling
 * (dashed border, distinct avatar) — someone who mistakes this for a steering channel will type an
 * instruction and be silently ignored.
 *
 * Transcripts are keyed by session in the parent, so switching boxes and coming back keeps history.
 */
export function AskPanel({
  session,
  messages,
  setMessages,
}: {
  session: string;
  messages: Msg[];
  setMessages: (next: Msg[]) => void;
}) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const send = async (newThread = false) => {
    const question = value.trim();
    if (!question || busy) return;
    const base = newThread ? [] : messages;
    const next: Msg[] = [...base, { role: "you", text: question }];
    setMessages(next);
    setValue("");
    setBusy(true);
    try {
      const res = await api.ask(session, question, newThread);
      const answer = res.answer || "(the co-pilot returned nothing)";
      setMessages([
        ...next,
        {
          role: "copilot",
          text: res.timedOut ? `${answer}\n\n(time cap reached — this answer may be partial)` : answer,
        },
      ]);
    } catch (e) {
      setMessages([...next, { role: "error", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="ask-heading" className="bg-card flex min-h-0 flex-col rounded-lg border">
      <header className="flex items-center gap-2 border-b px-3.5 py-2.5">
        <Eye className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        <h2 id="ask-heading" className="text-sm font-semibold">
          Co-pilot
        </h2>
        <span className="text-muted-foreground truncate text-xs">read-only · never interrupts the agent</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto shrink-0"
          onClick={() => void send(true)}
          disabled={busy || !messages.length || !value.trim()}
          title="Ask in a fresh thread, discarding this context"
        >
          <RotateCcw /> New thread
        </Button>
      </header>

      {messages.length === 0 && !busy ? (
        <div className="text-muted-foreground px-3.5 py-6 text-center text-xs">
          <p className="text-foreground mb-1 text-sm font-medium">Ask about this run</p>
          <p className="mx-auto max-w-[42ch] leading-relaxed">
            “What has it changed so far?” · “Why is it stuck?” · “Show me the diff.” The agent keeps working while
            you ask.
          </p>
        </div>
      ) : (
        <ChatMessageList className="max-h-80">
          {messages.map((m, i) =>
            m.role === "you" ? (
              <ChatBubble key={i} variant="sent">
                <ChatBubbleAvatar className="bg-accent/15 border-accent/30 text-accent">
                  <User />
                </ChatBubbleAvatar>
                <ChatBubbleMessage variant="sent">{m.text}</ChatBubbleMessage>
              </ChatBubble>
            ) : (
              <ChatBubble key={i} variant="received">
                <ChatBubbleAvatar>
                  <Eye />
                </ChatBubbleAvatar>
                <ChatBubbleMessage variant={m.role === "error" ? "error" : "copilot"}>{m.text}</ChatBubbleMessage>
              </ChatBubble>
            )
          )}
          {busy && (
            <ChatBubble variant="received">
              <ChatBubbleAvatar>
                <Eye />
              </ChatBubbleAvatar>
              <ChatBubbleMessage variant="copilot" isLoading />
            </ChatBubble>
          )}
        </ChatMessageList>
      )}

      <div className="border-t p-2">
        <div className="border-input bg-background focus-within:border-ring focus-within:ring-ring/40 flex items-end gap-1 rounded-md border transition-shadow focus-within:ring-[3px]">
          <label htmlFor="ask-input" className="sr-only">
            Ask the read-only co-pilot about this run
          </label>
          <ChatInput
            id="ask-input"
            value={value}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onSubmitMessage={() => void send(false)}
            placeholder="Ask about this run…"
          />
          <Button
            size="icon-touch"
            onClick={() => void send(false)}
            disabled={busy || !value.trim()}
            aria-label="Ask the co-pilot"
            className="m-1 shrink-0"
          >
            <Send />
          </Button>
        </div>
      </div>
    </section>
  );
}

export type { Msg as AskMessage };
