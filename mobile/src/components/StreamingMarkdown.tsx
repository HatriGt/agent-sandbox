import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { MarkdownLite } from "./MarkdownLite";

/**
 * Mirrors web's StreamingMarkdown: the newest in-progress assistant block reveals with a typewriter
 * cadence, animating only the tail not yet shown — a poll that re-delivers text does nothing, one
 * that adds text continues from where the reveal was. Reduce-motion shows the full text at once.
 */
export function StreamingMarkdown({ text, live }: { text: string; live: boolean }) {
  const [reduced, setReduced] = useState(false);
  const [shown, setShown] = useState(live ? 0 : text.length);
  const target = useRef(text);
  target.current = text;
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => {});
  }, []);

  useEffect(() => {
    if (!live || reduced) {
      setShown(text.length);
      return;
    }
    if (shownRef.current > text.length) setShown(text.length);
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      const cur = shownRef.current;
      const end = target.current.length;
      if (cur >= end) return;
      if (ts - last >= 16) {
        last = ts;
        const next = Math.min(end, cur + Math.max(2, Math.round((end - cur) / 18)));
        shownRef.current = next;
        setShown(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, live, reduced]);

  return <MarkdownLite text={!live || reduced ? text : text.slice(0, shown)} />;
}
