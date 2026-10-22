import * as React from "react";
import { Check, Copy, MessageCircleQuestion, Quote } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { IconSwap } from "@/components/ui/icon-swap";
import { cn } from "@/lib/utils";

/**
 * The floating pill over a text selection in the conversation (Claude desktop's "Ask in side chat").
 * Pointer devices at md and up only; phones keep the native selection UI. It reads the document
 * selection and shows when both ends sit inside the conversation scroller, so a selection in the
 * composer, the side chat or a pane never raises it. Pointer-down inside the pill is cancelled so a
 * click never collapses the selection it acts on.
 */
export function SelectionToolbar({
  scrollerRef,
  onAsk,
  onQuote,
}: {
  scrollerRef: React.RefObject<HTMLElement | null>;
  onAsk: (text: string) => void;
  onQuote: (text: string) => void;
}) {
  const enabled = useMediaQuery("(min-width: 48rem) and (hover: hover) and (pointer: fine)");
  const still = useReducedMotion();
  const [pill, setPill] = React.useState<Pill | null>(null);
  const [copied, setCopied] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!enabled) {
      setPill(null);
      return;
    }
    let timer = 0;
    let raf = 0;
    let dragging = false;
    const compute = () => {
      const root = scrollerRef.current;
      setPill(root ? readSelection(root) : null);
    };
    // Settles 80ms after the last change, and never while the mouse button is still down mid-drag.
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!dragging) compute();
      }, DEBOUNCE_MS);
    };
    const soon = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      dragging = true;
    };
    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      later();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPill(null);
    };
    document.addEventListener("selectionchange", later);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", soon, true);
    window.addEventListener("resize", soon);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", later);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", soon, true);
      window.removeEventListener("resize", soon);
    };
  }, [enabled, scrollerRef]);

  // The pill is centred on the selection and kept inside the viewport once its real width is known.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !pill) return;
    const half = el.offsetWidth / 2;
    el.style.left = `${Math.min(Math.max(pill.x, EDGE + half), window.innerWidth - EDGE - half)}px`;
  }, [pill]);

  React.useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(t);
  }, [copied]);

  const keep = (e: React.SyntheticEvent) => e.preventDefault();
  const ask = () => {
    if (!pill) return;
    onAsk(pill.text);
    setPill(null);
  };
  const quote = () => {
    if (!pill) return;
    onQuote(pill.text);
    setPill(null);
  };
  const copy = () => {
    if (!pill) return;
    void navigator.clipboard?.writeText(pill.text).then(() => setCopied(true));
  };

  return (
    <AnimatePresence>
      {pill && (
        <motion.div
          key="selection-toolbar"
          ref={ref}
          role="toolbar"
          aria-label="Selected text"
          data-selection-toolbar
          onPointerDown={keep}
          onMouseDown={keep}
          style={{ left: pill.x, top: pill.below ? pill.y : pill.y - HEIGHT }}
          initial={{ opacity: 0, x: "-50%", y: still ? 0 : pill.below ? -4 : 4 }}
          animate={{ opacity: 1, x: "-50%", y: 0 }}
          exit={{ opacity: 0, x: "-50%", y: still ? 0 : pill.below ? -4 : 4 }}
          transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="bg-popover text-popover-foreground shadow-e3 fixed z-40 flex h-8 items-center gap-0.5 rounded-lg border p-0.5"
        >
          <PillButton primary onClick={ask}>
            <MessageCircleQuestion aria-hidden />
            Ask in side chat
          </PillButton>
          <span className="bg-border mx-0.5 h-4 w-px" aria-hidden />
          <PillButton onClick={quote}>
            <Quote aria-hidden />
            Quote in reply
          </PillButton>
          <PillButton onClick={copy} aria-label={copied ? "Copied" : "Copy the selected text"}>
            <IconSwap state={copied}>{copied ? <Check aria-hidden /> : <Copy aria-hidden />}</IconSwap>
            {copied ? "Copied" : "Copy"}
          </PillButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface Pill {
  readonly text: string;
  /** Viewport x of the selection's first line centre; the pill is centred on it. */
  readonly x: number;
  /** Viewport y the pill hangs from: above the first line, or below it when near the top. */
  readonly y: number;
  readonly below: boolean;
}

const DEBOUNCE_MS = 80;
const GAP = 8;
const EDGE = 8;
const HEIGHT = 32;
const TOP_MIN = 48;

function readSelection(root: HTMLElement): Pill | null {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  const text = sel.toString().trim();
  if (text.length < 2) return null;
  const range = sel.getRangeAt(0);
  const rects = range.getClientRects();
  const first = rects.length ? rects[0] : range.getBoundingClientRect();
  if (first.width === 0 && first.height === 0) return null;
  // Scrolled out of the conversation's own viewport: nothing to hang the pill from.
  const view = root.getBoundingClientRect();
  if (first.bottom < view.top || first.top > view.bottom) return null;
  const below = first.top < TOP_MIN;
  return { text, x: first.left + first.width / 2, y: below ? first.bottom + GAP : first.top - GAP, below };
}

function PillButton({ primary = false, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-micro whitespace-nowrap transition-colors [&_svg]:size-3.5",
        primary ? "text-foreground hover:bg-muted font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className
      )}
      {...props}
    />
  );
}
