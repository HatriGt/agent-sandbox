import * as React from "react";
import { useReducedMotion } from "@/lib/motion-pref";
import { Markdown } from "@/components/ui/markdown";
import { stabilizeMarkdown } from "@/lib/markdown-stream";
import { cn } from "@/lib/utils";
import { useLiveRewrite } from "@/components/viz/live-blocks";

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
 * Reduced motion (the in-app setting) short-circuits to showing the full text immediately (no caret, no reveal).
 */
export function StreamingMarkdown({ text, live = true }: { text: string; live?: boolean }) {
  // A finished reply renders through the SAME element tree as the live one, so the visualizers
  // that grew while it streamed stay mounted when it ends — no remount, no replayed draw-in.
  const reduced = useReducedMotion() || !live;
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
  // Render the slice as the stable document it is becoming: a fence still being typed is hidden and
  // an open fence is virtually closed, so a code block never flickers in as prose-then-panel. The
  // FULL text is stabilised too: the agent is mid-reply, so the log's tail can be an open fence.
  const safe = React.useMemo(() => (live ? stabilizeMarkdown(revealed) : text), [live, revealed, text]);
  // A visual the agent re-emits under the same name renders once, at its first position, in its
  // latest version; later copies collapse to a row (lib/viz-identity.ts).
  const shownMd = useLiveRewrite(safe);

  // The caret belongs to the whole live reply, not just to the reveal: between two log deltas the
  // agent is still writing, and a caret that vanished there made every pause look like the end.
  // It sits inline after the last glyph (see styles/thread.css) and blinks only once caught up.
  return (
    <div className={cn("relative", live && "md-live", streaming && "md-catching-up")}>
      <Markdown className="prose-agent">{shownMd}</Markdown>
      {live && <span className="md-caret-block" aria-hidden />}
    </div>
  );
}

