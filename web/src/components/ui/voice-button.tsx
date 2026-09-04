import { Mic, MicOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { VoiceState } from "@/hooks/useVoiceInput";
import { cn } from "@/lib/utils";

/**
 * The dictation control, in two pieces:
 *  - <VoiceButton>: a size-7 icon button (twin of the @ / image buttons) that morphs mic → stop.
 *    While listening it grows a soft expanding ring and a live 5-bar equalizer driven by real mic
 *    amplitude, in the --live hue (functional color: blue = actively working).
 *  - <VoicePill>: the floating "Listening…" status pill above the composer that streams the interim
 *    phrase as ghost text — words materialize here first, then commit into the textarea.
 *
 * Reduced motion: the ring and bar animation collapse to a static colored state (CSS handles the
 * keyframes side; the springs here are gentle enough, and AnimatePresence fades respect the media
 * query via the `motion-reduce` utilities on the animated bits).
 */

export function VoiceButton({
  state,
  level,
  onToggle,
  className,
}: {
  state: VoiceState;
  level: number;
  onToggle: () => void;
  className?: string;
}) {
  const listening = state === "listening" || state === "arming";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-label={listening ? "Stop dictating" : "Dictate with your voice"}
          aria-pressed={listening}
          className={cn(
            "relative grid size-7 cursor-pointer place-items-center rounded-md transition-colors",
            listening
              ? "text-live"
              : state === "error"
                ? "text-destructive hover:bg-muted"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            className
          )}
        >
          {/* Expanding ring: the "this is live" heartbeat. Hidden for reduced motion. */}
          {listening && (
            <span
              aria-hidden
              className="border-live/50 mic-ring pointer-events-none absolute inset-0 rounded-md border motion-reduce:hidden"
            />
          )}
          <AnimatePresence mode="wait" initial={false}>
            {state === "listening" ? (
              <motion.span
                key="eq"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 28 }}
                className="grid place-items-center"
              >
                <Equalizer level={level} />
              </motion.span>
            ) : state === "arming" ? (
              <motion.span key="arming" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid place-items-center">
                <Mic className="mic-breathe size-3.5" />
              </motion.span>
            ) : state === "error" ? (
              <motion.span key="err" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} className="grid place-items-center">
                <MicOff className="size-3.5" />
              </motion.span>
            ) : (
              <motion.span
                key="mic"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 28 }}
                className="grid place-items-center"
              >
                <Mic className="size-3.5" />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {listening ? "Stop — the text stays yours to edit" : state === "error" ? "Microphone blocked — allow it in the address bar" : "Dictate — words stream into the box, you press send"}
      </TooltipContent>
    </Tooltip>
  );
}

/** Five live bars, center-weighted, driven by real mic amplitude (0..1). Doubles as the stop affordance. */
function Equalizer({ level }: { level: number }) {
  // Center bars react most — reads as a voice, not a VU meter.
  const weights = [0.45, 0.8, 1, 0.8, 0.45];
  return (
    <span className="flex h-3.5 items-center gap-[2px]" aria-hidden>
      {weights.map((w, i) => (
        <span
          key={i}
          className="bg-live mic-bar w-[2px] rounded-full"
          style={{
            height: `${Math.max(3, Math.min(14, 3 + level * 24 * w))}px`,
            animationDelay: `${i * 90}ms`,
            transition: "height 90ms ease-out",
          }}
        />
      ))}
    </span>
  );
}

/**
 * The status pill + ghost transcript. Floats above the composer; finalized words leave here and
 * appear in the textarea, so the pill always shows only the phrase still in flight.
 */
export function VoicePill({ state, interim }: { state: VoiceState; interim: string }) {
  const show = state === "listening" || state === "arming";
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          className="pointer-events-none absolute -top-2 left-1/2 z-10 w-max max-w-[min(90%,42rem)] -translate-x-1/2 -translate-y-full"
          role="status"
          aria-live="polite"
        >
          <div className="bg-card/95 border-live/40 flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 shadow-e2 backdrop-blur">
            <span className="relative grid size-2 place-items-center" aria-hidden>
              <span className="bg-live absolute inset-0 rounded-full opacity-40 mcp-ping motion-reduce:hidden" />
              <span className="bg-live size-1.5 rounded-full" />
            </span>
            <span className="text-live text-micro font-medium tracking-wide">
              {state === "arming" ? "Starting…" : "Listening"}
            </span>
            <AnimatePresence mode="popLayout">
              {interim && (
                <motion.span
                  key={interim}
                  initial={{ opacity: 0.3 }}
                  animate={{ opacity: 1 }}
                  className="text-muted-foreground max-w-[32rem] truncate text-micro italic"
                >
                  {interim}
                </motion.span>
              )}
            </AnimatePresence>
            {!interim && state === "listening" && (
              <span className="text-faint text-micro">speak — words land in the box</span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
