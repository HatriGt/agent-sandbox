import * as React from "react";
import { Markdown } from "@/components/ui/markdown";

/**
 * The live-feeling reveal for the NEWEST in-progress assistant block.
 *
 * Our source is a 3-second-polled `.agent.log`, not a token stream, so a finished paragraph would
 * otherwise pop in whole. This reveals the text with a smooth typewriter cadence — but crucially it
 * only ever animates the *tail that has not been shown yet*. When a poll delivers more text the
 * reveal continues from where it was; when a poll re-delivers text already on screen it does nothing.
 * That is what keeps it live without re-animating the whole history on every tick (the jank risk).
 *
 * Content is rendered through the same `Markdown` as static blocks, so a table/code fence that has
 * fully arrived reads correctly even mid-stream; the blinking caret marks the growing edge.
 *
 * `prefers-reduced-motion` short-circuits to showing the full text immediately (no caret, no reveal).
 */
export function StreamingMarkdown({ text }: { text: string }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = React.useState(() => (reduced ? text.length : 0));

  // The full target text lives in a ref so the rAF loop always reveals toward the latest poll's
  // content without restarting when `text` grows.
  const targetRef = React.useRef(text);
  targetRef.current = text;
  const shownRef = React.useRef(shown);
  shownRef.current = shown;

  React.useEffect(() => {
    if (reduced) {
      setShown(text.length);
      return;
    }
    // Never rewind: if the log briefly shrinks (dedupe re-emit), keep what we've shown.
    if (shownRef.current > text.length) setShown(text.length);

    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      const target = targetRef.current.length;
      const cur = shownRef.current;
      if (cur >= target) return; // caught up — idle until the next poll grows the text
      // Pace the reveal: faster when far behind (a big poll delta) so it never lags visibly, but
      // never so fast it just dumps. ~90 chars/sec baseline, scaled up by the backlog.
      if (ts - last >= 16) {
        last = ts;
        const backlog = target - cur;
        const step = Math.max(2, Math.round(backlog / 18));
        setShown(Math.min(target, cur + step));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, reduced]);

  const revealed = reduced ? text : text.slice(0, shown);
  const streaming = !reduced && shown < text.length;

  return (
    <div className="relative">
      <Markdown className="prose-agent">{revealed}</Markdown>
      {streaming && <span className="caret text-muted-foreground align-baseline" aria-hidden>▍</span>}
    </div>
  );
}

/** Track the reduced-motion preference reactively so a mid-session toggle is respected. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
