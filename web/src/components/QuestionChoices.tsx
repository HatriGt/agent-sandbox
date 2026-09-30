import * as React from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { parseQuestion, questionChoices } from "@/lib/question";
import { cn } from "@/lib/utils";

/**
 * One-tap answers for a waiting run, right in the inbox row (docs/plan-demo-parity.md bet 1): the
 * same ≤ 3 choices the phone notification offers. The label is the button; the whole option is the
 * answer. Anything else (free text, the longer options) is one click away in the thread.
 */
export function QuestionChoices({ box, question, className }: { box: string; question: string; className?: string }) {
  const choices = React.useMemo(() => questionChoices(parseQuestion(question)), [question]);
  const [sent, setSent] = React.useState<number | null>(null);
  if (choices.length === 0) return null;
  const answer = async (i: number) => {
    if (sent != null) return;
    setSent(i);
    try {
      await api.resume(box, choices[i].answer, { force: true });
      toast.success(`Answered: ${choices[i].label}`);
    } catch (e) {
      setSent(null);
      toast.error("Could not send the answer", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <div role="group" aria-label="Quick answers" className={cn("flex flex-wrap gap-1.5", className)}>
      {choices.map((c, i) => (
        <button
          key={c.answer}
          type="button"
          disabled={sent != null}
          title={c.answer}
          onClick={() => void answer(i)}
          className={cn(
            "border-attention/40 text-foreground hover:bg-attention/10 cursor-pointer rounded-md border px-2.5 py-1 text-micro transition-colors disabled:cursor-default",
            sent === i ? "bg-attention/15 border-attention" : sent != null && "opacity-50"
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
