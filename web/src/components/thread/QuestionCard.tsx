import * as React from "react";
import { ArrowUp, Check, ChevronDown, Pause, PenLine } from "lucide-react";
import { parseQuestion } from "@/lib/question";
import { Button } from "@/components/ui/button";
import { smartJoin, useVoiceInput } from "@/hooks/useVoiceInput";
import { VoiceButton } from "@/components/ui/voice-button";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";

/**
 * The agent's question as a real decision control — the shape Claude Code, Codex and Cursor use when
 * an agent needs the human: a one-line question, optional context, a list of selectable options with
 * a keyboard path, and a "something else" escape hatch. Answering releases the paused run, so the
 * choice is confirmed with one explicit Send rather than firing on the first click.
 *
 * Nothing about the mechanism (the sentinel file, the hook) appears here.
 */
export function QuestionCard({
  question,
  onAnswer,
  busy,
}: {
  question: string;
  onAnswer: (text: string) => void;
  busy?: boolean;
}) {
  const parsed = React.useMemo(() => parseQuestion(question), [question]);
  const hasOptions = parsed.options.length > 0;
  const [selected, setSelected] = React.useState<number | null>(null);
  const [other, setOther] = React.useState(false);
  const [custom, setCustom] = React.useState("");
  const [showContext, setShowContext] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const contextLines = parsed.context ? parsed.context.split("\n").length : 0;
  const longContext = contextLines > 4 || parsed.context.length > 420;

  React.useEffect(() => {
    setSelected(null);
    setOther(!hasOptions);
    setCustom("");
  }, [question, hasOptions]);

  // Dictate the free-text answer; sending stays behind the explicit button.
  const voice = useVoiceInput({
    onFinal: (spoken) => setCustom((prev) => prev + smartJoin(prev, spoken)),
  });

  const answer = other ? custom.trim() : selected != null ? parsed.options[selected] : "";
  const canSend = !!answer && !busy;
  const send = () => canSend && onAnswer(answer);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLTextAreaElement) return;
    const n = Number(e.key);
    if (hasOptions && n >= 1 && n <= parsed.options.length) {
      setOther(false);
      setSelected(n - 1);
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!hasOptions) return;
      e.preventDefault();
      setOther(false);
      setSelected((cur) => {
        const len = parsed.options.length;
        if (cur == null) return e.key === "ArrowDown" ? 0 : len - 1;
        return (cur + (e.key === "ArrowDown" ? 1 : -1) + len) % len;
      });
    } else if (e.key === "Enter" && canSend) {
      e.preventDefault();
      send();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      className="flex flex-col gap-1.5"
    >
      <span className="label text-attention-text flex items-center gap-1.5">
        <span className="relative grid size-3 place-items-center" aria-hidden>
          <span className="bg-attention absolute inset-0 rounded-full opacity-40 mcp-ping motion-reduce:hidden" />
          <Pause className="size-3" strokeWidth={2.5} />
        </span>
        Paused — the agent needs a decision
      </span>
      <div
        role="group"
        aria-label="Question from the agent"
        tabIndex={0}
        onKeyDown={onKey}
        className="border-attention/50 bg-card focus-visible:ring-attention/40 attention-glow max-w-[72ch] rounded-xl border outline-none focus-visible:ring-2"
      >
        <div className="px-5 pt-4 pb-3">
          <p className="text-foreground text-lead leading-[1.5] font-medium text-balance">{parsed.title || question}</p>
          {parsed.context && (
            <div className="mt-2">
              <p
                className={cn(
                  "text-muted-foreground text-meta leading-relaxed whitespace-pre-wrap",
                  longContext && !showContext && "line-clamp-3"
                )}
              >
                {parsed.context}
              </p>
              {longContext && (
                <button
                  type="button"
                  onClick={() => setShowContext((v) => !v)}
                  className="text-muted-foreground hover:text-foreground mt-1 inline-flex cursor-pointer items-center gap-1 text-micro font-medium"
                >
                  {showContext ? "Less" : "More context"}
                  <ChevronDown className={cn("size-3 transition-transform", showContext && "rotate-180")} aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>

        {hasOptions && (
          <ul role="radiogroup" aria-label="Options" className="flex flex-col gap-1 px-3 pb-2">
            {parsed.options.map((opt, i) => {
              const on = !other && selected === i;
              return (
                <li key={opt}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setOther(false);
                      setSelected(i);
                    }}
                    onDoubleClick={() => onAnswer(opt)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-left text-body transition-colors",
                      on
                        ? "border-attention bg-attention/10 text-foreground"
                        : "border-transparent hover:border-border hover:bg-muted text-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-4.5 shrink-0 place-items-center rounded-full border transition-colors",
                        on ? "border-attention bg-attention text-attention-ink" : "border-line-strong"
                      )}
                      aria-hidden
                    >
                      {on && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">{opt}</span>
                    <kbd className="text-faint hidden sm:inline">{i + 1}</kbd>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                role="radio"
                aria-checked={other}
                onClick={() => {
                  setOther(true);
                  setSelected(null);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-left text-body transition-colors",
                  other ? "border-attention bg-attention/10" : "border-transparent hover:border-border hover:bg-muted text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "grid size-4.5 shrink-0 place-items-center rounded-full border",
                    other ? "border-attention bg-attention text-attention-ink" : "border-line-strong"
                  )}
                  aria-hidden
                >
                  {other ? <Check className="size-3" strokeWidth={3} /> : <PenLine className="size-2.5" />}
                </span>
                Something else…
              </button>
            </li>
          </ul>
        )}

        {other && (
          <div className="px-3 pb-2">
            <div className={cn("bg-muted focus-within:ring-attention/50 flex items-end gap-1 rounded-md pr-1.5 transition-shadow focus-within:ring-2", (voice.state === "listening" || voice.state === "arming") && "mic-glow ring-0")}>
              <textarea
                ref={inputRef}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                placeholder={voice.state === "listening" ? (voice.interim ? voice.interim : "Listening — speak your answer…") : hasOptions ? "Type a different answer…" : "Type your answer…"}
                aria-label="Your answer"
                className="text-foreground placeholder:text-muted-foreground w-full resize-none rounded-md bg-transparent px-3 py-2 text-body outline-none"
              />
              {voice.supported && <VoiceButton state={voice.state} level={voice.level} onToggle={voice.toggle} className="mb-1.5" />}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
          <p className="text-muted-foreground min-w-0 truncate text-micro">
            {hasOptions ? "Pick one (or press its number), then send. Every tool call is blocked until you do." : "Your answer releases the paused run."}
          </p>
          <Button variant="attention" size="sm" onClick={send} disabled={!canSend} className="shrink-0">
            {busy ? "Sending…" : "Send answer"}
            <ArrowUp className="size-3.5" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
