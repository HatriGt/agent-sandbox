import * as React from "react";
import { ArrowUp, Check, ChevronDown, Pause, PenLine } from "lucide-react";
import { parseQuestion } from "@/lib/question";
import { Button } from "@/components/ui/button";
import { smartJoin, useVoiceInput } from "@/hooks/useVoiceInput";
import { VoiceButton } from "@/components/ui/voice-button";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { Collapse } from "@/components/ui/collapse";
import { IconSwap } from "@/components/ui/icon-swap";

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

  // The card is the thing that needs you, so it takes focus when it appears — unless you are
  // already typing somewhere. That makes the number keys, arrows and Enter work at once, and
  // scrolls the card into view on a phone where the composer would otherwise hide it.
  const groupRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = groupRef.current;
    if (!el) return;
    const a = document.activeElement as HTMLElement | null;
    const typing = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable) && (a as HTMLInputElement).value?.length > 0;
    if (typing) return;
    const t = window.setTimeout(() => el.focus({ preventScroll: false }), 80);
    return () => window.clearTimeout(t);
  }, [question]);

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
      exit={{ opacity: 0, y: -8, scale: 0.985, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }}
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
        ref={groupRef}
        role="group"
        aria-label="Question from the agent"
        tabIndex={0}
        onKeyDown={onKey}
        className="border-attention/50 bg-card focus-visible:ring-attention/40 attention-glow attention-pulse max-w-[72ch] rounded-xl border outline-none focus-visible:ring-2"
      >
        <div className="px-5 pt-4 pb-3">
          <p className="text-foreground text-lead leading-[1.5] font-medium text-balance">{parsed.title || question}</p>
          {parsed.context && (
            <div className="mt-2">
              <motion.p
                layout
                transition={{ layout: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }}
                className={cn(
                  "text-muted-foreground text-meta leading-relaxed whitespace-pre-wrap",
                  longContext && !showContext && "line-clamp-3"
                )}
              >
                {parsed.context}
              </motion.p>
              {longContext && (
                <button
                  type="button"
                  onClick={() => setShowContext((v) => !v)}
                  className="text-muted-foreground hover:text-foreground mt-1 inline-flex cursor-pointer items-center gap-1 text-micro font-medium"
                >
                  {showContext ? "Less" : "More context"}
                  <ChevronDown className={cn("size-3 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]", showContext && "rotate-180")} aria-hidden />
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
                      <motion.span
                        initial={false}
                        animate={on ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
                        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        className="grid place-items-center"
                      >
                        <Check className="size-3" strokeWidth={3} />
                      </motion.span>
                    </span>
                    <span className="min-w-0 flex-1">
                      {/* "Label | detail" (src/drivers/prompts.ts): label reads first, detail muted. */}
                      {opt.includes(" | ") ? (
                        <>
                          {opt.slice(0, opt.indexOf(" | "))}
                          <span className="text-muted-foreground"> — {opt.slice(opt.indexOf(" | ") + 3)}</span>
                        </>
                      ) : (
                        opt
                      )}
                    </span>
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
                  <IconSwap state={other}>{other ? <Check className="size-3" strokeWidth={3} /> : <PenLine className="size-2.5" />}</IconSwap>
                </span>
                Something else…
              </button>
            </li>
          </ul>
        )}

        <Collapse open={other}>
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
        </Collapse>

        <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
          {/* Phone: the clause truncated mid-word beside the button; two lines read, one chopped line
              does not. The number-key hint only applies with a keyboard anyway. */}
          <p className="text-muted-foreground min-w-0 text-micro leading-snug line-clamp-2 sm:line-clamp-none sm:truncate">
            <span className="sm:hidden">{hasOptions ? "Pick one, then send. The agent waits until you do." : "Your answer releases the paused run."}</span>
            <span className="hidden sm:inline">{hasOptions ? "Pick one (or press its number), then send. Every tool call is blocked until you do." : "Your answer releases the paused run."}</span>
          </p>
          <Button variant="attention" size="sm" onClick={send} disabled={!canSend} loading={busy} className="min-w-[8.5rem] shrink-0">
            <ArrowUp className="size-3.5" />
            Send answer
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
